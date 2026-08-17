import { describe, expect, it } from 'vitest';
import { matchesBoardFilter, normalizeFilterQuery } from '../filter';

describe('normalizeFilterQuery', () => {
  it('trims and lowercases', () => {
    expect(normalizeFilterQuery('  Design Review  ')).toBe('design review');
  });

  it('treats whitespace-only input as empty', () => {
    expect(normalizeFilterQuery('   ')).toBe('');
  });
});

describe('matchesBoardFilter', () => {
  // `query` is always pre-normalized by `normalizeFilterQuery` (lowercase) —
  // matchesBoardFilter trusts that contract rather than re-lowercasing it
  // itself, so these use lowercase queries and vary the *card's* casing
  // instead to prove the match is genuinely case-insensitive.
  const card = { title: 'Fix the HEADER Layout', labels: [{ name: 'FrontEnd' }, { name: 'BUG' }] };

  it('matches everything for an empty (normalized) query', () => {
    expect(matchesBoardFilter(card, '')).toBe(true);
  });

  it('matches a case-insensitive title substring', () => {
    expect(matchesBoardFilter(card, 'header')).toBe(true);
  });

  it('matches a case-insensitive label name substring', () => {
    expect(matchesBoardFilter(card, 'front')).toBe(true);
    expect(matchesBoardFilter(card, 'bug')).toBe(true);
  });

  it('returns false when neither title nor any label matches', () => {
    expect(matchesBoardFilter(card, 'database')).toBe(false);
  });

  it('returns false for a card with no labels and a non-matching title', () => {
    expect(matchesBoardFilter({ title: 'Something else', labels: [] }, 'header')).toBe(false);
  });
});
