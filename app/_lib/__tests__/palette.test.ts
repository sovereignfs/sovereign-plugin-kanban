import { describe, expect, it } from 'vitest';
import {
  BOARD_COLOR_NONE,
  BOARD_COLORS,
  boardColorValue,
  computeTextOn,
  isBoardColor,
  isBoardColorOrNone,
  isHexColor,
  resolveBoardColor,
} from '../palette';

describe('isHexColor', () => {
  it('accepts a well-formed 6-digit hex', () => {
    expect(isHexColor('#a1b2c3')).toBe(true);
  });

  it('accepts uppercase hex digits', () => {
    expect(isHexColor('#A1B2C3')).toBe(true);
  });

  it('rejects 3-digit shorthand', () => {
    expect(isHexColor('#abc')).toBe(false);
  });

  it('rejects missing the leading #', () => {
    expect(isHexColor('a1b2c3')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isHexColor('#zzzzzz')).toBe(false);
  });

  it('rejects a curated palette id', () => {
    expect(isHexColor('sky')).toBe(false);
  });

  // The only shape ever safe to interpolate directly into the board page's
  // <style> tag — anything with a stray `}`/`;`/quote must never pass.
  it('rejects a value carrying a CSS-injection payload', () => {
    expect(isHexColor('#fff} body{background:red')).toBe(false);
  });
});

describe('computeTextOn', () => {
  it('picks dark text for a light background', () => {
    expect(computeTextOn('#ffffff')).toBe('dark');
  });

  it('picks light text for a dark background', () => {
    expect(computeTextOn('#000000')).toBe('light');
  });

  it('matches every curated swatch\'s own hand-picked textOn', () => {
    for (const c of BOARD_COLORS) {
      expect(computeTextOn(c.value)).toBe(c.textOn);
    }
  });
});

describe('isBoardColor', () => {
  it('accepts every curated id', () => {
    for (const c of BOARD_COLORS) {
      expect(isBoardColor(c.id)).toBe(true);
    }
  });

  it('rejects a custom hex — labels have no custom-color affordance', () => {
    expect(isBoardColor('#a1b2c3')).toBe(false);
  });

  it('rejects the "no color" sentinel', () => {
    expect(isBoardColor(BOARD_COLOR_NONE)).toBe(false);
  });
});

describe('isBoardColorOrNone', () => {
  it('accepts a curated id', () => {
    expect(isBoardColorOrNone('sky')).toBe(true);
  });

  it('accepts the "no color" sentinel', () => {
    expect(isBoardColorOrNone(BOARD_COLOR_NONE)).toBe(true);
  });

  it('accepts a valid custom hex', () => {
    expect(isBoardColorOrNone('#a1b2c3')).toBe(true);
  });

  it('rejects an arbitrary string', () => {
    expect(isBoardColorOrNone('not-a-color')).toBe(false);
  });

  it('rejects a CSS-injection payload', () => {
    expect(isBoardColorOrNone('#fff} body{background:red')).toBe(false);
  });
});

describe('boardColorValue', () => {
  it('resolves a curated id to its hex', () => {
    expect(boardColorValue('sky')).toBe('#b5c9e8');
  });

  it('lowercases and returns a custom hex as-is', () => {
    expect(boardColorValue('#A1B2C3')).toBe('#a1b2c3');
  });

  it('falls back to the first swatch (Sky) for an unrecognized id', () => {
    expect(boardColorValue('not-a-real-id')).toBe('#b5c9e8');
  });
});

describe('resolveBoardColor', () => {
  it('returns null for the "no color" sentinel', () => {
    expect(resolveBoardColor(BOARD_COLOR_NONE)).toBeNull();
  });

  it('resolves a curated id to its hand-picked value/textOn', () => {
    expect(resolveBoardColor('ink')).toEqual({ value: '#3b5166', textOn: 'light' });
  });

  it('resolves a custom hex to itself plus a computed textOn', () => {
    expect(resolveBoardColor('#111111')).toEqual({ value: '#111111', textOn: 'light' });
  });

  it('falls back to the first swatch (Sky) for malformed data rather than trusting it', () => {
    expect(resolveBoardColor('<script>alert(1)</script>')).toEqual({
      value: '#b5c9e8',
      textOn: 'dark',
    });
  });
});
