/**
 * Applies the real generated SQLite migrations (migrations/sqlite/, via
 * Drizzle's own migrator — journal and all) to an in-memory database, then
 * exercises the schema through ../schema.ts: seed data, ordering, FK
 * cascades, and the one-level comment-reply model. This is the same
 * migration path the platform runs at startup, so a malformed journal or SQL
 * file fails here first.
 */
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedDemoData, SEED_PROJECT_ID, type KanbanDb } from '../seed';
import * as schema from '../schema';
import { createTestDb, type TestDb } from './test-db';

const ctx = { tenantId: 'tenant-1', userId: 'user-1' };

/** Narrow a possibly-undefined row (noUncheckedIndexedAccess) with a hard failure. */
function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`expected ${label} to exist`);
  return value;
}

let t: TestDb;
let db: TestDb['db'];

beforeEach(async () => {
  t = await createTestDb();
  db = t.db;
});

afterEach(() => {
  t.close();
});

describe('kanban schema (real migrations, in-memory sqlite)', () => {
  it('applies the migration folder cleanly and creates every table', async () => {
    const res = await t.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'kanban_%'",
    );
    const tables = res.rows.map((r) => String(r.name)).sort();
    expect(tables).toEqual([
      'kanban_activity',
      'kanban_board_members',
      'kanban_boards',
      'kanban_card_assignees',
      'kanban_card_labels',
      'kanban_cards',
      'kanban_checklist_items',
      'kanban_comments',
      'kanban_inbox_state',
      'kanban_labels',
      'kanban_lists',
      'kanban_project_members',
      'kanban_projects',
    ]);
  });

  it('seeds demo data idempotently', async () => {
    expect(await seedDemoData(db as unknown as KanbanDb, ctx)).toBe(true);
    expect(await seedDemoData(db as unknown as KanbanDb, ctx)).toBe(false);

    const projects = await db.select().from(schema.projects);
    expect(projects).toHaveLength(1);
    expect(must(projects[0], 'seed project').id).toBe(SEED_PROJECT_ID);

    const lists = await db
      .select()
      .from(schema.lists)
      .orderBy(asc(schema.lists.position));
    expect(lists.map((l) => l.name)).toEqual(['To Do', 'In Progress', 'Done']);

    const cards = await db.select().from(schema.cards);
    expect(cards).toHaveLength(5);
    // Every card carries its board id, not just its list id.
    expect(new Set(cards.map((c) => c.boardId)).size).toBe(1);

    const members = await db.select().from(schema.boardMembers);
    expect(members).toEqual([
      expect.objectContaining({ userId: ctx.userId, role: 'owner' }),
    ]);
  });

  it('cascades a board delete through lists, cards, and card children', async () => {
    await seedDemoData(db as unknown as KanbanDb, ctx);
    const board = must((await db.select().from(schema.boards))[0], 'seed board');
    const card = must((await db.select().from(schema.cards))[0], 'seed card');
    const now = Date.now();

    await db.insert(schema.checklistItems).values({
      id: 'chk-1',
      tenantId: ctx.tenantId,
      cardId: card.id,
      text: 'a checklist item',
      position: 1024,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.activity).values({
      id: 'act-1',
      tenantId: ctx.tenantId,
      cardId: card.id,
      boardId: board.id,
      actorId: ctx.userId,
      type: 'card.created',
      createdAt: now,
    });

    await db.delete(schema.boards).where(eq(schema.boards.id, board.id));

    expect(await db.select().from(schema.lists)).toHaveLength(0);
    expect(await db.select().from(schema.cards)).toHaveLength(0);
    expect(await db.select().from(schema.checklistItems)).toHaveLength(0);
    expect(await db.select().from(schema.activity)).toHaveLength(0);
    expect(await db.select().from(schema.boardMembers)).toHaveLength(0);
    // The project itself survives — boards cascade down, not up.
    expect(await db.select().from(schema.projects)).toHaveLength(1);
  });

  it('supports one-level comment replies and cascades reply deletion', async () => {
    await seedDemoData(db as unknown as KanbanDb, ctx);
    const card = must((await db.select().from(schema.cards))[0], 'seed card');
    const now = Date.now();
    const base = {
      tenantId: ctx.tenantId,
      cardId: card.id,
      authorId: ctx.userId,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.comments).values({ ...base, id: 'c-1', body: 'top level' });
    await db
      .insert(schema.comments)
      .values({ ...base, id: 'c-2', parentId: 'c-1', body: 'a reply' });

    const replies = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.parentId, 'c-1'));
    expect(replies).toHaveLength(1);

    // Deleting the parent removes the reply via the self-referencing FK.
    await db.delete(schema.comments).where(eq(schema.comments.id, 'c-1'));
    expect(await db.select().from(schema.comments)).toHaveLength(0);
  });

  it('rejects a card pointing at a missing list (FK enforced)', async () => {
    await seedDemoData(db as unknown as KanbanDb, ctx);
    const board = must((await db.select().from(schema.boards))[0], 'seed board');
    const now = Date.now();
    // Drizzle wraps the driver error ("Failed query: …") with the SQLite
    // FOREIGN KEY violation as its cause — assert on the whole chain.
    const orphanInsert = db.insert(schema.cards).values({
      id: 'bad-card',
      tenantId: ctx.tenantId,
      boardId: board.id,
      listId: 'no-such-list',
      title: 'orphan',
      position: 1024,
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
    });
    const error = await orphanInsert.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    const chain = [error, (error as { cause?: unknown }).cause]
      .map((e) => String((e as Error | undefined)?.message ?? ''))
      .join(' | ');
    expect(chain).toMatch(/FOREIGN KEY/i);
  });
});
