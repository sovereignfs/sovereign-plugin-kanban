import { describe, expect, it } from 'vitest';
import { describeActivity } from '../activity-copy';

const ctx = {
  lists: [{ id: 'l1', name: 'Done' }],
  labels: [{ id: 'lb1', name: 'Bug', color: 'clay' }],
  resolveName: (id: string) => (id === 'u2' ? 'Sam' : id),
};

describe('describeActivity — card scope (default)', () => {
  it('speaks about "this card"', () => {
    expect(describeActivity({ type: 'card.created', payload: { title: 'X' } }, ctx)).toBe(
      'created this card',
    );
    expect(describeActivity({ type: 'card.moved', payload: { toListId: 'l1' } }, ctx)).toBe(
      'moved this card to "Done"',
    );
    expect(describeActivity({ type: 'card.archived', payload: null }, ctx)).toBe('archived this card');
    expect(describeActivity({ type: 'comment.edited', payload: null }, ctx)).toBe('edited a comment');
  });

  it('never leaks an internal type name for an unknown type', () => {
    expect(describeActivity({ type: 'something.new', payload: null }, ctx)).toBe('updated the board');
  });
});

describe('describeActivity — board scope', () => {
  const board = { ...ctx, scope: 'board' as const };

  it('names the card from the live title when the row still points at one', () => {
    expect(
      describeActivity({ type: 'card.created', payload: { title: 'Old' } }, { ...board, cardTitle: 'New' }),
    ).toBe('created card "New"');
    expect(
      describeActivity({ type: 'comment.added', payload: { parentId: null } }, { ...board, cardTitle: 'Fix' }),
    ).toBe('commented on card "Fix"');
  });

  it('falls back to the title captured in the payload for a deleted card', () => {
    expect(
      describeActivity({ type: 'card.deleted', payload: { cardId: 'c1', title: 'Gone' } }, board),
    ).toBe('deleted card "Gone"');
  });

  it('degrades to "a card" with neither', () => {
    expect(describeActivity({ type: 'card.archived', payload: null }, board)).toBe('archived a card');
  });

  it('describes board-level events', () => {
    expect(describeActivity({ type: 'list.deleted', payload: { name: 'Backlog' } }, board)).toBe(
      'deleted the list "Backlog"',
    );
    expect(describeActivity({ type: 'board.updated', payload: { name: 'Roadmap' } }, board)).toBe(
      'renamed the board to "Roadmap"',
    );
    expect(describeActivity({ type: 'board.updated', payload: { color: true } }, board)).toBe(
      'updated the board settings',
    );
    expect(
      describeActivity({ type: 'member.role_changed', payload: { userId: 'u2', role: 'owner' } }, board),
    ).toBe('made Sam a board owner');
    expect(
      describeActivity({ type: 'member.removed', payload: { userId: 'u2', left: true } }, board),
    ).toBe('left the board');
    expect(describeActivity({ type: 'member.removed', payload: { userId: 'u2' } }, board)).toBe(
      'removed Sam from the board',
    );
  });
});
