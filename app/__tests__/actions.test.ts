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
  expect((await actions.createBoard({ projectId: project.id, name: 'B1', color: 'sky' })).ok).toBe(
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
    expect(await actions.createBoard({ projectId, name: 'X', color: 'clay' })).toEqual({
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

describe('project & board access — view vs. edit (K.18)', () => {
  it('a project co-owner can view a board they were never explicitly added to, but cannot mutate it', async () => {
    const { projectId, boardId } = await setup();
    // K.19's promote-to-owner UI doesn't exist yet — insert the second
    // owner row directly, exactly like K.9's tests insert board_members
    // rows to simulate state no action can produce yet.
    await t.db.insert(schema.projectMembers).values({
      projectId,
      userId: outsider.id,
      tenantId: outsider.tenantId,
      role: 'owner',
      addedBy: owner.id,
      createdAt: Date.now(),
    });

    const { getBoardData } = await import('../_lib/queries');
    const board = await getBoardData(t.db, boardId, {
      userId: outsider.id,
      tenantId: outsider.tenantId,
    });
    expect(board?.role).toBe('viewer');
    expect(board?.lists).toHaveLength(1);

    actAs(outsider);
    // Content stays off-limits (CONCEPT.md: project ownership never grants
    // edit access to a board's content)…
    expect((await actions.createList({ boardId, name: 'Should be denied' })).ok).toBe(false);
    expect(await t.db.select().from(schema.lists)).toHaveLength(1);
    // …but board *administration* (settings, membership, archive/delete) is
    // open to a project owner (K.20), so a board whose owner left never
    // becomes unmanageable.
    expect((await actions.updateBoard({ boardId, name: 'Renamed' })).ok).toBe(true);
    expect(must((await t.db.select().from(schema.boards))[0], 'board').name).toBe('Renamed');
  });

  it('a project member sees a public board in a public project read-only', async () => {
    const { projectId, boardId } = await setup();
    await t.db.insert(schema.projectMembers).values({
      projectId,
      userId: outsider.id,
      tenantId: outsider.tenantId,
      role: 'member',
      addedBy: owner.id,
      createdAt: Date.now(),
    });

    const { getBoardData } = await import('../_lib/queries');
    const board = await getBoardData(t.db, boardId, {
      userId: outsider.id,
      tenantId: outsider.tenantId,
    });
    expect(board?.role).toBe('viewer');

    actAs(outsider);
    expect((await actions.createList({ boardId, name: 'Should be denied' })).ok).toBe(false);
  });

  it('a private board hides itself from a plain project member (public project)', async () => {
    const { projectId, boardId } = await setup();
    await t.db
      .update(schema.boards)
      .set({ visibility: 'private' })
      .where(eq(schema.boards.id, boardId));
    await t.db.insert(schema.projectMembers).values({
      projectId,
      userId: outsider.id,
      tenantId: outsider.tenantId,
      role: 'member',
      addedBy: owner.id,
      createdAt: Date.now(),
    });

    const { getBoardData } = await import('../_lib/queries');
    expect(
      await getBoardData(t.db, boardId, { userId: outsider.id, tenantId: outsider.tenantId }),
    ).toBeNull();

    // The project owner can still see it, board visibility notwithstanding.
    expect(
      await getBoardData(t.db, boardId, { userId: owner.id, tenantId: owner.tenantId }),
    ).not.toBeNull();
  });

  it('a private project hides an otherwise-public board from a plain project member entirely', async () => {
    const { projectId, boardId } = await setup();
    await t.db
      .update(schema.projects)
      .set({ visibility: 'private' })
      .where(eq(schema.projects.id, projectId));
    await t.db.insert(schema.projectMembers).values({
      projectId,
      userId: outsider.id,
      tenantId: outsider.tenantId,
      role: 'member',
      addedBy: owner.id,
      createdAt: Date.now(),
    });

    const { getBoardData } = await import('../_lib/queries');
    // The board itself is still 'public' — the project's 'private' flag
    // overrides it, not the other way around.
    expect(
      (await t.db.select().from(schema.boards).where(eq(schema.boards.id, boardId)))[0]
        ?.visibility,
    ).toBe('public');
    expect(
      await getBoardData(t.db, boardId, { userId: outsider.id, tenantId: outsider.tenantId }),
    ).toBeNull();
  });

  it('getHomeData lists a project owner\'s boards read-only alongside their explicit memberships', async () => {
    const { projectId, boardId } = await setup();
    await t.db.insert(schema.projectMembers).values({
      projectId,
      userId: outsider.id,
      tenantId: outsider.tenantId,
      role: 'owner',
      addedBy: owner.id,
      createdAt: Date.now(),
    });

    const { getHomeData } = await import('../_lib/queries');
    const home = await getHomeData(t.db, { userId: outsider.id, tenantId: outsider.tenantId });
    expect(home).toHaveLength(1);
    const project = must(home[0], 'home project');
    expect(project.boards).toHaveLength(1);
    expect(must(project.boards[0], 'home board').role).toBe('viewer');
    expect(must(project.boards[0], 'home board').id).toBe(boardId);
  });

  it('an unrelated user gets no access at all — the Phase 1 baseline still holds', async () => {
    const { boardId } = await setup();
    const { getBoardData, getHomeData } = await import('../_lib/queries');
    expect(
      await getBoardData(t.db, boardId, { userId: outsider.id, tenantId: outsider.tenantId }),
    ).toBeNull();
    expect(await getHomeData(t.db, { userId: outsider.id, tenantId: outsider.tenantId })).toEqual(
      [],
    );
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
      title: 'C2',
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
    expect((await actions.createBoard({ projectId: p2.id, name: 'B2', color: 'sage' })).ok).toBe(
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
    expect((await actions.createBoard({ projectId: p2.id, name: 'B2', color: 'sage' })).ok).toBe(
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
    const { projectId, boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);
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
      actions.getBoardMemberCandidates({ boardId }),
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
    const { projectId, boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);
    harness.sentNotifications = []; // clear the "added to project" notification — this test only asserts the board one

    expect((await actions.addBoardMember({ boardId, userId: newcomer.id })).ok).toBe(true);
    const rows = await t.db.select().from(schema.boardMembers);
    expect(rows).toHaveLength(2);
    expect(must(rows.find((m) => m.userId === newcomer.id), 'newcomer row').role).toBe('member');

    const activityTypes = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(activityTypes).toContain('member.added');

    expect(harness.sentNotifications).toHaveLength(1);
    const notification = must(harness.sentNotifications[0], 'notification');
    expect(notification.recipientUserId).toBe(newcomer.id);
    expect(notification.url).toBe(`/kanban/b/${boardId}`);
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

  it('rejects adding a real directory user who isn’t a project member (K.20)', async () => {
    const { boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: outsider.id, email: 'outsider@example.com', name: 'Outsider' });

    expect(await actions.addBoardMember({ boardId, userId: outsider.id })).toEqual({
      ok: false,
      error: 'Add them to the project first.',
    });
    expect(await t.db.select().from(schema.boardMembers)).toHaveLength(1);
    expect(harness.sentNotifications).toHaveLength(0);
  });

  it('removes a member, records activity, and detaches them from the board’s cards', async () => {
    const { projectId, boardId, listId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);
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

  it('rejects removing the last owner, and removing a non-member', async () => {
    const { boardId } = await setup();
    actAs(owner);
    expect(await actions.removeBoardMember({ boardId, userId: owner.id })).toEqual({
      ok: false,
      error: 'A board needs at least one owner — make someone else an owner first.',
    });
    expect(await actions.removeBoardMember({ boardId, userId: outsider.id })).toEqual({
      ok: false,
      error: 'That person is not a member of this board.',
    });
  });

  it('candidates are sourced from project members only, excluding those already on the board', async () => {
    const { projectId, boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: owner.id, email: 'owner@example.com', name: 'Board Owner' });
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    registerDirectoryUser({ id: outsider.id, email: 'outsider@example.com', name: 'Outsider' });
    // A project member not yet on the board — the only one who should appear.
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);

    const results = await actions.getBoardMemberCandidates({ boardId });
    const ids = results.map((u) => u.id);
    expect(ids).toEqual([newcomer.id]);
    expect(ids).not.toContain(owner.id); // already a board member (also the project owner)
    expect(ids).not.toContain(outsider.id); // in the directory, but not a project member at all
  });

  it('notifies an assignee, but not on self-assignment', async () => {
    const { projectId, boardId, listId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);
    expect((await actions.addBoardMember({ boardId, userId: newcomer.id })).ok).toBe(true);
    harness.sentNotifications = []; // clear the "added to project"/"added to board" notifications from setup

    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');

    expect((await actions.assignMember({ cardId: card.id, userId: owner.id })).ok).toBe(true);
    expect(harness.sentNotifications).toHaveLength(0); // self-assignment

    expect((await actions.assignMember({ cardId: card.id, userId: newcomer.id })).ok).toBe(true);
    expect(harness.sentNotifications).toHaveLength(1);
    const notification = must(harness.sentNotifications[0], 'notification');
    expect(notification.recipientUserId).toBe(newcomer.id);
    expect(notification.url).toBe(`/kanban/b/${boardId}?card=${card.id}`);
  });

  it('getBoardData resolves member names and emails via the directory', async () => {
    const { projectId, boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: owner.id, email: 'owner@example.com', name: 'Board Owner' });
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);
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

describe('project members & share (K.19)', () => {
  const newcomer = { id: 'user-newcomer', tenantId: 'default' };

  it('denies member management to a non-owner without side effects', async () => {
    const { projectId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);

    // A plain member (just added) can't manage membership either — only an owner can.
    actAs(newcomer);
    const denials = await Promise.all([
      actions.addProjectMember({ projectId, userId: outsider.id }),
      actions.removeProjectMember({ projectId, userId: owner.id }),
      actions.updateProjectMemberRole({ projectId, userId: newcomer.id, role: 'owner' }),
      actions.searchProjectMemberCandidates({ projectId, query: 'out' }),
    ]);
    expect(denials[0].ok).toBe(false);
    expect(denials[1].ok).toBe(false);
    expect(denials[2].ok).toBe(false);
    expect(denials[3]).toEqual([]);

    actAs(outsider);
    expect(await actions.addProjectMember({ projectId, userId: outsider.id })).toEqual({
      ok: false,
      error: 'Project not found.',
    });

    expect(await t.db.select().from(schema.projectMembers)).toHaveLength(2); // owner + newcomer only
  });

  it('adds a member and notifies them with a project deep link', async () => {
    const { projectId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });

    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);
    const rows = await t.db.select().from(schema.projectMembers);
    expect(rows).toHaveLength(2);
    expect(must(rows.find((m) => m.userId === newcomer.id), 'newcomer row').role).toBe('member');

    expect(harness.sentNotifications).toHaveLength(1);
    const notification = must(harness.sentNotifications[0], 'notification');
    expect(notification.recipientUserId).toBe(newcomer.id);
    expect(notification.url).toBe(`/kanban#project-${projectId}`);
  });

  it('rejects adding someone already a member, and someone not in the directory', async () => {
    const { projectId } = await setup();
    actAs(owner);

    expect(await actions.addProjectMember({ projectId, userId: owner.id })).toEqual({
      ok: false,
      error: 'This person is already a member.',
    });
    expect(await actions.addProjectMember({ projectId, userId: 'user-ghost' })).toEqual({
      ok: false,
      error: 'That person could not be found.',
    });
    expect(await t.db.select().from(schema.projectMembers)).toHaveLength(1);
    expect(harness.sentNotifications).toHaveLength(0);
  });

  it('removing a member cascades to their board access and card assignments in that project', async () => {
    const { projectId, boardId, listId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);
    expect((await actions.addBoardMember({ boardId, userId: newcomer.id })).ok).toBe(true);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.assignMember({ cardId: card.id, userId: newcomer.id })).ok).toBe(true);

    // A board in a *different* project is untouched.
    expect((await actions.createProject({ name: 'Other' })).ok).toBe(true);
    const other = must(
      (await t.db.select().from(schema.projects)).find((p) => p.name === 'Other'),
      'other project',
    );
    expect((await actions.createBoard({ projectId: other.id, name: 'OB', color: 'sky' })).ok).toBe(
      true,
    );
    const otherBoard = must(
      (await t.db.select().from(schema.boards)).find((b) => b.name === 'OB'),
      'other board',
    );
    expect((await actions.addProjectMember({ projectId: other.id, userId: newcomer.id })).ok).toBe(
      true,
    );
    expect((await actions.addBoardMember({ boardId: otherBoard.id, userId: newcomer.id })).ok).toBe(
      true,
    );

    expect((await actions.removeProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);
    // Board membership in this project is gone (it used to linger, leaving
    // the user with live edit access to a board that had vanished from
    // their Home page), and so is their assignment on its cards…
    const memberships = await t.db.select().from(schema.boardMembers);
    expect(memberships.some((m) => m.boardId === boardId && m.userId === newcomer.id)).toBe(false);
    expect(await t.db.select().from(schema.cardAssignees)).toHaveLength(0);
    // …with a `member.removed` row narrating it on that board.
    expect(
      (await t.db.select().from(schema.activity)).some(
        (a) => a.boardId === boardId && a.type === 'member.removed',
      ),
    ).toBe(true);
    // The other project's board membership is untouched.
    expect(
      memberships.some((m) => m.boardId === otherBoard.id && m.userId === newcomer.id),
    ).toBe(true);
  });

  it('rejects removing the last owner, and removing a non-member', async () => {
    const { projectId } = await setup();
    actAs(owner);
    expect(await actions.removeProjectMember({ projectId, userId: owner.id })).toEqual({
      ok: false,
      error: 'A project needs at least one owner — promote someone else first.',
    });
    expect(await actions.removeProjectMember({ projectId, userId: outsider.id })).toEqual({
      ok: false,
      error: 'That person is not a member of this project.',
    });
  });

  it('promotes a member to co-owner, and a co-owner can then remove the original owner', async () => {
    const { projectId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);
    expect(
      (await actions.updateProjectMemberRole({ projectId, userId: newcomer.id, role: 'owner' }))
        .ok,
    ).toBe(true);

    // Two owners now — removing the original owner is allowed (one remains).
    expect((await actions.removeProjectMember({ projectId, userId: owner.id })).ok).toBe(true);
    const remaining = await t.db.select().from(schema.projectMembers);
    expect(remaining).toHaveLength(1);
    expect(must(remaining[0], 'remaining member').userId).toBe(newcomer.id);
    expect(must(remaining[0], 'remaining member').role).toBe('owner');
  });

  it('rejects demoting the last owner', async () => {
    const { projectId } = await setup();
    actAs(owner);
    expect(
      await actions.updateProjectMemberRole({ projectId, userId: owner.id, role: 'member' }),
    ).toEqual({ ok: false, error: 'A project needs at least one owner — promote someone else first.' });
  });

  it('search excludes existing members from candidates', async () => {
    const { projectId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: owner.id, email: 'owner@example.com', name: 'Project Owner' });
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });

    const results = await actions.searchProjectMemberCandidates({ projectId, query: 'New' });
    const ids = results.map((u) => u.id);
    expect(ids).toContain(newcomer.id);
    expect(ids).not.toContain(owner.id); // already a member
  });

  it('updateProject persists visibility, which getBoardData\'s viewer path immediately reflects', async () => {
    const { projectId, boardId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: newcomer.id, email: 'newcomer@example.com', name: 'Newcomer' });
    expect((await actions.addProjectMember({ projectId, userId: newcomer.id })).ok).toBe(true);

    const { getBoardData } = await import('../_lib/queries');
    expect(
      (await getBoardData(t.db, boardId, { userId: newcomer.id, tenantId: newcomer.tenantId }))
        ?.role,
    ).toBe('viewer');

    expect((await actions.updateProject({ projectId, visibility: 'private' })).ok).toBe(true);
    expect(
      await getBoardData(t.db, boardId, { userId: newcomer.id, tenantId: newcomer.tenantId }),
    ).toBeNull();
  });
});

describe('comment notifications (K.11)', () => {
  const commenter = { id: 'user-commenter', tenantId: 'default' };

  async function setupCardWithAssignee(): Promise<{ boardId: string; cardId: string }> {
    const { projectId, boardId, listId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: commenter.id, email: 'commenter@example.com', name: 'Commenter' });
    expect((await actions.addProjectMember({ projectId, userId: commenter.id })).ok).toBe(true);
    expect((await actions.addBoardMember({ boardId, userId: commenter.id })).ok).toBe(true);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.assignMember({ cardId: card.id, userId: owner.id })).ok).toBe(true);
    harness.sentNotifications = []; // clear the assignment notification (self-assign, none expected, but be explicit)
    return { boardId, cardId: card.id };
  }

  it('notifies every assignee on a top-level comment, never the commenter', async () => {
    const { cardId } = await setupCardWithAssignee();
    actAs(owner); // owner is the sole assignee and about to comment on their own card
    expect((await actions.addComment({ cardId, body: 'Top level' })).ok).toBe(true);
    expect(harness.sentNotifications).toHaveLength(0); // owner is both commenter and only assignee

    actAs(commenter); // not an assignee, just a board member
    expect((await actions.addComment({ cardId, body: 'Another comment' })).ok).toBe(true);
    expect(harness.sentNotifications).toHaveLength(1);
    const notification = must(harness.sentNotifications[0], 'notification');
    expect(notification.recipientUserId).toBe(owner.id);
    expect(notification.title).toBe('New comment on your card');
  });

  it('notifies the parent comment author on a reply, not the replier', async () => {
    const { cardId } = await setupCardWithAssignee();
    actAs(owner);
    expect((await actions.unassignMember({ cardId, userId: owner.id })).ok).toBe(true); // isolate reply-only behaviour
    expect((await actions.addComment({ cardId, body: 'Top level' })).ok).toBe(true);
    const top = must((await t.db.select().from(schema.comments))[0], 'top-level comment');
    harness.sentNotifications = [];

    actAs(commenter);
    expect(
      (await actions.addComment({ cardId, body: 'A reply', parentId: top.id })).ok,
    ).toBe(true);
    expect(harness.sentNotifications).toHaveLength(1);
    const notification = must(harness.sentNotifications[0], 'notification');
    expect(notification.recipientUserId).toBe(owner.id);
    expect(notification.title).toBe('New reply to your comment');
  });

  it('sends one notification, not two, when the parent author is also an assignee', async () => {
    const { cardId } = await setupCardWithAssignee();
    actAs(owner);
    expect((await actions.addComment({ cardId, body: 'Top level' })).ok).toBe(true);
    const top = must((await t.db.select().from(schema.comments))[0], 'top-level comment');
    harness.sentNotifications = [];

    actAs(commenter);
    expect(
      (await actions.addComment({ cardId, body: 'A reply', parentId: top.id })).ok,
    ).toBe(true);
    // owner is both the parent comment's author and the card's sole assignee —
    // must be notified exactly once, as a "reply", not twice.
    expect(harness.sentNotifications).toHaveLength(1);
    expect(must(harness.sentNotifications[0], 'notification').title).toBe('New reply to your comment');
  });
});

describe('inbox (K.11)', () => {
  it('markInboxSeen creates then updates the caller’s own row', async () => {
    await setup();
    actAs(owner);
    await actions.markInboxSeen();
    const rows = await t.db.select().from(schema.inboxState);
    expect(rows).toHaveLength(1);
    const firstSeenAt = must(rows[0], 'inbox state row').lastSeenAt;
    expect(firstSeenAt).not.toBeNull();

    await actions.markInboxSeen();
    const after = await t.db.select().from(schema.inboxState);
    expect(after).toHaveLength(1); // updated in place, not a second row
    expect(must(after[0], 'updated row').userId).toBe(owner.id);
  });

  /** Adds `userId` as a board member the same way the two setup steps K.9 tests already use. */
  async function addOtherMember(
    projectId: string,
    boardId: string,
    userId: string,
    name: string,
  ): Promise<void> {
    registerDirectoryUser({ id: userId, email: `${userId}@example.com`, name });
    actAs(owner);
    expect((await actions.addProjectMember({ projectId, userId })).ok).toBe(true);
    expect((await actions.addBoardMember({ boardId, userId })).ok).toBe(true);
  }

  it('getInboxFeed shows cards assigned to the actor by someone else, excludes self-assignment and other people’s assignments', async () => {
    const { projectId, boardId, listId } = await setup();
    await addOtherMember(projectId, boardId, 'user-other-member', 'Other');

    actAs(owner);
    expect((await actions.createCard({ listId, title: 'Card for other' })).ok).toBe(true);
    const cardForOther = must(
      (await t.db.select().from(schema.cards)).find((c) => c.title === 'Card for other'),
      'card for other',
    );
    expect((await actions.createCard({ listId, title: 'Self-assigned card' })).ok).toBe(true);
    const selfAssignedCard = must(
      (await t.db.select().from(schema.cards)).find((c) => c.title === 'Self-assigned card'),
      'self-assigned card',
    );
    // Owner assigns the other member to one card, and themselves to another.
    expect(
      (await actions.assignMember({ cardId: cardForOther.id, userId: 'user-other-member' })).ok,
    ).toBe(true);
    expect((await actions.assignMember({ cardId: selfAssignedCard.id, userId: owner.id })).ok).toBe(true);

    const { getInboxFeed } = await import('../_lib/queries');

    const otherFeed = await getInboxFeed(t.db, { userId: 'user-other-member', tenantId: 'default' });
    expect(otherFeed.items).toHaveLength(1);
    expect(must(otherFeed.items[0], 'assigned item')).toMatchObject({
      kind: 'assigned',
      cardId: cardForOther.id,
      boardId,
      actorId: owner.id,
    });

    // Self-assignment never shows up in the assigner's own inbox.
    const ownerFeed = await getInboxFeed(t.db, { userId: owner.id, tenantId: owner.tenantId });
    expect(ownerFeed.items.some((i) => i.cardId === selfAssignedCard.id)).toBe(false);
    expect(ownerFeed.items.some((i) => i.cardId === cardForOther.id)).toBe(false);
  });

  it('getInboxFeed shows replies to the actor’s own comments, excludes top-level comments and replies to someone else’s comment', async () => {
    const { projectId, boardId, listId } = await setup();
    await addOtherMember(projectId, boardId, 'user-other-member', 'Other');

    actAs(owner);
    expect((await actions.createCard({ listId, title: 'Discussed card' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.addComment({ cardId: card.id, body: 'Owner’s top-level comment' })).ok).toBe(
      true,
    );
    const ownerComment = must(
      (await t.db.select().from(schema.comments)).find((c) => c.authorId === owner.id),
      'owner comment',
    );

    actAs({ id: 'user-other-member', tenantId: 'default' });
    expect(
      (
        await actions.addComment({
          cardId: card.id,
          body: 'Reply to owner',
          parentId: ownerComment.id,
        })
      ).ok,
    ).toBe(true);
    const reply = must(
      (await t.db.select().from(schema.comments)).find((c) => c.authorId === 'user-other-member'),
      'reply',
    );
    // A top-level comment from the other member — not a reply to anything of owner's.
    expect((await actions.addComment({ cardId: card.id, body: 'Unrelated top-level' })).ok).toBe(true);
    // Owner replies to their own comment — should never show up in their own inbox.
    actAs(owner);
    expect(
      (await actions.addComment({ cardId: card.id, body: 'Owner replies to self', parentId: ownerComment.id })).ok,
    ).toBe(true);

    const { getInboxFeed } = await import('../_lib/queries');
    const ownerFeed = await getInboxFeed(t.db, { userId: owner.id, tenantId: owner.tenantId });
    expect(ownerFeed.items).toHaveLength(1);
    expect(must(ownerFeed.items[0], 'reply item')).toMatchObject({
      kind: 'reply',
      id: reply.id,
      cardId: card.id,
      boardId,
      actorId: 'user-other-member',
    });

    // The other member never gets a reply notification for owner's own reply
    // to owner's own comment, and has no comments of their own replied to.
    const otherFeed = await getInboxFeed(t.db, { userId: 'user-other-member', tenantId: 'default' });
    expect(otherFeed.items).toHaveLength(0);
  });

  it('hasUnseenInboxActivity ignores generic board activity but reacts to being assigned or getting a reply, and clears after markInboxSeen', async () => {
    const { projectId, boardId, listId } = await setup();
    const { hasUnseenInboxActivity } = await import('../_lib/queries');
    const ownerActor = { userId: owner.id, tenantId: owner.tenantId };

    actAs(owner);
    expect(await hasUnseenInboxActivity(t.db, ownerActor)).toBe(false); // only own board.created so far

    await addOtherMember(projectId, boardId, 'user-other-member', 'Other');
    expect(await hasUnseenInboxActivity(t.db, ownerActor)).toBe(false); // still only owner's own actions

    actAs({ id: 'user-other-member', tenantId: 'default' });
    // Generic board activity (list creation) is not personalized — must not light the badge.
    expect((await actions.createList({ boardId, name: 'A new list' })).ok).toBe(true);
    expect(await hasUnseenInboxActivity(t.db, ownerActor)).toBe(false);

    actAs(owner);
    expect((await actions.createCard({ listId, title: 'Card' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect(
      (await actions.assignMember({ cardId: card.id, userId: 'user-other-member' })).ok,
    ).toBe(true);
    // Assigning someone else doesn't light up the assigner's own badge.
    expect(await hasUnseenInboxActivity(t.db, ownerActor)).toBe(false);

    const otherActor = { userId: 'user-other-member', tenantId: 'default' };
    expect(await hasUnseenInboxActivity(t.db, otherActor)).toBe(true); // someone assigned them a card

    actAs({ id: 'user-other-member', tenantId: 'default' });
    await actions.markInboxSeen();
    expect(await hasUnseenInboxActivity(t.db, otherActor)).toBe(false);

    // A reply to the owner's comment lights the owner's badge back up.
    actAs(owner);
    expect((await actions.addComment({ cardId: card.id, body: 'Owner comment' })).ok).toBe(true);
    const ownerComment = must(
      (await t.db.select().from(schema.comments)).find((c) => c.authorId === owner.id),
      'owner comment',
    );
    expect(await hasUnseenInboxActivity(t.db, ownerActor)).toBe(false); // own comment, not a reply yet

    actAs({ id: 'user-other-member', tenantId: 'default' });
    expect(
      (await actions.addComment({ cardId: card.id, body: 'Reply', parentId: ownerComment.id })).ok,
    ).toBe(true);
    expect(await hasUnseenInboxActivity(t.db, ownerActor)).toBe(true);

    actAs(owner);
    await actions.markInboxSeen();
    expect(await hasUnseenInboxActivity(t.db, ownerActor)).toBe(false);
  });
});

describe('viewer read access (K.21)', () => {
  const viewer = { id: 'user-viewer', tenantId: 'default' };

  async function setupViewer(): Promise<{ boardId: string; cardId: string }> {
    const { projectId, boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'Seen by viewer' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    registerDirectoryUser({ id: viewer.id, email: 'viewer@example.com', name: 'Viewer' });
    expect((await actions.addProjectMember({ projectId, userId: viewer.id })).ok).toBe(true);
    return { boardId, cardId: card.id };
  }

  it('a viewer can open a card on a board they can only view (the overlay used to render nothing)', async () => {
    const { boardId, cardId } = await setupViewer();
    const { getBoardData, getCardDetail } = await import('../_lib/queries');
    const actor = { userId: viewer.id, tenantId: viewer.tenantId };
    expect((await getBoardData(t.db, boardId, actor))?.role).toBe('viewer');
    const detail = await getCardDetail(t.db, cardId, actor);
    expect(detail?.title).toBe('Seen by viewer');
    expect(typeof detail?.createdAt).toBe('number');
  });

  it('a viewer can page card activity and read the board feed, but not mutate', async () => {
    const { boardId, cardId } = await setupViewer();
    actAs(viewer);
    const activity = await actions.getMoreCardActivity({
      cardId,
      cursor: { createdAt: Date.now() + 1000, id: 'zzz' },
    });
    expect(activity.ok).toBe(true);
    const feed = await actions.getBoardActivity({ boardId });
    expect(feed.ok).toBe(true);
    if (feed.ok) expect(feed.items.map((i) => i.type)).toContain('card.created');
    expect((await actions.updateCard({ cardId, title: 'nope' })).ok).toBe(false);
    expect((await actions.addComment({ cardId, body: 'nope' })).ok).toBe(false);
  });

  it('an outsider still gets nothing from the read actions', async () => {
    const { boardId, cardId } = await setupViewer();
    actAs(outsider);
    expect((await actions.getBoardActivity({ boardId })).ok).toBe(false);
    expect((await actions.listArchivedCards({ boardId })).ok).toBe(false);
    const { getCardDetail } = await import('../_lib/queries');
    expect(await getCardDetail(t.db, cardId, { userId: outsider.id, tenantId: 'default' })).toBeNull();
  });
});

describe('input validation on the plain actions (not just the form wrappers)', () => {
  it('rejects an unknown board colour on create and update', async () => {
    const { projectId, boardId } = await setup();
    actAs(owner);
    expect(await actions.createBoard({ projectId, name: 'X', color: 'javascript:alert(1)' })).toEqual({
      ok: false,
      error: 'Pick a color for the board.',
    });
    expect(await actions.updateBoard({ boardId, color: 'red' })).toEqual({
      ok: false,
      error: 'Pick a color for the board.',
    });
    // Curated ids, the 'none' sentinel, and a strict 6-digit hex all pass.
    expect((await actions.updateBoard({ boardId, color: 'none' })).ok).toBe(true);
    expect((await actions.updateBoard({ boardId, color: '#AbCdEf' })).ok).toBe(true);
  });

  it('rejects an unknown project or board visibility', async () => {
    const { projectId, boardId } = await setup();
    actAs(owner);
    expect(
      await actions.updateProject({ projectId, visibility: 'friends' as unknown as 'public' }),
    ).toEqual({ ok: false, error: 'Visibility must be public or private.' });
    expect(
      await actions.updateBoard({ boardId, visibility: 'friends' as unknown as 'public' }),
    ).toEqual({ ok: false, error: 'Visibility must be public or private.' });
    expect((await actions.updateBoard({ boardId, visibility: 'private' })).ok).toBe(true);
    expect(must((await t.db.select().from(schema.boards))[0], 'board').visibility).toBe('private');
  });

  it('rejects a non-integer due date and an oversized description without throwing', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, '2026-01-01']) {
      expect(await actions.updateCard({ cardId: card.id, dueDate: bad as unknown as number })).toEqual({
        ok: false,
        error: 'That due date isn’t valid.',
      });
    }
    expect(await actions.updateCard({ cardId: card.id, description: 'x'.repeat(20_001) })).toEqual({
      ok: false,
      error: 'Description must be 20000 characters or fewer.',
    });
    expect((await actions.updateCard({ cardId: card.id, dueDate: null })).ok).toBe(true);
  });

  it('logs a combined title + due-date edit as two activity rows', async () => {
    const { listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect(
      (await actions.updateCard({ cardId: card.id, title: 'Renamed', dueDate: Date.now() })).ok,
    ).toBe(true);
    const types = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(types).toContain('field.changed');
    expect(types).toContain('due.changed');
  });
});

describe('archive (cards and boards)', () => {
  it('archives a card off the board payload and restores it into the same list', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'Parked' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.archiveCard({ cardId: card.id })).ok).toBe(true);

    const { getBoardData } = await import('../_lib/queries');
    const ownerActor = { userId: owner.id, tenantId: owner.tenantId };
    const board = await getBoardData(t.db, boardId, ownerActor);
    expect(board?.cards).toHaveLength(0);
    expect(board?.archivedCardCount).toBe(1);
    expect(must(board?.lists[0], 'list').cardCount).toBe(0);

    const archived = await actions.listArchivedCards({ boardId });
    expect(archived.ok && archived.cards.map((c) => c.id)).toEqual([card.id]);

    expect((await actions.restoreCard({ cardId: card.id })).ok).toBe(true);
    const after = await getBoardData(t.db, boardId, ownerActor);
    expect(after?.cards.map((c) => c.id)).toEqual([card.id]);
    expect(must(after?.cards[0], 'card').listId).toBe(listId);
    const types = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(types).toContain('card.archived');
    expect(types).toContain('card.restored');
  });

  it('an archived board is read-only for members until restored, and hidden behind archivedAt on Home', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.archiveBoard({ boardId })).ok).toBe(true);
    // Every content mutation refuses the archived board, owner or not.
    expect((await actions.createList({ boardId, name: 'X' })).ok).toBe(false);
    expect((await actions.createCard({ listId, title: 'X' })).ok).toBe(false);
    expect((await actions.renameList({ listId, name: 'X' })).ok).toBe(false);
    // It still opens, flagged archived, and Home carries the flag.
    const { getBoardData, getHomeData } = await import('../_lib/queries');
    const ownerActor = { userId: owner.id, tenantId: owner.tenantId };
    expect((await getBoardData(t.db, boardId, ownerActor))?.archivedAt).not.toBeNull();
    const home = await getHomeData(t.db, ownerActor);
    expect(must(home[0]?.boards[0], 'home board').archivedAt).not.toBeNull();
    // Administration still works — that's how it gets restored.
    expect((await actions.restoreBoard({ boardId })).ok).toBe(true);
    expect((await actions.createList({ boardId, name: 'Back' })).ok).toBe(true);
  });

  it('a plain member cannot archive or delete the board; a project owner can', async () => {
    const { projectId, boardId } = await setup();
    const member = { id: 'user-member', tenantId: 'default' };
    actAs(owner);
    registerDirectoryUser({ id: member.id, email: 'm@example.com', name: 'M' });
    expect((await actions.addProjectMember({ projectId, userId: member.id })).ok).toBe(true);
    expect((await actions.addBoardMember({ boardId, userId: member.id })).ok).toBe(true);
    actAs(member);
    expect((await actions.archiveBoard({ boardId })).ok).toBe(false);
    expect((await actions.deleteBoard({ boardId })).ok).toBe(false);

    // A project co-owner who is *not* a board member manages it (K.20).
    const coOwner = { id: 'user-coowner', tenantId: 'default' };
    registerDirectoryUser({ id: coOwner.id, email: 'co@example.com', name: 'Co' });
    await t.db.insert(schema.projectMembers).values({
      projectId,
      userId: coOwner.id,
      tenantId: 'default',
      role: 'owner',
      addedBy: owner.id,
      createdAt: Date.now(),
    });
    actAs(coOwner);
    expect((await actions.archiveBoard({ boardId })).ok).toBe(true);
    expect((await actions.restoreBoard({ boardId })).ok).toBe(true);
    expect((await actions.addBoardMember({ boardId, userId: coOwner.id })).ok).toBe(true);
    expect((await actions.deleteBoard({ boardId })).ok).toBe(true);
    expect(await t.db.select().from(schema.boards)).toHaveLength(0);
  });
});

describe('board ownership, leaving, and promotion', () => {
  const member = { id: 'user-member', tenantId: 'default' };

  async function setupWithMember(): Promise<{ projectId: string; boardId: string; listId: string }> {
    const ctx = await setup();
    actAs(owner);
    registerDirectoryUser({ id: member.id, email: 'm@example.com', name: 'M' });
    expect((await actions.addProjectMember({ projectId: ctx.projectId, userId: member.id })).ok).toBe(
      true,
    );
    expect((await actions.addBoardMember({ boardId: ctx.boardId, userId: member.id })).ok).toBe(true);
    return ctx;
  }

  it('promotes a member to owner, after which the original owner may be removed', async () => {
    const { boardId } = await setupWithMember();
    actAs(owner);
    expect(
      (await actions.updateBoardMemberRole({ boardId, userId: member.id, role: 'owner' })).ok,
    ).toBe(true);
    expect((await actions.updateBoardMemberRole({ boardId, userId: member.id, role: 'owner' })).ok).toBe(
      true,
    ); // no-op
    expect((await actions.removeBoardMember({ boardId, userId: owner.id })).ok).toBe(true);
    const rows = await t.db.select().from(schema.boardMembers);
    expect(rows).toHaveLength(1);
    expect(must(rows[0], 'row').role).toBe('owner');
    expect((await t.db.select().from(schema.activity)).map((a) => a.type)).toContain(
      'member.role_changed',
    );
  });

  it('refuses to demote the last owner', async () => {
    const { boardId } = await setupWithMember();
    actAs(owner);
    expect(await actions.updateBoardMemberRole({ boardId, userId: owner.id, role: 'member' })).toEqual({
      ok: false,
      error: 'A board needs at least one owner — make someone else an owner first.',
    });
  });

  it('a member can leave a board (unassigned from its cards); the sole owner cannot', async () => {
    const { boardId, listId } = await setupWithMember();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.assignMember({ cardId: card.id, userId: member.id })).ok).toBe(true);

    expect((await actions.leaveBoard({ boardId })).ok).toBe(false); // sole owner
    actAs(member);
    expect((await actions.leaveBoard({ boardId })).ok).toBe(true);
    expect(await t.db.select().from(schema.boardMembers)).toHaveLength(1);
    expect(await t.db.select().from(schema.cardAssignees)).toHaveLength(0);
    const left = must(
      (await t.db.select().from(schema.activity)).find((a) => a.type === 'member.removed'),
      'left row',
    );
    expect(JSON.parse(left.payload ?? 'null')).toEqual({ userId: member.id, left: true });
    actAs(outsider);
    expect((await actions.leaveBoard({ boardId })).ok).toBe(false);
  });

  it('a member can leave a project (cascading to its boards); the sole owner cannot', async () => {
    const { projectId, boardId } = await setupWithMember();
    actAs(owner);
    expect((await actions.leaveProject({ projectId })).ok).toBe(false);
    actAs(member);
    expect((await actions.leaveProject({ projectId })).ok).toBe(true);
    expect(await t.db.select().from(schema.projectMembers)).toHaveLength(1);
    expect(
      (await t.db.select().from(schema.boardMembers)).some(
        (m) => m.boardId === boardId && m.userId === member.id,
      ),
    ).toBe(false);
  });

  it('removing a project member who solely owned a board promotes the earliest remaining member', async () => {
    const { projectId, boardId } = await setupWithMember();
    // Make `member` the board's only owner, and give the board another
    // plain member to inherit it.
    const heir = { id: 'user-heir', tenantId: 'default' };
    actAs(owner);
    registerDirectoryUser({ id: heir.id, email: 'h@example.com', name: 'H' });
    expect((await actions.addProjectMember({ projectId, userId: heir.id })).ok).toBe(true);
    expect((await actions.addBoardMember({ boardId, userId: heir.id })).ok).toBe(true);
    expect(
      (await actions.updateBoardMemberRole({ boardId, userId: member.id, role: 'owner' })).ok,
    ).toBe(true);
    expect((await actions.leaveBoard({ boardId })).ok).toBe(true); // original owner steps off the board
    expect((await actions.removeProjectMember({ projectId, userId: member.id })).ok).toBe(true);
    const rows = await t.db.select().from(schema.boardMembers);
    expect(rows).toHaveLength(1);
    expect(must(rows[0], 'heir row')).toMatchObject({ userId: heir.id, role: 'owner' });
  });
});

describe('comment edit/delete, label edit, checklist edit', () => {
  const other = { id: 'user-other', tenantId: 'default' };

  async function setupCard(): Promise<{ boardId: string; cardId: string }> {
    const { projectId, boardId, listId } = await setup();
    actAs(owner);
    registerDirectoryUser({ id: other.id, email: 'o@example.com', name: 'Other' });
    expect((await actions.addProjectMember({ projectId, userId: other.id })).ok).toBe(true);
    expect((await actions.addBoardMember({ boardId, userId: other.id })).ok).toBe(true);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    harness.sentNotifications = [];
    return { boardId, cardId: card.id };
  }

  it('authors edit their own comments only; owners may delete anyone’s', async () => {
    const { cardId } = await setupCard();
    actAs(other);
    expect((await actions.addComment({ cardId, body: 'Original' })).ok).toBe(true);
    const comment = must((await t.db.select().from(schema.comments))[0], 'comment');

    actAs(owner);
    expect(await actions.updateComment({ commentId: comment.id, body: 'Hijacked' })).toEqual({
      ok: false,
      error: 'You can only edit your own comments.',
    });
    actAs(other);
    expect((await actions.updateComment({ commentId: comment.id, body: 'Edited' })).ok).toBe(true);
    const edited = must((await t.db.select().from(schema.comments))[0], 'edited');
    expect(edited.body).toBe('Edited');
    expect(edited.updatedAt).toBeGreaterThanOrEqual(edited.createdAt);

    // A reply hangs off it; deleting the parent (as the board owner —
    // moderation) cascades the reply too.
    actAs(owner);
    expect((await actions.addComment({ cardId, body: 'Reply', parentId: comment.id })).ok).toBe(true);
    expect(await t.db.select().from(schema.comments)).toHaveLength(2);
    expect((await actions.deleteComment({ commentId: comment.id })).ok).toBe(true);
    expect(await t.db.select().from(schema.comments)).toHaveLength(0);
    const types = (await t.db.select().from(schema.activity)).map((a) => a.type);
    expect(types).toContain('comment.edited');
    expect(types).toContain('comment.deleted');
  });

  it('a plain member cannot delete someone else’s comment', async () => {
    const { cardId } = await setupCard();
    actAs(owner);
    expect((await actions.addComment({ cardId, body: 'Owner says' })).ok).toBe(true);
    const comment = must((await t.db.select().from(schema.comments))[0], 'comment');
    actAs(other);
    expect(await actions.deleteComment({ commentId: comment.id })).toEqual({
      ok: false,
      error: 'You can only delete your own comments.',
    });
    expect(await t.db.select().from(schema.comments)).toHaveLength(1);
  });

  it('notifies earlier commenters on a new top-level comment, once each', async () => {
    const { cardId } = await setupCard();
    actAs(other);
    expect((await actions.addComment({ cardId, body: 'First' })).ok).toBe(true);
    harness.sentNotifications = [];
    actAs(owner);
    expect((await actions.addComment({ cardId, body: 'Second' })).ok).toBe(true);
    expect(harness.sentNotifications).toHaveLength(1);
    expect(must(harness.sentNotifications[0], 'n')).toMatchObject({
      recipientUserId: other.id,
      title: 'New comment on a card you commented on',
    });
    // The commenter themselves never gets one, even with earlier comments.
    harness.sentNotifications = [];
    expect((await actions.addComment({ cardId, body: 'Third' })).ok).toBe(true);
    expect(harness.sentNotifications.map((n) => n.recipientUserId)).toEqual([other.id]);
  });

  it('renames and recolors a label; rejects a non-curated colour', async () => {
    const { boardId } = await setupCard();
    actAs(owner);
    expect((await actions.createLabel({ boardId, name: 'Bug', color: 'clay' })).ok).toBe(true);
    const label = must((await t.db.select().from(schema.labels))[0], 'label');
    expect(await actions.updateLabel({ labelId: label.id, color: '#ff0000' })).toEqual({
      ok: false,
      error: 'Pick a color for the label.',
    });
    expect((await actions.updateLabel({ labelId: label.id, name: 'Defect', color: 'ink' })).ok).toBe(
      true,
    );
    expect(must((await t.db.select().from(schema.labels))[0], 'label')).toMatchObject({
      name: 'Defect',
      color: 'ink',
    });
    actAs(outsider);
    expect((await actions.updateLabel({ labelId: label.id, name: 'X' })).ok).toBe(false);
  });

  it('edits a checklist item’s text and logs a reorder', async () => {
    const { cardId } = await setupCard();
    actAs(owner);
    expect((await actions.createChecklistItem({ cardId, text: 'A' })).ok).toBe(true);
    expect((await actions.createChecklistItem({ cardId, text: 'B' })).ok).toBe(true);
    const item = must(
      (await t.db.select().from(schema.checklistItems)).find((i) => i.text === 'A'),
      'item',
    );
    expect((await actions.updateChecklistItem({ itemId: item.id, text: 'A2' })).ok).toBe(true);
    expect(
      (await t.db.select().from(schema.checklistItems)).find((i) => i.id === item.id)?.text,
    ).toBe('A2');
    const before = (await t.db.select().from(schema.activity)).length;
    expect((await actions.moveChecklistItem({ itemId: item.id, direction: 'down' })).ok).toBe(true);
    expect((await t.db.select().from(schema.activity)).length).toBe(before + 1);
  });
});

describe('board data aggregates and board activity', () => {
  it('counts assignees, checklist progress, and comments per card via aggregates', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'C1' })).ok).toBe(true);
    const card = must((await t.db.select().from(schema.cards))[0], 'card');
    expect((await actions.assignMember({ cardId: card.id, userId: owner.id })).ok).toBe(true);
    expect((await actions.createChecklistItem({ cardId: card.id, text: 'a' })).ok).toBe(true);
    expect((await actions.createChecklistItem({ cardId: card.id, text: 'b' })).ok).toBe(true);
    const item = must((await t.db.select().from(schema.checklistItems))[0], 'item');
    expect((await actions.toggleChecklistItem({ itemId: item.id, done: true })).ok).toBe(true);
    expect((await actions.addComment({ cardId: card.id, body: 'one' })).ok).toBe(true);
    expect((await actions.addComment({ cardId: card.id, body: 'two' })).ok).toBe(true);

    const { getBoardData } = await import('../_lib/queries');
    const board = await getBoardData(t.db, boardId, { userId: owner.id, tenantId: 'default' });
    expect(must(board?.cards[0], 'summary')).toMatchObject({
      assigneeCount: 1,
      checklistDone: 1,
      checklistTotal: 2,
      commentCount: 2,
    });
    expect(board?.canManage).toBe(true);
    expect(board?.visibility).toBe('public');
  });

  it('pages the board feed newest-first with card titles resolved', async () => {
    const { boardId, listId } = await setup();
    actAs(owner);
    expect((await actions.createCard({ listId, title: 'Titled' })).ok).toBe(true);
    const feed = await actions.getBoardActivity({ boardId });
    if (!feed.ok) throw new Error(feed.error);
    expect(feed.items[0]).toMatchObject({ type: 'card.created', cardTitle: 'Titled' });
    expect(feed.items.map((i) => i.type)).toEqual(['card.created', 'list.created', 'board.created']);
    expect(feed.nextCursor).toBeNull();
    expect(feed.items.every((i) => typeof i.createdAt === 'number')).toBe(true);
  });
});
