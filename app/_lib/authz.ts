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
import { and, eq, isNull } from 'drizzle-orm';
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

/**
 * Null when the actor may not *edit* this board: not an explicit member, or
 * the board is archived (archived boards are read-only for everyone until
 * restored — the manager-only `restoreBoard` doesn't go through here).
 */
export async function requireBoardMember(
  db: KanbanDb,
  boardId: string,
  actor: Actor,
): Promise<BoardRole | null> {
  const rows = await db
    .select({ role: schema.boardMembers.role })
    .from(schema.boardMembers)
    .innerJoin(schema.boards, eq(schema.boards.id, schema.boardMembers.boardId))
    .where(
      and(
        eq(schema.boardMembers.boardId, boardId),
        eq(schema.boardMembers.userId, actor.userId),
        eq(schema.boardMembers.tenantId, actor.tenantId),
        isNull(schema.boards.archivedAt),
      ),
    );
  const role = rows[0]?.role;
  return role === 'owner' || role === 'member' ? role : null;
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
 * The board a card belongs to, if the actor is a member of it and the board
 * isn't archived. The single check every card-scoped mutation uses:
 * resolves the card's board and the actor's membership in one place so a
 * forged cardId can't cross boards. (An archived *card* on a live board
 * still passes — restore/delete need it.)
 */
export async function requireCardAccess(
  db: KanbanDb,
  cardId: string,
  actor: Actor,
): Promise<{ cardId: string; boardId: string; listId: string; title: string; role: BoardRole } | null> {
  const rows = await db
    .select({
      cardId: schema.cards.id,
      boardId: schema.cards.boardId,
      listId: schema.cards.listId,
      title: schema.cards.title,
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
    .innerJoin(schema.boards, eq(schema.boards.id, schema.cards.boardId))
    .where(and(eq(schema.cards.id, cardId), isNull(schema.boards.archivedAt)));
  const row = rows[0];
  if (!row) return null;
  return { ...row, role: row.role === 'owner' ? 'owner' : 'member' };
}

/** The board a list belongs to, if the actor is a member of it and the board isn't archived. */
export async function requireListAccess(
  db: KanbanDb,
  listId: string,
  actor: Actor,
): Promise<{ listId: string; boardId: string; name: string; role: BoardRole } | null> {
  const rows = await db
    .select({
      listId: schema.lists.id,
      boardId: schema.lists.boardId,
      name: schema.lists.name,
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
    .innerJoin(schema.boards, eq(schema.boards.id, schema.lists.boardId))
    .where(and(eq(schema.lists.id, listId), isNull(schema.boards.archivedAt)));
  const row = rows[0];
  if (!row) return null;
  return { ...row, role: row.role === 'owner' ? 'owner' : 'member' };
}

// ---------------------------------------------------------------------------
// Phase 2 read-side access and board management (K.18/K.20/K.21)

export type BoardViewRole = BoardRole | 'viewer';

export interface BoardAccess {
  boardId: string;
  projectId: string;
  /** 'viewer' = read-only via project ownership or public project + public board. */
  role: BoardViewRole;
  /** The actor's project-level role, if any — a project owner can always view. */
  projectRole: ProjectRole | null;
  boardVisibility: string;
  projectVisibility: string;
}

/**
 * Who may *see* a board — the single read-side resolver `getBoardData`,
 * `getCardDetail`, and every read action (`getMoreCardActivity`,
 * `getBoardActivity`, `getArchivedCards`) share. The three tiers are
 * CONCEPT.md's Phase 2 rules: an explicit member (edit access), a project
 * owner (always, regardless of either visibility flag), or a plain project
 * member when both the project and the board are `public`. Null means "no
 * access at all" — callers render the authenticated 404, never a
 * confirmation the board exists.
 *
 * Previously only `getBoardData` resolved the viewer tier; `getCardDetail`
 * still inner-joined `kanban_board_members`, so a viewer could open a board
 * but clicking any card silently rendered nothing (and every `?card=`
 * deep link from a notification landed on the bare board). Centralizing the
 * check here is what fixed that.
 */
export async function getBoardAccess(
  db: KanbanDb,
  boardId: string,
  actor: Actor,
): Promise<BoardAccess | null> {
  const rows = await db
    .select({
      boardId: schema.boards.id,
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
  const row = rows[0];
  if (!row) return null;

  const projectRole = await getProjectRole(db, row.projectId, actor);
  const base = {
    boardId: row.boardId,
    projectId: row.projectId,
    projectRole,
    boardVisibility: row.boardVisibility,
    projectVisibility: row.projectVisibility,
  };
  if (row.memberRole === 'owner' || row.memberRole === 'member') {
    return { ...base, role: row.memberRole };
  }
  if (projectRole === 'owner') return { ...base, role: 'viewer' };
  if (
    projectRole === 'member' &&
    row.projectVisibility === 'public' &&
    row.boardVisibility === 'public'
  ) {
    return { ...base, role: 'viewer' };
  }
  return null;
}

/**
 * Who may *administer* a board — its settings, archive/delete, and
 * membership: a board owner, or (K.20) any owner of the board's project.
 * Project ownership still never grants edit access to a board's *content*
 * (CONCEPT.md's Phase 2 rules — `requireBoardMember`/`requireCardAccess`
 * are unchanged); this only opens the configure-once surfaces, so a board
 * whose owner has left the project doesn't become unmanageable.
 */
export async function requireBoardManager(
  db: KanbanDb,
  boardId: string,
  actor: Actor,
): Promise<{ boardId: string; projectId: string; isBoardOwner: boolean } | null> {
  const access = await getBoardAccess(db, boardId, actor);
  if (!access) return null;
  const isBoardOwner = access.role === 'owner';
  if (!isBoardOwner && access.projectRole !== 'owner') return null;
  return { boardId: access.boardId, projectId: access.projectId, isBoardOwner };
}

/**
 * Read-side counterpart of `requireCardAccess`: the card's board, if the
 * actor may at least view it (member or viewer). Card *mutations* keep
 * using `requireCardAccess`, which still demands explicit membership.
 */
export async function requireCardView(
  db: KanbanDb,
  cardId: string,
  actor: Actor,
): Promise<{ cardId: string; boardId: string; listId: string; role: BoardViewRole } | null> {
  const rows = await db
    .select({ cardId: schema.cards.id, boardId: schema.cards.boardId, listId: schema.cards.listId })
    .from(schema.cards)
    .where(eq(schema.cards.id, cardId));
  const row = rows[0];
  if (!row) return null;
  const access = await getBoardAccess(db, row.boardId, actor);
  if (!access) return null;
  return { ...row, role: access.role };
}
