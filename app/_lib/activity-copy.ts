/**
 * Human-readable copy for one `kanban_activity` row (K.8 review checklist:
 * "no internal type names leak"). The actor's name is rendered separately by
 * the caller — this only returns the verb phrase that follows it, e.g.
 * "commented" in "**You** commented · 5m ago".
 *
 * `card.deleted`/`list.*`/`board.created`/`member.*` are board-level events
 * (recorded with no `cardId`, see `activity.ts`) and so never actually reach
 * a card-scoped feed like this one — their copy exists anyway for
 * completeness. The `default` case keeps this function forward-compatible
 * with activity types added by later tasks without requiring an edit here
 * first.
 *
 * `ActivityCopyContext.lists`/`labels` are deliberately the minimal shape
 * this file actually reads (`id`/`name`[/`color`]), not the full
 * `BoardData['lists']`/`['labels']` — a single-board `BoardData` value still
 * satisfies this structurally (extra fields are fine). This function is only
 * consumed by the card detail panel's own activity log now — the Inbox
 * (K.11, redesigned) no longer goes through `kanban_activity`/this function
 * at all; see `queries.ts`'s `getInboxFeed` for its own dedicated copy.
 */
import type { CardDetail } from './queries';

type ActivityItem = CardDetail['activity'][number];

export interface ActivityCopyContext {
  lists: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  resolveName: (userId: string) => string;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ms));
}

export function describeActivity(item: ActivityItem, ctx: ActivityCopyContext): string {
  const payload = payloadRecord(item.payload);

  switch (item.type) {
    case 'card.created':
      return 'created this card';
    case 'card.moved': {
      const toListId = payload.toListId;
      const toList = typeof toListId === 'string' ? ctx.lists.find((l) => l.id === toListId) : undefined;
      return toList ? `moved this card to "${toList.name}"` : 'moved this card';
    }
    case 'card.deleted':
      return 'deleted this card';
    case 'field.changed': {
      if (typeof payload.title === 'string') return `renamed the card to "${payload.title}"`;
      if (payload.description) return 'updated the description';
      return 'updated the card';
    }
    case 'due.changed': {
      const dueDate = payload.dueDate;
      if (dueDate === null || dueDate === undefined) return 'cleared the due date';
      return typeof dueDate === 'number' ? `set the due date to ${formatDate(dueDate)}` : 'updated the due date';
    }
    case 'assignee.added': {
      const userId = payload.userId;
      return typeof userId === 'string' ? `assigned ${ctx.resolveName(userId)}` : 'assigned someone';
    }
    case 'assignee.removed': {
      const userId = payload.userId;
      return typeof userId === 'string' ? `unassigned ${ctx.resolveName(userId)}` : 'unassigned someone';
    }
    case 'label.added': {
      const labelId = payload.labelId;
      const label = typeof labelId === 'string' ? ctx.labels.find((l) => l.id === labelId) : undefined;
      return label ? `added the label "${label.name}"` : 'added a label';
    }
    case 'label.removed': {
      const labelId = payload.labelId;
      const label = typeof labelId === 'string' ? ctx.labels.find((l) => l.id === labelId) : undefined;
      return label ? `removed the label "${label.name}"` : 'removed a label';
    }
    case 'checklist.changed':
      return 'updated the checklist';
    case 'comment.added':
      return payload.parentId ? 'replied to a comment' : 'commented';
    case 'list.created': {
      const name = payload.name;
      return typeof name === 'string' ? `created the list "${name}"` : 'created a list';
    }
    case 'list.renamed': {
      const name = payload.name;
      return typeof name === 'string' ? `renamed a list to "${name}"` : 'renamed a list';
    }
    case 'list.deleted':
      return 'deleted a list';
    case 'board.created':
      return 'created the board';
    case 'member.added': {
      const userId = payload.userId;
      return typeof userId === 'string'
        ? `added ${ctx.resolveName(userId)} to the board`
        : 'added a member';
    }
    case 'member.removed': {
      const userId = payload.userId;
      return typeof userId === 'string'
        ? `removed ${ctx.resolveName(userId)} from the board`
        : 'removed a member';
    }
    default:
      return 'updated the board';
  }
}
