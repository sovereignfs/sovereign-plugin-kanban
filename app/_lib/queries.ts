/**
 * Read layer — the three payloads from SPEC's "Data fetching contract".
 * Access is enforced here as well as in actions: every query is scoped to
 * the acting user's memberships, so a page can never render a board the
 * viewer doesn't belong to.
 */
import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { sdk } from '@sovereignfs/sdk';
import type { KanbanDb } from '../_db/client';
import * as schema from '../_db/schema';
import { ACTIVITY_PAGE_SIZE, activityCursorFor, type ActivityCursor } from './activity-pagination';
import type { Actor } from './authz';
import type { MemberIdentity } from './identity';

// ---------------------------------------------------------------------------
// Home payload

export interface HomeBoard {
  id: string;
  name: string;
  color: string;
  projectId: string;
}

export interface HomeProject {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  isCreator: boolean;
  boards: HomeBoard[];
}

/**
 * Projects the actor created (even when empty) plus every board the actor
 * is a member of, grouped under its project. One round trip's worth of
 * queries, no per-project N+1.
 */
export async function getHomeData(db: KanbanDb, actor: Actor): Promise<HomeProject[]> {
  const memberBoards = await db
    .select({
      id: schema.boards.id,
      name: schema.boards.name,
      color: schema.boards.color,
      projectId: schema.boards.projectId,
      position: schema.boards.createdAt,
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

  const ownProjects = await db
    .select()
    .from(schema.projects)
    .where(
      and(eq(schema.projects.createdBy, actor.userId), eq(schema.projects.tenantId, actor.tenantId)),
    )
    .orderBy(asc(schema.projects.createdAt));

  const otherProjectIds = [
    ...new Set(
      memberBoards.map((b) => b.projectId).filter((id) => !ownProjects.some((p) => p.id === id)),
    ),
  ];
  const otherProjects =
    otherProjectIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.projects)
          .where(inArray(schema.projects.id, otherProjectIds))
          .orderBy(asc(schema.projects.createdAt));

  const result: HomeProject[] = [...ownProjects, ...otherProjects].map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    createdBy: p.createdBy,
    isCreator: p.createdBy === actor.userId,
    boards: [],
  }));
  const byId = new Map(result.map((p) => [p.id, p]));
  for (const b of memberBoards) {
    byId.get(b.projectId)?.boards.push({
      id: b.id,
      name: b.name,
      color: b.color,
      projectId: b.projectId,
    });
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
  role: 'owner' | 'member';
  members: Array<MemberIdentity & { role: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  lists: BoardList[];
  cards: BoardCardSummary[];
}

/** Full board payload, or null when the actor is not a member. */
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
    .where(eq(schema.boards.id, boardId));
  const board = boardRows[0];
  if (!board) return null;

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
  }));

  return {
    id: board.id,
    name: board.name,
    color: board.color,
    projectId: board.projectId,
    role: board.role === 'owner' ? 'owner' : 'member',
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
