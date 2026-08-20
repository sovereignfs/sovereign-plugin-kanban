/**
 * Per-resource authorization. Every server action starts with
 * `requireUser()` (session) and then the relevant resource check — the
 * middleware's route gating is never sufficient for a server action, which
 * is a public POST endpoint dispatched by action id.
 *
 * Denials deliberately read as "not found": whether a board exists is
 * itself membership-gated information.
 */
import { sdk } from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import type { KanbanDb } from '../_db/client';
import * as schema from '../_db/schema';

export interface Actor {
  userId: string;
  tenantId: string;
}

export async function requireUser(): Promise<Actor> {
  const session = await sdk.auth.requireSession();
  return { userId: session.user.id, tenantId: session.user.tenantId };
}

export type BoardRole = 'owner' | 'member';

/** The actor's role on a board, or null when not a member (or no such board). */
export async function getBoardRole(
  db: KanbanDb,
  boardId: string,
  actor: Actor,
): Promise<BoardRole | null> {
  const rows = await db
    .select({ role: schema.boardMembers.role })
    .from(schema.boardMembers)
    .where(
      and(
        eq(schema.boardMembers.boardId, boardId),
        eq(schema.boardMembers.userId, actor.userId),
        eq(schema.boardMembers.tenantId, actor.tenantId),
      ),
    );
  const role = rows[0]?.role;
  return role === 'owner' || role === 'member' ? role : null;
}

/** Null when the actor may not touch this board. */
export async function requireBoardMember(
  db: KanbanDb,
  boardId: string,
  actor: Actor,
): Promise<BoardRole | null> {
  return getBoardRole(db, boardId, actor);
}

/** Null unless the actor owns this board. */
export async function requireBoardOwner(
  db: KanbanDb,
  boardId: string,
  actor: Actor,
): Promise<BoardRole | null> {
  const role = await getBoardRole(db, boardId, actor);
  return role === 'owner' ? role : null;
}

export type ProjectRole = 'owner' | 'member';

/**
 * The actor's role on a project, or null when not a member (or no such
 * project). Mirrors `getBoardRole` exactly. Phase 2 (K.18) — a project's
 * `created_by` stays a historical "who created this" field; ownership
 * authority now lives here, in `kanban_project_members`. See CONCEPT.md's
 * "Phase 2" section.
 */
export async function getProjectRole(
  db: KanbanDb,
  projectId: string,
  actor: Actor,
): Promise<ProjectRole | null> {
  const rows = await db
    .select({ role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .where(
      and(
        eq(schema.projectMembers.projectId, projectId),
        eq(schema.projectMembers.userId, actor.userId),
        eq(schema.projectMembers.tenantId, actor.tenantId),
      ),
    );
  const role = rows[0]?.role;
  return role === 'owner' || role === 'member' ? role : null;
}

/** Null when the actor isn't a member of this project at all. */
export async function requireProjectMember(
  db: KanbanDb,
  projectId: string,
  actor: Actor,
): Promise<ProjectRole | null> {
  return getProjectRole(db, projectId, actor);
}

/** Null unless the actor owns this project (one of possibly several owners). */
export async function requireProjectOwner(
  db: KanbanDb,
  projectId: string,
  actor: Actor,
): Promise<ProjectRole | null> {
  const role = await getProjectRole(db, projectId, actor);
  return role === 'owner' ? role : null;
}

/**
 * The board a card belongs to, if the actor is a member of it. The single
 * check every card-scoped action uses: resolves the card's board and the
 * actor's membership in one place so a forged cardId can't cross boards.
 */
export async function requireCardAccess(
  db: KanbanDb,
  cardId: string,
  actor: Actor,
): Promise<{ cardId: string; boardId: string; listId: string; role: BoardRole } | null> {
  const rows = await db
    .select({
      cardId: schema.cards.id,
      boardId: schema.cards.boardId,
      listId: schema.cards.listId,
      role: schema.boardMembers.role,
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
  const row = rows[0];
  if (!row) return null;
  return { ...row, role: row.role === 'owner' ? 'owner' : 'member' };
}

/** The board a list belongs to, if the actor is a member of it. */
export async function requireListAccess(
  db: KanbanDb,
  listId: string,
  actor: Actor,
): Promise<{ listId: string; boardId: string; role: BoardRole } | null> {
  const rows = await db
    .select({
      listId: schema.lists.id,
      boardId: schema.lists.boardId,
      role: schema.boardMembers.role,
    })
    .from(schema.lists)
    .innerJoin(
      schema.boardMembers,
      and(
        eq(schema.boardMembers.boardId, schema.lists.boardId),
        eq(schema.boardMembers.userId, actor.userId),
        eq(schema.boardMembers.tenantId, actor.tenantId),
      ),
    )
    .where(eq(schema.lists.id, listId));
  const row = rows[0];
  if (!row) return null;
  return { ...row, role: row.role === 'owner' ? 'owner' : 'member' };
}
