/**
 * Sovereign Kanban — Postgres migration-twin schema.
 *
 * Exists ONLY to drive `drizzle-kit generate --dialect postgresql`;
 * application code never imports it — queries always go through
 * `./schema.ts` (sqlite-core), whose column serialization this file must
 * match exactly: plain `integer` for booleans and timestamps (never native
 * `boolean`/`bigint`), `doublePrecision` for REAL positions. Keep every
 * table/column/index structurally identical to ./schema.ts.
 *
 * After regenerating Postgres migrations, strip any
 * `REFERENCES "public"."..."` schema qualifier down to an unqualified
 * `REFERENCES "..."` — plugin tables live in `plugin_<slug>` reached via
 * search_path, and the qualified form fails at migration time. See
 * docs/plugin-database.md "Foreign keys in a Postgres schema".
 */
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const projects = pgTable(
  'kanban_projects',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_projects_tenant_idx').on(t.tenantId)],
);

export const boards = pgTable(
  'kanban_boards',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_boards_project_idx').on(t.projectId)],
);

export const boardMembers = pgTable(
  'kanban_board_members',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    role: text('role').notNull(),
    addedBy: text('added_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    index('kanban_board_members_user_idx').on(t.userId),
  ],
);

export const lists = pgTable(
  'kanban_lists',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: doublePrecision('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_lists_board_position_idx').on(t.boardId, t.position)],
);

export const cards = pgTable(
  'kanban_cards',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    dueDate: integer('due_date'),
    position: doublePrecision('position').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('kanban_cards_board_idx').on(t.boardId),
    index('kanban_cards_list_position_idx').on(t.listId, t.position),
  ],
);

export const labels = pgTable(
  'kanban_labels',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_labels_board_idx').on(t.boardId)],
);

export const cardLabels = pgTable(
  'kanban_card_labels',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.labelId] })],
);

export const cardAssignees = pgTable(
  'kanban_card_assignees',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    assignedBy: text('assigned_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.userId] }),
    index('kanban_card_assignees_user_idx').on(t.userId),
  ],
);

export const checklistItems = pgTable(
  'kanban_checklist_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: integer('done').notNull().default(0),
    position: doublePrecision('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_checklist_items_card_position_idx').on(t.cardId, t.position)],
);

export const comments = pgTable(
  'kanban_comments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_comments_card_idx').on(t.cardId)],
);

export const activity = pgTable(
  'kanban_activity',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').notNull(),
    type: text('type').notNull(),
    payload: text('payload'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('kanban_activity_board_created_idx').on(t.boardId, t.createdAt),
    index('kanban_activity_card_idx').on(t.cardId),
  ],
);
