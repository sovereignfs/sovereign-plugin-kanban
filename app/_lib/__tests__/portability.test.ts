/**
 * `deleteAllKanbanData` (account-deletion cascade) tests. Runs against the
 * real generated migrations on an ephemeral libsql DB (production client
 * semantics — see `createTestDb`'s own doc comment), matching this repo's
 * established convention (`app/__tests__/actions.test.ts`) rather than a
 * hand-rolled fake, since the handler's own correctness depends on the
 * real FK `onDelete: 'cascade'` behavior defined in `schema.ts`.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeletionContext } from '@sovereignfs/sdk';
import { createTestDb, type TestDb } from '../../_db/__tests__/test-db';
import * as schema from '../../_db/schema';

const capturedDeleter = {
  fn: null as ((ctx: DeletionContext) => Promise<{ deleted: number; errors?: string[] }>) | null,
};

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    portability: {
      provideDelete: vi.fn(async (fn: typeof capturedDeleter.fn) => {
        capturedDeleter.fn = fn;
      }),
    },
  },
}));

const TENANT = 't1';
let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(() => {
  t.close();
});

async function seedProject(
  id: string,
  ownerIds: [string, ...string[]],
  memberIds: string[] = [],
): Promise<void> {
  const [firstOwnerId] = ownerIds;
  await t.db.insert(schema.projects).values({
    id,
    tenantId: TENANT,
    name: id,
    createdBy: firstOwnerId,
    createdAt: 1,
    updatedAt: 1,
  });
  let joinedAt = 1;
  for (const userId of ownerIds) {
    await t.db.insert(schema.projectMembers).values({
      projectId: id,
      userId,
      tenantId: TENANT,
      role: 'owner',
      addedBy: firstOwnerId,
      createdAt: joinedAt++,
    });
  }
  for (const userId of memberIds) {
    await t.db.insert(schema.projectMembers).values({
      projectId: id,
      userId,
      tenantId: TENANT,
      role: 'member',
      addedBy: firstOwnerId,
      createdAt: joinedAt++,
    });
  }
}

async function seedBoard(
  id: string,
  projectId: string,
  ownerId: string,
  memberIds: string[] = [],
): Promise<void> {
  await t.db.insert(schema.boards).values({
    id,
    tenantId: TENANT,
    projectId,
    name: id,
    color: 'grey',
    createdBy: ownerId,
    createdAt: 1,
    updatedAt: 1,
  });
  let joinedAt = 1;
  await t.db.insert(schema.boardMembers).values({
    boardId: id,
    userId: ownerId,
    tenantId: TENANT,
    role: 'owner',
    addedBy: ownerId,
    createdAt: joinedAt++,
  });
  for (const userId of memberIds) {
    await t.db.insert(schema.boardMembers).values({
      boardId: id,
      userId,
      tenantId: TENANT,
      role: 'member',
      addedBy: ownerId,
      createdAt: joinedAt++,
    });
  }
}

describe('boards', () => {
  it("removes a plain member's own access and card assignments, leaving the board and other members untouched", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await seedProject('proj-1', ['owner']);
    await seedBoard('board-1', 'proj-1', 'owner', ['departing']);
    await t.db.insert(schema.lists).values({
      id: 'list-1',
      tenantId: TENANT,
      boardId: 'board-1',
      name: 'To Do',
      position: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await t.db.insert(schema.cards).values({
      id: 'card-1',
      tenantId: TENANT,
      boardId: 'board-1',
      listId: 'list-1',
      title: 'A card',
      position: 1,
      createdBy: 'owner',
      createdAt: 1,
      updatedAt: 1,
    });
    await t.db.insert(schema.cardAssignees).values({
      cardId: 'card-1',
      userId: 'departing',
      tenantId: TENANT,
      assignedBy: 'owner',
      createdAt: 1,
    });

    const result = await capturedDeleter.fn?.({ userId: 'departing', tenantId: TENANT, db: t.db });

    expect(await t.db.select().from(schema.boards)).toHaveLength(1);
    expect(
      await t.db
        .select()
        .from(schema.boardMembers)
        .where(eq(schema.boardMembers.boardId, 'board-1')),
    ).toEqual([expect.objectContaining({ userId: 'owner', role: 'owner' })]);
    expect(await t.db.select().from(schema.cardAssignees)).toEqual([]);
    expect(result?.deleted).toBeGreaterThan(0);
  });

  it('transfers ownership to a remaining member and cleans up the departing owner’s own assignments', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await seedProject('proj-1', ['departing']);
    await seedBoard('board-1', 'proj-1', 'departing', ['successor']);
    await t.db.insert(schema.lists).values({
      id: 'list-1',
      tenantId: TENANT,
      boardId: 'board-1',
      name: 'To Do',
      position: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await t.db.insert(schema.cards).values({
      id: 'card-1',
      tenantId: TENANT,
      boardId: 'board-1',
      listId: 'list-1',
      title: 'A card',
      position: 1,
      createdBy: 'departing',
      createdAt: 1,
      updatedAt: 1,
    });
    await t.db.insert(schema.cardAssignees).values({
      cardId: 'card-1',
      userId: 'departing',
      tenantId: TENANT,
      assignedBy: 'departing',
      createdAt: 1,
    });

    await capturedDeleter.fn?.({ userId: 'departing', tenantId: TENANT, db: t.db });

    expect(await t.db.select().from(schema.boards)).toHaveLength(1);
    const members = await t.db
      .select()
      .from(schema.boardMembers)
      .where(eq(schema.boardMembers.boardId, 'board-1'));
    expect(members).toEqual([expect.objectContaining({ userId: 'successor', role: 'owner' })]);
    expect(await t.db.select().from(schema.cardAssignees)).toEqual([]);
    // The card itself survives untouched — only the departing user's own assignment is dropped.
    expect(await t.db.select().from(schema.cards)).toHaveLength(1);
  });

  it('hard-deletes a board with no remaining member, cascading its lists/cards/assignees', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await seedProject('proj-1', ['departing']);
    await seedBoard('board-1', 'proj-1', 'departing');
    await t.db.insert(schema.lists).values({
      id: 'list-1',
      tenantId: TENANT,
      boardId: 'board-1',
      name: 'To Do',
      position: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await t.db.insert(schema.cards).values({
      id: 'card-1',
      tenantId: TENANT,
      boardId: 'board-1',
      listId: 'list-1',
      title: 'A card',
      position: 1,
      createdBy: 'departing',
      createdAt: 1,
      updatedAt: 1,
    });

    const result = await capturedDeleter.fn?.({ userId: 'departing', tenantId: TENANT, db: t.db });

    expect(await t.db.select().from(schema.boards)).toEqual([]);
    expect(await t.db.select().from(schema.lists)).toEqual([]);
    expect(await t.db.select().from(schema.cards)).toEqual([]);
    expect(await t.db.select().from(schema.boardMembers)).toEqual([]);
    expect(result?.deleted).toBeGreaterThan(0);
  });
});

describe('projects', () => {
  it('removes a plain member without touching the project or its boards', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await seedProject('proj-1', ['owner'], ['departing']);

    await capturedDeleter.fn?.({ userId: 'departing', tenantId: TENANT, db: t.db });

    expect(await t.db.select().from(schema.projects)).toHaveLength(1);
    expect(
      await t.db
        .select()
        .from(schema.projectMembers)
        .where(eq(schema.projectMembers.projectId, 'proj-1')),
    ).toEqual([expect.objectContaining({ userId: 'owner', role: 'owner' })]);
  });

  it('removes a departing owner with no promotion needed when a co-owner remains', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await seedProject('proj-1', ['departing', 'co-owner']);

    await capturedDeleter.fn?.({ userId: 'departing', tenantId: TENANT, db: t.db });

    const members = await t.db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, 'proj-1'));
    expect(members).toEqual([expect.objectContaining({ userId: 'co-owner', role: 'owner' })]);
  });

  it('promotes the earliest-joined member when the last owner departs and non-owner members remain', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await seedProject('proj-1', ['departing'], ['later-member', 'earlier-member']);
    // seedProject assigns createdAt in insertion order — reorder so
    // 'earlier-member' really does have the smaller timestamp.
    await t.db
      .update(schema.projectMembers)
      .set({ createdAt: 5 })
      .where(
        and(
          eq(schema.projectMembers.projectId, 'proj-1'),
          eq(schema.projectMembers.userId, 'later-member'),
        ),
      );
    await t.db
      .update(schema.projectMembers)
      .set({ createdAt: 2 })
      .where(
        and(
          eq(schema.projectMembers.projectId, 'proj-1'),
          eq(schema.projectMembers.userId, 'earlier-member'),
        ),
      );

    await capturedDeleter.fn?.({ userId: 'departing', tenantId: TENANT, db: t.db });

    const members = await t.db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, 'proj-1'));
    expect(members.find((m) => m.userId === 'earlier-member')).toMatchObject({ role: 'owner' });
    expect(members.find((m) => m.userId === 'later-member')).toMatchObject({ role: 'member' });
  });

  it("promotes a board's independent owner into the project instead of cascading, when that person has no project-level membership at all", async () => {
    // Reproduces the structural risk `removeProjectMember` documents:
    // board membership is never stripped by a project-membership removal,
    // so 'board-owner' can hold real board ownership under a project they
    // aren't a member of at all.
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await seedProject('proj-1', ['departing']);
    await seedBoard('board-1', 'proj-1', 'board-owner');

    const result = await capturedDeleter.fn?.({ userId: 'departing', tenantId: TENANT, db: t.db });

    expect(await t.db.select().from(schema.projects)).toHaveLength(1);
    expect(await t.db.select().from(schema.boards)).toHaveLength(1);
    const projectMembers = await t.db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, 'proj-1'));
    expect(projectMembers).toEqual([
      expect.objectContaining({ userId: 'board-owner', role: 'owner' }),
    ]);
    expect(result?.deleted).toBeGreaterThan(0);
  });

  it('hard-deletes a project with no member and no independently-owned board left, cascading its boards', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await seedProject('proj-1', ['departing']);
    await seedBoard('board-1', 'proj-1', 'departing');

    await capturedDeleter.fn?.({ userId: 'departing', tenantId: TENANT, db: t.db });

    expect(await t.db.select().from(schema.projects)).toEqual([]);
    expect(await t.db.select().from(schema.boards)).toEqual([]);
  });
});

describe('inbox state', () => {
  it("removes the user's own inbox-read-state row without touching another user's", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await t.db
      .insert(schema.inboxState)
      .values({ userId: 'departing', tenantId: TENANT, lastSeenAt: 1 });
    await t.db
      .insert(schema.inboxState)
      .values({ userId: 'other', tenantId: TENANT, lastSeenAt: 1 });

    await capturedDeleter.fn?.({ userId: 'departing', tenantId: TENANT, db: t.db });

    expect(await t.db.select().from(schema.inboxState)).toEqual([
      expect.objectContaining({ userId: 'other' }),
    ]);
  });
});
