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

/** The project row, or null when it doesn't exist or the actor didn't create it. */
export async function requireProjectCreator(
  db: KanbanDb,
  projectId: string,
  actor: Actor,
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.createdBy, actor.userId),
        eq(schema.projects.tenantId, actor.tenantId),
      ),
    );
  return rows[0] ?? null;
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
