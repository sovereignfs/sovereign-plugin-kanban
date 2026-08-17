import { sdk } from '@sovereignfs/sdk';
import type { KanbanDb } from '../_db/client';

/** This plugin's isolated database, typed for the kanban schema. */
export async function getDb(): Promise<KanbanDb> {
  return (await sdk.db.getClient()) as KanbanDb;
}
