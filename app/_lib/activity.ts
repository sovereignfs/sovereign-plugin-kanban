import type { KanbanTx, KanbanDb } from '../_db/client';
import { newId } from './ids';
import * as schema from '../_db/schema';

/** Activity vocabulary (SPEC "Activity & notifications"). */
export type ActivityType =
  | 'card.created'
  | 'card.moved'
  | 'card.deleted'
  | 'field.changed'
  | 'assignee.added'
  | 'assignee.removed'
  | 'label.added'
  | 'label.removed'
  | 'due.changed'
  | 'checklist.changed'
  | 'comment.added'
  | 'list.created'
  | 'list.renamed'
  | 'list.deleted'
  | 'board.created'
  | 'member.added'
  | 'member.removed';

export interface ActivityInput {
  tenantId: string;
  boardId: string;
  /** Null for board-level events (list/membership changes). */
  cardId?: string | null;
  actorId: string;
  type: ActivityType;
  payload?: Record<string, unknown>;
}

/**
 * Record one activity row. Call inside the same transaction as the mutation
 * it describes so the audit trail can never disagree with the data.
 */
export async function recordActivity(db: KanbanDb | KanbanTx, input: ActivityInput): Promise<void> {
  await db.insert(schema.activity).values({
    id: newId(),
    tenantId: input.tenantId,
    boardId: input.boardId,
    cardId: input.cardId ?? null,
    actorId: input.actorId,
    type: input.type,
    payload: input.payload === undefined ? null : JSON.stringify(input.payload),
    createdAt: Date.now(),
  });
}
