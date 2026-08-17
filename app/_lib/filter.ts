/**
 * K.10 board search/filter — pure, dnd-kit/React-free so it's directly
 * unit-testable (same reasoning as `order.ts`'s split in K.7). Matches
 * title or any attached label name, case-insensitive substring.
 */
export interface FilterableCard {
  title: string;
  labels: Array<{ name: string }>;
}

export function normalizeFilterQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/** `query` must already be normalized (see `normalizeFilterQuery`) — an empty query matches everything. */
export function matchesBoardFilter(card: FilterableCard, query: string): boolean {
  if (!query) return true;
  if (card.title.toLowerCase().includes(query)) return true;
  return card.labels.some((label) => label.name.toLowerCase().includes(query));
}
