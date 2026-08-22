/**
 * Read layer — the three payloads from SPEC's "Data fetching contract".
 * Access is enforced here as well as in actions: every query is scoped to
 * the acting user's memberships, so a page can never render a board the
 * viewer doesn't belong to.
 */
import { and, asc, desc, eq, inArray, lt, ne, or } from 'drizzle-orm';
import { sdk } from '@sovereignfs/sdk';
import type { KanbanDb } from '../_db/client';
import * as schema from '../_db/schema';
import { ACTIVITY_PAGE_SIZE, activityCursorFor, type ActivityCursor } from './activity-pagination';
import { getProjectRole, type Actor } from './authz';
import type { MemberIdentity } from './identity';

// ---------------------------------------------------------------------------
// Home payload

export interface HomeBoard {
  id: string;
  name: string;
  color: string;
  projectId: string;
  /** Phase 2 (K.18) — 'viewer' means read-only access; unused by UI until K.21. */
  role: 'owner' | 'member' | 'viewer';
}

export interface HomeProject {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  isCreator: boolean;
  /** Phase 2 (K.18) — the actor's own `kanban_project_members` role. */
  role: 'owner' | 'member';
  /** Phase 2 (K.18) — 'public' | 'private'; unused by UI until K.19's visibility toggle. */
  visibility: string;
  /** Phase 2 (K.19) — every project member, for the share dialog. */
  members: Array<MemberIdentity & { role: string }>;
  boards: HomeBoard[];
}

/**
 * Projects the actor belongs to via `kanban_project_members` (K.18 — this
 * replaces the old created-by/board-membership-derived sourcing; every
 * project has an owner row for at least its creator, seeded either by
 * `createProject` or K.17's migration backfill), each with its boards:
 * explicit board memberships (edit access, unchanged from Phase 1) plus any
 * boards the actor can merely view — every board in a project they own, or
 * public boards in a public project they're a member of. `isCreator` is
 * untouched from Phase 1 (still `created_by`-derived) — it and project
 * ownership are equivalent until K.19 adds a promote-to-owner UI, so there's
 * no behavior change here yet.
 */
export async function getHomeData(db: KanbanDb, actor: Actor): Promise<HomeProject[]> {
  const myMemberships = await db
    .select({ projectId: schema.projectMembers.projectId, role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .where(
      and(
        eq(schema.projectMembers.userId, actor.userId),
        eq(schema.projectMembers.tenantId, actor.tenantId),
      ),
    );
  if (myMemberships.length === 0) return [];

  const roleByProject = new Map(
    myMemberships.map((m) => [m.projectId, m.role === 'owner' ? 'owner' : 'member'] as const),
  );
  const projectIds = [...roleByProject.keys()];

  // Sorted in JS via `localeCompare`, not a SQL `orderBy` — SQLite's default
  // BINARY collation is case-sensitive (every uppercase name would sort
  // before every lowercase one), and this list is never large enough
  // (a user's own project count) to need the DB to do the sorting.
  const projectRows = (
    await db
      .select()
      .from(schema.projects)
      .where(inArray(schema.projects.id, projectIds))
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Every member of every one of these projects (K.19's share dialog needs
  // the full list, not just the actor's own row), resolved to directory
  // identities in one batched call rather than per-project.
  const allMemberRows = await db
    .select({
      projectId: schema.projectMembers.projectId,
      userId: schema.projectMembers.userId,
      role: schema.projectMembers.role,
    })
    .from(schema.projectMembers)
    .where(inArray(schema.projectMembers.projectId, projectIds));
  const memberDirectoryUsers =
    allMemberRows.length === 0
      ? []
      : await sdk.directory.resolveUsers({
          ids: [...new Set(allMemberRows.map((m) => m.userId))],
        });
  const memberDirectoryById = new Map(memberDirectoryUsers.map((u) => [u.id, u]));
  const membersByProject = new Map<string, Array<MemberIdentity & { role: string }>>();
  for (const m of allMemberRows) {
    const list = membersByProject.get(m.projectId) ?? [];
    list.push({
      userId: m.userId,
      role: m.role,
      name: memberDirectoryById.get(m.userId)?.name ?? null,
      email: memberDirectoryById.get(m.userId)?.email ?? null,
      image: memberDirectoryById.get(m.userId)?.image ?? null,
    });
    membersByProject.set(m.projectId, list);
  }

  const result: HomeProject[] = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    createdBy: p.createdBy,
    isCreator: p.createdBy === actor.userId,
    role: roleByProject.get(p.id) ?? 'member',
    visibility: p.visibility,
    members: membersByProject.get(p.id) ?? [],
    boards: [],
  }));
  const projectById = new Map(result.map((p) => [p.id, p]));
  const seenBoardIds = new Set<string>();

  // Explicit board memberships — edit access, exactly Phase 1's query.
  const memberBoardRows = await db
    .select({
      id: schema.boards.id,
      name: schema.boards.name,
      color: schema.boards.color,
      projectId: schema.boards.projectId,
      role: schema.boardMembers.role,
    })
    .from(schema.boards)
    .innerJoin(
      schema.boardMembers,
      and(
        eq(schema.boardMembers.boardId, schema.boards.id),
        eq(schema.boardMembers.userId, actor.userId),
        eq(schema.boardMembers.tenantId, actor.tenantId),
      ),
    )
    .orderBy(asc(schema.boards.createdAt));

  for (const b of memberBoardRows) {
    const project = projectById.get(b.projectId);
    if (!project) continue;
    project.boards.push({
      id: b.id,
      name: b.name,
      color: b.color,
      projectId: b.projectId,
      role: b.role === 'owner' ? 'owner' : 'member',
    });
    seenBoardIds.add(b.id);
  }

  // Read-only boards: every board in a project the actor owns, or public
  // boards in a public project the actor is a plain member of. Explicit
  // memberships above already cover edit access for any of these boards.
  const ownedProjectIds = projectRows
    .filter((p) => roleByProject.get(p.id) === 'owner')
    .map((p) => p.id);
  const publicMemberProjectIds = projectRows
    .filter((p) => roleByProject.get(p.id) === 'member' && p.visibility === 'public')
    .map((p) => p.id);
  const viewerCandidateProjectIds = [...ownedProjectIds, ...publicMemberProjectIds];

  if (viewerCandidateProjectIds.length > 0) {
    const candidateBoardRows = await db
      .select({
        id: schema.boards.id,
        name: schema.boards.name,
        color: schema.boards.color,
        projectId: schema.boards.projectId,
        visibility: schema.boards.visibility,
      })
      .from(schema.boards)
      .where(inArray(schema.boards.projectId, viewerCandidateProjectIds))
      .orderBy(asc(schema.boards.createdAt));

    const ownedProjectIdSet = new Set(ownedProjectIds);
    for (const b of candidateBoardRows) {
      if (seenBoardIds.has(b.id)) continue;
      const ownsProject = ownedProjectIdSet.has(b.projectId);
      if (!ownsProject && b.visibility !== 'public') continue;
      const project = projectById.get(b.projectId);
      if (!project) continue;
      project.boards.push({ id: b.id, name: b.name, color: b.color, projectId: b.projectId, role: 'viewer' });
      seenBoardIds.add(b.id);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Board payload

export interface BoardCardSummary {
  id: string;
  title: string;
  listId: string;
  position: number;
  dueDate: number | null;
  labels: Array<{ id: string; name: string; color: string }>;
  assigneeCount: number;
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
}

export interface BoardList {
  id: string;
  name: string;
  position: number;
  cardCount: number;
}

export interface BoardData {
  id: string;
  name: string;
  color: string;
  projectId: string;
  /**
   * 'viewer' (K.18) — read-only access via project ownership or a public
   * project + public board, never an explicit `kanban_board_members` row.
   * Every mutation action still checks board membership directly and never
   * treats 'viewer' as passing, so this is purely a read-side addition. The
   * board renders fully for a viewer even though no read-only UI exists
   * yet (K.21) — mutation attempts are denied server-side in the meantime,
   * just without a friendly disabled-affordance UI around them.
   */
  role: 'owner' | 'member' | 'viewer';
  members: Array<MemberIdentity & { role: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  lists: BoardList[];
  cards: BoardCardSummary[];
}

/**
 * Full board payload, or null when the actor has no access at all (not a
 * board member, not a project owner, and not a project member of a public
 * project + public board — K.18).
 */
export async function getBoardData(
  db: KanbanDb,
  boardId: string,
  actor: Actor,
): Promise<BoardData | null> {
  const boardRows = await db
    .select({
      id: schema.boards.id,
      name: schema.boards.name,
      color: schema.boards.color,
      projectId: schema.boards.projectId,
      boardVisibility: schema.boards.visibility,
      projectVisibility: schema.projects.visibility,
      memberRole: schema.boardMembers.role,
    })
    .from(schema.boards)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.boards.projectId))
    .leftJoin(
      schema.boardMembers,
      and(
        eq(schema.boardMembers.boardId, schema.boards.id),
        eq(schema.boardMembers.userId, actor.userId),
        eq(schema.boardMembers.tenantId, actor.tenantId),
      ),
    )
    .where(eq(schema.boards.id, boardId));
  const boardRow = boardRows[0];
  if (!boardRow) return null;

  let role: 'owner' | 'member' | 'viewer';
  if (boardRow.memberRole === 'owner' || boardRow.memberRole === 'member') {
    role = boardRow.memberRole;
  } else {
    const projectRole = await getProjectRole(db, boardRow.projectId, actor);
    if (projectRole === 'owner') {
      role = 'viewer';
    } else if (
      projectRole === 'member' &&
      boardRow.projectVisibility === 'public' &&
      boardRow.boardVisibility === 'public'
    ) {
      role = 'viewer';
    } else {
      return null;
    }
  }
  const board = { id: boardRow.id, name: boardRow.name, color: boardRow.color, projectId: boardRow.projectId };

  const [memberRows, boardLabels, listRows, cardRows] = await Promise.all([
    db
      .select({ userId: schema.boardMembers.userId, role: schema.boardMembers.role })
      .from(schema.boardMembers)
      .where(eq(schema.boardMembers.boardId, boardId)),
    db
      .select({ id: schema.labels.id, name: schema.labels.name, color: schema.labels.color })
      .from(schema.labels)
      .where(eq(schema.labels.boardId, boardId)),
    db
      .select({
        id: schema.lists.id,
        name: schema.lists.name,
        position: schema.lists.position,
      })
      .from(schema.lists)
      .where(eq(schema.lists.boardId, boardId))
      .orderBy(asc(schema.lists.position)),
    db
      .select({
        id: schema.cards.id,
        title: schema.cards.title,
        listId: schema.cards.listId,
        position: schema.cards.position,
        dueDate: schema.cards.dueDate,
      })
      .from(schema.cards)
      .where(eq(schema.cards.boardId, boardId))
      .orderBy(asc(schema.cards.position)),
  ]);

  const cardIds = cardRows.map((c) => c.id);
  const [labelLinks, assigneeRows, checklistRows, commentRows] =
    cardIds.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          db
            .select({ cardId: schema.cardLabels.cardId, labelId: schema.cardLabels.labelId })
            .from(schema.cardLabels)
            .where(inArray(schema.cardLabels.cardId, cardIds)),
          db
            .select({ cardId: schema.cardAssignees.cardId })
            .from(schema.cardAssignees)
            .where(inArray(schema.cardAssignees.cardId, cardIds)),
          db
            .select({ cardId: schema.checklistItems.cardId, done: schema.checklistItems.done })
            .from(schema.checklistItems)
            .where(inArray(schema.checklistItems.cardId, cardIds)),
          db
            .select({ cardId: schema.comments.cardId })
            .from(schema.comments)
            .where(inArray(schema.comments.cardId, cardIds)),
        ]);

  const labelById = new Map(boardLabels.map((l) => [l.id, l]));
  const cards: BoardCardSummary[] = cardRows.map((c) => ({
    id: c.id,
    title: c.title,
    listId: c.listId,
    position: c.position,
    dueDate: c.dueDate,
    labels: [],
    assigneeCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    commentCount: 0,
  }));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  for (const link of labelLinks) {
    const label = labelById.get(link.labelId);
    const card = cardById.get(link.cardId);
    if (label && card) card.labels.push(label);
  }
  for (const a of assigneeRows) {
    const card = cardById.get(a.cardId);
    if (card) card.assigneeCount++;
  }
  for (const item of checklistRows) {
    const card = cardById.get(item.cardId);
    if (!card) continue;
    card.checklistTotal++;
    if (item.done === 1) card.checklistDone++;
  }
  for (const c of commentRows) {
    const card = cardById.get(c.cardId);
    if (card) card.commentCount++;
  }

  const countByList = new Map<string, number>();
  for (const c of cards) countByList.set(c.listId, (countByList.get(c.listId) ?? 0) + 1);

  // K.9: resolve each member's directory name/email so avatars, the share
  // dialog, and every displayName() call site can show a real person
  // instead of a raw id. A departed/deactivated user simply isn't in the
  // result — name/email fall back to null, and displayName() falls back to
  // the raw id.
  const directoryUsers =
    memberRows.length === 0
      ? []
      : await sdk.directory.resolveUsers({ ids: memberRows.map((m) => m.userId) });
  const directoryById = new Map(directoryUsers.map((u) => [u.id, u]));
  const members: Array<MemberIdentity & { role: string }> = memberRows.map((m) => ({
    userId: m.userId,
    role: m.role,
    name: directoryById.get(m.userId)?.name ?? null,
    email: directoryById.get(m.userId)?.email ?? null,
    image: directoryById.get(m.userId)?.image ?? null,
  }));

  return {
    id: board.id,
    name: board.name,
    color: board.color,
    projectId: board.projectId,
    role,
    members,
    labels: boardLabels,
    lists: listRows.map((l) => ({ ...l, cardCount: countByList.get(l.id) ?? 0 })),
    cards,
  };
}

// ---------------------------------------------------------------------------
// Card detail payload

// Re-exported so existing server-side callers (actions.ts, tests) don't need
// to know these moved to a dedicated sdk-free module — see
// activity-pagination.ts's own doc comment for why they had to move.
export { ACTIVITY_PAGE_SIZE, activityCursorFor, type ActivityCursor } from './activity-pagination';

export interface CardDetail {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  description: string | null;
  dueDate: number | null;
  createdBy: string;
  createdAt: number;
  labels: Array<{ id: string; name: string; color: string }>;
  assignees: Array<{ userId: string; assignedBy: string }>;
  checklist: Array<{ id: string; text: string; done: boolean; position: number }>;
  comments: Array<{
    id: string;
    parentId: string | null;
    authorId: string;
    body: string;
    createdAt: number;
  }>;
  activity: Array<{
    id: string;
    actorId: string;
    type: string;
    payload: unknown;
    createdAt: number;
  }>;
}

/** Full card payload (fetched when the detail surface opens), or null without access. */
export async function getCardDetail(
  db: KanbanDb,
  cardId: string,
  actor: Actor,
): Promise<CardDetail | null> {
  const rows = await db
    .select({
      id: schema.cards.id,
      boardId: schema.cards.boardId,
      listId: schema.cards.listId,
      title: schema.cards.title,
      description: schema.cards.description,
      dueDate: schema.cards.dueDate,
      createdBy: schema.cards.createdBy,
      createdAt: schema.cards.createdAt,
    })
    .from(schema.cards)
    .innerJoin(
      schema.boardMembers,
      and(
        eq(schema.boardMembers.boardId, schema.cards.boardId),
        eq(schema.boardMembers.userId, actor.userId),
        eq(schema.boardMembers.tenantId, actor.tenantId),
      ),
    )
    .where(eq(schema.cards.id, cardId));
  const card = rows[0];
  if (!card) return null;

  const [labelRows, assignees, checklist, commentRows, activityRows] = await Promise.all([
    db
      .select({ id: schema.labels.id, name: schema.labels.name, color: schema.labels.color })
      .from(schema.cardLabels)
      .innerJoin(schema.labels, eq(schema.labels.id, schema.cardLabels.labelId))
      .where(eq(schema.cardLabels.cardId, cardId)),
    db
      .select({ userId: schema.cardAssignees.userId, assignedBy: schema.cardAssignees.assignedBy })
      .from(schema.cardAssignees)
      .where(eq(schema.cardAssignees.cardId, cardId)),
    db
      .select({
        id: schema.checklistItems.id,
        text: schema.checklistItems.text,
        done: schema.checklistItems.done,
        position: schema.checklistItems.position,
      })
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.cardId, cardId))
      .orderBy(asc(schema.checklistItems.position)),
    db
      .select({
        id: schema.comments.id,
        parentId: schema.comments.parentId,
        authorId: schema.comments.authorId,
        body: schema.comments.body,
        createdAt: schema.comments.createdAt,
      })
      .from(schema.comments)
      .where(eq(schema.comments.cardId, cardId))
      .orderBy(asc(schema.comments.createdAt)),
    db
      .select({
        id: schema.activity.id,
        actorId: schema.activity.actorId,
        type: schema.activity.type,
        payload: schema.activity.payload,
        createdAt: schema.activity.createdAt,
      })
      .from(schema.activity)
      .where(eq(schema.activity.cardId, cardId))
      .orderBy(desc(schema.activity.createdAt), desc(schema.activity.id))
      .limit(ACTIVITY_PAGE_SIZE),
  ]);

  return {
    ...card,
    labels: labelRows,
    assignees,
    checklist: checklist.map((i) => ({ ...i, done: i.done === 1 })),
    comments: commentRows,
    activity: activityRows.map((a) => ({
      ...a,
      payload: a.payload === null ? null : (JSON.parse(a.payload) as unknown),
    })),
  };
}

// ---------------------------------------------------------------------------
// Activity pagination (K.8) — page 1 comes from `getCardDetail` above; the
// card overlay's "Load more" calls `getActivityPage` (via the
// `getMoreCardActivity` action) for subsequent pages using the same
// `(createdAt, id)` cursor and ordering, so a page boundary can never
// duplicate or skip a row that shares a millisecond timestamp with its
// neighbour. `ActivityCursor`/`activityCursorFor` themselves live in
// `activity-pagination.ts` (see that file's doc comment) and are re-exported
// above.

export interface ActivityPage {
  items: CardDetail['activity'];
  nextCursor: ActivityCursor | null;
}

export async function getActivityPage(
  db: KanbanDb,
  cardId: string,
  cursor: ActivityCursor,
): Promise<ActivityPage> {
  const rows = await db
    .select({
      id: schema.activity.id,
      actorId: schema.activity.actorId,
      type: schema.activity.type,
      payload: schema.activity.payload,
      createdAt: schema.activity.createdAt,
    })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.cardId, cardId),
        or(
          lt(schema.activity.createdAt, cursor.createdAt),
          and(eq(schema.activity.createdAt, cursor.createdAt), lt(schema.activity.id, cursor.id)),
        ),
      ),
    )
    .orderBy(desc(schema.activity.createdAt), desc(schema.activity.id))
    .limit(ACTIVITY_PAGE_SIZE);

  const items = rows.map((a) => ({
    ...a,
    payload: a.payload === null ? null : (JSON.parse(a.payload) as unknown),
  }));
  return { items, nextCursor: activityCursorFor(items) };
}

// ---------------------------------------------------------------------------
// Inbox (K.11, redesigned)

export const INBOX_PAGE_SIZE = 100;

/**
 * "assigned" = actor was assigned to the card by someone else. "reply" =
 * someone replied to one of the actor's own comments. Deliberately narrower
 * than a per-board activity log (that's `CardDetail['activity']`, rendered
 * in the card detail panel via `describeActivity()`) — the Inbox is "things
 * that happened *to* you," not "everything that happened on your boards."
 * @-mentions are out of scope: this plugin has no mention parsing anywhere
 * yet, so there's no `'mention'` kind here to add later without new
 * infrastructure first.
 */
export interface InboxItem {
  id: string;
  kind: 'assigned' | 'reply';
  boardId: string;
  boardName: string;
  cardId: string;
  cardTitle: string;
  actorId: string;
  createdAt: number;
}

export interface InboxFeed {
  items: InboxItem[];
  members: MemberIdentity[];
}

/**
 * Personalized Inbox (K.11 redesign) — "cards assigned to me" and "replies
 * to my comments," queried straight from the source-of-truth tables
 * (`kanban_card_assignees`, `kanban_comments`) rather than scanning
 * `kanban_activity`: that log's `payload` is opaque JSON `text` with no
 * native query support, so filtering "is this about me" through it would
 * mean fetching every board's activity and parsing JSON in application
 * code — the same "everything, unfiltered" shape this redesign replaces.
 * Both queries below lean on their own indexed columns instead
 * (`kanban_card_assignees_user_idx`; the new `kanban_comments_author_idx`/
 * `kanban_comments_parent_idx` pair, used as a two-step "find my comment
 * ids, then find replies to them" rather than a self-join, so each step can
 * use its own index rather than scanning the whole comments table).
 *
 * Self-assignment and replying to your own comment are excluded (matches
 * `assignMember`/`addComment`'s own notification dedup — you don't need to
 * be told about your own action). Capped at `INBOX_PAGE_SIZE`, newest first,
 * no further pagination — same deliberate Phase 1 scope as before.
 */
export async function getInboxFeed(db: KanbanDb, actor: Actor): Promise<InboxFeed> {
  const [assignedRows, myCommentRows] = await Promise.all([
    db
      .select({
        cardId: schema.cardAssignees.cardId,
        actorId: schema.cardAssignees.assignedBy,
        createdAt: schema.cardAssignees.createdAt,
      })
      .from(schema.cardAssignees)
      .where(
        and(
          eq(schema.cardAssignees.userId, actor.userId),
          eq(schema.cardAssignees.tenantId, actor.tenantId),
          ne(schema.cardAssignees.assignedBy, actor.userId),
        ),
      )
      .orderBy(desc(schema.cardAssignees.createdAt))
      .limit(INBOX_PAGE_SIZE),
    db
      .select({ id: schema.comments.id })
      .from(schema.comments)
      .where(
        and(eq(schema.comments.authorId, actor.userId), eq(schema.comments.tenantId, actor.tenantId)),
      ),
  ]);

  const myCommentIds = myCommentRows.map((c) => c.id);
  const replyRows =
    myCommentIds.length === 0
      ? []
      : await db
          .select({
            id: schema.comments.id,
            cardId: schema.comments.cardId,
            actorId: schema.comments.authorId,
            createdAt: schema.comments.createdAt,
          })
          .from(schema.comments)
          .where(
            and(
              inArray(schema.comments.parentId, myCommentIds),
              ne(schema.comments.authorId, actor.userId),
            ),
          )
          .orderBy(desc(schema.comments.createdAt))
          .limit(INBOX_PAGE_SIZE);

  if (assignedRows.length === 0 && replyRows.length === 0) return { items: [], members: [] };

  const cardIds = [...new Set([...assignedRows.map((r) => r.cardId), ...replyRows.map((r) => r.cardId)])];
  const cardRows = await db
    .select({ id: schema.cards.id, title: schema.cards.title, boardId: schema.cards.boardId })
    .from(schema.cards)
    .where(inArray(schema.cards.id, cardIds));
  const cardById = new Map(cardRows.map((c) => [c.id, c]));

  const boardIds = [...new Set(cardRows.map((c) => c.boardId))];
  const boardRows =
    boardIds.length === 0
      ? []
      : await db
          .select({ id: schema.boards.id, name: schema.boards.name })
          .from(schema.boards)
          .where(inArray(schema.boards.id, boardIds));
  const boardNameById = new Map(boardRows.map((b) => [b.id, b.name]));

  // A card can have been deleted between the assignment/reply and this read
  // (no cascading cleanup on the Inbox side) — skip rather than render a
  // dangling row with no title/board to show.
  function toItem(
    kind: InboxItem['kind'],
    id: string,
    cardId: string,
    actorId: string,
    createdAt: number,
  ): InboxItem | null {
    const card = cardById.get(cardId);
    if (!card) return null;
    return {
      id,
      kind,
      boardId: card.boardId,
      boardName: boardNameById.get(card.boardId) ?? 'Unknown board',
      cardId,
      cardTitle: card.title,
      actorId,
      createdAt,
    };
  }

  const items = [
    ...assignedRows.map((r) =>
      toItem('assigned', `assigned:${r.cardId}:${actor.userId}`, r.cardId, r.actorId, r.createdAt),
    ),
    ...replyRows.map((r) => toItem('reply', r.id, r.cardId, r.actorId, r.createdAt)),
  ]
    .filter((i): i is InboxItem => i !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, INBOX_PAGE_SIZE);

  const actorIds = [...new Set(items.map((i) => i.actorId))];
  const directoryUsers =
    actorIds.length === 0 ? [] : await sdk.directory.resolveUsers({ ids: actorIds });
  const directoryById = new Map(directoryUsers.map((u) => [u.id, u]));
  const members: MemberIdentity[] = actorIds.map((userId) => ({
    userId,
    name: directoryById.get(userId)?.name ?? null,
    email: directoryById.get(userId)?.email ?? null,
    image: directoryById.get(userId)?.image ?? null,
  }));

  return { items, members };
}

/**
 * For the sidebar's unseen badge — a cheap existence check, not a full feed
 * fetch. Mirrors `getInboxFeed`'s own self-exclusion (no badge for your own
 * self-assignment or a reply to your own comment).
 */
export async function hasUnseenInboxActivity(db: KanbanDb, actor: Actor): Promise<boolean> {
  const [seenRows, latestAssignedRows, myCommentRows] = await Promise.all([
    db
      .select({ lastSeenAt: schema.inboxState.lastSeenAt })
      .from(schema.inboxState)
      .where(eq(schema.inboxState.userId, actor.userId)),
    db
      .select({ createdAt: schema.cardAssignees.createdAt })
      .from(schema.cardAssignees)
      .where(
        and(
          eq(schema.cardAssignees.userId, actor.userId),
          eq(schema.cardAssignees.tenantId, actor.tenantId),
          ne(schema.cardAssignees.assignedBy, actor.userId),
        ),
      )
      .orderBy(desc(schema.cardAssignees.createdAt))
      .limit(1),
    db
      .select({ id: schema.comments.id })
      .from(schema.comments)
      .where(
        and(eq(schema.comments.authorId, actor.userId), eq(schema.comments.tenantId, actor.tenantId)),
      ),
  ]);

  const lastSeenAt = seenRows[0]?.lastSeenAt ?? null;

  const latestAssignedAt = latestAssignedRows[0]?.createdAt;
  if (latestAssignedAt !== undefined && (lastSeenAt === null || latestAssignedAt > lastSeenAt)) {
    return true;
  }

  const myCommentIds = myCommentRows.map((c) => c.id);
  if (myCommentIds.length === 0) return false;
  const latestReplyRows = await db
    .select({ createdAt: schema.comments.createdAt })
    .from(schema.comments)
    .where(
      and(inArray(schema.comments.parentId, myCommentIds), ne(schema.comments.authorId, actor.userId)),
    )
    .orderBy(desc(schema.comments.createdAt))
    .limit(1);
  const latestReplyAt = latestReplyRows[0]?.createdAt;
  return latestReplyAt !== undefined && (lastSeenAt === null || latestReplyAt > lastSeenAt);
}
