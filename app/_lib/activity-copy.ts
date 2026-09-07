/**
 * Human-readable copy for one `kanban_activity` row (K.8 review checklist:
 * "no internal type names leak"). The actor's name is rendered separately by
 * the caller — this only returns the verb phrase that follows it, e.g.
 * "commented" in "**You** commented · 5m ago".
 *
 * Two scopes: `'card'` (the card detail panel's own feed — "this card") and
 * `'board'` (the board-level activity panel, where every row needs to say
 * *which* card — "created card "Fix login""). Board-scope copy takes the
 * card's name from `ctx.cardTitle` when the row still points at a live card,
 * falling back to the title captured in the payload at write time
 * (`card.created`, `card.deleted`) so a deleted card's history still reads.
 *
 * The `default` case keeps this function forward-compatible with activity
 * types added by later tasks without requiring an edit here first.
 */
import type { CardDetail } from './queries';

type ActivityItem = Pick<CardDetail['activity'][number], 'type' | 'payload'>;

export interface ActivityCopyContext {
  lists: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  resolveName: (userId: string) => string;
  /** Defaults to 'card'. */
  scope?: 'card' | 'board';
  /** Board scope only — the live card title for rows that still have a card. */
  cardTitle?: string | null;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ms));
}

export function describeActivity(item: ActivityItem, ctx: ActivityCopyContext): string {
  const payload = payloadRecord(item.payload);
  const boardScope = ctx.scope === 'board';
  const payloadTitle = typeof payload.title === 'string' ? payload.title : null;
  const cardName = ctx.cardTitle ?? payloadTitle;
  // "this card" inside a card's own feed; a named card (or "a card") in the board feed.
  const card = boardScope ? (cardName ? `card "${cardName}"` : 'a card') : 'this card';
  const onCard = boardScope ? ` on ${card}` : '';

  switch (item.type) {
    case 'card.created':
      return `created ${card}`;
    case 'card.moved': {
      const toListId = payload.toListId;
      const toList = typeof toListId === 'string' ? ctx.lists.find((l) => l.id === toListId) : undefined;
      return toList ? `moved ${card} to "${toList.name}"` : `moved ${card}`;
    }
    case 'card.deleted':
      return `deleted ${card}`;
    case 'card.archived':
      return `archived ${card}`;
    case 'card.restored':
      return `restored ${card}`;
    case 'field.changed': {
      if (typeof payload.title === 'string') {
        return boardScope ? `renamed a card to "${payload.title}"` : `renamed the card to "${payload.title}"`;
      }
      if (payload.description) return `updated the description${onCard}`;
      return boardScope ? `updated ${card}` : 'updated the card';
    }
    case 'due.changed': {
      const dueDate = payload.dueDate;
      if (dueDate === null || dueDate === undefined) return `cleared the due date${onCard}`;
      return typeof dueDate === 'number'
        ? `set the due date to ${formatDate(dueDate)}${onCard}`
        : `updated the due date${onCard}`;
    }
    case 'assignee.added': {
      const userId = payload.userId;
      return typeof userId === 'string'
        ? `assigned ${ctx.resolveName(userId)}${boardScope ? ` to ${card}` : ''}`
        : `assigned someone${boardScope ? ` to ${card}` : ''}`;
    }
    case 'assignee.removed': {
      const userId = payload.userId;
      return typeof userId === 'string'
        ? `unassigned ${ctx.resolveName(userId)}${boardScope ? ` from ${card}` : ''}`
        : `unassigned someone${boardScope ? ` from ${card}` : ''}`;
    }
    case 'label.added': {
      const labelId = payload.labelId;
      const label = typeof labelId === 'string' ? ctx.labels.find((l) => l.id === labelId) : undefined;
      return label ? `added the label "${label.name}"${onCard}` : `added a label${onCard}`;
    }
    case 'label.removed': {
      const labelId = payload.labelId;
      const label = typeof labelId === 'string' ? ctx.labels.find((l) => l.id === labelId) : undefined;
      return label ? `removed the label "${label.name}"${onCard}` : `removed a label${onCard}`;
    }
    case 'label.updated': {
      const name = payload.name;
      return typeof name === 'string' ? `updated the label "${name}"` : 'updated a label';
    }
    case 'checklist.changed':
      return `updated the checklist${onCard}`;
    case 'comment.added':
      return payload.parentId ? `replied to a comment${onCard}` : `commented${onCard}`;
    case 'comment.edited':
      return `edited a comment${onCard}`;
    case 'comment.deleted':
      return `deleted a comment${onCard}`;
    case 'list.created': {
      const name = payload.name;
      return typeof name === 'string' ? `created the list "${name}"` : 'created a list';
    }
    case 'list.renamed': {
      const name = payload.name;
      return typeof name === 'string' ? `renamed a list to "${name}"` : 'renamed a list';
    }
    case 'list.deleted': {
      const name = payload.name;
      return typeof name === 'string' ? `deleted the list "${name}"` : 'deleted a list';
    }
    case 'board.created':
      return 'created the board';
    case 'board.updated': {
      const name = payload.name;
      if (typeof name === 'string') return `renamed the board to "${name}"`;
      return 'updated the board settings';
    }
    case 'board.archived':
      return 'archived the board';
    case 'board.restored':
      return 'restored the board';
    case 'member.added': {
      const userId = payload.userId;
      return typeof userId === 'string'
        ? `added ${ctx.resolveName(userId)} to the board`
        : 'added a member';
    }
    case 'member.removed': {
      const userId = payload.userId;
      if (payload.left) return 'left the board';
      return typeof userId === 'string'
        ? `removed ${ctx.resolveName(userId)} from the board`
        : 'removed a member';
    }
    case 'member.role_changed': {
      const userId = payload.userId;
      const who = typeof userId === 'string' ? ctx.resolveName(userId) : 'someone';
      return payload.role === 'owner' ? `made ${who} a board owner` : `changed ${who} to a member`;
    }
    default:
      return 'updated the board';
  }
}
