/**
 * Read layer — the three payloads from SPEC's "Data fetching contract".
 * Access is enforced here as well as in actions: every query is scoped to
 * the acting user's memberships (or, for reads, the viewer tier resolved by
 * `getBoardAccess`), so a page can never render a board the viewer doesn't
 * belong to.
 *
 * Every timestamp column read here goes through `asMs`/`asMsOrNull`
 * (`timestamps.ts`) — on Postgres those columns are `bigint` and arrive as
 * strings; nothing downstream of this file should ever have to know.
 */
import { and, asc, count, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { sdk } from '@sovereignfs/sdk';
import type { KanbanDb } from '../_db/client';
import * as schema from '../_db/schema';
import { ACTIVITY_PAGE_SIZE, activityCursorFor, type ActivityCursor } from './activity-pagination';
import { getBoardAccess, requireCardView, type Actor, type BoardViewRole } from './authz';
import type { MemberIdentity } from './identity';
import { asMs, asMsOrNull } from './timestamps';

// ---------------------------------------------------------------------------
// Home payload

export interface HomeBoard {
  id: string;
  name: string;
  color: string;
  description: string | null;
  projectId: string;
  /** Phase 2 (K.18) — 'viewer' means read-only access (K.21 renders it as such). */
  role: 'owner' | 'member' | 'viewer';
  /** Null while active; set when the board was archived (hidden behind the "Archived" disclosure). */
  archivedAt: number | null;
}

export interface HomeProject {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  isCreator: boolean;
  /** Phase 2 (K.18) — the actor's own `kanban_project_members` role. */
  role: 'owner' | 'member';
  /** Phase 2 (K.18) — 'public' | 'private'. */
  visibility: string;
  /** Phase 2 (K.19) — every project member, for the share dialog. */
  members: Array<MemberIdentity & { role: string }>;
  boards: HomeBoard[];
}

async function resolveIdentities(
  userIds: string[],
): Promise<Map<string, { name: string | null; email: string | null; image: string | null }>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const users = await sdk.directory.resolveUsers({ ids: unique });
  return new Map(users.map((u) => [u.id, { name: u.name, email: u.email, image: u.image }]));
}

/**
 * Projects the actor belongs to via `kanban_project_members` (K.18), each
 * with its boards: explicit board memberships (edit access) plus any boards
 * the actor can merely view — every board in a project they own, or public
 * boards in a public project they're a member of. Archived boards are
 * included (with `archivedAt` set) so Home can offer a restore path; the UI
 * tucks them behind a disclosure rather than the main grid.
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
  // BINARY collation is case-sensitive, and a user's own project count is
  // never large enough to need the DB to do the sorting.
  const projectRows = (
    await db.select().from(schema.projects).where(inArray(schema.projects.id, projectIds))
  ).sort((a, b) => a.name.localeCompare(b.name));

  const allMemberRows = await db
    .select({
      projectId: schema.projectMembers.projectId,
      userId: schema.projectMembers.userId,
      role: schema.projectMembers.role,
    })
    .from(schema.projectMembers)
    .where(inArray(schema.projectMembers.projectId, projectIds));
  const identityById = await resolveIdentities(allMemberRows.map((m) => m.userId));
  const membersByProject = new Map<string, Array<MemberIdentity & { role: string }>>();
  for (const m of allMemberRows) {
    const list = membersByProject.get(m.projectId) ?? [];
    const identity = identityById.get(m.userId);
    list.push({
      userId: m.userId,
      role: m.role,
      name: identity?.name ?? null,
      email: identity?.email ?? null,
      image: identity?.image ?? null,
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
      description: schema.boards.description,
      projectId: schema.boards.projectId,
      archivedAt: schema.boards.archivedAt,
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
      description: b.description,
      projectId: b.projectId,
      role: b.role === 'owner' ? 'owner' : 'member',
      archivedAt: asMsOrNull(b.archivedAt),
    });
    seenBoardIds.add(b.id);
  }

  // Read-only boards: every board in a project the actor owns, or public
  // boards in a public project the actor is a plain member of.
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
        description: schema.boards.description,
        projectId: schema.boards.projectId,
        visibility: schema.boards.visibility,
        archivedAt: schema.boards.archivedAt,
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
      project.boards.push({
        id: b.id,
        name: b.name,
        color: b.color,
        description: b.description,
        projectId: b.projectId,
        role: 'viewer',
        archivedAt: asMsOrNull(b.archivedAt),
      });
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
  description: string | null;
  projectId: string;
  /** 'public' | 'private' (K.20) — only consulted when the project is public. */
  visibility: string;
  /** Null while active. An archived board renders read-only for everyone. */
  archivedAt: number | null;
  /**
   * 'viewer' (K.18) — read-only access via project ownership or a public
   * project + public board, never an explicit `kanban_board_members` row.
   * Every mutation action still checks board membership directly and never
   * treats 'viewer' as passing. K.21 threads `canEdit` (`role !== 'viewer'`
   * and not archived) through every interactive component.
   */
  role: BoardViewRole;
  /** The actor's project-level role, if any. */
  projectRole: 'owner' | 'member' | null;
  /** Board owner or project owner (K.20): settings, archive/delete, membership. */
  canManage: boolean;
  members: Array<MemberIdentity & { role: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  lists: BoardList[];
  /** Active (non-archived) cards only. */
  cards: BoardCardSummary[];
  /** How many cards are archived — drives the "Archived cards" menu entry. */
  archivedCardCount: number;
}

/**
 * Full board payload, or null when the actor has no access at all (see
 * `getBoardAccess` for the three access tiers).
 */
export async function getBoardData(
  db: KanbanDb,
  boardId: string,
  actor: Actor,
): Promise<BoardData | null> {
  const access = await getBoardAccess(db, boardId, actor);
  if (!access) return null;

  const boardRows = await db
    .select({
      id: schema.boards.id,
      name: schema.boards.name,
      color: schema.boards.color,
      description: schema.boards.description,
      projectId: schema.boards.projectId,
      visibility: schema.boards.visibility,
      archivedAt: schema.boards.archivedAt,
    })
    .from(schema.boards)
    .where(eq(schema.boards.id, boardId));
  const board = boardRows[0];
  if (!board) return null;

  // Per-card aggregates are joined through `kanban_cards` on `board_id`
  // rather than `inArray(cardIds)` — a board with thousands of cards would
  // otherwise ship thousands of bind parameters per query (and previously
  // fetched one row per *comment* just to count them).
  const onBoard = and(eq(schema.cards.boardId, boardId), isNull(schema.cards.archivedAt));
  const [memberRows, boardLabels, listRows, cardRows, archivedRows] = await Promise.all([
    db
      .select({ userId: schema.boardMembers.userId, role: schema.boardMembers.role })
      .from(schema.boardMembers)
      .where(eq(schema.boardMembers.boardId, boardId)),
    db
      .select({ id: schema.labels.id, name: schema.labels.name, color: schema.labels.color })
      .from(schema.labels)
      .where(eq(schema.labels.boardId, boardId)),
    db
      .select({ id: schema.lists.id, name: schema.lists.name, position: schema.lists.position })
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
      .where(onBoard)
      .orderBy(asc(schema.cards.position)),
    db
      .select({ n: count() })
      .from(schema.cards)
      .where(and(eq(schema.cards.boardId, boardId), sql`${schema.cards.archivedAt} IS NOT NULL`)),
  ]);

  const [labelLinks, assigneeCounts, checklistCounts, commentCounts] =
    cardRows.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          db
            .select({ cardId: schema.cardLabels.cardId, labelId: schema.cardLabels.labelId })
            .from(schema.cardLabels)
            .innerJoin(schema.cards, eq(schema.cards.id, schema.cardLabels.cardId))
            .where(onBoard),
          db
            .select({ cardId: schema.cardAssignees.cardId, n: count() })
            .from(schema.cardAssignees)
            .innerJoin(schema.cards, eq(schema.cards.id, schema.cardAssignees.cardId))
            .where(onBoard)
            .groupBy(schema.cardAssignees.cardId),
          db
            .select({
              cardId: schema.checklistItems.cardId,
              total: count(),
              done: sql<number>`coalesce(sum(${schema.checklistItems.done}), 0)`.mapWith(Number),
            })
            .from(schema.checklistItems)
            .innerJoin(schema.cards, eq(schema.cards.id, schema.checklistItems.cardId))
            .where(onBoard)
            .groupBy(schema.checklistItems.cardId),
          db
            .select({ cardId: schema.comments.cardId, n: count() })
            .from(schema.comments)
            .innerJoin(schema.cards, eq(schema.cards.id, schema.comments.cardId))
            .where(onBoard)
            .groupBy(schema.comments.cardId),
        ]);

  const labelById = new Map(boardLabels.map((l) => [l.id, l]));
  const cards: BoardCardSummary[] = cardRows.map((c) => ({
    id: c.id,
    title: c.title,
    listId: c.listId,
    position: c.position,
    dueDate: asMsOrNull(c.dueDate),
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
  for (const a of assigneeCounts) {
    const card = cardById.get(a.cardId);
    if (card) card.assigneeCount = a.n;
  }
  for (const item of checklistCounts) {
    const card = cardById.get(item.cardId);
    if (!card) continue;
    card.checklistTotal = item.total;
    card.checklistDone = item.done;
  }
  for (const c of commentCounts) {
    const card = cardById.get(c.cardId);
    if (card) card.commentCount = c.n;
  }

  const countByList = new Map<string, number>();
  for (const c of cards) countByList.set(c.listId, (countByList.get(c.listId) ?? 0) + 1);

  // K.9: resolve each member's directory name/email so avatars, the share
  // dialog, and every displayName() call site can show a real person. A
  // departed/deactivated user simply isn't in the result — name/email fall
  // back to null, and displayName() falls back to the raw id.
  const identityById = await resolveIdentities(memberRows.map((m) => m.userId));
  const members: Array<MemberIdentity & { role: string }> = memberRows.map((m) => ({
    userId: m.userId,
    role: m.role,
    name: identityById.get(m.userId)?.name ?? null,
    email: identityById.get(m.userId)?.email ?? null,
    image: identityById.get(m.userId)?.image ?? null,
  }));

  return {
    id: board.id,
    name: board.name,
    color: board.color,
    description: board.description,
    projectId: board.projectId,
    visibility: board.visibility,
    archivedAt: asMsOrNull(board.archivedAt),
    role: access.role,
    projectRole: access.projectRole,
    canManage: access.role === 'owner' || access.projectRole === 'owner',
    members,
    labels: boardLabels,
    lists: listRows.map((l) => ({ ...l, cardCount: countByList.get(l.id) ?? 0 })),
    cards,
    archivedCardCount: archivedRows[0]?.n ?? 0,
  };
}

/** Archived cards on a board (newest archive first), for the restore/delete panel. */
export interface ArchivedCard {
  id: string;
  title: string;
  listId: string;
  archivedAt: number;
}

export async function getArchivedCards(db: KanbanDb, boardId: string): Promise<ArchivedCard[]> {
  const rows = await db
    .select({
      id: schema.cards.id,
      title: schema.cards.title,
      listId: schema.cards.listId,
      archivedAt: schema.cards.archivedAt,
    })
    .from(schema.cards)
    .where(and(eq(schema.cards.boardId, boardId), sql`${schema.cards.archivedAt} IS NOT NULL`))
    .orderBy(desc(schema.cards.archivedAt));
  return rows.map((r) => ({ ...r, archivedAt: asMsOrNull(r.archivedAt) ?? 0 }));
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
  archivedAt: number | null;
  labels: Array<{ id: string; name: string; color: string }>;
  assignees: Array<{ userId: string; assignedBy: string }>;
  checklist: Array<{ id: string; text: string; done: boolean; position: number }>;
  comments: Array<{
    id: string;
    parentId: string | null;
    authorId: string;
    body: string;
    createdAt: number;
    updatedAt: number;
  }>;
  activity: Array<{
    id: string;
    actorId: string;
    type: string;
    payload: unknown;
    createdAt: number;
  }>;
}

function parsePayload(payload: string | null): unknown {
  if (payload === null) return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    // A malformed row must never take the whole card/board feed down.
    return null;
  }
}

/**
 * Full card payload (fetched when the detail surface opens), or null without
 * access. Viewers (K.18) get it too — reading a card is part of reading the
 * board; every mutation action still demands explicit membership.
 */
export async function getCardDetail(
  db: KanbanDb,
  cardId: string,
  actor: Actor,
): Promise<CardDetail | null> {
  const view = await requireCardView(db, cardId, actor);
  if (!view) return null;

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
      archivedAt: schema.cards.archivedAt,
    })
    .from(schema.cards)
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
        updatedAt: schema.comments.updatedAt,
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
    id: card.id,
    boardId: card.boardId,
    listId: card.listId,
    title: card.title,
    description: card.description,
    dueDate: asMsOrNull(card.dueDate),
    createdBy: card.createdBy,
    createdAt: asMs(card.createdAt),
    archivedAt: asMsOrNull(card.archivedAt),
    labels: labelRows,
    assignees,
    checklist: checklist.map((i) => ({ ...i, done: i.done === 1 })),
    comments: commentRows.map((c) => ({
      ...c,
      createdAt: asMs(c.createdAt),
      updatedAt: asMs(c.updatedAt),
    })),
    activity: activityRows.map((a) => ({
      ...a,
      createdAt: asMs(a.createdAt),
      payload: parsePayload(a.payload),
    })),
  };
}

// ---------------------------------------------------------------------------
// Activity pagination (K.8) — page 1 comes from `getCardDetail` above; the
// card overlay's "Load more" calls `getActivityPage` (via the
// `getMoreCardActivity` action) for subsequent pages using the same
// `(createdAt, id)` cursor and ordering, so a page boundary can never
// duplicate or skip a row that shares a millisecond timestamp with its
// neighbour.

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
    createdAt: asMs(a.createdAt),
    payload: parsePayload(a.payload),
  }));
  return { items, nextCursor: activityCursorFor(items) };
}

// ---------------------------------------------------------------------------
// Board activity — the board-level feed (list/member/board events plus every
// card event), previously recorded but never rendered anywhere.

export const BOARD_ACTIVITY_PAGE_SIZE = 30;

export interface BoardActivityItem {
  id: string;
  actorId: string;
  type: string;
  payload: unknown;
  createdAt: number;
  cardId: string | null;
  /** Resolved for rows still pointing at a live card; null for board-level rows or deleted cards. */
  cardTitle: string | null;
}

export interface BoardActivityPage {
  items: BoardActivityItem[];
  nextCursor: ActivityCursor | null;
}

export async function getBoardActivityPage(
  db: KanbanDb,
  boardId: string,
  cursor: ActivityCursor | null,
): Promise<BoardActivityPage> {
  const scope = eq(schema.activity.boardId, boardId);
  const rows = await db
    .select({
      id: schema.activity.id,
      actorId: schema.activity.actorId,
      type: schema.activity.type,
      payload: schema.activity.payload,
      createdAt: schema.activity.createdAt,
      cardId: schema.activity.cardId,
      cardTitle: schema.cards.title,
    })
    .from(schema.activity)
    .leftJoin(schema.cards, eq(schema.cards.id, schema.activity.cardId))
    .where(
      cursor
        ? and(
            scope,
            or(
              lt(schema.activity.createdAt, cursor.createdAt),
              and(
                eq(schema.activity.createdAt, cursor.createdAt),
                lt(schema.activity.id, cursor.id),
              ),
            ),
          )
        : scope,
    )
    .orderBy(desc(schema.activity.createdAt), desc(schema.activity.id))
    .limit(BOARD_ACTIVITY_PAGE_SIZE);

  const items: BoardActivityItem[] = rows.map((a) => ({
    id: a.id,
    actorId: a.actorId,
    type: a.type,
    payload: parsePayload(a.payload),
    createdAt: asMs(a.createdAt),
    cardId: a.cardId,
    cardTitle: a.cardTitle ?? null,
  }));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      items.length < BOARD_ACTIVITY_PAGE_SIZE || !last
        ? null
        : { createdAt: last.createdAt, id: last.id },
  };
}

// ---------------------------------------------------------------------------
// Inbox (K.11, redesigned)

export const INBOX_PAGE_SIZE = 100;

/**
 * "assigned" = actor was assigned to the card by someone else. "reply" =
 * someone replied to one of the actor's own comments. Deliberately narrower
 * than a per-board activity log — the Inbox is "things that happened *to*
 * you," not "everything that happened on your boards."
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

/** Replies (by someone else) to comments the actor wrote — one indexed self-join, bounded by `limit`. */
function repliesToActor(db: KanbanDb, actor: Actor, limit: number) {
  const parent = alias(schema.comments, 'parent');
  return db
    .select({
      id: schema.comments.id,
      cardId: schema.comments.cardId,
      actorId: schema.comments.authorId,
      createdAt: schema.comments.createdAt,
    })
    .from(schema.comments)
    .innerJoin(parent, eq(parent.id, schema.comments.parentId))
    .where(
      and(
        eq(parent.authorId, actor.userId),
        eq(parent.tenantId, actor.tenantId),
        ne(schema.comments.authorId, actor.userId),
      ),
    )
    .orderBy(desc(schema.comments.createdAt))
    .limit(limit);
}

/**
 * Personalized Inbox — "cards assigned to me" and "replies to my comments,"
 * queried straight from the source-of-truth tables. The reply side is a
 * self-join on `kanban_comments` (`parent_id` → the actor's own comment,
 * both sides indexed) rather than the previous "fetch every comment id the
 * actor ever wrote, then `inArray` them" — that list was unbounded and ran
 * on every navigation via `hasUnseenInboxActivity`.
 *
 * Self-assignment and replying to your own comment are excluded. Capped at
 * `INBOX_PAGE_SIZE`, newest first, no further pagination.
 */
export async function getInboxFeed(db: KanbanDb, actor: Actor): Promise<InboxFeed> {
  const [assignedRows, replyRows] = await Promise.all([
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
    repliesToActor(db, actor, INBOX_PAGE_SIZE),
  ]);

  if (assignedRows.length === 0 && replyRows.length === 0) return { items: [], members: [] };

  const cardIds = [
    ...new Set([...assignedRows.map((r) => r.cardId), ...replyRows.map((r) => r.cardId)]),
  ];
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
  // — skip rather than render a dangling row with no title/board to show.
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
      toItem(
        'assigned',
        `assigned:${r.cardId}:${actor.userId}`,
        r.cardId,
        r.actorId,
        asMs(r.createdAt),
      ),
    ),
    ...replyRows.map((r) => toItem('reply', r.id, r.cardId, r.actorId, asMs(r.createdAt))),
  ]
    .filter((i): i is InboxItem => i !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, INBOX_PAGE_SIZE);

  const identityById = await resolveIdentities(items.map((i) => i.actorId));
  const members: MemberIdentity[] = [...identityById.entries()].map(([userId, identity]) => ({
    userId,
    ...identity,
  }));

  return { items, members };
}

/**
 * For the sidebar's unseen badge — a cheap existence check (two `LIMIT 1`
 * reads on indexed columns), not a full feed fetch. Mirrors `getInboxFeed`'s
 * own self-exclusion.
 */
export async function hasUnseenInboxActivity(db: KanbanDb, actor: Actor): Promise<boolean> {
  const [seenRows, latestAssignedRows, latestReplyRows] = await Promise.all([
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
    repliesToActor(db, actor, 1),
  ]);

  const lastSeenAt = asMsOrNull(seenRows[0]?.lastSeenAt);
  const latest = Math.max(
    asMsOrNull(latestAssignedRows[0]?.createdAt) ?? -1,
    asMsOrNull(latestReplyRows[0]?.createdAt) ?? -1,
  );
  if (latest < 0) return false;
  return lastSeenAt === null || latest > lastSeenAt;
}
