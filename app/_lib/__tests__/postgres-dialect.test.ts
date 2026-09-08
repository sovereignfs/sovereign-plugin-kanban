/**
 * Compile-only regression coverage for a real production bug (found live,
 * after this plugin was deployed against Postgres — see `queries.ts`'s
 * `repliesToActor` doc comment for the full root-cause writeup): a self-join
 * built with `alias(schema.comments, 'parent')` compiled to correct SQL on
 * SQLite but silently dropped its `AS` clause on Postgres, producing
 * `inner join "parent" on ...` — a reference to a table named literally
 * "parent" that doesn't exist (error 42P01). Every other query in this file
 * runs against the real generated migrations on ephemeral libsql
 * (`_db/__tests__/test-db.ts`), which is exactly why this class of bug is
 * invisible to the rest of the suite — this repo has no Postgres test
 * harness (`docs/plugin-database.md`).
 *
 * This doesn't need one either: `drizzle-orm`'s `PgDialect`/`.toSQL()` can
 * compile a query builder to its final SQL text with no live connection at
 * all (`drizzle.mock()` from `drizzle-orm/node-postgres` builds a
 * dialect-bound `db` that never opens a socket). That's enough to assert
 * the query is syntactically sound Postgres and, specifically, that it
 * never regresses to referencing a bare, unqualified alias.
 *
 * `repliesToActor` is typed to take a `KanbanDb` (the sqlite-core-typed
 * client every other call site uses), but this plugin's whole cross-dialect
 * strategy rests on the query builder being bound to its *connection*, not
 * to the table objects passed to it (`docs/plugin-database.md`) — so a
 * Postgres-dialect `db` duck-types through the same call just as
 * `sdk.db.getClient()`'s real Postgres client does in production. The cast
 * below is that same trusted duck-typing, made explicit for a test.
 */
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { KanbanDb } from '../../_db/client';
import { repliesToActor } from '../queries';

const pgDb = drizzle.mock() as unknown as KanbanDb;

describe('repliesToActor — compiled against the real Postgres dialect', () => {
  it('never joins a bare, unqualified alias — the exact shape of the production bug', () => {
    const { sql } = repliesToActor(pgDb, { userId: 'u1', tenantId: 'default' }, 100).toSQL();
    expect(sql).not.toMatch(/join\s+"?parent"?\s/i);
    expect(sql).not.toContain('join "parent"');
  });

  it('compiles to a scalar IN (subquery) against kanban_comments, correctly scoped by author and tenant', () => {
    const { sql, params } = repliesToActor(pgDb, { userId: 'u1', tenantId: 'default' }, 100).toSQL();
    expect(sql).toBe(
      'select "id", "card_id", "author_id", "created_at" from "kanban_comments" ' +
        'where ("kanban_comments"."parent_id" in ' +
        '(select "id" from "kanban_comments" where ' +
        '("kanban_comments"."author_id" = $1 and "kanban_comments"."tenant_id" = $2)) ' +
        'and "kanban_comments"."author_id" <> $3) ' +
        'order by "kanban_comments"."created_at" desc limit $4',
    );
    expect(params).toEqual(['u1', 'default', 'u1', 100]);
  });

  it('parameterizes the actor id and limit rather than a fixed shape, for a different actor/limit', () => {
    const { params } = repliesToActor(pgDb, { userId: 'someone-else', tenantId: 'acme' }, 1).toSQL();
    expect(params).toEqual(['someone-else', 'acme', 'someone-else', 1]);
  });
});
