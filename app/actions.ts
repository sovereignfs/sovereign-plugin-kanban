'use server';

/**
 * Server actions — the mutation layer every surface (web + mobile) calls.
 *
 * Every action:
 * 1. `requireUser()` — session, always first.
 * 2. Per-resource authorization (membership/ownership) — a server action is a
 *    public POST endpoint dispatched by action id; route gating never covers
 *    it. Denials read as "not found" so existence isn't leaked.
 * 3. Input validation *here*, not only in the form wrappers at the bottom —
 *    the plain actions are just as reachable by a direct request.
 * 4. Mutation + `recordActivity()` in one transaction.
 * 5. Returns `ActionResult` — domain failures are values, never throws.
 *
 * Access tiers (CONCEPT.md Phase 2): content mutations need explicit board
 * membership (`requireBoardMember`/`requireListAccess`/`requireCardAccess`,
 * all of which also refuse an archived board); board administration
 * (settings, archive/delete, membership) needs `requireBoardManager` — a
 * board owner or a project owner; reads accept the viewer tier.
 */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { sdk, type DirectoryUser, type NotificationListResult } from '@sovereignfs/sdk';
import type { KanbanTx } from './_db/client';
import {
  needsRenormalize,
  positionAfter,
  positionBetween,
  renormalizedPositions,
} from './_db/position';
import * as schema from './_db/schema';
import { fail, ok, type ActionResult } from './_lib/action-result';
import { isBoardColor, isBoardColorOrNone } from './_lib/palette';
import { recordActivity } from './_lib/activity';
import {
  getBoardAccess,
  getBoardRole,
  getProjectRole,
  requireBoardManager,
  requireBoardMember,
  requireCardAccess,
  requireCardView,
  requireListAccess,
  requireProjectOwner,
  requireUser,
  type Actor,
} from './_lib/authz';
import { getDb } from './_lib/db';
import { newId } from './_lib/ids';
import {
  getActivityPage,
  getArchivedCards,
  getBoardActivityPage,
  type ActivityCursor,
  type ArchivedCard,
  type BoardActivityPage,
  type CardDetail,
} from './_lib/queries';

const NOT_FOUND_BOARD = 'Board not found.';
const NOT_FOUND_PROJECT = 'Project not found.';
const NOT_FOUND_LIST = 'List not found.';
const NOT_FOUND_CARD = 'Card not found.';
const NOT_FOUND_LABEL = 'Label not found.';
const NOT_FOUND_ITEM = 'Checklist item not found.';
const NOT_FOUND_COMMENT = 'Comment not found.';
const LAST_PROJECT_OWNER = 'A project needs at least one owner — promote someone else first.';
const LAST_BOARD_OWNER = 'A board needs at least one owner — make someone else an owner first.';

const MAX_DESCRIPTION = 20_000;

type Db = Awaited<ReturnType<typeof getDb>>;

function refresh(): void {
  revalidatePath('/kanban', 'layout');
}

function cleanName(raw: unknown, label: string, max = 200): string | ActionResult {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length === 0) return fail(`${label} is required.`);
  if (name.length > max) return fail(`${label} must be ${max} characters or fewer.`);
  return name;
}

/** Optional free text: trimmed, empty → null, length-capped. */
function cleanOptionalText(raw: unknown, label: string, max: number): string | null | ActionResult {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return fail(`${label} must be text.`);
  const text = raw.trim();
  if (text.length === 0) return null;
  if (text.length > max) return fail(`${label} must be ${max} characters or fewer.`);
  return text;
}

function cleanVisibility(raw: unknown): 'public' | 'private' | ActionResult {
  if (raw === 'public' || raw === 'private') return raw;
  return fail('Visibility must be public or private.');
}

/** A due date is null or a real Unix-ms integer — never NaN/Infinity/a string. */
function cleanDueDate(raw: unknown): number | null | ActionResult {
  if (raw === null) return null;
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) return raw;
  return fail('That due date isn’t valid.');
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
  const description = cleanOptionalText(input.description, 'Description', 2000);
  if (typeof description === 'object' && description !== null) return description;
  const db = await getDb();
  const now = Date.now();
  const projectId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(schema.projects).values({
      id: projectId,
      tenantId: actor.tenantId,
      name,
      description,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    });
    // Phase 2 (K.18): the creator becomes the project's first owner via
    // kanban_project_members — this is what requireProjectOwner and the
    // read layer's viewer resolution actually read.
    await tx.insert(schema.projectMembers).values({
      projectId,
      userId: actor.userId,
      tenantId: actor.tenantId,
      role: 'owner',
      addedBy: actor.userId,
      createdAt: now,
    });
  });
  refresh();
  return ok('Project created.');
}

export async function updateProject(input: {
  projectId: string;
  name?: string;
  description?: string | null;
  visibility?: 'public' | 'private';
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireProjectOwner(db, input.projectId, actor))) return fail(NOT_FOUND_PROJECT);

  const patch: Partial<typeof schema.projects.$inferInsert> = { updatedAt: Date.now() };
  if (input.name !== undefined) {
    const name = cleanName(input.name, 'Project name');
    if (typeof name !== 'string') return name;
    patch.name = name;
  }
  if (input.description !== undefined) {
    const description = cleanOptionalText(input.description, 'Description', 2000);
    if (typeof description === 'object' && description !== null) return description;
    patch.description = description;
  }
  if (input.visibility !== undefined) {
    const visibility = cleanVisibility(input.visibility);
    if (typeof visibility !== 'string') return visibility;
    patch.visibility = visibility;
  }

  await db.update(schema.projects).set(patch).where(eq(schema.projects.id, input.projectId));
  refresh();
  return ok('Project updated.');
}

export async function deleteProject(input: { projectId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireProjectOwner(db, input.projectId, actor))) return fail(NOT_FOUND_PROJECT);
  await db.delete(schema.projects).where(eq(schema.projects.id, input.projectId));
  refresh();
  return ok('Project deleted.');
}

// ---------------------------------------------------------------------------
// Project members & share (K.19)

/**
 * Directory search for the project share dialog's "add a member" picker,
 * excluding current members. This is the only place a genuinely new person
 * enters the picture — the board-add picker (`getBoardMemberCandidates`,
 * K.20) sources its candidates from project members only.
 */
export async function searchProjectMemberCandidates(input: {
  projectId: string;
  query: string;
}): Promise<DirectoryUser[]> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireProjectOwner(db, input.projectId, actor))) return [];
  const query = input.query.trim();
  if (query.length < 2) return [];

  const [results, memberRows] = await Promise.all([
    sdk.directory.searchUsers({ query, limit: 8 }),
    db
      .select({ userId: schema.projectMembers.userId })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, input.projectId)),
  ]);
  const memberIds = new Set(memberRows.map((m) => m.userId));
  return results.filter((u) => !memberIds.has(u.id));
}

export async function addProjectMember(input: {
  projectId: string;
  userId: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireProjectOwner(db, input.projectId, actor))) return fail(NOT_FOUND_PROJECT);

  const existingRole = await getProjectRole(db, input.projectId, {
    userId: input.userId,
    tenantId: actor.tenantId,
  });
  if (existingRole) return fail('This person is already a member.');

  const [target] = await sdk.directory.resolveUsers({ ids: [input.userId] });
  if (!target) return fail('That person could not be found.');

  const projectRows = await db
    .select({ name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.id, input.projectId));
  const projectName = projectRows[0]?.name ?? 'a project';

  await db.insert(schema.projectMembers).values({
    projectId: input.projectId,
    userId: input.userId,
    tenantId: actor.tenantId,
    role: 'member',
    addedBy: actor.userId,
    createdAt: Date.now(),
  });

  // Fired after the insert commits — a failed send shouldn't roll back a
  // successful membership grant.
  await sdk.notifications.send(
    {
      recipientUserId: input.userId,
      title: 'Added to a project',
      body: `You now have access to "${projectName}" on Kanban.`,
      url: `/kanban#project-${input.projectId}`,
      category: 'info',
    },
    await headers(),
  );

  refresh();
  return ok('Member added.');
}

/** How many project owners exist — the invariant `removeProjectMember`/`leaveProject`/`updateProjectMemberRole` protect. */
async function countProjectOwners(db: Db | KanbanTx, projectId: string): Promise<number> {
  const rows = await db
    .select({ userId: schema.projectMembers.userId })
    .from(schema.projectMembers)
    .where(
      and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.role, 'owner')),
    );
  return rows.length;
}

/** Detach `userId` from every card on `boardId` — a departed member can't stay an assignee. */
async function unassignFromBoardCards(tx: KanbanTx, boardId: string, userId: string): Promise<void> {
  const boardCardIds = (
    await tx
      .select({ id: schema.cards.id })
      .from(schema.cards)
      .where(eq(schema.cards.boardId, boardId))
  ).map((c) => c.id);
  if (boardCardIds.length === 0) return;
  await tx
    .delete(schema.cardAssignees)
    .where(
      and(
        eq(schema.cardAssignees.userId, userId),
        inArray(schema.cardAssignees.cardId, boardCardIds),
      ),
    );
}

/**
 * If `boardId` has no owner left, promote its earliest-joined remaining
 * member — mirrors the account-deletion handler's own succession rule so a
 * board never ends up ownerless (and therefore unmanageable by anyone but
 * a project owner).
 */
async function ensureBoardHasOwner(tx: KanbanTx, boardId: string): Promise<void> {
  const members = await tx
    .select({ userId: schema.boardMembers.userId, role: schema.boardMembers.role, createdAt: schema.boardMembers.createdAt })
    .from(schema.boardMembers)
    .where(eq(schema.boardMembers.boardId, boardId));
  if (members.length === 0 || members.some((m) => m.role === 'owner')) return;
  const promotee = [...members].sort((a, b) => Number(a.createdAt) - Number(b.createdAt))[0];
  if (!promotee) return;
  await tx
    .update(schema.boardMembers)
    .set({ role: 'owner' })
    .where(and(eq(schema.boardMembers.boardId, boardId), eq(schema.boardMembers.userId, promotee.userId)));
}

/**
 * Leaving (or being removed from) a project cascades to every board in it:
 * board membership is drawn from project membership (CONCEPT.md Phase 2),
 * so a `kanban_board_members` row can't outlive the project membership it
 * was granted under. Previously the removal deliberately didn't cascade,
 * which left the user with live edit access to boards that had silently
 * vanished from their Home page (`getHomeData` only lists boards under
 * projects the user belongs to). Each affected board gets its own
 * `member.removed` row; a board left ownerless promotes a successor.
 */
async function stripBoardAccessInProject(
  tx: KanbanTx,
  projectId: string,
  userId: string,
  actor: Actor,
  reason: 'removed' | 'left',
): Promise<void> {
  const memberships = await tx
    .select({ boardId: schema.boardMembers.boardId })
    .from(schema.boardMembers)
    .innerJoin(schema.boards, eq(schema.boards.id, schema.boardMembers.boardId))
    .where(and(eq(schema.boards.projectId, projectId), eq(schema.boardMembers.userId, userId)));
  for (const { boardId } of memberships) {
    await tx
      .delete(schema.boardMembers)
      .where(and(eq(schema.boardMembers.boardId, boardId), eq(schema.boardMembers.userId, userId)));
    await unassignFromBoardCards(tx, boardId, userId);
    await ensureBoardHasOwner(tx, boardId);
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId,
      actorId: actor.userId,
      type: 'member.removed',
      payload: reason === 'left' ? { userId, left: true } : { userId },
    });
  }
}

/**
 * Owner-only. Projects support co-owners, so the rule is a plain invariant:
 * never let a project end up with zero owners. Cascades to the project's
 * boards — see `stripBoardAccessInProject`.
 */
export async function removeProjectMember(input: {
  projectId: string;
  userId: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireProjectOwner(db, input.projectId, actor))) return fail(NOT_FOUND_PROJECT);

  const existingRole = await getProjectRole(db, input.projectId, {
    userId: input.userId,
    tenantId: actor.tenantId,
  });
  if (!existingRole) return fail('That person is not a member of this project.');

  if (existingRole === 'owner' && (await countProjectOwners(db, input.projectId)) <= 1) {
    return fail(LAST_PROJECT_OWNER);
  }

  await db.transaction(async (tx) => {
    await stripBoardAccessInProject(
      tx,
      input.projectId,
      input.userId,
      actor,
      input.userId === actor.userId ? 'left' : 'removed',
    );
    await tx
      .delete(schema.projectMembers)
      .where(
        and(
          eq(schema.projectMembers.projectId, input.projectId),
          eq(schema.projectMembers.userId, input.userId),
        ),
      );
  });
  refresh();
  return ok(input.userId === actor.userId ? 'You left the project.' : 'Member removed.');
}

/** Any member may leave a project themselves — except its last owner. */
export async function leaveProject(input: { projectId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const role = await getProjectRole(db, input.projectId, actor);
  if (!role) return fail(NOT_FOUND_PROJECT);
  if (role === 'owner' && (await countProjectOwners(db, input.projectId)) <= 1) {
    return fail('You’re the only owner — make someone else an owner (or delete the project) first.');
  }
  await db.transaction(async (tx) => {
    await stripBoardAccessInProject(tx, input.projectId, actor.userId, actor, 'left');
    await tx
      .delete(schema.projectMembers)
      .where(
        and(
          eq(schema.projectMembers.projectId, input.projectId),
          eq(schema.projectMembers.userId, actor.userId),
        ),
      );
  });
  refresh();
  return ok('You left the project.');
}

/** Promote a member to co-owner, or demote a co-owner to member — owner-only, same last-owner protection as removal. */
export async function updateProjectMemberRole(input: {
  projectId: string;
  userId: string;
  role: 'owner' | 'member';
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireProjectOwner(db, input.projectId, actor))) return fail(NOT_FOUND_PROJECT);
  if (input.role !== 'owner' && input.role !== 'member') return fail('Unknown role.');

  const existingRole = await getProjectRole(db, input.projectId, {
    userId: input.userId,
    tenantId: actor.tenantId,
  });
  if (!existingRole) return fail('That person is not a member of this project.');
  if (existingRole === input.role) return ok('No change.');

  if (existingRole === 'owner' && (await countProjectOwners(db, input.projectId)) <= 1) {
    return fail(LAST_PROJECT_OWNER);
  }

  await db
    .update(schema.projectMembers)
    .set({ role: input.role })
    .where(
      and(
        eq(schema.projectMembers.projectId, input.projectId),
        eq(schema.projectMembers.userId, input.userId),
      ),
    );
  refresh();
  return ok(input.role === 'owner' ? 'Promoted to owner.' : 'Changed to member.');
}

// ---------------------------------------------------------------------------
// Boards

export async function createBoard(input: {
  projectId: string;
  name: string;
  color: string;
  description?: string | null;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const name = cleanName(input.name, 'Board name');
  if (typeof name !== 'string') return name;
  if (!isBoardColorOrNone(input.color)) return fail('Pick a color for the board.');
  const description = cleanOptionalText(input.description, 'Description', 2000);
  if (typeof description === 'object' && description !== null) return description;
  const db = await getDb();
  // Boards are created by a project owner (any co-owner, not just the
  // original creator); board membership governs content edits after that.
  if (!(await requireProjectOwner(db, input.projectId, actor))) return fail(NOT_FOUND_PROJECT);

  const now = Date.now();
  const boardId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(schema.boards).values({
      id: boardId,
      tenantId: actor.tenantId,
      projectId: input.projectId,
      name,
      color: input.color,
      description,
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

/** Board settings — board owner or project owner (K.20). */
export async function updateBoard(input: {
  boardId: string;
  name?: string;
  color?: string;
  description?: string | null;
  visibility?: 'public' | 'private';
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardManager(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);

  const patch: Partial<typeof schema.boards.$inferInsert> = { updatedAt: Date.now() };
  const changed: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name, 'Board name');
    if (typeof name !== 'string') return name;
    patch.name = name;
    changed.name = name;
  }
  if (input.color !== undefined) {
    if (!isBoardColorOrNone(input.color)) return fail('Pick a color for the board.');
    patch.color = input.color;
    changed.color = true;
  }
  if (input.description !== undefined) {
    const description = cleanOptionalText(input.description, 'Description', 2000);
    if (typeof description === 'object' && description !== null) return description;
    patch.description = description;
    changed.description = true;
  }
  if (input.visibility !== undefined) {
    const visibility = cleanVisibility(input.visibility);
    if (typeof visibility !== 'string') return visibility;
    patch.visibility = visibility;
    changed.visibility = visibility;
  }
  if (Object.keys(changed).length === 0) return fail('Nothing to update.');

  await db.transaction(async (tx) => {
    await tx.update(schema.boards).set(patch).where(eq(schema.boards.id, input.boardId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: input.boardId,
      actorId: actor.userId,
      type: 'board.updated',
      payload: changed,
    });
  });
  refresh();
  return ok('Board updated.');
}

export async function deleteBoard(input: { boardId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardManager(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);
  await db.delete(schema.boards).where(eq(schema.boards.id, input.boardId));
  refresh();
  return ok('Board deleted.');
}

/**
 * Archive keeps everything (lists, cards, members, history) but hides the
 * board from the Home grid and makes it read-only for everyone — the
 * membership checks every content mutation runs refuse an archived board.
 */
export async function archiveBoard(input: { boardId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardManager(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.boards)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.boards.id, input.boardId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: input.boardId,
      actorId: actor.userId,
      type: 'board.archived',
    });
  });
  refresh();
  return ok('Board archived.');
}

export async function restoreBoard(input: { boardId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardManager(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.boards)
      .set({ archivedAt: null, updatedAt: Date.now() })
      .where(eq(schema.boards.id, input.boardId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: input.boardId,
      actorId: actor.userId,
      type: 'board.restored',
    });
  });
  refresh();
  return ok('Board restored.');
}

// ---------------------------------------------------------------------------
// Board members & share (K.9 / K.20)

/**
 * K.20 — candidates for the share dialog's "add a member" picker, sourced
 * from the board's own project membership, never a fresh directory search.
 * Returns the *whole* eligible list (the client filters it); manager-only,
 * and an empty list rather than `fail()` since this isn't a form mutation.
 */
export async function getBoardMemberCandidates(input: { boardId: string }): Promise<DirectoryUser[]> {
  const actor = await requireUser();
  const db = await getDb();
  const manager = await requireBoardManager(db, input.boardId, actor);
  if (!manager) return [];

  const [projectMemberRows, boardMemberRows] = await Promise.all([
    db
      .select({ userId: schema.projectMembers.userId })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, manager.projectId)),
    db
      .select({ userId: schema.boardMembers.userId })
      .from(schema.boardMembers)
      .where(eq(schema.boardMembers.boardId, input.boardId)),
  ]);
  const boardMemberIds = new Set(boardMemberRows.map((m) => m.userId));
  const eligibleIds = projectMemberRows
    .map((m) => m.userId)
    .filter((id) => !boardMemberIds.has(id));
  if (eligibleIds.length === 0) return [];

  return sdk.directory.resolveUsers({ ids: eligibleIds });
}

export async function addBoardMember(input: { boardId: string; userId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const manager = await requireBoardManager(db, input.boardId, actor);
  if (!manager) return fail(NOT_FOUND_BOARD);

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

  // K.20 — a board can only be shared with someone already trusted at the
  // project level. Enforced here too, not just in the picker: an action is a
  // public POST endpoint, so a direct request could otherwise hand board
  // access to a stranger. Checked *after* the directory-existence check so a
  // nonexistent user still gets "could not be found."
  if (
    !(await getProjectRole(db, manager.projectId, { userId: input.userId, tenantId: actor.tenantId }))
  ) {
    return fail('Add them to the project first.');
  }

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
  // a successful membership grant. The headers arg lets the runtime stamp
  // `source`/`sourceType` from this plugin's id.
  await sdk.notifications.send(
    {
      recipientUserId: input.userId,
      title: 'Added to a board',
      body: `You now have access to "${boardName}" on Kanban.`,
      url: `/kanban/b/${input.boardId}`,
      category: 'info',
    },
    await headers(),
  );

  refresh();
  return ok('Member added.');
}

async function countBoardOwners(db: Db | KanbanTx, boardId: string): Promise<number> {
  const rows = await db
    .select({ userId: schema.boardMembers.userId })
    .from(schema.boardMembers)
    .where(and(eq(schema.boardMembers.boardId, boardId), eq(schema.boardMembers.role, 'owner')));
  return rows.length;
}

/**
 * Manager-only. Boards support multiple owners (`updateBoardMemberRole`),
 * so the rule is the same last-owner invariant projects use rather than
 * "the owner can't be removed" — an owner can be removed while another
 * owner remains. Members leaving of their own accord use `leaveBoard`.
 */
export async function removeBoardMember(input: {
  boardId: string;
  userId: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardManager(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);
  const existingRole = await getBoardRole(db, input.boardId, {
    userId: input.userId,
    tenantId: actor.tenantId,
  });
  if (!existingRole) return fail('That person is not a member of this board.');
  if (existingRole === 'owner' && (await countBoardOwners(db, input.boardId)) <= 1) {
    return fail(LAST_BOARD_OWNER);
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.boardMembers)
      .where(
        and(eq(schema.boardMembers.boardId, input.boardId), eq(schema.boardMembers.userId, input.userId)),
      );
    // A removed member still showing as an assignee would be confusing
    // (assigned to someone with no access) — detach them from every card.
    await unassignFromBoardCards(tx, input.boardId, input.userId);
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

/** Any member may leave a board themselves — except its last owner. */
export async function leaveBoard(input: { boardId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const role = await getBoardRole(db, input.boardId, actor);
  if (!role) return fail(NOT_FOUND_BOARD);
  if (role === 'owner' && (await countBoardOwners(db, input.boardId)) <= 1) {
    return fail('You’re the only owner — make someone else an owner (or delete the board) first.');
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.boardMembers)
      .where(
        and(eq(schema.boardMembers.boardId, input.boardId), eq(schema.boardMembers.userId, actor.userId)),
      );
    await unassignFromBoardCards(tx, input.boardId, actor.userId);
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: input.boardId,
      actorId: actor.userId,
      type: 'member.removed',
      payload: { userId: actor.userId, left: true },
    });
  });
  refresh();
  return ok('You left the board.');
}

/** Promote a board member to co-owner or demote an owner — manager-only, last-owner protected. */
export async function updateBoardMemberRole(input: {
  boardId: string;
  userId: string;
  role: 'owner' | 'member';
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await requireBoardManager(db, input.boardId, actor))) return fail(NOT_FOUND_BOARD);
  if (input.role !== 'owner' && input.role !== 'member') return fail('Unknown role.');

  const existingRole = await getBoardRole(db, input.boardId, {
    userId: input.userId,
    tenantId: actor.tenantId,
  });
  if (!existingRole) return fail('That person is not a member of this board.');
  if (existingRole === input.role) return ok('No change.');
  if (existingRole === 'owner' && (await countBoardOwners(db, input.boardId)) <= 1) {
    return fail(LAST_BOARD_OWNER);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.boardMembers)
      .set({ role: input.role })
      .where(
        and(eq(schema.boardMembers.boardId, input.boardId), eq(schema.boardMembers.userId, input.userId)),
      );
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: input.boardId,
      actorId: actor.userId,
      type: 'member.role_changed',
      payload: { userId: input.userId, role: input.role },
    });
  });
  refresh();
  return ok(input.role === 'owner' ? 'Made an owner.' : 'Changed to member.');
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
      payload: { name: access.name },
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
    const position = await placeAmong(rows, {
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
  const fieldChanges: Record<string, unknown> = {};
  let dueChange: { dueDate: number | null } | null = null;
  if (input.title !== undefined) {
    const title = cleanName(input.title, 'Card title', 500);
    if (typeof title !== 'string') return title;
    patch.title = title;
    fieldChanges.title = title;
  }
  if (input.description !== undefined) {
    const description = cleanOptionalText(input.description, 'Description', MAX_DESCRIPTION);
    if (typeof description === 'object' && description !== null) return description;
    patch.description = description;
    fieldChanges.description = true;
  }
  if (input.dueDate !== undefined) {
    const dueDate = cleanDueDate(input.dueDate);
    if (typeof dueDate === 'object' && dueDate !== null) return dueDate;
    patch.dueDate = dueDate;
    dueChange = { dueDate };
  }
  if (Object.keys(fieldChanges).length === 0 && !dueChange) return fail('Nothing to update.');

  await db.transaction(async (tx) => {
    await tx.update(schema.cards).set(patch).where(eq(schema.cards.id, input.cardId));
    // One row per kind of change — a combined title+due-date edit used to
    // be logged as a single `due.changed` with the title buried in it.
    if (Object.keys(fieldChanges).length > 0) {
      await recordActivity(tx, {
        tenantId: actor.tenantId,
        boardId: access.boardId,
        cardId: input.cardId,
        actorId: actor.userId,
        type: 'field.changed',
        payload: fieldChanges,
      });
    }
    if (dueChange) {
      await recordActivity(tx, {
        tenantId: actor.tenantId,
        boardId: access.boardId,
        cardId: input.cardId,
        actorId: actor.userId,
        type: 'due.changed',
        payload: dueChange,
      });
    }
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
    // would cascade away with the card it narrates. The deleted id and
    // title ride in the payload so the board feed can still tell the story.
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      actorId: actor.userId,
      type: 'card.deleted',
      payload: { cardId: input.cardId, title: access.title },
    });
    await tx.delete(schema.cards).where(eq(schema.cards.id, input.cardId));
  });
  refresh();
  return ok('Card deleted.');
}

/** Archive: off the board, kept intact (list, position, everything) for a later restore. */
export async function archiveCard(input: { cardId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.cards)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.cards.id, input.cardId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: input.cardId,
      actorId: actor.userId,
      type: 'card.archived',
      payload: { title: access.title },
    });
  });
  refresh();
  return ok('Card archived.');
}

export async function restoreCard(input: { cardId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardAccess(db, input.cardId, actor);
  if (!access) return fail(NOT_FOUND_CARD);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.cards)
      .set({ archivedAt: null, updatedAt: Date.now() })
      .where(eq(schema.cards.id, input.cardId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: access.boardId,
      cardId: input.cardId,
      actorId: actor.userId,
      type: 'card.restored',
      payload: { title: access.title },
    });
  });
  refresh();
  return ok('Card restored.');
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
  // Cross-board moves are not supported — reject a target list on any other
  // board even when the actor is a member of both.
  if (!target || target.boardId !== access.boardId) return fail(NOT_FOUND_LIST);

  const listChanged = input.toListId !== access.listId;
  const moved = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: schema.cards.id, position: schema.cards.position })
      .from(schema.cards)
      .where(eq(schema.cards.listId, input.toListId))
      .orderBy(asc(schema.cards.position));
    const position = await placeAmong(rows, {
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

async function requireLabelAccess(
  db: Db,
  labelId: string,
  actor: Actor,
): Promise<{ labelId: string; boardId: string; name: string } | null> {
  const rows = await db
    .select({ boardId: schema.labels.boardId, name: schema.labels.name })
    .from(schema.labels)
    .where(eq(schema.labels.id, labelId));
  const label = rows[0];
  if (!label || !(await requireBoardMember(db, label.boardId, actor))) return null;
  return { labelId, boardId: label.boardId, name: label.name };
}

/** Rename and/or recolor a label — reflected on every card wearing it. */
export async function updateLabel(input: {
  labelId: string;
  name?: string;
  color?: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const label = await requireLabelAccess(db, input.labelId, actor);
  if (!label) return fail(NOT_FOUND_LABEL);

  const patch: Partial<typeof schema.labels.$inferInsert> = { updatedAt: Date.now() };
  if (input.name !== undefined) {
    const name = cleanName(input.name, 'Label name', 50);
    if (typeof name !== 'string') return name;
    patch.name = name;
  }
  if (input.color !== undefined) {
    if (!isBoardColor(input.color)) return fail('Pick a color for the label.');
    patch.color = input.color;
  }
  if (patch.name === undefined && patch.color === undefined) return fail('Nothing to update.');

  await db.transaction(async (tx) => {
    await tx.update(schema.labels).set(patch).where(eq(schema.labels.id, input.labelId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: label.boardId,
      actorId: actor.userId,
      type: 'label.updated',
      payload: { labelId: input.labelId, name: patch.name ?? label.name },
    });
  });
  refresh();
  return ok('Label updated.');
}

export async function deleteLabel(input: { labelId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const label = await requireLabelAccess(db, input.labelId, actor);
  if (!label) return fail(NOT_FOUND_LABEL);

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
  // commits, deep-linking straight to the card.
  if (input.userId !== actor.userId) {
    await sdk.notifications.send(
      {
        recipientUserId: input.userId,
        title: 'Assigned to a card',
        body: `You were assigned to "${access.title}" on Kanban.`,
        url: `/kanban/b/${access.boardId}?card=${input.cardId}`,
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
  db: Db,
  itemId: string,
  actor: Actor,
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

/** Edit an item's text in place. */
export async function updateChecklistItem(input: {
  itemId: string;
  text: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  const text = cleanName(input.text, 'Checklist item', 300);
  if (typeof text !== 'string') return text;
  const db = await getDb();
  const access = await requireChecklistItemAccess(db, input.itemId, actor);
  if (!access) return fail(NOT_FOUND_ITEM);

  await db.transaction(async (tx) => {
    await tx
      .update(schema.checklistItems)
      .set({ text, updatedAt: Date.now() })
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
 * button-driven reorder, not drag. A plain value swap needs no midpoint
 * math and can't underflow.
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

// ---------------------------------------------------------------------------
// Comments & activity (K.8)

/**
 * Add a top-level comment, or a reply when `parentId` is set. One level of
 * nesting only — a reply's own id can never be used as a `parentId`.
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
  let parentAuthorId: string | null = null;
  if (input.parentId) {
    const parentRows = await db
      .select({
        id: schema.comments.id,
        cardId: schema.comments.cardId,
        parentId: schema.comments.parentId,
        authorId: schema.comments.authorId,
      })
      .from(schema.comments)
      .where(eq(schema.comments.id, input.parentId));
    const parent = parentRows[0];
    if (!parent || parent.cardId !== input.cardId) return fail(NOT_FOUND_COMMENT);
    if (parent.parentId !== null) return fail('Replies can’t be nested further.');
    parentId = parent.id;
    parentAuthorId = parent.authorId;
  }

  // Everyone who has already commented on this card, captured *before* the
  // insert so the new comment's own author isn't in the set.
  const priorCommenterRows = await db
    .select({ authorId: schema.comments.authorId })
    .from(schema.comments)
    .where(eq(schema.comments.cardId, input.cardId));

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

  // K.11: notify the parent comment's author (reply-to-your-comment), every
  // assignee of the card (comment-on-your-card), and everyone else who has
  // commented on the card (thread participants) — never the commenter
  // themselves, and never the same person twice. Priority order decides the
  // wording when someone qualifies more than once.
  const recipients = new Map<string, 'reply' | 'comment' | 'thread'>();
  if (parentAuthorId && parentAuthorId !== actor.userId) {
    recipients.set(parentAuthorId, 'reply');
  }
  const assigneeRows = await db
    .select({ userId: schema.cardAssignees.userId })
    .from(schema.cardAssignees)
    .where(eq(schema.cardAssignees.cardId, input.cardId));
  for (const a of assigneeRows) {
    if (a.userId !== actor.userId && !recipients.has(a.userId)) recipients.set(a.userId, 'comment');
  }
  for (const c of priorCommenterRows) {
    if (c.authorId !== actor.userId && !recipients.has(c.authorId)) {
      recipients.set(c.authorId, 'thread');
    }
  }
  if (recipients.size > 0) {
    const requestHeaders = await headers();
    const copy = {
      reply: {
        title: 'New reply to your comment',
        body: `Someone replied to your comment on "${access.title}".`,
      },
      comment: { title: 'New comment on your card', body: `Someone commented on "${access.title}".` },
      thread: {
        title: 'New comment on a card you commented on',
        body: `Someone commented on "${access.title}".`,
      },
    } as const;
    for (const [userId, reason] of recipients) {
      await sdk.notifications.send(
        {
          recipientUserId: userId,
          title: copy[reason].title,
          body: copy[reason].body,
          url: `/kanban/b/${access.boardId}?card=${input.cardId}`,
          category: 'info',
        },
        requestHeaders,
      );
    }
  }

  refresh();
  return ok(parentId ? 'Reply added.' : 'Comment added.');
}

async function requireCommentAccess(
  db: Db,
  commentId: string,
  actor: Actor,
): Promise<{ commentId: string; cardId: string; boardId: string; authorId: string } | null> {
  const rows = await db
    .select({ cardId: schema.comments.cardId, authorId: schema.comments.authorId })
    .from(schema.comments)
    .where(eq(schema.comments.id, commentId));
  const comment = rows[0];
  if (!comment) return null;
  const access = await requireCardAccess(db, comment.cardId, actor);
  if (!access) return null;
  return { commentId, cardId: comment.cardId, boardId: access.boardId, authorId: comment.authorId };
}

/** Authors edit their own comments; nobody else's. */
export async function updateComment(input: { commentId: string; body: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const body = cleanName(input.body, 'Comment', 3000);
  if (typeof body !== 'string') return body;
  const db = await getDb();
  const comment = await requireCommentAccess(db, input.commentId, actor);
  if (!comment) return fail(NOT_FOUND_COMMENT);
  if (comment.authorId !== actor.userId) return fail('You can only edit your own comments.');

  await db.transaction(async (tx) => {
    await tx
      .update(schema.comments)
      .set({ body, updatedAt: Date.now() })
      .where(eq(schema.comments.id, input.commentId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: comment.boardId,
      cardId: comment.cardId,
      actorId: actor.userId,
      type: 'comment.edited',
      payload: { commentId: input.commentId },
    });
  });
  refresh();
  return ok('Comment updated.');
}

/**
 * Authors delete their own comments; a board owner may delete anyone's
 * (moderation). Deleting a top-level comment takes its replies with it
 * (FK cascade).
 */
export async function deleteComment(input: { commentId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  const db = await getDb();
  const comment = await requireCommentAccess(db, input.commentId, actor);
  if (!comment) return fail(NOT_FOUND_COMMENT);
  if (comment.authorId !== actor.userId) {
    const role = await getBoardRole(db, comment.boardId, actor);
    if (role !== 'owner') return fail('You can only delete your own comments.');
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.comments).where(eq(schema.comments.id, input.commentId));
    await recordActivity(tx, {
      tenantId: actor.tenantId,
      boardId: comment.boardId,
      cardId: comment.cardId,
      actorId: actor.userId,
      type: 'comment.deleted',
      payload: { commentId: input.commentId },
    });
  });
  refresh();
  return ok('Comment deleted.');
}

// ---------------------------------------------------------------------------
// Reads — data-returning actions for surfaces that fetch on open. These
// accept the viewer tier (a read, not a mutation) and never call refresh().

export async function getMoreCardActivity(input: {
  cardId: string;
  cursor: ActivityCursor;
}): Promise<
  { ok: true; items: CardDetail['activity']; nextCursor: ActivityCursor | null } | { ok: false; error: string }
> {
  const actor = await requireUser();
  const db = await getDb();
  const access = await requireCardView(db, input.cardId, actor);
  if (!access) return { ok: false, error: NOT_FOUND_CARD };
  const page = await getActivityPage(db, input.cardId, input.cursor);
  return { ok: true, ...page };
}

/** The board-level activity feed (board menu → "Activity"), newest first, paged. */
export async function getBoardActivity(input: {
  boardId: string;
  cursor?: ActivityCursor | null;
}): Promise<({ ok: true } & BoardActivityPage) | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await getBoardAccess(db, input.boardId, actor))) return { ok: false, error: NOT_FOUND_BOARD };
  const page = await getBoardActivityPage(db, input.boardId, input.cursor ?? null);
  return { ok: true, ...page };
}

/** Archived cards on a board (board menu → "Archived cards"). */
export async function listArchivedCards(input: {
  boardId: string;
}): Promise<{ ok: true; cards: ArchivedCard[] } | { ok: false; error: string }> {
  const actor = await requireUser();
  const db = await getDb();
  if (!(await getBoardAccess(db, input.boardId, actor))) return { ok: false, error: NOT_FOUND_BOARD };
  return { ok: true, cards: await getArchivedCards(db, input.boardId) };
}

// ---------------------------------------------------------------------------
// Inbox (K.11)

/**
 * Records the Inbox as seen "now" — clears the sidebar's unseen indicator.
 * Called from a client-side `useEffect` on the Inbox page mounting for
 * real, never during the page's own server render (a `<Link>` prefetch
 * would otherwise clear "unseen" for activity nobody looked at).
 */
export async function markInboxSeen(): Promise<void> {
  const actor = await requireUser();
  const db = await getDb();
  const now = Date.now();
  await db
    .insert(schema.inboxState)
    .values({ userId: actor.userId, tenantId: actor.tenantId, lastSeenAt: now })
    .onConflictDoUpdate({ target: schema.inboxState.userId, set: { lastSeenAt: now } });
  refresh();
}

// ---------------------------------------------------------------------------
// Platform notifications (mobile header bell)
//
// The real Notification Center — the same cross-plugin data the platform's
// own bell shows — read/managed via `@sovereignfs/sdk`'s
// `notifications.list/markRead/markAllRead/dismiss/dismissAll` surface.
// Every SDK call below is already self-scoped to the calling session's own
// user; `requireUser()` here is defense-in-depth, not what makes these safe.

export async function listPlatformNotifications(): Promise<NotificationListResult> {
  await requireUser();
  return sdk.notifications.list();
}

export async function markPlatformNotificationRead(id: string): Promise<ActionResult> {
  await requireUser();
  await sdk.notifications.markRead(id);
  return ok('Marked read.');
}

export async function markAllPlatformNotificationsRead(): Promise<ActionResult> {
  await requireUser();
  await sdk.notifications.markAllRead();
  return ok('Marked all read.');
}

export async function dismissPlatformNotification(id: string): Promise<ActionResult> {
  await requireUser();
  await sdk.notifications.dismiss(id);
  return ok('Dismissed.');
}

export async function dismissAllPlatformNotifications(): Promise<ActionResult> {
  await requireUser();
  await sdk.notifications.dismissAll();
  return ok('Cleared.');
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
  const visibility = formData.get('visibility');
  return updateProject({
    projectId: String(formData.get('projectId') ?? ''),
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? '') || null,
    visibility: visibility === 'private' ? 'private' : 'public',
  });
}

export async function createBoardForm(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return createBoard({
    projectId: String(formData.get('projectId') ?? ''),
    name: String(formData.get('name') ?? ''),
    color: String(formData.get('color') ?? ''),
    description: String(formData.get('description') ?? '') || null,
  });
}

export async function updateBoardForm(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const visibility = formData.get('visibility');
  return updateBoard({
    boardId: String(formData.get('boardId') ?? ''),
    name: String(formData.get('name') ?? ''),
    color: String(formData.get('color') ?? ''),
    description: String(formData.get('description') ?? '') || null,
    visibility: visibility === 'private' ? 'private' : 'public',
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
