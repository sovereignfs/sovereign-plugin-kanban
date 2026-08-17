/**
 * Ephemeral test database matching production client semantics: the runtime
 * hands isolated plugins an async libsql-backed Drizzle client, so tests use
 * the same driver — notably its `transaction()` behavior, which the sync
 * better-sqlite3 driver does not share. Applies the real generated
 * migrations (journal and all), exactly the path the platform runs at
 * startup.
 *
 * A temp *file* rather than `:memory:`, deliberately: @libsql/client's
 * sqlite3 flavour opens a fresh connection for each interactive
 * `transaction()`, and every `:memory:` connection is its own brand-new
 * empty database — verified empirically here: after `db.transaction()` on a
 * `:memory:` client, previously-migrated tables are simply gone. A file URL
 * gives all connections the same database.
 */
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KanbanDb } from '../client';

const migrationsFolder = fileURLToPath(new URL('../../../migrations/sqlite', import.meta.url));

export interface TestDb {
  db: LibSQLDatabase;
  kanban: KanbanDb;
  client: Client;
  close: () => void;
}

export async function createTestDb(): Promise<TestDb> {
  const file = join(tmpdir(), `kanban-test-${randomUUID()}.db`);
  const client = createClient({ url: `file:${file}` });
  await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });
  return {
    db,
    kanban: db as unknown as KanbanDb,
    client,
    close: () => {
      client.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
    },
  };
}
