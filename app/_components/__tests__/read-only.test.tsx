// @vitest-environment jsdom
/**
 * K.21's read-only mode, at the component level: the unit tests in
 * `app/__tests__/actions.test.ts` prove a viewer's mutations are refused
 * server-side, but the point of K.21 is that a viewer never sees an
 * affordance that would fail. That's only observable by rendering.
 *
 * `ListColumn` and the card-field components are rendered directly rather
 * than through `BoardView` — `BoardView` pulls in `DndContext`,
 * `useIsMobile`, and the router, none of which this behaviour depends on.
 */
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';
import { ToastProvider } from '@sovereignfs/ui';

vi.mock('next/navigation', () => ({
  usePathname: () => '/kanban/b/board-1',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../../actions', () => ({
  createCard: vi.fn(),
  createChecklistItem: vi.fn(),
  createLabel: vi.fn(),
  deleteChecklistItem: vi.fn(),
  deleteComment: vi.fn(),
  deleteLabel: vi.fn(),
  deleteList: vi.fn(),
  moveChecklistItem: vi.fn(),
  renameList: vi.fn(),
  toggleCardLabel: vi.fn(),
  toggleChecklistItem: vi.fn(),
  updateCard: vi.fn(),
  updateChecklistItem: vi.fn(),
  updateComment: vi.fn(),
  updateLabel: vi.fn(),
  addComment: vi.fn(),
  assignMember: vi.fn(),
  unassignMember: vi.fn(),
}));

import { CardChecklist } from '../CardChecklist';
import { CardComments } from '../CardComments';
import { CardDescription } from '../CardDescription';
import { CardLabels } from '../CardLabels';
import { ListColumn } from '../ListColumn';
import type { CardDetail } from '../../_lib/queries';

afterEach(cleanup);

/**
 * Every component under test calls `useToast()` — the plugin supplies
 * `ToastProvider` in its own root layout (`shell: minimal` gets none from
 * the platform), so tests have to supply it too.
 */
function render(ui: ReactElement) {
  return rtlRender(<ToastProvider>{ui}</ToastProvider>);
}

const list = { id: 'l1', name: 'To Do', position: 1024, cardCount: 2 };
const cards = [
  {
    id: 'c1',
    title: 'First card',
    listId: 'l1',
    position: 1024,
    dueDate: null,
    labels: [],
    assigneeCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    commentCount: 0,
  },
];

const card: CardDetail = {
  id: 'c1',
  boardId: 'b1',
  listId: 'l1',
  title: 'First card',
  description: 'A description',
  dueDate: null,
  createdBy: 'u1',
  createdAt: 1_780_000_000_000,
  archivedAt: null,
  labels: [{ id: 'lb1', name: 'Bug', color: 'clay' }],
  assignees: [],
  checklist: [{ id: 'i1', text: 'Step one', done: false, position: 1024 }],
  comments: [
    {
      id: 'cm1',
      parentId: null,
      authorId: 'u1',
      body: 'A comment',
      createdAt: 1_780_000_000_000,
      updatedAt: 1_780_000_000_000,
    },
  ],
  activity: [],
};

const currentUser = { id: 'u1', name: 'Me' };

describe('ListColumn read-only', () => {
  it('renders the list and its cards but no mutation affordances', () => {
    render(<ListColumn list={list} cards={cards} canEdit={false} />);
    // The content is all there…
    expect(screen.getByText('To Do')).toBeTruthy();
    expect(screen.getByText('First card')).toBeTruthy();
    // …and nothing to change it with.
    expect(screen.queryByRole('button', { name: /options for/i })).toBeNull();
    expect(screen.queryByText('+ Add a card')).toBeNull();
    // The title is plain text, not a rename trigger.
    expect(screen.queryByRole('button', { name: 'To Do' })).toBeNull();
  });

  it('renders every affordance when editing is allowed', () => {
    render(<ListColumn list={list} cards={cards} canEdit={true} />);
    expect(screen.getByRole('button', { name: /options for/i })).toBeTruthy();
    expect(screen.getByText('+ Add a card')).toBeTruthy();
  });
});

describe('card fields read-only', () => {
  it('shows the description as content with no edit trigger', () => {
    render(<CardDescription card={card} canEdit={false} />);
    expect(screen.getByText('A description')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the checklist without a composer, toggles, or row actions', () => {
    render(<CardChecklist card={card} canEdit={false} />);
    expect(screen.getByText('Step one')).toBeTruthy();
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true);
    expect(screen.queryByText('+ Add an item')).toBeNull();
    expect(screen.queryByRole('button', { name: /move up/i })).toBeNull();
  });

  it('shows attached labels with no picker', () => {
    render(<CardLabels card={card} boardId="b1" boardLabels={card.labels} canEdit={false} />);
    expect(screen.getByText('Bug')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /labels/i })).toBeNull();
  });

  it('shows comments with no composer and no per-comment actions', () => {
    render(
      <CardComments
        card={card}
        members={[
          { userId: 'u1', name: 'Me', email: 'me@example.com', image: null, role: 'owner' },
        ]}
        currentUser={currentUser}
        canEdit={false}
        canModerate={false}
      />,
    );
    expect(screen.getByText('A comment')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('offers Edit/Delete on your own comment, and only Delete to a moderator', () => {
    const members = [
      { userId: 'u1', name: 'Me', email: 'me@example.com', image: null, role: 'owner' },
    ];
    const { unmount } = render(
      <CardComments
        card={card}
        members={members}
        currentUser={currentUser}
        canEdit
        canModerate={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    unmount();

    // Someone else's comment, viewed by a board owner: delete but no edit.
    render(
      <CardComments
        card={card}
        members={members}
        currentUser={{ id: 'u2', name: 'Other' }}
        canEdit
        canModerate
      />,
    );
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});
