import { sdk } from '@sovereignfs/sdk';
import type { DeletionContext, DeletionResult } from '@sovereignfs/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import type { KanbanDb, KanbanTx } from '../_db/client';
import * as schema from '../_db/schema';

export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideDelete(deleteAllKanbanData);
}

/**
 * A removed board member still showing as a card assignee would be
 * confusing (assigned to someone with no access) — mirrors
 * `actions.ts`'s `removeBoardMember` cleanup exactly, since account
 * deletion takes the same "this membership row is going away" path that
 * action already handles for a manual removal.
 */
async function unassignFromBoardCards(
  tx: KanbanTx,
  tenantId: string,
  boardId: string,
  userId: string,
): Promise<void> {
  const boardCardIds = (
    await tx
      .select({ id: schema.cards.id })
      .from(schema.cards)
      .where(and(eq(schema.cards.tenantId, tenantId), eq(schema.cards.boardId, boardId)))
  ).map((c) => c.id);
  if (boardCardIds.length === 0) return;
  await tx
    .delete(schema.cardAssignees)
    .where(
      and(
        eq(schema.cardAssignees.tenantId, tenantId),
        eq(schema.cardAssignees.userId, userId),
        inArray(schema.cardAssignees.cardId, boardCardIds),
      ),
    );
}

/**
 * Mirrors Docs' `deleteAllDocsData` (`plugins/sovereign-plugin-docs.local/app/_lib/portability.ts`)
 * one hierarchy level deeper: project → board, instead of folder →
 * document. Two loops, boards first then projects — the project loop's
 * own nested-ownership check (below) depends on the boards loop having
 * already run, the same ordering Docs' folder loop depends on its
 * document loop for.
 *
 * `createdBy`/`authorId`/`actorId`/`addedBy` attribution columns are left
 * dangling everywhere on purpose — `queries.ts` already resolves an
 * unknown user id to `null`/"Unknown" gracefully, and `activity.cardId`'s
 * own `set null` (vs. cascade) treats the audit trail as historical fact
 * that survives even a live card's own deletion, so there is nothing to
 * anonymize here that the app doesn't already handle.
 */
async function deleteAllKanbanData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as KanbanDb;
  let deleted = 0;

  // ---- Boards ----
  const boardMemberships = await db
    .select()
    .from(schema.boardMembers)
    .where(
      and(
        eq(schema.boardMembers.tenantId, ctx.tenantId),
        eq(schema.boardMembers.userId, ctx.userId),
      ),
    );

  for (const membership of boardMemberships) {
    const [board] = await db
      .select({ id: schema.boards.id })
      .from(schema.boards)
      .where(
        and(eq(schema.boards.id, membership.boardId), eq(schema.boards.tenantId, ctx.tenantId)),
      );

    if (!board) {
      // Dangling membership row with no board behind it.
      await db
        .delete(schema.boardMembers)
        .where(
          and(
            eq(schema.boardMembers.tenantId, ctx.tenantId),
            eq(schema.boardMembers.boardId, membership.boardId),
            eq(schema.boardMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    if (membership.role !== 'owner') {
      // A plain member — leave the board alone, drop just their own access
      // and card assignments (`removeBoardMember`'s exact cleanup shape).
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.boardMembers)
          .where(
            and(
              eq(schema.boardMembers.tenantId, ctx.tenantId),
              eq(schema.boardMembers.boardId, board.id),
              eq(schema.boardMembers.userId, ctx.userId),
            ),
          );
        await unassignFromBoardCards(tx, ctx.tenantId, board.id, ctx.userId);
      });
      deleted += 1;
      continue;
    }

    const allMembers = await db
      .select()
      .from(schema.boardMembers)
      .where(
        and(
          eq(schema.boardMembers.tenantId, ctx.tenantId),
          eq(schema.boardMembers.boardId, board.id),
        ),
      );
    const successors = allMembers.filter((m) => m.userId !== ctx.userId);

    if (successors.length > 0) {
      // The product UI never creates a second board owner (`removeBoardMember`
      // refuses to let the sole owner remove themselves), so this is
      // defensive rather than a case reachable through the app today — kept
      // for the same reason Docs/Sheets keep the identical check.
      const promotee =
        successors.find((m) => m.role === 'owner') ??
        [...successors].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!promotee) continue;
      await db.transaction(async (tx) => {
        if (promotee.role !== 'owner') {
          await tx
            .update(schema.boardMembers)
            .set({ role: 'owner' })
            .where(
              and(
                eq(schema.boardMembers.tenantId, ctx.tenantId),
                eq(schema.boardMembers.boardId, board.id),
                eq(schema.boardMembers.userId, promotee.userId),
              ),
            );
        }
        await tx
          .delete(schema.boardMembers)
          .where(
            and(
              eq(schema.boardMembers.tenantId, ctx.tenantId),
              eq(schema.boardMembers.boardId, board.id),
              eq(schema.boardMembers.userId, ctx.userId),
            ),
          );
        await unassignFromBoardCards(tx, ctx.tenantId, board.id, ctx.userId);
      });
      deleted += 1;
    } else {
      // Sole board member — nothing left to preserve. `boards`' cascade
      // (`onDelete: 'cascade'`, schema.ts) handles lists/cards/labels/
      // cardLabels/cardAssignees/checklistItems/comments/activity for free —
      // no manual per-table cleanup needed, unlike Docs/Sheets' workbooks/
      // folders, which have no cascade defined at all.
      await db
        .delete(schema.boards)
        .where(and(eq(schema.boards.id, board.id), eq(schema.boards.tenantId, ctx.tenantId)));
      deleted += 1;
    }
  }

  // ---- Projects ----
  const projectMemberships = await db
    .select()
    .from(schema.projectMembers)
    .where(
      and(
        eq(schema.projectMembers.tenantId, ctx.tenantId),
        eq(schema.projectMembers.userId, ctx.userId),
      ),
    );

  for (const membership of projectMemberships) {
    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.id, membership.projectId),
          eq(schema.projects.tenantId, ctx.tenantId),
        ),
      );

    if (!project) {
      await db
        .delete(schema.projectMembers)
        .where(
          and(
            eq(schema.projectMembers.tenantId, ctx.tenantId),
            eq(schema.projectMembers.projectId, membership.projectId),
            eq(schema.projectMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    const allMembers = await db
      .select()
      .from(schema.projectMembers)
      .where(
        and(
          eq(schema.projectMembers.tenantId, ctx.tenantId),
          eq(schema.projectMembers.projectId, project.id),
        ),
      );
    const otherMembers = allMembers.filter((m) => m.userId !== ctx.userId);
    const otherOwners = otherMembers.filter((m) => m.role === 'owner');

    if (membership.role !== 'owner' || otherOwners.length > 0) {
      // Either a plain member, or an owner stepping down while a co-owner
      // remains — `countProjectOwners`'s own last-owner invariant.
      // Deliberately does not cascade to this user's board memberships
      // under the project (`removeProjectMember`'s own documented
      // behavior) — those were already resolved independently, above.
      await db
        .delete(schema.projectMembers)
        .where(
          and(
            eq(schema.projectMembers.tenantId, ctx.tenantId),
            eq(schema.projectMembers.projectId, project.id),
            eq(schema.projectMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    const otherNonOwners = otherMembers.filter((m) => m.role !== 'owner');
    if (otherNonOwners.length > 0) {
      // Last owner, but other members exist — promote the earliest-joined
      // one, mirroring `updateProjectMemberRole`'s own promote path.
      const promotee = [...otherNonOwners].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!promotee) continue;
      await db.transaction(async (tx) => {
        await tx
          .update(schema.projectMembers)
          .set({ role: 'owner' })
          .where(
            and(
              eq(schema.projectMembers.tenantId, ctx.tenantId),
              eq(schema.projectMembers.projectId, project.id),
              eq(schema.projectMembers.userId, promotee.userId),
            ),
          );
        await tx
          .delete(schema.projectMembers)
          .where(
            and(
              eq(schema.projectMembers.tenantId, ctx.tenantId),
              eq(schema.projectMembers.projectId, project.id),
              eq(schema.projectMembers.userId, ctx.userId),
            ),
          );
      });
      deleted += 1;
      continue;
    }

    // Sole project member. Before hard-deleting the project (which would
    // cascade every board under it away), check whether any board here is
    // still independently owned by someone else entirely — reachable
    // because `removeProjectMember` deliberately never cascades to board
    // membership, so a person can hold real board ownership under a
    // project they currently have no project-level membership on at all.
    const projectBoards = await db
      .select({ id: schema.boards.id })
      .from(schema.boards)
      .where(
        and(eq(schema.boards.tenantId, ctx.tenantId), eq(schema.boards.projectId, project.id)),
      );
    let bystanderOwnerId: string | undefined;
    for (const projectBoard of projectBoards) {
      const [ownerRow] = await db
        .select({ userId: schema.boardMembers.userId })
        .from(schema.boardMembers)
        .where(
          and(
            eq(schema.boardMembers.tenantId, ctx.tenantId),
            eq(schema.boardMembers.boardId, projectBoard.id),
            eq(schema.boardMembers.role, 'owner'),
          ),
        );
      if (ownerRow && ownerRow.userId !== ctx.userId) {
        bystanderOwnerId = ownerRow.userId;
        break;
      }
    }

    if (bystanderOwnerId) {
      const promoteeId = bystanderOwnerId;
      await db.transaction(async (tx) => {
        await tx.insert(schema.projectMembers).values({
          projectId: project.id,
          userId: promoteeId,
          tenantId: ctx.tenantId,
          role: 'owner',
          addedBy: ctx.userId,
          createdAt: Date.now(),
        });
        await tx
          .delete(schema.projectMembers)
          .where(
            and(
              eq(schema.projectMembers.tenantId, ctx.tenantId),
              eq(schema.projectMembers.projectId, project.id),
              eq(schema.projectMembers.userId, ctx.userId),
            ),
          );
      });
      deleted += 1;
    } else {
      // Genuinely nothing left — hard-delete cascades to every board (and
      // transitively every list/card/etc.) under it.
      await db
        .delete(schema.projects)
        .where(and(eq(schema.projects.id, project.id), eq(schema.projects.tenantId, ctx.tenantId)));
      deleted += 1;
    }
  }

  const inboxRows = await db
    .select({ userId: schema.inboxState.userId })
    .from(schema.inboxState)
    .where(eq(schema.inboxState.userId, ctx.userId));
  await db.delete(schema.inboxState).where(eq(schema.inboxState.userId, ctx.userId));
  deleted += inboxRows.length;

  return { deleted };
}
