import { describe, expect, it } from 'vitest';
import {
  MIN_GAP,
  POSITION_STEP,
  firstPosition,
  needsRenormalize,
  positionAfter,
  positionBefore,
  positionBetween,
  renormalizedPositions,
} from '../position';

describe('position helpers', () => {
  it('starts an empty sequence at POSITION_STEP', () => {
    expect(firstPosition()).toBe(POSITION_STEP);
    expect(positionAfter(undefined)).toBe(POSITION_STEP);
    expect(positionBefore(undefined)).toBe(POSITION_STEP);
    expect(positionBetween(undefined, undefined)).toBe(POSITION_STEP);
  });

  it('appends and prepends by a full step', () => {
    expect(positionAfter(POSITION_STEP)).toBe(2 * POSITION_STEP);
    expect(positionBefore(POSITION_STEP)).toBe(0);
  });

  it('inserts at the midpoint between two neighbours', () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(undefined, 1024)).toBe(0);
    expect(positionBetween(1024, undefined)).toBe(2048);
  });

  it('rejects inverted neighbours', () => {
    expect(() => positionBetween(2048, 1024)).toThrow(/prev.*must be </);
    expect(() => positionBetween(1024, 1024)).toThrow(/prev.*must be </);
  });

  it('midpoints stay strictly between neighbours until the gap underflows', () => {
    // Repeatedly insert into the same gap — the classic worst case.
    let prev = POSITION_STEP;
    const next = 2 * POSITION_STEP;
    while (!needsRenormalize(prev, next)) {
      const mid = positionBetween(prev, next);
      expect(mid).toBeGreaterThan(prev);
      expect(mid).toBeLessThan(next);
      prev = mid;
    }
    // The gap underflowed — renormalization is signalled well before float64
    // precision could produce a midpoint equal to a neighbour.
    expect(next - prev).toBeLessThan(MIN_GAP);
  });

  it('does not signal renormalization at sequence edges', () => {
    expect(needsRenormalize(undefined, 5)).toBe(false);
    expect(needsRenormalize(5, undefined)).toBe(false);
    expect(needsRenormalize(undefined, undefined)).toBe(false);
  });

  it('renormalizes to evenly-spaced steps', () => {
    expect(renormalizedPositions(3)).toEqual([POSITION_STEP, 2 * POSITION_STEP, 3 * POSITION_STEP]);
    expect(renormalizedPositions(0)).toEqual([]);
    // Renormalized sequences have full-step gaps again.
    const positions = renormalizedPositions(100);
    for (let i = 1; i < positions.length; i++) {
      expect(needsRenormalize(positions[i - 1], positions[i])).toBe(false);
    }
  });

  it('sequential appends never need renormalization', () => {
    let last: number | undefined;
    const seen: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const next = positionAfter(last);
      if (last !== undefined) {
        expect(next).toBeGreaterThan(last);
        expect(needsRenormalize(last, next)).toBe(false);
      }
      seen.push(next);
      last = next;
    }
    expect(new Set(seen).size).toBe(1000);
  });
});
