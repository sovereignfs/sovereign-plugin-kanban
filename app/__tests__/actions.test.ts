/**
 * Server-action authorization + behavior tests (K.3 review checklist):
 * every action denies a non-member/non-creator without mutating anything,
 * mutations record activity, and reorder/move handles stale neighbours and
 * gap-underflow renormalization. Runs against the real generated migrations
 * on an ephemeral libsql DB (production client semantics) with the SDK
 * mocked to impersonate switchable users.
 */
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../_db/__tests__/test-db';
import { MIN_GAP, POSITION_STEP } from '../_db/position';
import * as schema from '../_db/schema';

interface FakeDirectoryUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

interface SentNotification {
  recipientUserId: string;
  title: string;
  body?: string;
  url?: string;
  category?: string;
}

const harness = vi.hoisted(() => ({
  currentUser: null as { id: string; tenantId: string } | null,
  dbClient: null as unknown,
  directoryUsers: new Map<string, FakeDirectoryUser>(),
  sentNotifications: [] as SentNotification[],
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: {
      requireSession: vi.fn(async () => {
        if (!harness.currentUser) throw new Error('Not authenticated');
        return { user: harness.currentUser };
      }),
    },
    db: { getClient: vi.fn(async () => harness.dbClient) },
    directory: {
      resolveUsers: vi.fn(async ({ ids }: { ids: string[] }) =>
        ids
          .map((id) => harness.directoryUsers.get(id))
          .filter((u): u is FakeDirectoryUser => u !== undefined),
      ),
      searchUsers: vi.fn(async ({ query }: { query: string }) =>
        [...harness.directoryUsers.values()].filter(
          (u) =>
            u.name?.toLowerCase().includes(query.toLowerCase()) ||
            u.email.toLowerCase().includes(query.toLowerCase()),
        ),
      ),
    },
    notifications: {
      send: vi.fn(async (input: SentNotification) => {
        harness.sentNotifications.push(input);
      }),
    },
  },
}));

import * as actions from '../actions';

const owner = { id: 'user-owner', tenantId: 'default' };
const outsider = { id: 'user-outsider', tenantId: 'default' };

let t: TestDb;

function actAs(user: { id: string; tenantId: string } | null): void {
  harness.currentUser = user;
}

function registerDirectoryUser(user: { id: string; email: string; name: string | null }): void {
  harness.directoryUsers.set(user.id, { ...user, image: null });
}

/** Narrow a possibly-undefined value (noUncheckedIndexedAccess / find) with a hard failure. */
function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`expected ${label} to exist`);
  return value;
}

async function setup(): Promise<{ projectId: string; boardId: string; listId: string }> {
  actAs(owner);
  expect((await actions.createProject({ name: 'P1' })).ok).toBe(true);
  const project = must((await t.db.select().from(schema.projects))[0], 'project');
  expect((await actions.createBoard({ projectId: project.id, name: 'B1', color: 'grey' })).ok).toBe(
    true,
  );
  const board = must((await t.db.select().from(schema.boards))[0], 'board');
  expect((await actions.createList({ boardId: board.id, name: 'To Do' })).ok).toBe(true);
  const list = must((await t.db.select().from(schema.lists))[0], 'list');
  return { projectId: project.id, boardId: board.id, listId: list.id };
}

beforeEach(async () => {
  t = await createTestDb();
  harness.dbClient = t.db;
});

afterEach(() => {
  t.close();
  actAs(null);
  harness.directoryUsers.clear();
  harness.sentNotifications = [];
});

describe('authorization — non-members and non-creators are denied without side effects', () => {
  it('denies every project mutation to a non-creator', async () => {
    const { projectId } = await setup();
    actAs(outsider);

    expect(await actions.updateProject({ projectId, name: 'stolen' })).toEqual({
      ok: false,
      error: 'Project not found.',
    });
    expect(await actions.deleteProject({ projectId })).toEqual({
      ok: false,
      error: 'Project not found.',
    });
    expect(await actions.createBoard({ projectId, name: 'X', color: 'red' })).toEqual({
      ok: false,
      error: 'Project not found.',
    });

    const projects = await t.db.select().from(schema.projects);
    expect(projects).toHaveLength(1);
    expect(must(projects[0], 'project').name).toBe('P1');
    expect(await t.db.select().from(schema.boards)).toHaveLength(1);
  });

  it('denies every board/list/card mutation to a non-member', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    const before = {
      boards: await t.db.select().from(schema.boards),
      lists: await t.db.select().from(schema.lists),
      cards: await t.db.select().from(schema.cards),
      activity: (await t.db.select().from(schema.activity)).length,
    };

    actAs(outsider);
    const denials: Array<Promise<{ ok: boolean }>> = [
      actions.updateBoard({ boardId, name: 'stolen' }),
      actions.deleteBoard({ boardId }),
      actions.createList({ boardId, name: 'X' }),
      actions.renameList({ listId, name: 'X' }),
      actions.deleteList({ listId }),
      actions.reorderList({ listId }),
      actions.createCard({ listId, title: 'X' }),
      actions.updateCard({ cardId: card.id, title: 'X' }),
      actions.deleteCard({ cardId: card.id }),
      actions.moveCard({ cardId: card.id, toListId: listId }),
    ];
    for (const result of await Promise.all(denials)) expect(result.ok).toBe(false);

    expect(await t.db.select().from(schema.boards)).toEqual(before.boards);
    expect(await t.db.select().from(schema.lists)).toEqual(before.lists);
    expect(await t.db.select().from(schema.cards)).toEqual(before.cards);
    expect((await t.db.select().from(schema.activity)).length).toBe(before.activity);
  });

  it('rejects unauthenticated calls outright', async () => {
    actAs(null);
    await expect(actions.createProject({ name: 'X' })).rejects.toThrow();
  });

  it('a plain member cannot perform owner-only board mutations', async () => {
    const { boardId } = await setup();
    await t.db.insert(schema.boardMembers).values({
      boardId,
      userId: outsider.id,
      tenantId: outsider.tenantId,
      role: 'member',
      addedBy: owner.id,
      createdAt: Date.now(),
    });
    actAs(outsider);
    expect((await actions.updateBoard({ boardId, name: 'X' })).ok).toBe(false);
    expect((await actions.deleteBoard({ boardId })).ok).toBe(false);
    // But member-level operations work.
    expect((await actions.createList({ boardId, name: 'Member list' })).ok).toBe(true);
  });
});

describe('mutations record activity and maintain ordering', () => {
  it('walks the full happy path with an audit trail', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createList({ boardId, name: 'Done' })).ok).toBe(true);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    expect((await actions.createCard({ listId, title: 'C2' })).ok).toBe(true);

    const lists = await t.db.select().from(schema.lists).orderBy(asc(schema.lists.position));
    const cards = await t.db.select().from(schema.cards).orderBy(asc(schema.cards.position));
    expect(lists.map((l) => l.name)).toEqual(['To Do', 'Done']);
    expect(cards.map((c) => c.title)).toEqual(['C1', 'C2']);
    const c1 = must(cards[0], 'C1');
    const c2 = must(cards[1], 'C2');

    // Move C2 to Done, then delete it — both narrated.
    const done = must(lists[1], 'Done list');
    expect((await actions.moveCard({ cardId: c2.id, toListId: done.id })).ok).toBe(true);
    const moved = must(
      (await t.db.select().from(schema.cards).where(eq(schema.cards.id, c2.id)))[0],
      'moved card',
    );
    expect(moved.listId).toBe(done.id);
    expect((await actions.deleteCard({ cardId: c2.id })).ok).toBe(true);

    const activityRows = await t.db.select().from(schema.activity);
    expect(activityRows.map((a) => a.type).sort()).toEqual(
      [
        'board.created',
        'list.created',
        'list.created',
        'card.created',
        'card.created',
        'card.moved',
        'card.deleted',
      ].sort(),
    );
    // Audit rows outlive the card they narrate: deleting C2 detaches its
    // history (card_id set null), never erases it.
    const movedRow = must(
      activityRows.find((a) => a.type === 'card.moved'),
      'card.moved activity',
    );
    expect(movedRow.cardId).toBeNull();
    const deletion = must(
      activityRows.find((a) => a.type === 'card.deleted'),
      'card.deleted activity',
    );
    expect(deletion.cardId).toBeNull();
    expect(JSON.parse(must(deletion.payload ?? undefined, 'deletion payload'))).toEqual({
      cardId: c2.id,
    });
    // C1's creation row still points at the living card.
    expect(activityRows.some((a) => a.type === 'card.created' && a.cardId === c1.id)).toBe(true);
  });

  it('reorders a card between neighbours with a single-position write', async () => {
    const { listId } = await setup();
    actAs(owner);
    for (const title of ['A', 'B', 'C']) {
      expect((await actions.createCard({ listId, title })).ok).toBe(true);
    }
    const rows = await t.db.select().from(schema.cards).orderBy(asc(schema.cards.position));
    const a = must(rows[0], 'A');
    const b = must(rows[1], 'B');
    const c = must(rows[2], 'C');
    // Move C between A and B.
    expect(
      (
        await actions.moveCard({
          cardId: c.id,
          toListId: listId,
          prevCardId: a.id,
          nextCardId: b.id,
        })
      ).ok,
    ).toBe(true);
    const after = await t.db.select().from(schema.cards).orderBy(asc(schema.cards.position));
    expect(after.map((r) => r.title)).toEqual(['A', 'C', 'B']);
    // A and B kept their original positions — one row moved.
    expect(must(after[0], 'A after').position).toBe(a.position);
    expect(must(after[2], 'B after').position).toBe(b.position);
  });

  it('surfaces a retry when drag neighbours vanished concurrently', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'A' })).ok).toBe(true);
    const a = must((await t.db.select().from(schema.cards))[0], 'A');
    const result = await actions.moveCard({
      cardId: a.id,
      toListId: listId,
      prevCardId: 'gone-card',
    });
    expect(result).toEqual({
      ok: false,
      error: 'Those cards changed while you were dragging — try again.',
    });
  });

  it('renormalizes a list whose gap underflowed, preserving order', async () => {
    const { listId } = await setup();
    actAs(owner);
    for (const title of ['A', 'B', 'C', 'D']) {
      expect((await actions.createCard({ listId, title })).ok).toBe(true);
    }
    // Squeeze A/B into an underflowed gap directly.
    const rows = await t.db.select().from(schema.cards).orderBy(asc(schema.cards.position));
    const a = must(rows[0], 'A');
    const b = must(rows[1], 'B');
    const d = must(rows[3], 'D');
    await t.db.update(schema.cards).set({ position: 1 }).where(eq(schema.cards.id, a.id));
    await t.db
      .update(schema.cards)
      .set({ position: 1 + MIN_GAP / 10 })
      .where(eq(schema.cards.id, b.id));

    // Dropping D between A and B forces renormalization first.
    expect(
      (
        await actions.moveCard({
          cardId: d.id,
          toListId: listId,
          prevCardId: a.id,
          nextCardId: b.id,
        })
      ).ok,
    ).toBe(true);

    const after = await t.db.select().from(schema.cards).orderBy(asc(schema.cards.position));
    expect(after.map((r) => r.title)).toEqual(['A', 'D', 'B', 'C']);
    // The stationary rows sit on fresh full-step positions again.
    expect(must(after[0], 'A after').position).toBe(POSITION_STEP);
    expect(must(after[2], 'B after').position).toBe(2 * POSITION_STEP);
  });

  it('rejects a cross-board move even when the actor is a member of both boards', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createProject({ name: 'P2' })).ok).toBe(true);
    const p2 = must(
      (await t.db.select().from(schema.projects)).find((p) => p.name === 'P2'),
      'P2',
    );
    expect((await actions.createBoard({ projectId: p2.id, name: 'B2', color: 'blue' })).ok).toBe(
      true,
    );
    const b2 = must(
      (await t.db.select().from(schema.boards)).find((b) => b.name === 'B2'),
      'B2',
    );
    expect((await actions.createList({ boardId: b2.id, name: 'Other' })).ok).toBe(true);
    const otherList = must(
      (await t.db.select().from(schema.lists)).find((l) => l.name === 'Other'),
      'other list',
    );

    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect(await actions.moveCard({ cardId: card.id, toListId: otherList.id })).toEqual({
      ok: false,
      error: 'List not found.',
    });
  });
});

describe('labels (K.6)', () => {
  it('denies label mutations to a non-member without side effects', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createLabel({ boardId, name: 'Bug', color: 'clay' })).ok).toBe(true);
    const label = must((await t.db.select().from(schema.labels))[0], 'label');
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    actAs(outsider);
    const denials = await Promise.all([
      actions.createLabel({ boardId, name: 'X', color: 'sky' }),
      actions.deleteLabel({ labelId: label.id }),
      actions.toggleCardLabel({ cardId: card.id, labelId: label.id, on: true }),
    ]);
    for (const result of denials) expect(result.ok).toBe(false);
    expect(await t.db.select().from(schema.labels)).toHaveLength(1);
    expect(await t.db.select().from(schema.cardLabels)).toHaveLength(0);
  });

  it('creates a label, attaches/detaches it on a card, and records activity', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createLabel({ boardId, name: 'Bug', color: 'clay' })).ok).toBe(true);
    const label = must((await t.db.select().from(schema.labels))[0], 'label');
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    expect((await actions.toggleCardLabel({ cardId: card.id, labelId: label.id, on: true })).ok).toBe(
      true,
    );
    expect(await t.db.select().from(schema.cardLabels)).toHaveLength(1);
    // Toggling on twice is a no-op, not a duplicate-key crash.
    expect((await actions.toggleCardLabel({ cardId: card.id, labelId: label.id, on: true })).ok).toBe(
      true,
    );
    expect(await t.db.select().from(schema.cardLabels)).toHaveLength(1);

    expect((await actions.toggleCardLabel({ cardId: card.id, labelId: label.id, on: false })).ok).toBe(
      true,
    );
    expect(await t.db.select().from(schema.cardLabels)).toHaveLength(0);

    const activityTypes = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(activityTypes).toContain('label.added');
    expect(activityTypes).toContain('label.removed');
  });

  it('rejects attaching a label from a different board even with membership on both', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createProject({ name: 'P2' })).ok).toBe(true);
    const p2 = must(
      (await t.db.select().from(schema.projects)).find((p) => p.name === 'P2'),
      'P2',
    );
    expect((await actions.createBoard({ projectId: p2.id, name: 'B2', color: 'blue' })).ok).toBe(
      true,
    );
    const b2 = must(
      (await t.db.select().from(schema.boards)).find((b) => b.name === 'B2'),
      'B2',
    );
    expect((await actions.createLabel({ boardId: b2.id, name: 'Other', color: 'sage' })).ok).toBe(
      true,
    );
    const otherLabel = must((await t.db.select().from(schema.labels))[0], 'other label');
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    expect(
      await actions.toggleCardLabel({ cardId: card.id, labelId: otherLabel.id, on: true }),
    ).toEqual({ ok: false, error: 'Label not found.' });
  });

  it('deleting a label cascades off every card it was attached to', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createLabel({ boardId, name: 'Bug', color: 'clay' })).ok).toBe(true);
    const label = must((await t.db.select().from(schema.labels))[0], 'label');
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.toggleCardLabel({ cardId: card.id, labelId: label.id, on: true })).ok).toBe(
      true,
    );

    expect((await actions.deleteLabel({ labelId: label.id })).ok).toBe(true);
    expect(await t.db.select().from(schema.labels)).toHaveLength(0);
    expect(await t.db.select().from(schema.cardLabels)).toHaveLength(0);
  });
});

describe('assignees (K.6)', () => {
  it('denies assignment mutations to a non-member without side effects', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    actAs(outsider);
    const denials = await Promise.all([
      actions.assignMember({ cardId: card.id, userId: owner.id }),
      actions.unassignMember({ cardId: card.id, userId: owner.id }),
    ]);
    for (const result of denials) expect(result.ok).toBe(false);
    expect(await t.db.select().from(schema.cardAssignees)).toHaveLength(0);
  });

  it('assigns and unassigns a board member, recording activity', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    expect((await actions.assignMember({ cardId: card.id, userId: owner.id })).ok).toBe(true);
    expect(await t.db.select().from(schema.cardAssignees)).toHaveLength(1);
    expect((await actions.unassignMember({ cardId: card.id, userId: owner.id })).ok).toBe(true);
    expect(await t.db.select().from(schema.cardAssignees)).toHaveLength(0);

    const activityTypes = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(activityTypes).toContain('assignee.added');
    expect(activityTypes).toContain('assignee.removed');
  });

  it('rejects assigning a user who is not a board member', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    expect(await actions.assignMember({ cardId: card.id, userId: outsider.id })).toEqual({
      ok: false,
      error: 'That person is not a member of this board.',
    });
  });
});

describe('checklist (K.6)', () => {
  it('denies checklist mutations to a non-member without side effects', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.createChecklistItem({ cardId: card.id, text: 'Item 1' })).ok).toBe(true);
    const item = must((await t.db.select().from(schema.checklistItems))[0], 'item');

    actAs(outsider);
    const denials = await Promise.all([
      actions.createChecklistItem({ cardId: card.id, text: 'X' }),
      actions.toggleChecklistItem({ itemId: item.id, done: true }),
      actions.deleteChecklistItem({ itemId: item.id }),
      actions.moveChecklistItem({ itemId: item.id, direction: 'up' }),
    ]);
    for (const result of denials) expect(result.ok).toBe(false);
    const items = await t.db.select().from(schema.checklistItems);
    expect(items).toHaveLength(1);
    expect(must(items[0], 'item').done).toBe(0);
  });

  it('adds, toggles, and deletes a checklist item, recording activity for each', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    expect((await actions.createChecklistItem({ cardId: card.id, text: 'Item 1' })).ok).toBe(true);
    const item = must((await t.db.select().from(schema.checklistItems))[0], 'item');
    expect((await actions.toggleChecklistItem({ itemId: item.id, done: true })).ok).toBe(true);
    expect(
      must((await t.db.select().from(schema.checklistItems))[0], 'toggled item').done,
    ).toBe(1);

    expect((await actions.deleteChecklistItem({ itemId: item.id })).ok).toBe(true);
    expect(await t.db.select().from(schema.checklistItems)).toHaveLength(0);

    const activityTypes = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(activityTypes.filter((type) => type === 'checklist.changed')).toHaveLength(3);
  });

  it('reorders by swapping position with the neighbour, a no-op at the edges', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    for (const text of ['A', 'B', 'C']) {
      expect((await actions.createChecklistItem({ cardId: card.id, text })).ok).toBe(true);
    }
    const before = await t.db
      .select()
      .from(schema.checklistItems)
      .orderBy(asc(schema.checklistItems.position));
    expect(before.map((i) => i.text)).toEqual(['A', 'B', 'C']);
    const a = must(before[0], 'A');
    const c = must(before[2], 'C');

    // The first item can't move up — no-op, no crash.
    expect((await actions.moveChecklistItem({ itemId: a.id, direction: 'up' })).ok).toBe(true);
    expect(
      (await t.db.select().from(schema.checklistItems).orderBy(asc(schema.checklistItems.position))).map(
        (i) => i.text,
      ),
    ).toEqual(['A', 'B', 'C']);

    // The last item can't move down — no-op, no crash.
    expect((await actions.moveChecklistItem({ itemId: c.id, direction: 'down' })).ok).toBe(true);

    // Move C up: swaps with B.
    expect((await actions.moveChecklistItem({ itemId: c.id, direction: 'up' })).ok).toBe(true);
    const after = await t.db
      .select()
      .from(schema.checklistItems)
      .orderBy(asc(schema.checklistItems.position));
    expect(after.map((i) => i.text)).toEqual(['A', 'C', 'B']);
  });
});

describe('comments (K.8)', () => {
  it('denies comment mutations to a non-member without side effects', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    actAs(outsider);
    expect(await actions.addComment({ cardId: card.id, body: 'Hi' })).toEqual({
      ok: false,
      error: 'Card not found.',
    });
    expect(await t.db.select().from(schema.comments)).toHaveLength(0);
  });

  it('adds a top-level comment and a one-level reply, recording activity for each', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    expect((await actions.addComment({ cardId: card.id, body: 'Top level' })).ok).toBe(true);
    const top = must((await t.db.select().from(schema.comments))[0], 'top-level comment');
    expect(top.parentId).toBeNull();

    expect(
      (await actions.addComment({ cardId: card.id, body: 'A reply', parentId: top.id })).ok,
    ).toBe(true);
    const comments = await t.db.select().from(schema.comments);
    expect(comments).toHaveLength(2);
    const reply = must(
      comments.find((c) => c.id !== top.id),
      'reply',
    );
    expect(reply.parentId).toBe(top.id);

    const activityTypes = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(activityTypes.filter((type) => type === 'comment.added')).toHaveLength(2);
  });

  it('rejects replying to a reply — one level of nesting only', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.addComment({ cardId: card.id, body: 'Top level' })).ok).toBe(true);
    const top = must((await t.db.select().from(schema.comments))[0], 'top-level comment');
    expect(
      (await actions.addComment({ cardId: card.id, body: 'A reply', parentId: top.id })).ok,
    ).toBe(true);
    const reply = must(
      (await t.db.select().from(schema.comments)).find((c) => c.id !== top.id),
      'reply',
    );

    expect(
      await actions.addComment({ cardId: card.id, body: 'Nested', parentId: reply.id }),
    ).toEqual({ ok: false, error: 'Replies can’t be nested further.' });
    expect(await t.db.select().from(schema.comments)).toHaveLength(2);
  });

  it('rejects a parentId belonging to a different card', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    expect((await actions.createCard({ listId, title: 'C2' })).ok).toBe(true);
    const cards = await t.db.select().from(schema.cards);
    const c1 = must(
      cards.find((c) => c.title === 'C1'),
      'C1',
    );
    const c2 = must(
      cards.find((c) => c.title === 'C2'),
      'C2',
    );
    expect((await actions.addComment({ cardId: c1.id, body: 'On C1' })).ok).toBe(true);
    const commentOnC1 = must((await t.db.select().from(schema.comments))[0], 'comment');

    expect(
      await actions.addComment({ cardId: c2.id, body: 'Cross-card reply', parentId: commentOnC1.id }),
    ).toEqual({ ok: false, error: 'Comment not found.' });
  });
});

describe('activity (K.8)', () => {
  it('denies getMoreCardActivity to a non-member', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    actAs(outsider);
    expect(
      await actions.getMoreCardActivity({
        cardId: card.id,
        cursor: { createdAt: Date.now(), id: 'irrelevant' },
      }),
    ).toEqual({ ok: false, error: 'Card not found.' });
  });

  it('pages past the first 20 rows on a stable (createdAt, id) cursor, with no overlap or gap', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    // createCard already recorded one activity row; insert 24 more directly,
    // deliberately sharing one millisecond timestamp, so the cursor's id
    // tie-break — not wall-clock drift — is what's actually under test.
    const now = Date.now();
    for (let i = 0; i < 24; i++) {
      await t.db.insert(schema.activity).values({
        id: `activity-${String(i).padStart(2, '0')}`,
        tenantId: owner.tenantId,
        boardId,
        cardId: card.id,
        actorId: owner.id,
        type: 'checklist.changed',
        payload: null,
        createdAt: now,
      });
    }

    const { getCardDetail, ACTIVITY_PAGE_SIZE } = await import('../_lib/queries');
    const detail = await getCardDetail(t.db, card.id, { userId: owner.id, tenantId: owner.tenantId });
    if (!detail) throw new Error('expected card detail');
    const page1 = detail.activity;
    expect(page1).toHaveLength(ACTIVITY_PAGE_SIZE);

    const cursorSource = must(page1[page1.length - 1], 'last row of page 1');
    const page2 = await actions.getMoreCardActivity({
      cardId: card.id,
      cursor: { createdAt: cursorSource.createdAt, id: cursorSource.id },
    });
    if (!page2.ok) throw new Error(`expected ok, got ${page2.error}`);
    expect(page2.items).toHaveLength(5); // 25 rows total - 20 on page 1
    expect(page2.nextCursor).toBeNull();

    const allIds = new Set([...page1.map((a) => a.id), ...page2.items.map((a) => a.id)]);
    expect(allIds.size).toBe(25);
  });
});

describe('board members & share (K.9)', () => {
  const newcomer = { id: 'user-newcomer', tenantId: 'default' };

  it('denies member management to a non-owner without side effects', async () => {
    const { boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addBoardMember({ boardId, userId: newcomer.id })).ok).toBe(true);
    const member = must(
      (await t.db.select().from(schema.boardMembers)).find((m) => m.userId !== owner.id),
      'added member',
    );

    // A plain member (just added) can't manage membership either — only the owner can.
    actAs(newcomer);
    const denials = await Promise.all([
      actions.addBoardMember({ boardId, userId: outsider.id }),
      actions.removeBoardMember({ boardId, userId: owner.id }),
      actions.searchBoardMemberCandidates({ boardId, query: 'out' }),
    ]);
    expect(denials[0].ok).toBe(false);
    expect(denials[1].ok).toBe(false);
    expect(denials[2]).toEqual([]);

    actAs(outsider);
    expect(await actions.addBoardMember({ boardId, userId: outsider.id })).toEqual({
      ok: false,
      error: 'Board not found.',
    });
    expect(await actions.removeBoardMember({ boardId, userId: member.userId })).toEqual({
      ok: false,
      error: 'Board not found.',
    });

    expect(await t.db.select().from(schema.boardMembers)).toHaveLength(2); // owner + newcomer only
  });

  it('adds a member, records activity, and notifies them with a board deep link', async () => {
    const { boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });

    expect((await actions.addBoardMember({ boardId, userId: newcomer.id })).ok).toBe(true);
    const rows = await t.db.select().from(schema.boardMembers);
    expect(rows).toHaveLength(2);
    expect(must(rows.find((m) => m.userId === newcomer.id), 'newcomer row').role).toBe('member');

    const activityTypes = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(activityTypes).toContain('member.added');

    expect(harness.sentNotifications).toHaveLength(1);
    const notification = must(harness.sentNotifications[0], 'notification');
    expect(notification.recipientUserId).toBe(newcomer.id);
    expect(notification.url).toBe(`/kanban/boards/${boardId}`);
  });

  it('rejects adding someone already a member, and someone not in the directory', async () => {
    const { boardId } = await setup();
    actAs(owner);

    expect(await actions.addBoardMember({ boardId, userId: owner.id })).toEqual({
      ok: false,
      error: 'This person is already a member.',
    });
    expect(await actions.addBoardMember({ boardId, userId: 'user-ghost' })).toEqual({
      ok: false,
      error: 'That person could not be found.',
    });
    expect(await t.db.select().from(schema.boardMembers)).toHaveLength(1);
    expect(harness.sentNotifications).toHaveLength(0);
  });

  it('removes a member, records activity, and detaches them from the board’s cards', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addBoardMember({ boardId, userId: newcomer.id })).ok).toBe(true);

    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.assignMember({ cardId: card.id, userId: newcomer.id })).ok).toBe(true);
    expect(await t.db.select().from(schema.cardAssignees)).toHaveLength(1);

    expect((await actions.removeBoardMember({ boardId, userId: newcomer.id })).ok).toBe(true);
    expect(await t.db.select().from(schema.boardMembers)).toHaveLength(1);
    expect(await t.db.select().from(schema.cardAssignees)).toHaveLength(0);

    const activityTypes = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(activityTypes).toContain('member.removed');
  });

  it('rejects removing the owner, and removing a non-member', async () => {
    const { boardId } = await setup();
    actAs(owner);
    expect(await actions.removeBoardMember({ boardId, userId: owner.id })).toEqual({
      ok: false,
      error: 'The owner can’t be removed — delete the board instead.',
    });
    expect(await actions.removeBoardMember({ boardId, userId: outsider.id })).toEqual({
      ok: false,
      error: 'That person is not a member of this board.',
    });
  });

  it('search excludes existing members from candidates', async () => {
    const { boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: owner.id, email: 'owner@example.com', name: 'Board Owner' });
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });

    const results = await actions.searchBoardMemberCandidates({ boardId, query: 'New' });
    const ids = results.map((u) => u.id);
    expect(ids).toContain(newcomer.id);
    expect(ids).not.toContain(owner.id); // already a member
  });

  it('notifies an assignee, but not on self-assignment', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addBoardMember({ boardId, userId: newcomer.id })).ok).toBe(true);
    harness.sentNotifications = []; // clear the "added to board" notification from setup

    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    expect((await actions.assignMember({ cardId: card.id, userId: owner.id })).ok).toBe(true);
    expect(harness.sentNotifications).toHaveLength(0); // self-assignment

    expect((await actions.assignMember({ cardId: card.id, userId: newcomer.id })).ok).toBe(true);
    expect(harness.sentNotifications).toHaveLength(1);
    const notification = must(harness.sentNotifications[0], 'notification');
    expect(notification.recipientUserId).toBe(newcomer.id);
    expect(notification.url).toBe(`/kanban/boards/${boardId}?card=${card.id}`);
  });

  it('getBoardData resolves member names and emails via the directory', async () => {
    const { boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: owner.id, email: 'owner@example.com', name: 'Board Owner' });
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addBoardMember({ boardId, userId: newcomer.id })).ok).toBe(true);

    const { getBoardData } = await import('../_lib/queries');
    const board = await getBoardData(t.db, boardId, { userId: owner.id, tenantId: owner.tenantId });
    if (!board) throw new Error('expected board data');
    const members = board.members;
    expect(must(members.find((m) => m.userId === owner.id), 'owner member').name).toBe('Board Owner');
    expect(must(members.find((m) => m.userId === newcomer.id), 'newcomer member').email).toBe(
      'newcomer@example.com',
    );
  });
});
