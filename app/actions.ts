'use server';

/**
 * Server actions — the mutation layer every surface (web + mobile) calls.
 *
 * Every action:
 * 1. `requireUser()` — session, always first.
 * 2. Per-resource authorization (membership/creator) — a server action is a
 *    public POST endpoint dispatched by action id; route gating never covers
 *    it. Denials read as "not found" so existence isn't leaked.
 * 3. Mutation + `recordActivity()` in one transaction.
 * 4. Returns `ActionResult` — domain failures are values, never throws.
 */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { sdk, type DirectoryUser } from '@sovereignfs/sdk';
import type { KanbanTx } from './_db/client';
import {
  needsRenormalize,
  positionAfter,
  positionBetween,
  renormalizedPositions,
} from './_db/position';
import * as schema from './_db/schema';
import { fail, ok, type ActionResult } from './_lib/action-result';
import { isBoardColor } from './_lib/palette';
import { recordActivity } from './_lib/activity';
import {
  getBoardRole,
  requireBoardMember,
  requireBoardOwner,
  requireCardAccess,
  requireListAccess,
  requireProjectCreator,
  requireUser,
} from './_lib/authz';
import { getDb } from './_lib/db';
import { newId } from './_lib/ids';
import { getActivityPage, type ActivityCursor, type CardDetail } from './_lib/queries';

const NOT_FOUND_BOARD = 'Board not found.';
const NOT_FOUND_PROJECT = 'Project not found.';
const NOT_FOUND_LIST = 'List not found.';
const NOT_FOUND_CARD = 'Card not found.';
const NOT_FOUND_LABEL = 'Label not found.';
const NOT_FOUND_ITEM = 'Checklist item not found.';
const NOT_FOUND_COMMENT = 'Comment not found.';

function refresh(): void {
  revalidatePath('/kanban', 'layout');
}

function cleanName(raw: unknown, label: string, max = 200): string | ActionResult {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length === 0) return fail(`${label} is required.`);
  if (name.length > max) return fail(`${label} must be ${max} characters or fewer.`);
  return name;
}

// ---------------------------------------------------------------------------
// Projects

export async function createProject(input: {
  name: string;
  description?: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const name = cleanName(input.name, 'Project name');
  if (typeof name !== 'string') return name;
  const db = await getDb();
  const now = Date.now();
  await db.insert(schema.projects).values({
    id: newId(),
    tenantId: actor.tenantId,
    name,
    description: input.description?.trim() || null,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  refresh();
  return ok('Project created.');
}

export async function updateProject(input: {
  projectId: string;
  name?: string;
  description?: string | null;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireProjectCreator(db, input.projectId, actor))) return fail(NOT_FOUND_PROJECT);

  const patch: Partial<typeof schema.projects.$inferInsert> = { updatedAt: Date.now() };
  if (input.name !== undefined) {
    const name = cleanName(input.name, 'Project name');
    if (typeof name !== 'string') return name;
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;

  await db.update(schema.projects).set(patch).where(eq(schema.projects.id, input.projectId));
  refresh();
  return ok('Project updated.');
}

export async function deleteProject(input: { projectId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireProjectCreator(db, input.projectId, actor))) return fail(NOT_FOUND_PROJECT);
  await db.delete(schema.projects).where(eq(schema.projects.id, input.projectId));
  refresh();
  return ok('Project deleted.');
}

// ---------------------------------------------------------------------------
// Boards

export async function createBoard(input: {
  projectId: string;
  name: string;
  color: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const name = cleanName(input.name, 'Board name');
  if (typeof name !== 'string') return name;
  const db = await getDb();
  // Boards are created by their project's creator; membership governs
  // everything after creation.
  if (!(await requireProjectCreator(db, input.projectId, actor))) return fail(NOT_FOUND_PROJECT);

  const now = Date.now();
  const boardId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(schema.boards).values({
      id: boardId,
      tenantId: actor.tenantId,
      projectId: input.projectId,
      name,
      color: input.color,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schema.boardMembers).values({
      boardId,
      userId: actor.userId,
      tenantId: actor.tenantId,
      role: 'owner',
      addedBy: actor.userId,
      createdAt: now,
    });
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId,
      actorId: actor.userId,
      type: 'board.created',
      payload: { name },
    });
  });
  refresh();
  return ok('Board created.');
}

export async function updateBoard(input: {
  boardId: string;
  name?: string;
  color?: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardOwner(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);

  const patch: Partial<typeof schema.boards.$inferInsert> = { updatedAt: Date.now() };
  if (input.name !== undefined) {
    const name = cleanName(input.name, 'Board name');
    if (typeof name !== 'string') return name;
    patch.name = name;
  }
  if (input.color !== undefined) patch.color = input.color;

  await db.update(schema.boards).set(patch).where(eq(schema.boards.id, input.boardId));
  refresh();
  return ok('Board updated.');
}

export async function deleteBoard(input: { boardId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardOwner(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);
  await db.delete(schema.boards).where(eq(schema.boards.id, input.boardId));
  refresh();
  return ok('Board deleted.');
}

// ---------------------------------------------------------------------------
// Board members & share (K.9)

/**
 * Directory search for the share dialog's "add a member" picker, already
 * excluding current members — an owner searching for someone already on the
 * board would otherwise just hit `addBoardMember`'s "already a member"
 * denial for no reason. Owner-only, like the rest of membership management;
 * returns an empty list rather than `fail()` since this isn't a mutation a
 * form reports errors for, it's a live search-as-you-type result set.
 */
export async function searchBoardMemberCandidates(input: {
  boardId: string;
  query: string;
}): Promise<DirectoryUser[]> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardOwner(db, input.boardId, actor))) return [];
  const query = input.query.trim();
  if (query.length < 2) return [];

  const [results, memberRows] = await Promise.all([
    sdk.directory.searchUsers({ query, limit: 8 }),
    db
      .select({ userId: schema.boardMembers.userId })
      .from(schema.boardMembers)
      .where(eq(schema.boardMembers.boardId, input.boardId)),
  ]);
  const memberIds = new Set(memberRows.map((m) => m.userId));
  return results.filter((u) => !memberIds.has(u.id));
}

export async function addBoardMember(input: { boardId: string; userId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardOwner(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);

  const existingRole = await getBoardRole(db, input.boardId, {
    userId: input.userId,
    tenantId: actor.tenantId,
  });
  if (existingRole) return fail('This person is already a member.');

  const [target] = await sdk.directory.resolveUsers({ ids: [input.userId] });
  if (!target) return fail('That person could not be found.');

  const boardRows = await db
    .select({ name: schema.boards.name })
    .from(schema.boards)
    .where(eq(schema.boards.id, input.boardId));
  const boardName = boardRows[0]?.name ?? 'a board';

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.insert(schema.boardMembers).values({
      boardId: input.boardId,
      userId: input.userId,
      tenantId: actor.tenantId,
      role: 'member',
      addedBy: actor.userId,
      createdAt: now,
    });
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: input.boardId,
      actorId: actor.userId,
      type: 'member.added',
      payload: { userId: input.userId },
    });
  });

  // Fired after the transaction commits — a failed send shouldn't roll back
  // a successful membership grant. The headers arg is required so the
  // runtime can stamp `source`/`sourceType` from this plugin's id rather
  // than "unknown" — plugins can't forge it themselves either way.
  await sdk.notifications.send(
    {
      recipientUserId: input.userId,
      title: 'Added to a board',
      body: `You now have access to "${boardName}" on Kanban.`,
      url: `/kanban/boards/${input.boardId}`,
      category: 'info',
    },
    await headers(),
  );

  refresh();
  return ok('Member added.');
}

export async function removeBoardMember(input: {
  boardId: string;
  userId: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardOwner(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);
  if (input.userId === actor.userId) {
    return fail('The owner can’t be removed — delete the board instead.');
  }
  const existingRole = await getBoardRole(db, input.boardId, {
    userId: input.userId,
    tenantId: actor.tenantId,
  });
  if (!existingRole) return fail('That person is not a member of this board.');

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.boardMembers)
      .where(
        and(eq(schema.boardMembers.boardId, input.boardId), eq(schema.boardMembers.userId, input.userId)),
      );
    // A removed member still showing as an assignee on the board's cards
    // would be confusing (assigned to someone with no access) — detach them
    // from every card on this board too. No per-card `assignee.removed`
    // activity for this bulk cleanup; the single `member.removed` row below
    // covers it, matching how `deleteList`'s cascading card deletion
    // doesn't emit per-card activity either.
    const boardCardIds = (
      await tx
        .select({ id: schema.cards.id })
        .from(schema.cards)
        .where(eq(schema.cards.boardId, input.boardId))
    ).map((c) => c.id);
    if (boardCardIds.length > 0) {
      await tx
        .delete(schema.cardAssignees)
        .where(
          and(
            eq(schema.cardAssignees.userId, input.userId),
            inArray(schema.cardAssignees.cardId, boardCardIds),
          ),
        );
    }
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: input.boardId,
      actorId: actor.userId,
      type: 'member.removed',
      payload: { userId: input.userId },
    });
  });
  refresh();
  return ok('Member removed.');
}

// ---------------------------------------------------------------------------
// Lists

export async function createList(input: { boardId: string; name: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const name = cleanName(input.name, 'List name');
  if (typeof name !== 'string') return name;
  const db = await getDb();
  if (!(await requireBoardMember(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);

  const now = Date.now();
  await db.transaction(async (tx) => {
    const last = await lastPosition(
      tx,
      schema.lists,
      eq(schema.lists.boardId, input.boardId),
      schema.lists.position,
    );
    await tx.insert(schema.lists).values({
      id: newId(),
      tenantId: actor.tenantId,
      boardId: input.boardId,
      name,
      position: positionAfter(last),
      createdAt: now,
      updatedAt: now,
    });
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: input.boardId,
      actorId: actor.userId,
      type: 'list.created',
      payload: { name },
    });
  });
  refresh();
  return ok('List added.');
}

export async function renameList(input: { listId: string; name: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const name = cleanName(input.name, 'List name');
  if (typeof name !== 'string') return name;
  const db = await getDb();
  const access = await requireListAccess(db, input.listId, actor);
  if (!access) return fail(NOT_FOUND_LIST);

  await db.transaction(async (tx) => {
    await tx
      .update(schema.lists)
      .set({ name, updatedAt: Date.now() })
      .where(eq(schema.lists.id, input.listId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      actorId: actor.userId,
      type: 'list.renamed',
      payload: { name },
    });
  });
  refresh();
  return ok('List renamed.');
}

export async function deleteList(input: { listId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireListAccess(db, input.listId, actor);
  if (!access) return fail(NOT_FOUND_LIST);

  await db.transaction(async (tx) => {
    await tx.delete(schema.lists).where(eq(schema.lists.id, input.listId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      actorId: actor.userId,
      type: 'list.deleted',
    });
  });
  refresh();
  return ok('List deleted.');
}

/** Reorder a list among its board's lists (drag drop target neighbours). */
export async function reorderList(input: {
  listId: string;
  prevListId?: string | null;
  nextListId?: string | null;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireListAccess(db, input.listId, actor);
  if (!access) return fail(NOT_FOUND_LIST);

  const moved = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: schema.lists.id, position: schema.lists.position })
      .from(schema.lists)
      .where(eq(schema.lists.boardId, access.boardId))
      .orderBy(asc(schema.lists.position));
    const position = await placeAmong(tx, rows, {
      movingId: input.listId,
      prevId: input.prevListId ?? null,
      nextId: input.nextListId ?? null,
      write: async (id, pos) =>
        void (await tx.update(schema.lists).set({ position: pos }).where(eq(schema.lists.id, id))),
    });
    if (position === null) return false;
    await tx
      .update(schema.lists)
      .set({ position, updatedAt: Date.now() })
      .where(eq(schema.lists.id, input.listId));
    return true;
  });
  if (!moved) return fail('Those lists changed while you were dragging — try again.');
  refresh();
  return ok('List moved.');
}

// ---------------------------------------------------------------------------
// Cards

export async function createCard(input: { listId: string; title: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const title = cleanName(input.title, 'Card title', 500);
  if (typeof title !== 'string') return title;
  const db = await getDb();
  const access = await requireListAccess(db, input.listId, actor);
  if (!access) return fail(NOT_FOUND_LIST);

  const now = Date.now();
  const cardId = newId();
  await db.transaction(async (tx) => {
    const last = await lastPosition(
      tx,
      schema.cards,
      eq(schema.cards.listId, input.listId),
      schema.cards.position,
    );
    await tx.insert(schema.cards).values({
      id: cardId,
      tenantId: actor.tenantId,
      boardId: access.boardId,
      listId: input.listId,
      title,
      position: positionAfter(last),
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId,
      actorId: actor.userId,
      type: 'card.created',
      payload: { title },
    });
  });
  refresh();
  return ok('Card added.');
}

export async function updateCard(input: {
  cardId: string;
  title?: string;
  description?: string | null;
  dueDate?: number | null;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);

  const patch: Partial<typeof schema.cards.$inferInsert> = { updatedAt: Date.now() };
  const changed: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = cleanName(input.title, 'Card title', 500);
    if (typeof title !== 'string') return title;
    patch.title = title;
    changed.title = title;
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
    changed.description = true;
  }
  if (input.dueDate !== undefined) {
    patch.dueDate = input.dueDate;
    changed.dueDate = input.dueDate;
  }
  if (Object.keys(changed).length === 0) return fail('Nothing to update.');

  await db.transaction(async (tx) => {
    await tx.update(schema.cards).set(patch).where(eq(schema.cards.id, input.cardId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: input.cardId,
      actorId: actor.userId,
      type: input.dueDate !== undefined ? 'due.changed' : 'field.changed',
      payload: changed,
    });
  });
  refresh();
  return ok('Card updated.');
}

export async function deleteCard(input: { cardId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);

  await db.transaction(async (tx) => {
    // Deliberately no `cardId` on this activity row — a card-linked row
    // would cascade away with the card it narrates. The deleted id rides in
    // the payload so the board feed can still tell the story.
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      actorId: actor.userId,
      type: 'card.deleted',
      payload: { cardId: input.cardId },
    });
    await tx.delete(schema.cards).where(eq(schema.cards.id, input.cardId));
  });
  refresh();
  return ok('Card deleted.');
}

/**
 * Move a card — reorder within its list or move to another list on the same
 * board (drag on web; "Move to…" menu on mobile).
 */
export async function moveCard(input: {
  cardId: string;
  toListId: string;
  prevCardId?: string | null;
  nextCardId?: string | null;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);
  const target = await requireListAccess(db, input.toListId, actor);
  // Cross-board moves are not a Phase 1 operation — reject a target list on
  // any other board even when the actor is a member of both.
  if (!target || target.boardId !== access.boardId) return fail(NOT_FOUND_LIST);

  const listChanged = input.toListId !== access.listId;
  const moved = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: schema.cards.id, position: schema.cards.position })
      .from(schema.cards)
      .where(eq(schema.cards.listId, input.toListId))
      .orderBy(asc(schema.cards.position));
    const position = await placeAmong(tx, rows, {
      movingId: input.cardId,
      prevId: input.prevCardId ?? null,
      nextId: input.nextCardId ?? null,
      write: async (id, pos) =>
        void (await tx.update(schema.cards).set({ position: pos }).where(eq(schema.cards.id, id))),
    });
    if (position === null) return false;
    await tx
      .update(schema.cards)
      .set({ listId: input.toListId, position, updatedAt: Date.now() })
      .where(eq(schema.cards.id, input.cardId));
    if (listChanged) {
      await recordActivity(tx, {
        tenantId: actor.tenantId,
        boardId: access.boardId,
        cardId: input.cardId,
        actorId: actor.userId,
        type: 'card.moved',
        payload: { fromListId: access.listId, toListId: input.toListId },
      });
    }
    return true;
  });
  if (!moved) return fail('Those cards changed while you were dragging — try again.');
  refresh();
  return ok('Card moved.');
}

// ---------------------------------------------------------------------------
// Labels (board-scoped)

export async function createLabel(input: {
  boardId: string;
  name: string;
  color: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const name = cleanName(input.name, 'Label name', 50);
  if (typeof name !== 'string') return name;
  if (!isBoardColor(input.color)) return fail('Pick a color for the label.');
  const db = await getDb();
  if (!(await requireBoardMember(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);

  const now = Date.now();
  await db.insert(schema.labels).values({
    id: newId(),
    tenantId: actor.tenantId,
    boardId: input.boardId,
    name,
    color: input.color,
    createdAt: now,
    updatedAt: now,
  });
  refresh();
  return ok('Label created.');
}

export async function deleteLabel(input: { labelId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const rows = await db
    .select({ boardId: schema.labels.boardId })
    .from(schema.labels)
    .where(eq(schema.labels.id, input.labelId));
  const label = rows[0];
  if (!label || !(await requireBoardMember(db, label.boardId, actor))) return fail(NOT_FOUND_LABEL);

  // Cascades kanban_card_labels via the FK — no card is left pointing at a
  // deleted label.
  await db.delete(schema.labels).where(eq(schema.labels.id, input.labelId));
  refresh();
  return ok('Label deleted.');
}

/** Attach or detach a board label on a card. */
export async function toggleCardLabel(input: {
  cardId: string;
  labelId: string;
  on: boolean;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);

  const labelRows = await db
    .select({ boardId: schema.labels.boardId })
    .from(schema.labels)
    .where(eq(schema.labels.id, input.labelId));
  const label = labelRows[0];
  // A label from a different board can never attach here, even if the
  // actor happens to be a member of both boards.
  if (!label || label.boardId !== access.boardId) return fail(NOT_FOUND_LABEL);

  await db.transaction(async (tx) => {
    if (input.on) {
      await tx
        .insert(schema.cardLabels)
        .values({ cardId: input.cardId, labelId: input.labelId, tenantId: actor.tenantId })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(schema.cardLabels)
        .where(
          and(eq(schema.cardLabels.cardId, input.cardId), eq(schema.cardLabels.labelId, input.labelId)),
        );
    }
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: input.cardId,
      actorId: actor.userId,
      type: input.on ? 'label.added' : 'label.removed',
      payload: { labelId: input.labelId },
    });
  });
  refresh();
  return ok('Label updated.');
}

// ---------------------------------------------------------------------------
// Assignees

/** Assign a card to a board member. `userId` must already be a member — this is not an invite flow (K.9). */
export async function assignMember(input: { cardId: string; userId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);
  const targetRole = await getBoardRole(db, access.boardId, {
    userId: input.userId,
    tenantId: actor.tenantId,
  });
  if (!targetRole) return fail('That person is not a member of this board.');

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.cardAssignees)
      .values({
        cardId: input.cardId,
        userId: input.userId,
        tenantId: actor.tenantId,
        assignedBy: actor.userId,
        createdAt: Date.now(),
      })
      .onConflictDoNothing();
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: input.cardId,
      actorId: actor.userId,
      type: 'assignee.added',
      payload: { userId: input.userId },
    });
  });

  // No self-notification for self-assignment. Fired after the transaction
  // commits, deep-linking straight to the card per SPEC's notification URL
  // convention (`/kanban/boards/<id>?card=<id>`).
  if (input.userId !== actor.userId) {
    const cardRows = await db
      .select({ title: schema.cards.title })
      .from(schema.cards)
      .where(eq(schema.cards.id, input.cardId));
    const cardTitle = cardRows[0]?.title ?? 'a card';
    await sdk.notifications.send(
      {
        recipientUserId: input.userId,
        title: 'Assigned to a card',
        body: `You were assigned to "${cardTitle}" on Kanban.`,
        url: `/kanban/boards/${access.boardId}?card=${input.cardId}`,
        category: 'info',
      },
      await headers(),
    );
  }

  refresh();
  return ok('Assigned.');
}

export async function unassignMember(input: { cardId: string; userId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.cardAssignees)
      .where(
        and(eq(schema.cardAssignees.cardId, input.cardId), eq(schema.cardAssignees.userId, input.userId)),
      );
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: input.cardId,
      actorId: actor.userId,
      type: 'assignee.removed',
      payload: { userId: input.userId },
    });
  });
  refresh();
  return ok('Unassigned.');
}

// ---------------------------------------------------------------------------
// Checklist

export async function createChecklistItem(input: {
  cardId: string;
  text: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const text = cleanName(input.text, 'Checklist item', 300);
  if (typeof text !== 'string') return text;
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);

  const now = Date.now();
  await db.transaction(async (tx) => {
    const last = await lastPosition(
      tx,
      schema.checklistItems,
      eq(schema.checklistItems.cardId, input.cardId),
      schema.checklistItems.position,
    );
    await tx.insert(schema.checklistItems).values({
      id: newId(),
      tenantId: actor.tenantId,
      cardId: input.cardId,
      text,
      done: 0,
      position: positionAfter(last),
      createdAt: now,
      updatedAt: now,
    });
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: input.cardId,
      actorId: actor.userId,
      type: 'checklist.changed',
    });
  });
  refresh();
  return ok('Checklist item added.');
}

async function requireChecklistItemAccess(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
  actor: { userId: string; tenantId: string },
): Promise<{ cardId: string; boardId: string } | null> {
  const rows = await db
    .select({ cardId: schema.checklistItems.cardId })
    .from(schema.checklistItems)
    .where(eq(schema.checklistItems.id, itemId));
  const item = rows[0];
  if (!item) return null;
  const access = await requireCardAccess(db, item.cardId, actor);
  if (!access) return null;
  return { cardId: item.cardId, boardId: access.boardId };
}

export async function toggleChecklistItem(input: {
  itemId: string;
  done: boolean;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireChecklistItemAccess(db, input.itemId, actor);
  if (!access) return fail(NOT_FOUND_ITEM);

  await db.transaction(async (tx) => {
    await tx
      .update(schema.checklistItems)
      .set({ done: input.done ? 1 : 0, updatedAt: Date.now() })
      .where(eq(schema.checklistItems.id, input.itemId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: access.cardId,
      actorId: actor.userId,
      type: 'checklist.changed',
    });
  });
  refresh();
  return ok('Checklist updated.');
}

export async function deleteChecklistItem(input: { itemId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireChecklistItemAccess(db, input.itemId, actor);
  if (!access) return fail(NOT_FOUND_ITEM);

  await db.transaction(async (tx) => {
    await tx.delete(schema.checklistItems).where(eq(schema.checklistItems.id, input.itemId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: access.cardId,
      actorId: actor.userId,
      type: 'checklist.changed',
    });
  });
  refresh();
  return ok('Checklist item deleted.');
}

/**
 * Reorder by swapping position with the immediate up/down neighbour — a
 * button-driven reorder, not drag (full drag-and-drop is K.7's board-level
 * scope). A plain value swap needs no midpoint math and can't underflow.
 */
export async function moveChecklistItem(input: {
  itemId: string;
  direction: 'up' | 'down';
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireChecklistItemAccess(db, input.itemId, actor);
  if (!access) return fail(NOT_FOUND_ITEM);

  await db.transaction(async (tx) => {
    const siblings = await tx
      .select({ id: schema.checklistItems.id, position: schema.checklistItems.position })
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.cardId, access.cardId))
      .orderBy(asc(schema.checklistItems.position));
    const idx = siblings.findIndex((s) => s.id === input.itemId);
    const neighborIdx = input.direction === 'up' ? idx - 1 : idx + 1;
    const item = siblings[idx];
    const neighbor = siblings[neighborIdx];
    if (!item || !neighbor) return; // already at the edge — no-op
    await tx
      .update(schema.checklistItems)
      .set({ position: neighbor.position, updatedAt: Date.now() })
      .where(eq(schema.checklistItems.id, item.id));
    await tx
      .update(schema.checklistItems)
      .set({ position: item.position, updatedAt: Date.now() })
      .where(eq(schema.checklistItems.id, neighbor.id));
  });
  refresh();
  return ok('Checklist updated.');
}

// ---------------------------------------------------------------------------
// Comments & activity (K.8)

/**
 * Add a top-level comment, or a reply when `parentId` is set. One level of
 * nesting only (schema note on `kanban_comments.parent_id`) — a reply's own
 * id can never be used as a `parentId`, so a reply can't itself be replied
 * to.
 */
export async function addComment(input: {
  cardId: string;
  body: string;
  parentId?: string | null;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const body = cleanName(input.body, 'Comment', 3000);
  if (typeof body !== 'string') return body;
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);

  let parentId: string | null = null;
  if (input.parentId) {
    const parentRows = await db
      .select({
        id: schema.comments.id,
        cardId: schema.comments.cardId,
        parentId: schema.comments.parentId,
      })
      .from(schema.comments)
      .where(eq(schema.comments.id, input.parentId));
    const parent = parentRows[0];
    if (!parent || parent.cardId !== input.cardId) return fail(NOT_FOUND_COMMENT);
    if (parent.parentId !== null) return fail('Replies can’t be nested further.');
    parentId = parent.id;
  }

  const now = Date.now();
  const commentId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(schema.comments).values({
      id: commentId,
      tenantId: actor.tenantId,
      cardId: input.cardId,
      parentId,
      authorId: actor.userId,
      body,
      createdAt: now,
      updatedAt: now,
    });
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: input.cardId,
      actorId: actor.userId,
      type: 'comment.added',
      payload: { commentId, parentId },
    });
  });
  refresh();
  return ok(parentId ? 'Reply added.' : 'Comment added.');
}

/**
 * The card overlay's "Load more" for the Activity section — page 1 comes
 * from `getCardDetail` (fetched server-side alongside the card itself);
 * this is a read, not a mutation, so it returns data directly instead of
 * the plain `ActionResult` envelope and never calls `refresh()`.
 */
export async function getMoreCardActivity(input: {
  cardId: string;
  cursor: ActivityCursor;
}): Promise<
  { ok: true; items: CardDetail['activity']; nextCursor: ActivityCursor | null } | { ok: false; error: string }
> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return { ok: false, error: NOT_FOUND_CARD };
  const page = await getActivityPage(db, input.cardId, input.cursor);
  return { ok: true, ...page };
}

// ---------------------------------------------------------------------------
// Form-bound wrappers (useActionState signatures) — thin adapters over the
// plain actions above; validation and authorization live there, not here.

export async function createProjectForm(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return createProject({
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? '') || undefined,
  });
}

export async function updateProjectForm(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return updateProject({
    projectId: String(formData.get('projectId') ?? ''),
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? '') || null,
  });
}

export async function createBoardForm(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const color = String(formData.get('color') ?? '');
  if (!isBoardColor(color)) return fail('Pick a color for the board.');
  return createBoard({
    projectId: String(formData.get('projectId') ?? ''),
    name: String(formData.get('name') ?? ''),
    color,
  });
}

export async function updateBoardForm(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const color = String(formData.get('color') ?? '');
  if (!isBoardColor(color)) return fail('Pick a color for the board.');
  return updateBoard({
    boardId: String(formData.get('boardId') ?? ''),
    name: String(formData.get('name') ?? ''),
    color,
  });
}

// ---------------------------------------------------------------------------
// Position plumbing

type PositionedRow = { id: string; position: number };

async function lastPosition(
  tx: KanbanTx,
  table: typeof schema.lists | typeof schema.cards | typeof schema.checklistItems,
  where: ReturnType<typeof eq>,
  column:
    | (typeof schema.lists)['position']
    | (typeof schema.cards)['position']
    | (typeof schema.checklistItems)['position'],
): Promise<number | undefined> {
  const rows = await tx
    .select({ position: column })
    .from(table)
    .where(where)
    .orderBy(desc(column))
    .limit(1);
  return rows[0]?.position;
}

/**
 * Compute the moving row's new position among `rows` (the target scope,
 * ordered), placing it after `prevId` / before `nextId`. Renormalizes the
 * whole scope through `write` first when the target gap has underflowed.
 * Returns null when the named neighbours aren't in the scope anymore (a
 * concurrent move) — the caller surfaces a retry.
 */
async function placeAmong(
  _tx: KanbanTx,
  rows: PositionedRow[],
  opts: {
    movingId: string;
    prevId: string | null;
    nextId: string | null;
    write: (id: string, position: number) => Promise<void>;
  },
): Promise<number | null> {
  let scope = rows.filter((r) => r.id !== opts.movingId);

  const findPos = (id: string | null): number | undefined | null => {
    if (id === null) return undefined;
    const row = scope.find((r) => r.id === id);
    return row ? row.position : null;
  };

  let prev = findPos(opts.prevId);
  let next = findPos(opts.nextId);
  if (prev === null || next === null) return null;

  if (needsRenormalize(prev, next)) {
    const fresh = renormalizedPositions(scope.length);
    scope = scope.map((r, i) => {
      const position = fresh[i];
      if (position === undefined) throw new Error('renormalize: length mismatch');
      return { ...r, position };
    });
    for (const r of scope) await opts.write(r.id, r.position);
    prev = findPos(opts.prevId);
    next = findPos(opts.nextId);
    if (prev === null || next === null) return null;
  }

  return positionBetween(prev, next);
}
