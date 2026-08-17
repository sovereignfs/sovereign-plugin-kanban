import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/**
 * The shape of this plugin's database client. `sdk.db.getClient()` returns
 * `unknown` by contract (the SDK takes no dependency on a dialect's Drizzle
 * types); plugin code casts to this. The runtime hands isolated plugins an
 * async client (libsql on SQLite instances, node-postgres on Postgres —
 * both query correctly through the sqlite-core schema, see
 * docs/plugin-database.md), so the async variant is the honest type.
 */
export type KanbanDb = BaseSQLiteDatabase<'async', unknown>;

/** The transaction handle KanbanDb.transaction() passes to its callback. */
export type KanbanTx = Parameters<Parameters<KanbanDb['transaction']>[0]>[0];
