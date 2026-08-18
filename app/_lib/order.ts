/**
 * Pure drag-time ordering — visual order only, never the numeric `position`
 * column (the server computes real fractional positions; the client only
 * needs "what order do things visually sit in right now" to (a) render
 * during a drag and (b) name the drop's before/after neighbours for
 * `reorderList`/`moveCard`). Deliberately dnd-kit-free so it's unit-testable
 * without the DOM.
 */
import { arrayMove } from '@dnd-kit/sortable';

export interface OrderState {
  /** Board list ids, in display order. */
  listOrder: string[];
  /** listId -> its card ids, in display order. */
  cardOrderByList: Record<string, string[]>;
}

export type OrderAction =
  | { type: 'moveList'; listId: string; toIndex: number }
  | { type: 'moveCard'; cardId: string; toListId: string; toIndex: number };

export function seedOrder(
  lists: Array<{ id: string }>,
  cards: Array<{ id: string; listId: string }>,
): OrderState {
  const cardOrderByList: Record<string, string[]> = {};
  for (const list of lists) cardOrderByList[list.id] = [];
  for (const card of cards) cardOrderByList[card.listId]?.push(card.id);
  return { listOrder: lists.map((l) => l.id), cardOrderByList };
}

function findListOf(state: OrderState, cardId: string): string | undefined {
  return Object.keys(state.cardOrderByList).find((listId) =>
    state.cardOrderByList[listId]?.includes(cardId),
  );
}

/** Clamp an insertion index into `[0, length]` — arrayMove/splice targets, not an existing-item index. */
function clampInsertIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

export function applyOrder(state: OrderState, action: OrderAction): OrderState {
  if (action.type === 'moveList') {
    const fromIndex = state.listOrder.indexOf(action.listId);
    if (fromIndex === -1) return state;
    const toIndex = clampInsertIndex(action.toIndex, state.listOrder.length - 1);
    return { ...state, listOrder: arrayMove(state.listOrder, fromIndex, toIndex) };
  }

  const { cardId, toListId, toIndex } = action;
  const fromListId = findListOf(state, cardId);
  if (!fromListId) return state;

  if (fromListId === toListId) {
    const list = state.cardOrderByList[fromListId] ?? [];
    const fromIndex = list.indexOf(cardId);
    const clamped = clampInsertIndex(toIndex, list.length - 1);
    return {
      ...state,
      cardOrderByList: { ...state.cardOrderByList, [fromListId]: arrayMove(list, fromIndex, clamped) },
    };
  }

  // Cross-list: remove from the source array, insert into the destination —
  // no index-shift correction needed since they're different arrays.
  const source = (state.cardOrderByList[fromListId] ?? []).filter((id) => id !== cardId);
  const destination = [...(state.cardOrderByList[toListId] ?? [])];
  destination.splice(clampInsertIndex(toIndex, destination.length), 0, cardId);
  return {
    ...state,
    cardOrderByList: { ...state.cardOrderByList, [fromListId]: source, [toListId]: destination },
  };
}

const LIST_DROP_PREFIX = 'list-drop:';

/**
 * A droppable id for a list's card container, distinct from the list's own
 * id (used separately as its sortable-item id in the outer lists row) and
 * from any card id — lets an empty list (with no card sortables of its own
 * to be dropped "onto") still register as a valid drop target.
 */
export function listDropId(listId: string): string {
  return `${LIST_DROP_PREFIX}${listId}`;
}

/** Recovers the list id from a `listDropId()` string, or null if it isn't one. */
export function listIdFromDropId(id: string): string | null {
  return id.startsWith(LIST_DROP_PREFIX) ? id.slice(LIST_DROP_PREFIX.length) : null;
}

/** The ids immediately before/after `id` in `order` — `reorderList`/`moveCard`'s neighbour args. */
export function neighborsOf(order: string[], id: string): { prevId: string | null; nextId: string | null } {
  const index = order.indexOf(id);
  if (index === -1) return { prevId: null, nextId: null };
  return { prevId: order[index - 1] ?? null, nextId: order[index + 1] ?? null };
}

/**
 * K.15's "Move to…" — `moveCard`'s neighbour args for dropping a card at the
 * very top or bottom of a target list, from that list's own cards (any
 * order — sorted here by `position`, the same field the server itself
 * orders by, so this is correct regardless of what order `targetListCards`
 * arrives in).
 */
export function topBottomNeighbors(
  targetListCards: Array<{ id: string; position: number }>,
  edge: 'top' | 'bottom',
): { prevCardId: string | null; nextCardId: string | null } {
  const sorted = [...targetListCards].sort((a, b) => a.position - b.position);
  if (edge === 'top') return { prevCardId: null, nextCardId: sorted[0]?.id ?? null };
  return { prevCardId: sorted[sorted.length - 1]?.id ?? null, nextCardId: null };
}
