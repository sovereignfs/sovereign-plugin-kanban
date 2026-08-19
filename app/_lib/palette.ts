/**
 * Board/label color palette. The design system is deliberately monochrome —
 * no decorative color tokens exist — so these colors are plugin *data*: a
 * curated set of muted hexes stored on rows by id and rendered via inline
 * `style`, never from CSS files (see docs/adhoc/web-home.md, "Board colors
 * are data, not tokens"). K.6's labels reuse this module.
 */
export interface PaletteColor {
  id: string;
  /** User-facing name (swatch tooltip / aria-label). */
  name: string;
  value: string;
  /**
   * Whether text/icons painted directly on this color (the board canvas and
   * header — never a label chip, which never has text drawn over it) need
   * to be light or dark to stay readable. Board-only concern, but declared
   * per swatch since labels reuse the same array and don't care about it.
   */
  textOn: 'light' | 'dark';
}

export const BOARD_COLORS: readonly PaletteColor[] = [
  { id: 'sky', name: 'Sky', value: '#b5c9e8', textOn: 'dark' },
  { id: 'sage', name: 'Sage', value: '#c9e0c4', textOn: 'dark' },
  { id: 'sand', name: 'Sand', value: '#e8d3b5', textOn: 'dark' },
  { id: 'clay', name: 'Clay', value: '#e0c4c4', textOn: 'dark' },
  { id: 'lilac', name: 'Lilac', value: '#d8c4e0', textOn: 'dark' },
  { id: 'mist', name: 'Mist', value: '#c4dde0', textOn: 'dark' },
  { id: 'stone', name: 'Stone', value: '#d6d3cb', textOn: 'dark' },
  { id: 'slate', name: 'Slate', value: '#c9cbd4', textOn: 'dark' },
  // Darker options — same muted/desaturated character as the pastels above
  // (not vivid/saturated), just shifted toward the dark end of each hue
  // rather than the light end, so they read as part of the same curated
  // set rather than a mismatched second palette.
  { id: 'ink', name: 'Ink', value: '#3b5166', textOn: 'light' },
  { id: 'forest', name: 'Forest', value: '#3f5c4c', textOn: 'light' },
  { id: 'wine', name: 'Wine', value: '#6b3b4a', textOn: 'light' },
  { id: 'charcoal', name: 'Charcoal', value: '#494952', textOn: 'light' },
] as const;

const FALLBACK: PaletteColor = { id: 'sky', name: 'Sky', value: '#b5c9e8', textOn: 'dark' };

export const DEFAULT_BOARD_COLOR = FALLBACK.id;

/** Board-only sentinel — never a valid label color (see `isBoardColor` vs. `isBoardColorOrNone`). */
export const BOARD_COLOR_NONE = 'none';

/** Resolve a stored color id to its hex; unknown ids fall back to the first swatch. */
export function boardColorValue(id: string): string {
  return (BOARD_COLORS.find((c) => c.id === id) ?? FALLBACK).value;
}

/** Label validation — "no color" is never a legitimate label color. */
export function isBoardColor(id: string): boolean {
  return BOARD_COLORS.some((c) => c.id === id);
}

/** Board validation — also accepts the "no color" sentinel. */
export function isBoardColorOrNone(id: string): boolean {
  return id === BOARD_COLOR_NONE || isBoardColor(id);
}

export interface ResolvedBoardColor {
  value: string;
  textOn: 'light' | 'dark';
}

/**
 * Board-only resolution: `null` for "no color", meaning the board should
 * render with zero board-specific styling — identical to the neutral
 * project/home view. Callers that always need a real color to paint
 * (labels, or a generic fallback-to-a-swatch use) should use
 * `boardColorValue` instead, which never returns null.
 */
export function resolveBoardColor(id: string): ResolvedBoardColor | null {
  if (id === BOARD_COLOR_NONE) return null;
  const c = BOARD_COLORS.find((c) => c.id === id) ?? FALLBACK;
  return { value: c.value, textOn: c.textOn };
}
