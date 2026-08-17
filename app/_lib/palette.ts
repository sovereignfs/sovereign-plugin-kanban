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
}

export const BOARD_COLORS: readonly PaletteColor[] = [
  { id: 'sky', name: 'Sky', value: '#b5c9e8' },
  { id: 'sage', name: 'Sage', value: '#c9e0c4' },
  { id: 'sand', name: 'Sand', value: '#e8d3b5' },
  { id: 'clay', name: 'Clay', value: '#e0c4c4' },
  { id: 'lilac', name: 'Lilac', value: '#d8c4e0' },
  { id: 'mist', name: 'Mist', value: '#c4dde0' },
  { id: 'stone', name: 'Stone', value: '#d6d3cb' },
  { id: 'slate', name: 'Slate', value: '#c9cbd4' },
] as const;

const FALLBACK: PaletteColor = { id: 'sky', name: 'Sky', value: '#b5c9e8' };

export const DEFAULT_BOARD_COLOR = FALLBACK.id;

/** Resolve a stored color id to its hex; unknown ids fall back to the first swatch. */
export function boardColorValue(id: string): string {
  return (BOARD_COLORS.find((c) => c.id === id) ?? FALLBACK).value;
}

export function isBoardColor(id: string): boolean {
  return BOARD_COLORS.some((c) => c.id === id);
}
