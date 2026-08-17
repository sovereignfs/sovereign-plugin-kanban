/**
 * Dev seed — a demo project/board/lists/cards for local development.
 *
 * Pure data-layer helper: takes any Drizzle client bound to this plugin's
 * schema (the SDK boundary forbids reaching into `@sovereignfs/db` from
 * plugin code, so acquiring the client is the caller's job — a dev-gated
 * server action, or the in-memory test DB). Idempotent: no-ops when the
 * seed project already exists.
 */
import { eq } from 'drizzle-orm';
import type { KanbanDb } from './client';
import { positionAfter } from './position';
import * as schema from './schema';

export type { KanbanDb } from './client';

export const SEED_PROJECT_ID = 'seed-project-demo';

export interface SeedContext {
  tenantId: string;
  userId: string;
}

export async function seedDemoData(db: KanbanDb, ctx: SeedContext): Promise<boolean> {
  const existing = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, SEED_PROJECT_ID));
  if (existing.length > 0) return false;

  const now = Date.now();
  const base = { tenantId: ctx.tenantId, createdAt: now, updatedAt: now };

  await db.insert(schema.projects).values({
    ...base,
    id: SEED_PROJECT_ID,
    name: 'Demo Project',
    description: 'Seeded demo data — safe to delete.',
    createdBy: ctx.userId,
  });

  const boardId = 'seed-board-demo';
  await db.insert(schema.boards).values({
    ...base,
    id: boardId,
    projectId: SEED_PROJECT_ID,
    name: 'Demo Board',
    color: 'sky',
    createdBy: ctx.userId,
  });

  await db.insert(schema.boardMembers).values({
    boardId,
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    role: 'owner',
    addedBy: ctx.userId,
    createdAt: now,
  });

  const listNames = ['To Do', 'In Progress', 'Done'];
  let listPosition: number | undefined;
  const listIds: string[] = [];
  for (const [i, name] of listNames.entries()) {
    const id = `seed-list-${i}`;
    listPosition = positionAfter(listPosition);
    listIds.push(id);
    await db.insert(schema.lists).values({
      ...base,
      id,
      boardId,
      name,
      position: listPosition,
    });
  }

  const cardsByList: Array<[number, string[]]> = [
    [0, ['Sketch the board layout', 'Write the data model', 'Pick label colors']],
    [1, ['Wire up drag-and-drop']],
    [2, ['Decide on the plugin name']],
  ];
  for (const [listIndex, titles] of cardsByList) {
    const listId = listIds[listIndex];
    if (listId === undefined) throw new Error(`seed: no list at index ${listIndex}`);
    let cardPosition: number | undefined;
    for (const [i, title] of titles.entries()) {
      cardPosition = positionAfter(cardPosition);
      await db.insert(schema.cards).values({
        ...base,
        id: `seed-card-${listIndex}-${i}`,
        boardId,
        listId,
        title,
        position: cardPosition,
        createdBy: ctx.userId,
      });
    }
  }

  return true;
}
