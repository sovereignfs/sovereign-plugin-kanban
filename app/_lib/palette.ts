/**
 * Board/label color palette. The design system is deliberately monochrome —
 * no decorative color tokens exist — so these colors are plugin *data*: a
 * curated set of muted hexes stored on rows by id and rendered via inline
 * `style`, never from CSS files (see docs/adhoc/web-home.md, "Board colors
 * are data, not tokens"). K.6's labels reuse this module.
 *
 * Boards additionally accept an arbitrary hex value (`@sovereignfs/ui`'s
 * `ColorPicker`, native `<input type="color">` trigger) alongside the
 * curated suggestions — see `isHexColor`/`computeTextOn` below. Labels stay
 * curated-only (`isBoardColor`, unchanged) — broadening this module's board
 * validation must never silently broaden label validation too, since the
 * label color dialog offers no custom-color affordance to justify it.
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

/** Strict `#rrggbb` check — the only shape ever safe to interpolate directly
 *  into a CSS custom property (`app/b/[boardId]/page.tsx`'s `:root` style
 *  tag). Deliberately narrow: no 3-digit shorthand, no named colors, no
 *  `rgb()`/`hsl()` functions — those would each need their own injection
 *  review, and nothing produces them today (the native color-input trigger
 *  always emits lowercase 6-digit hex). */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function relativeLuminance(hex: string): number {
  const channel = (start: number) => {
    const c = parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [channel(1), channel(3), channel(5)];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG contrast-based light/dark text choice for an arbitrary hex — the
 * programmatic equivalent of each curated swatch's hand-picked `textOn`.
 * Picks whichever of pure black/white text has the higher contrast ratio
 * against the given background, so it degrades gracefully for colors near
 * the middle of the lightness range rather than relying on a single
 * luminance-threshold guess.
 */
export function computeTextOn(hex: string): 'light' | 'dark' {
  const l = relativeLuminance(hex);
  const contrastWithBlack = contrastRatio(l, 0);
  const contrastWithWhite = contrastRatio(l, 1);
  return contrastWithWhite > contrastWithBlack ? 'light' : 'dark';
}

/** Resolve a stored color id to its hex; unknown ids fall back to the first swatch. */
export function boardColorValue(id: string): string {
  if (isHexColor(id)) return id.toLowerCase();
  return (BOARD_COLORS.find((c) => c.id === id) ?? FALLBACK).value;
}

/** Label validation — curated ids only, "no color" is never a legitimate
 *  label color, and (unlike boards) there is no custom-color affordance in
 *  the label picker to justify accepting arbitrary hex here. */
export function isBoardColor(id: string): boolean {
  return BOARD_COLORS.some((c) => c.id === id);
}

/** Board validation — a curated id, the "no color" sentinel, or a valid
 *  `#rrggbb` custom color. */
export function isBoardColorOrNone(id: string): boolean {
  return id === BOARD_COLOR_NONE || isBoardColor(id) || isHexColor(id);
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
 *
 * A value that isn't `'none'`, a known curated id, or a well-formed hex
 * (i.e. anything that reached the DB without going through
 * `isBoardColorOrNone` — a defensive floor, not the primary validation
 * gate) falls back to the first swatch rather than being trusted as-is,
 * the same way an unrecognized curated id always has.
 */
export function resolveBoardColor(id: string): ResolvedBoardColor | null {
  if (id === BOARD_COLOR_NONE) return null;
  if (isHexColor(id)) return { value: id.toLowerCase(), textOn: computeTextOn(id) };
  const c = BOARD_COLORS.find((c) => c.id === id) ?? FALLBACK;
  return { value: c.value, textOn: c.textOn };
}
