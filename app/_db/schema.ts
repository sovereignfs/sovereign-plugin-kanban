/**
 * Sovereign Kanban — Drizzle schema (SQLite).
 *
 * Application code queries through this file on both dialects — the query
 * builder is bound to the client connection, not the table object. The
 * Postgres twin (`schema.postgres.ts`) exists only to drive
 * `drizzle-kit generate --dialect postgresql`; keep the two structurally
 * identical, and keep Postgres column types serialization-compatible with
 * these (plain integer for booleans/timestamps — never native
 * boolean/bigint). See docs/plugin-database.md.
 *
 * Conventions:
 * - ids are caller-generated text (nanoid).
 * - timestamps are Unix milliseconds (integer).
 * - `position` is a fractional REAL — see ./position.ts.
 * - `tenant_id` on every table (multi-tenancy readiness).
 */
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'kanban_projects',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdBy: text('created_by').notNull(),
    /**
     * 'public' | 'private' (Phase 2, K.17). Enforced in the data layer, not
     * the schema. 'public': a board's own `visibility` governs who among
     * project members can view it. 'private': overrides every board's own
     * flag — only that board's own members and the project's owners can
     * view any board in the project. See CONCEPT.md's "Phase 2" section.
     */
    visibility: text('visibility').notNull().default('public'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_projects_tenant_idx').on(t.tenantId)],
);

export const boards = sqliteTable(
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
    /**
     * 'public' | 'private' (Phase 2, K.17). Only consulted when the parent
     * project is 'public' — a 'private' project overrides this regardless
     * of value. 'public': any project member can view (read-only unless
     * also an explicit board member). 'private': only this board's own
     * members and the project's owners can view it.
     */
    visibility: text('visibility').notNull().default('public'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_boards_project_idx').on(t.projectId)],
);

export const boardMembers = sqliteTable(
  'kanban_board_members',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** 'owner' | 'member' — enforced in the data layer, not the schema. */
    role: text('role').notNull(),
    addedBy: text('added_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    index('kanban_board_members_user_idx').on(t.userId),
  ],
);

/**
 * Project-level membership (Phase 2, K.17) — sits above `boardMembers`, not
 * a replacement for it. A project supports multiple 'owner' rows (unlike
 * the single `projects.createdBy` field, which stays a historical "who
 * created this" marker; ownership authority lives here). Board-add UI
 * (K.20) sources its candidate list from this table, never a fresh
 * directory search — someone must be a project member before they can be
 * added to any of its boards. See CONCEPT.md's "Phase 2" section.
 */
export const projectMembers = sqliteTable(
  'kanban_project_members',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** 'owner' | 'member' — enforced in the data layer, not the schema. */
    role: text('role').notNull(),
    addedBy: text('added_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('kanban_project_members_user_idx').on(t.userId),
  ],
);

export const lists = sqliteTable(
  'kanban_lists',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: real('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_lists_board_position_idx').on(t.boardId, t.position)],
);

export const cards = sqliteTable(
  'kanban_cards',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Denormalized alongside listId so board-level queries never join through lists. */
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    /** Unix ms, nullable. */
    dueDate: integer('due_date'),
    position: real('position').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('kanban_cards_board_idx').on(t.boardId),
    index('kanban_cards_list_position_idx').on(t.listId, t.position),
  ],
);

export const labels = sqliteTable(
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

export const cardLabels = sqliteTable(
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

export const cardAssignees = sqliteTable(
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

export const checklistItems = sqliteTable(
  'kanban_checklist_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    /** 0 | 1 — plain integer, never a native boolean (dialect portability). */
    done: integer('done').notNull().default(0),
    position: real('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('kanban_checklist_items_card_position_idx').on(t.cardId, t.position)],
);

export const comments = sqliteTable(
  'kanban_comments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /** Null for a top-level comment; a comment id for a reply (one level only). */
    parentId: text('parent_id').references((): AnySQLiteColumn => comments.id, {
      onDelete: 'cascade',
    }),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('kanban_comments_card_idx').on(t.cardId),
    // Support the Inbox's "replies to my comments" query (K.11 redesign):
    // author_idx finds the actor's own comments, parent_idx then finds
    // replies to those ids — both sides of that self-join need an index or
    // it degrades to a full table scan.
    index('kanban_comments_author_idx').on(t.authorId),
    index('kanban_comments_parent_idx').on(t.parentId),
  ],
);

export const activity = sqliteTable(
  'kanban_activity',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /**
     * Null for board-level events (e.g. membership changes). `set null`, not
     * cascade: activity is an audit trail — deleting a card must detach its
     * history into the board feed, never erase it. (Board deletion still
     * cascades: the whole feed belongs to the board.)
     */
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').notNull(),
    type: text('type').notNull(),
    /** JSON-encoded event details. */
    payload: text('payload'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('kanban_activity_board_created_idx').on(t.boardId, t.createdAt),
    index('kanban_activity_card_idx').on(t.cardId),
  ],
);

/**
 * K.11 Inbox read/unread — one row per user, updated on every Inbox visit.
 * Deliberately global, not per-board: the Inbox aggregates activity across
 * every board the user belongs to, so "seen" is a single timestamp, not a
 * per-board or per-activity-row read state (SPEC: "lightweight — a
 * last_seen_at per user is enough; no per-row read state in Phase 1").
 */
export const inboxState = sqliteTable('kanban_inbox_state', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  /** Null until the user's first Inbox visit. */
  lastSeenAt: integer('last_seen_at'),
});
