import { describe, expect, it } from 'vitest';
import { applyOrder, neighborsOf, seedOrder, topBottomNeighbors, type OrderState } from '../order';

const lists = [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }];
const cards = [
  { id: 'c1', listId: 'l1' },
  { id: 'c2', listId: 'l1' },
  { id: 'c3', listId: 'l1' },
  { id: 'c4', listId: 'l2' },
];

function seed(): OrderState {
  return seedOrder(lists, cards);
}

describe('seedOrder', () => {
  it('groups cards under their list in input order, including empty lists', () => {
    const state = seed();
    expect(state.listOrder).toEqual(['l1', 'l2', 'l3']);
    expect(state.cardOrderByList).toEqual({
      l1: ['c1', 'c2', 'c3'],
      l2: ['c4'],
      l3: [],
    });
  });
});

describe('applyOrder — moveList', () => {
  it('reorders lists to the target index', () => {
    const next = applyOrder(seed(), { type: 'moveList', listId: 'l1', toIndex: 2 });
    expect(next.listOrder).toEqual(['l2', 'l3', 'l1']);
  });

  it('is a no-op for an unknown list id', () => {
    const state = seed();
    const next = applyOrder(state, { type: 'moveList', listId: 'ghost', toIndex: 0 });
    expect(next).toBe(state);
  });

  it('clamps an out-of-range target index', () => {
    const next = applyOrder(seed(), { type: 'moveList', listId: 'l1', toIndex: 999 });
    expect(next.listOrder).toEqual(['l2', 'l3', 'l1']);
  });
});

describe('applyOrder — moveCard, same list', () => {
  it('reorders within the list without touching other lists', () => {
    const next = applyOrder(seed(), { type: 'moveCard', cardId: 'c1', toListId: 'l1', toIndex: 2 });
    expect(next.cardOrderByList.l1).toEqual(['c2', 'c3', 'c1']);
    expect(next.cardOrderByList.l2).toEqual(['c4']);
  });

  it('moving to its own current index is a same-shape no-op', () => {
    const state = seed();
    const next = applyOrder(state, { type: 'moveCard', cardId: 'c2', toListId: 'l1', toIndex: 1 });
    expect(next.cardOrderByList.l1).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('applyOrder — moveCard, cross list', () => {
  it('moves the card out of its source list and into the target at the given index', () => {
    const next = applyOrder(seed(), { type: 'moveCard', cardId: 'c2', toListId: 'l2', toIndex: 0 });
    expect(next.cardOrderByList.l1).toEqual(['c1', 'c3']);
    expect(next.cardOrderByList.l2).toEqual(['c2', 'c4']);
  });

  it('drops into an empty list', () => {
    const next = applyOrder(seed(), { type: 'moveCard', cardId: 'c1', toListId: 'l3', toIndex: 0 });
    expect(next.cardOrderByList.l1).toEqual(['c2', 'c3']);
    expect(next.cardOrderByList.l3).toEqual(['c1']);
  });

  it('appends past the end of the target list (clamped index)', () => {
    const next = applyOrder(seed(), { type: 'moveCard', cardId: 'c1', toListId: 'l2', toIndex: 999 });
    expect(next.cardOrderByList.l2).toEqual(['c4', 'c1']);
  });

  it('is a no-op for an unknown card id', () => {
    const state = seed();
    const next = applyOrder(state, { type: 'moveCard', cardId: 'ghost', toListId: 'l2', toIndex: 0 });
    expect(next).toBe(state);
  });
});

describe('neighborsOf', () => {
  it('returns both neighbours for a middle item', () => {
    expect(neighborsOf(['a', 'b', 'c'], 'b')).toEqual({ prevId: 'a', nextId: 'c' });
  });

  it('returns null on the missing side at each edge', () => {
    expect(neighborsOf(['a', 'b', 'c'], 'a')).toEqual({ prevId: null, nextId: 'b' });
    expect(neighborsOf(['a', 'b', 'c'], 'c')).toEqual({ prevId: 'b', nextId: null });
  });

  it('returns nulls for an id not in the order', () => {
    expect(neighborsOf(['a', 'b'], 'ghost')).toEqual({ prevId: null, nextId: null });
  });

  it('returns nulls for a single-item order', () => {
    expect(neighborsOf(['a'], 'a')).toEqual({ prevId: null, nextId: null });
  });
});

describe('topBottomNeighbors', () => {
  const targetCards = [
    { id: 'c2', position: 2 },
    { id: 'c1', position: 1 },
    { id: 'c3', position: 3 },
  ];

  it('top: prevCardId null, nextCardId the lowest-position card, regardless of input order', () => {
    expect(topBottomNeighbors(targetCards, 'top')).toEqual({ prevCardId: null, nextCardId: 'c1' });
  });

  it('bottom: prevCardId the highest-position card, nextCardId null', () => {
    expect(topBottomNeighbors(targetCards, 'bottom')).toEqual({ prevCardId: 'c3', nextCardId: null });
  });

  it('both edges are null for an empty target list', () => {
    expect(topBottomNeighbors([], 'top')).toEqual({ prevCardId: null, nextCardId: null });
    expect(topBottomNeighbors([], 'bottom')).toEqual({ prevCardId: null, nextCardId: null });
  });

  it('a single-card target list is both its own top and bottom neighbour set', () => {
    const single = [{ id: 'only', position: 5 }];
    expect(topBottomNeighbors(single, 'top')).toEqual({ prevCardId: null, nextCardId: 'only' });
    expect(topBottomNeighbors(single, 'bottom')).toEqual({ prevCardId: 'only', nextCardId: null });
  });
});
