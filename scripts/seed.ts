/**
 * Dev seed script — populates this plugin's isolated dev database with
 * realistic sample data covering (as close to) every UI scenario as one
 * seed run reasonably can: owned vs. shared projects, boards with varying
 * member/label/list counts, and cards spanning every combination of
 * description / due date (overdue, due today, upcoming) / labels /
 * checklist (0%, partial, 100%) / single & multiple assignees / comments
 * (top-level and one-level replies, multiple authors) / a long title (wrap
 * test) / a "kitchen sink" card with everything at once — plus enough
 * board- and card-level activity to give the Inbox feed real, varied,
 * unseen content.
 *
 * Requires `pnpm sv seed` to have already been run once from the monorepo
 * root — this script assigns cards to, and shares boards with, the four
 * well-known dev accounts that creates (looked up by email, never
 * hardcoded ids, since those are randomly generated per-database):
 *   owner@sovereign.local   (the target user — sign in as this one)
 *   admin@sovereign.local
 *   auditor@sovereign.local
 *   user@sovereign.local
 *
 * Run from this plugin's own directory (or `pnpm --filter
 * sovereign-plugin-kanban exec tsx scripts/seed.ts` from the monorepo
 * root), with the dev sqld instance already running (`pnpm dev` or `tsx
 * scripts/ensure-sqld.ts` starts it):
 *
 *   pnpm exec tsx scripts/seed.ts
 *   pnpm exec tsx scripts/seed.ts --reset   # wipe this script's own data first, then reseed
 *
 * Idempotent by default: no-ops (prints what already exists) if the seed
 * data is already present, rather than duplicating it on a second run.
 *
 * Connects directly to the dev sqld instance via `@libsql/client` rather
 * than importing `@sovereignfs/db` — this plugin's own `package.json`
 * doesn't depend on internal platform packages, and the monorepo's own
 * root `scripts/seed.ts` sets exactly this precedent for standalone dev
 * tooling ("deliberately doesn't import from apps/auth... mirrors it
 * instead"). SQLite (sqld) dev only; this plugin has no Postgres dev seed
 * path today.
 */
import { createClient, type Client } from '@libsql/client';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { nanoid } from 'nanoid';
import { positionAfter } from '../app/_db/position';
import * as schema from '../app/_db/schema';
import type { ActivityType } from '../app/_lib/activity';

const SQLD_URL = process.env.SOVEREIGN_SQLD_URL ?? 'http://localhost:28080';
const KANBAN_NAMESPACE = 'plugin_fs_sovereign_kanban';
const AUTH_NAMESPACE = 'sovereign_auth';
const TENANT_ID = 'default';
const RESET = process.argv.includes('--reset');

function namespacedClient(namespace: string): Client {
  return createClient({
    url: SQLD_URL,
    fetch: (input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set('x-namespace', namespace);
      return fetch(input as string, { ...init, headers });
    },
  });
}

interface DevUser {
  id: string;
  name: string;
  email: string;
}

async function lookupDevUsers(): Promise<{
  owner: DevUser;
  admin: DevUser;
  member: DevUser;
  auditor: DevUser;
}> {
  const auth = namespacedClient(AUTH_NAMESPACE);
  const emails = [
    'owner@sovereign.local',
    'admin@sovereign.local',
    'user@sovereign.local',
    'auditor@sovereign.local',
  ];
  const res = await auth.execute({
    sql: `SELECT id, name, email FROM "user" WHERE email IN (${emails.map(() => '?').join(',')})`,
    args: emails,
  });
  auth.close();

  const byEmail = new Map(
    res.rows.map((r) => [r.email as string, { id: r.id as string, name: r.name as string, email: r.email as string }]),
  );
  const missing = emails.filter((e) => !byEmail.has(e));
  if (missing.length > 0) {
    throw new Error(
      `Missing dev account(s): ${missing.join(', ')}. Run "pnpm sv seed" from the monorepo root first, then re-run this script.`,
    );
  }
  function requireUser(email: string): DevUser {
    const user = byEmail.get(email);
    if (!user) throw new Error(`Missing dev account: ${email}`);
    return user;
  }
  return {
    owner: requireUser('owner@sovereign.local'),
    admin: requireUser('admin@sovereign.local'),
    member: requireUser('user@sovereign.local'),
    auditor: requireUser('auditor@sovereign.local'),
  };
}

// ---------------------------------------------------------------------------
// Fixed ids for every seeded row (prefixed `seed-scenario-`, distinct from
// `app/_db/seed.ts`'s own `seed-project-demo` single-board smoke-test seed
// so the two never collide) — makes this script idempotent and `--reset`
// trivial: deleting the three project rows cascades everything below them
// (boards → boardMembers/lists → cards → cardLabels/cardAssignees/
// checklistItems/comments, boards → activity too — see schema.ts's
// `onDelete: 'cascade'` references).
const PROJECT_LAUNCH = 'seed-scenario-project-launch';
const PROJECT_MARKETING = 'seed-scenario-project-marketing';
const PROJECT_ENGINEERING = 'seed-scenario-project-engineering';

const DAY = 24 * 60 * 60 * 1000;

/** A fresh chained-position generator, scoped to one board's list of lists. */
function positionSequence(): () => number {
  let last: number | undefined;
  return () => (last = positionAfter(last));
}

async function main(): Promise<void> {
  const users = await lookupDevUsers();
  const client = namespacedClient(KANBAN_NAMESPACE);
  const db = drizzle(client);

  if (RESET) {
    console.log('--reset: deleting prior seed data...');
    await db
      .delete(schema.projects)
      .where(inArray(schema.projects.id, [PROJECT_LAUNCH, PROJECT_MARKETING, PROJECT_ENGINEERING]));
  }

  const existing = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, PROJECT_LAUNCH));
  if (existing.length > 0) {
    console.log('Seed data already present (project "Product Launch" exists) — nothing to do.');
    console.log('Run again with --reset to wipe and recreate it.');
    client.close();
    return;
  }

  const now = Date.now();
  const daysAgo = (n: number): number => now - n * DAY;
  const daysFromNow = (n: number): number => now + n * DAY;

  let activityCount = 0;
  async function activity(input: {
    boardId: string;
    cardId?: string;
    actorId: string;
    type: ActivityType;
    payload?: Record<string, unknown>;
    createdAt: number;
  }): Promise<void> {
    await db.insert(schema.activity).values({
      id: nanoid(),
      tenantId: TENANT_ID,
      boardId: input.boardId,
      cardId: input.cardId ?? null,
      actorId: input.actorId,
      type: input.type,
      payload: input.payload === undefined ? null : JSON.stringify(input.payload),
      createdAt: input.createdAt,
    });
    activityCount++;
  }

  async function addProject(input: {
    id: string;
    name: string;
    description: string | null;
    createdBy: string;
    createdAt: number;
  }): Promise<void> {
    await db.insert(schema.projects).values({
      id: input.id,
      tenantId: TENANT_ID,
      name: input.name,
      description: input.description,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }

  async function addBoard(input: {
    id: string;
    projectId: string;
    name: string;
    color: string;
    createdBy: string;
    createdAt: number;
    members: Array<{ userId: string; role: 'owner' | 'member' }>;
  }): Promise<void> {
    await db.insert(schema.boards).values({
      id: input.id,
      tenantId: TENANT_ID,
      projectId: input.projectId,
      name: input.name,
      color: input.color,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    for (const m of input.members) {
      await db.insert(schema.boardMembers).values({
        boardId: input.id,
        userId: m.userId,
        tenantId: TENANT_ID,
        role: m.role,
        addedBy: input.createdBy,
        createdAt: input.createdAt,
      });
      if (m.userId !== input.createdBy) {
        await activity({
          boardId: input.id,
          actorId: input.createdBy,
          type: 'member.added',
          payload: { userId: m.userId },
          createdAt: input.createdAt,
        });
      }
    }
    await activity({ boardId: input.id, actorId: input.createdBy, type: 'board.created', createdAt: input.createdAt });
  }

  async function addList(input: {
    id: string;
    boardId: string;
    name: string;
    position: number;
    createdBy: string;
    createdAt: number;
  }): Promise<void> {
    await db.insert(schema.lists).values({
      id: input.id,
      tenantId: TENANT_ID,
      boardId: input.boardId,
      name: input.name,
      position: input.position,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    await activity({
      boardId: input.boardId,
      actorId: input.createdBy,
      type: 'list.created',
      payload: { name: input.name },
      createdAt: input.createdAt,
    });
  }

  async function addLabel(input: {
    id: string;
    boardId: string;
    name: string;
    color: string;
    createdAt: number;
  }): Promise<void> {
    await db.insert(schema.labels).values({
      id: input.id,
      tenantId: TENANT_ID,
      boardId: input.boardId,
      name: input.name,
      color: input.color,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }

  interface CardSpec {
    id: string;
    boardId: string;
    listId: string;
    title: string;
    description?: string;
    dueDate?: number;
    createdBy: string;
    createdAt: number;
    labelIds?: string[];
    assigneeIds?: string[];
    checklist?: Array<{ text: string; done: boolean }>;
    comments?: Array<{ authorId: string; body: string; createdAt: number; replies?: Array<{ authorId: string; body: string; createdAt: number }> }>;
  }

  async function addCard(spec: CardSpec, position: number): Promise<void> {
    await db.insert(schema.cards).values({
      id: spec.id,
      tenantId: TENANT_ID,
      boardId: spec.boardId,
      listId: spec.listId,
      title: spec.title,
      description: spec.description ?? null,
      dueDate: spec.dueDate ?? null,
      position,
      createdBy: spec.createdBy,
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
    });
    await activity({
      boardId: spec.boardId,
      cardId: spec.id,
      actorId: spec.createdBy,
      type: 'card.created',
      createdAt: spec.createdAt,
    });

    if (spec.dueDate !== undefined) {
      await activity({
        boardId: spec.boardId,
        cardId: spec.id,
        actorId: spec.createdBy,
        type: 'due.changed',
        payload: { dueDate: spec.dueDate },
        createdAt: spec.createdAt,
      });
    }

    for (const labelId of spec.labelIds ?? []) {
      await db.insert(schema.cardLabels).values({ cardId: spec.id, labelId, tenantId: TENANT_ID });
      await activity({
        boardId: spec.boardId,
        cardId: spec.id,
        actorId: spec.createdBy,
        type: 'label.added',
        payload: { labelId },
        createdAt: spec.createdAt,
      });
    }

    for (const userId of spec.assigneeIds ?? []) {
      await db.insert(schema.cardAssignees).values({
        cardId: spec.id,
        userId,
        tenantId: TENANT_ID,
        assignedBy: spec.createdBy,
        createdAt: spec.createdAt,
      });
      await activity({
        boardId: spec.boardId,
        cardId: spec.id,
        actorId: spec.createdBy,
        type: 'assignee.added',
        payload: { userId },
        createdAt: spec.createdAt,
      });
    }

    if (spec.checklist && spec.checklist.length > 0) {
      let itemPosition: number | undefined;
      for (const item of spec.checklist) {
        itemPosition = positionAfter(itemPosition);
        await db.insert(schema.checklistItems).values({
          id: nanoid(),
          tenantId: TENANT_ID,
          cardId: spec.id,
          text: item.text,
          done: item.done ? 1 : 0,
          position: itemPosition,
          createdAt: spec.createdAt,
          updatedAt: spec.createdAt,
        });
      }
      await activity({
        boardId: spec.boardId,
        cardId: spec.id,
        actorId: spec.createdBy,
        type: 'checklist.changed',
        createdAt: spec.createdAt,
      });
    }

    for (const comment of spec.comments ?? []) {
      const commentId = nanoid();
      await db.insert(schema.comments).values({
        id: commentId,
        tenantId: TENANT_ID,
        cardId: spec.id,
        parentId: null,
        authorId: comment.authorId,
        body: comment.body,
        createdAt: comment.createdAt,
        updatedAt: comment.createdAt,
      });
      await activity({
        boardId: spec.boardId,
        cardId: spec.id,
        actorId: comment.authorId,
        type: 'comment.added',
        createdAt: comment.createdAt,
      });
      for (const reply of comment.replies ?? []) {
        await db.insert(schema.comments).values({
          id: nanoid(),
          tenantId: TENANT_ID,
          cardId: spec.id,
          parentId: commentId,
          authorId: reply.authorId,
          body: reply.body,
          createdAt: reply.createdAt,
          updatedAt: reply.createdAt,
        });
        await activity({
          boardId: spec.boardId,
          cardId: spec.id,
          actorId: reply.authorId,
          type: 'comment.added',
          payload: { parentId: commentId },
          createdAt: reply.createdAt,
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Project 1 — "Product Launch" (owned by the target user), two boards.
  // ---------------------------------------------------------------------
  await addProject({
    id: PROJECT_LAUNCH,
    name: 'Product Launch',
    description: 'Everything for the v2 launch — the kitchen-sink project for exercising every card scenario.',
    createdBy: users.owner.id,
    createdAt: daysAgo(20),
  });

  const boardSprint = 'seed-scenario-board-sprint';
  await addBoard({
    id: boardSprint,
    projectId: PROJECT_LAUNCH,
    name: 'Sprint 12',
    color: 'sky',
    createdBy: users.owner.id,
    createdAt: daysAgo(20),
    members: [
      { userId: users.owner.id, role: 'owner' },
      { userId: users.member.id, role: 'member' },
    ],
  });

  const labelBug = 'seed-scenario-label-bug';
  const labelFeature = 'seed-scenario-label-feature';
  const labelUrgent = 'seed-scenario-label-urgent';
  await addLabel({ id: labelBug, boardId: boardSprint, name: 'Bug', color: 'clay', createdAt: daysAgo(20) });
  await addLabel({ id: labelFeature, boardId: boardSprint, name: 'Feature', color: 'sky', createdAt: daysAgo(20) });
  await addLabel({ id: labelUrgent, boardId: boardSprint, name: 'Urgent', color: 'slate', createdAt: daysAgo(20) });

  const listBacklog = 'seed-scenario-list-backlog';
  const listTodo = 'seed-scenario-list-todo';
  const listInProgress = 'seed-scenario-list-in-progress';
  const listInReview = 'seed-scenario-list-in-review';
  const listDone = 'seed-scenario-list-done';
  const sprintListPos = positionSequence();
  await addList({ id: listBacklog, boardId: boardSprint, name: 'Backlog', position: sprintListPos(), createdBy: users.owner.id, createdAt: daysAgo(19) });
  await addList({ id: listTodo, boardId: boardSprint, name: 'To Do', position: sprintListPos(), createdBy: users.owner.id, createdAt: daysAgo(19) });
  await addList({ id: listInProgress, boardId: boardSprint, name: 'In Progress', position: sprintListPos(), createdBy: users.owner.id, createdAt: daysAgo(19) });
  await addList({ id: listInReview, boardId: boardSprint, name: 'In Review', position: sprintListPos(), createdBy: users.owner.id, createdAt: daysAgo(19) });
  await addList({ id: listDone, boardId: boardSprint, name: 'Done', position: sprintListPos(), createdBy: users.owner.id, createdAt: daysAgo(19) });

  let pos = 0;
  const nextPos = (): number => (pos += 1);

  // Backlog: bare card, description-only, single label, long title, overdue.
  await addCard({ id: 'seed-scenario-card-ci', boardId: boardSprint, listId: listBacklog, title: 'Set up CI pipeline', createdBy: users.owner.id, createdAt: daysAgo(18) }, nextPos());
  await addCard({ id: 'seed-scenario-card-research', boardId: boardSprint, listId: listBacklog, title: 'Research competitor pricing', description: 'Pull public pricing pages for the 5 closest competitors and summarize tiers.', createdBy: users.owner.id, createdAt: daysAgo(17) }, nextPos());
  await addCard({ id: 'seed-scenario-card-press', boardId: boardSprint, listId: listBacklog, title: 'Draft press release', labelIds: [labelFeature], createdBy: users.owner.id, createdAt: daysAgo(16) }, nextPos());
  await addCard({ id: 'seed-scenario-card-longtitle', boardId: boardSprint, listId: listBacklog, title: 'Long title card to test how the list view truncates or wraps a title that runs on for quite a while before it ends', createdBy: users.owner.id, createdAt: daysAgo(15) }, nextPos());
  await addCard({ id: 'seed-scenario-card-overdue', boardId: boardSprint, listId: listBacklog, title: 'Legacy migration write-up (overdue)', dueDate: daysAgo(10), createdBy: users.owner.id, createdAt: daysAgo(14) }, nextPos());
  await addCard({ id: 'seed-scenario-card-vendorlist', boardId: boardSprint, listId: listBacklog, title: 'Shortlist analytics vendors', labelIds: [labelFeature], createdBy: users.owner.id, createdAt: daysAgo(13) }, nextPos());
  await addCard({ id: 'seed-scenario-card-supportdocs', boardId: boardSprint, listId: listBacklog, title: 'Draft support docs outline', description: 'One doc per surface: web, mobile, and the API.', createdBy: users.owner.id, createdAt: daysAgo(12) }, nextPos());
  await addCard({ id: 'seed-scenario-card-betainvite', boardId: boardSprint, listId: listBacklog, title: 'Plan beta invite wave 2', dueDate: daysFromNow(9), createdBy: users.owner.id, createdAt: daysAgo(11) }, nextPos());

  // To Do: upcoming due + assignee, empty checklist, due-today + 2 labels, plain.
  pos = 0;
  await addCard({ id: 'seed-scenario-card-onboarding', boardId: boardSprint, listId: listTodo, title: 'Design onboarding flow', dueDate: daysFromNow(2), assigneeIds: [users.member.id], createdBy: users.owner.id, createdAt: daysAgo(13) }, nextPos());
  await addCard({ id: 'seed-scenario-card-apidocs', boardId: boardSprint, listId: listTodo, title: 'Write API documentation', checklist: [{ text: 'Outline endpoints', done: false }, { text: 'Document auth flow', done: false }, { text: 'Add code samples', done: false }], createdBy: users.owner.id, createdAt: daysAgo(12) }, nextPos());
  await addCard({ id: 'seed-scenario-card-loginbug', boardId: boardSprint, listId: listTodo, title: 'Fix login bug', labelIds: [labelBug, labelUrgent], dueDate: now, assigneeIds: [users.owner.id], createdBy: users.owner.id, createdAt: daysAgo(11) }, nextPos());
  await addCard({ id: 'seed-scenario-card-retro', boardId: boardSprint, listId: listTodo, title: 'Plan sprint retro', createdBy: users.owner.id, createdAt: daysAgo(10) }, nextPos());
  await addCard({ id: 'seed-scenario-card-emailtemplates', boardId: boardSprint, listId: listTodo, title: 'Build transactional email templates', labelIds: [labelFeature], assigneeIds: [users.member.id], createdBy: users.owner.id, createdAt: daysAgo(9) }, nextPos());
  await addCard({ id: 'seed-scenario-card-ratelimits', boardId: boardSprint, listId: listTodo, title: 'Tune API rate limits', dueDate: daysFromNow(5), createdBy: users.owner.id, createdAt: daysAgo(8) }, nextPos());
  await addCard({ id: 'seed-scenario-card-a11yaudit', boardId: boardSprint, listId: listTodo, title: 'Accessibility audit pass', checklist: [{ text: 'Keyboard nav', done: false }, { text: 'Screen reader pass', done: false }], createdBy: users.owner.id, createdAt: daysAgo(7) }, nextPos());

  // In Progress: partial checklist + 2 assignees + comment; description+label+due; kitchen sink.
  pos = 0;
  await addCard({
    id: 'seed-scenario-card-dnd',
    boardId: boardSprint,
    listId: listInProgress,
    title: 'Implement drag-and-drop reorder',
    checklist: [{ text: 'Web sensors', done: true }, { text: 'Mobile sensors', done: true }, { text: 'Collision detection', done: false }, { text: 'Keyboard support', done: false }],
    assigneeIds: [users.owner.id, users.member.id],
    comments: [{ authorId: users.member.id, body: 'Web drag is working well — starting on mobile next.', createdAt: daysAgo(3) }],
    createdBy: users.owner.id,
    createdAt: daysAgo(9),
  }, nextPos());
  await addCard({ id: 'seed-scenario-card-authrefactor', boardId: boardSprint, listId: listInProgress, title: 'Refactor auth middleware', description: 'Consolidate the three separate session checks into one shared helper.', dueDate: daysFromNow(4), labelIds: [labelFeature], createdBy: users.owner.id, createdAt: daysAgo(8) }, nextPos());
  await addCard({
    id: 'seed-scenario-card-kitchensink',
    boardId: boardSprint,
    listId: listInProgress,
    title: 'Kitchen sink card — every field at once',
    description: 'Exercises description, due date, multiple labels, partial checklist, multiple assignees, and a comment thread with a reply, all on one card.',
    dueDate: daysFromNow(1),
    labelIds: [labelBug, labelFeature, labelUrgent],
    assigneeIds: [users.owner.id, users.member.id],
    checklist: [{ text: 'Reproduce the issue', done: true }, { text: 'Write a failing test', done: true }, { text: 'Ship the fix', done: false }],
    comments: [
      { authorId: users.owner.id, body: 'Flagging this as the reference card for UI review.', createdAt: daysAgo(2), replies: [{ authorId: users.member.id, body: 'Looks great on mobile too.', createdAt: daysAgo(1) }] },
      { authorId: users.member.id, body: 'One more pass on the checklist copy and this is done.', createdAt: daysAgo(1) },
    ],
    createdBy: users.owner.id,
    createdAt: daysAgo(7),
  }, nextPos());
  await addCard({ id: 'seed-scenario-card-searchindex', boardId: boardSprint, listId: listInProgress, title: 'Build board search index', labelIds: [labelFeature], assigneeIds: [users.owner.id], createdBy: users.owner.id, createdAt: daysAgo(6) }, nextPos());
  await addCard({ id: 'seed-scenario-card-exportcsv', boardId: boardSprint, listId: listInProgress, title: 'Export board data to CSV', dueDate: daysFromNow(2), createdBy: users.owner.id, createdAt: daysAgo(5) }, nextPos());

  // In Review: 100% checklist; comment + reply from different authors.
  pos = 0;
  await addCard({ id: 'seed-scenario-card-tokensdoc', boardId: boardSprint, listId: listInReview, title: 'Update design tokens doc', checklist: [{ text: 'List every token', done: true }, { text: 'Add usage examples', done: true }], createdBy: users.owner.id, createdAt: daysAgo(6) }, nextPos());
  await addCard({
    id: 'seed-scenario-card-pr142',
    boardId: boardSprint,
    listId: listInReview,
    title: 'Code review: PR #142',
    comments: [{ authorId: users.owner.id, body: 'Can you split this into two PRs? The migration and the UI change are unrelated.', createdAt: daysAgo(2), replies: [{ authorId: users.member.id, body: 'Good call — splitting it now.', createdAt: daysAgo(1) }] }],
    createdBy: users.owner.id,
    createdAt: daysAgo(5),
  }, nextPos());
  await addCard({ id: 'seed-scenario-card-pr150', boardId: boardSprint, listId: listInReview, title: 'Code review: PR #150', labelIds: [labelBug], createdBy: users.owner.id, createdAt: daysAgo(4) }, nextPos());
  await addCard({ id: 'seed-scenario-card-perfpass', boardId: boardSprint, listId: listInReview, title: 'Performance review of board load', assigneeIds: [users.member.id], createdBy: users.owner.id, createdAt: daysAgo(3) }, nextPos());

  // Done: plain finished cards.
  pos = 0;
  await addCard({ id: 'seed-scenario-card-kickoff', boardId: boardSprint, listId: listDone, title: 'Kickoff meeting notes', createdBy: users.owner.id, createdAt: daysAgo(19) }, nextPos());
  await addCard({ id: 'seed-scenario-card-staging', boardId: boardSprint, listId: listDone, title: 'Set up staging environment', createdBy: users.owner.id, createdAt: daysAgo(18) }, nextPos());
  await addCard({ id: 'seed-scenario-card-brand', boardId: boardSprint, listId: listDone, title: 'Approve brand guidelines', createdBy: users.owner.id, createdAt: daysAgo(17) }, nextPos());
  await addCard({ id: 'seed-scenario-card-domain', boardId: boardSprint, listId: listDone, title: 'Register launch domain', createdBy: users.owner.id, createdAt: daysAgo(16) }, nextPos());
  await addCard({ id: 'seed-scenario-card-legalreview', boardId: boardSprint, listId: listDone, title: 'Legal review of ToS updates', createdBy: users.owner.id, createdAt: daysAgo(15) }, nextPos());
  await addCard({ id: 'seed-scenario-card-analyticsplan', boardId: boardSprint, listId: listDone, title: 'Finalize launch analytics plan', createdBy: users.owner.id, createdAt: daysAgo(14) }, nextPos());

  // Second board under the same project — sparse, no labels, tests a
  // near-empty board/list next to Sprint 12's full one.
  const boardBacklogIdeas = 'seed-scenario-board-backlog-ideas';
  await addBoard({
    id: boardBacklogIdeas,
    projectId: PROJECT_LAUNCH,
    name: 'Backlog Ideas',
    color: 'clay',
    createdBy: users.owner.id,
    createdAt: daysAgo(9),
    members: [{ userId: users.owner.id, role: 'owner' }],
  });
  const listIdeas = 'seed-scenario-list-ideas';
  const listMaybe = 'seed-scenario-list-maybe';
  const backlogIdeasListPos = positionSequence();
  await addList({ id: listIdeas, boardId: boardBacklogIdeas, name: 'Ideas', position: backlogIdeasListPos(), createdBy: users.owner.id, createdAt: daysAgo(9) });
  await addList({ id: listMaybe, boardId: boardBacklogIdeas, name: 'Maybe Later', position: backlogIdeasListPos(), createdBy: users.owner.id, createdAt: daysAgo(9) });
  pos = 0;
  await addCard({ id: 'seed-scenario-card-videotutorials', boardId: boardBacklogIdeas, listId: listIdeas, title: 'Explore video tutorials', createdBy: users.owner.id, createdAt: daysAgo(8) }, nextPos());
  await addCard({ id: 'seed-scenario-card-affiliate', boardId: boardBacklogIdeas, listId: listIdeas, title: 'Consider an affiliate program', createdBy: users.owner.id, createdAt: daysAgo(7) }, nextPos());
  await addCard({ id: 'seed-scenario-card-referralprogram', boardId: boardBacklogIdeas, listId: listIdeas, title: 'Sketch a referral program', createdBy: users.owner.id, createdAt: daysAgo(6) }, nextPos());
  await addCard({ id: 'seed-scenario-card-podcast', boardId: boardBacklogIdeas, listId: listIdeas, title: 'Guest on a podcast', dueDate: daysFromNow(14), createdBy: users.owner.id, createdAt: daysAgo(5) }, nextPos());
  pos = 0;
  await addCard({ id: 'seed-scenario-card-rebrand', boardId: boardBacklogIdeas, listId: listMaybe, title: 'Rebrand palette exploration', createdBy: users.owner.id, createdAt: daysAgo(6) }, nextPos());
  await addCard({ id: 'seed-scenario-card-swagstore', boardId: boardBacklogIdeas, listId: listMaybe, title: 'Set up a swag store', createdBy: users.owner.id, createdAt: daysAgo(5) }, nextPos());
  await addCard({ id: 'seed-scenario-card-communityforum', boardId: boardBacklogIdeas, listId: listMaybe, title: 'Explore a community forum', createdBy: users.owner.id, createdAt: daysAgo(4) }, nextPos());

  // ---------------------------------------------------------------------
  // Project 2 — "Marketing" (owned by the target user), one small board.
  // ---------------------------------------------------------------------
  await addProject({
    id: PROJECT_MARKETING,
    name: 'Marketing',
    description: null,
    createdBy: users.owner.id,
    createdAt: daysAgo(12),
  });
  const boardCampaign = 'seed-scenario-board-campaign';
  await addBoard({
    id: boardCampaign,
    projectId: PROJECT_MARKETING,
    name: 'Campaign Q1',
    color: 'sage',
    createdBy: users.owner.id,
    createdAt: daysAgo(12),
    members: [
      { userId: users.owner.id, role: 'owner' },
      { userId: users.admin.id, role: 'member' },
    ],
  });
  const listCampaignIdeas = 'seed-scenario-list-campaign-ideas';
  await addList({ id: listCampaignIdeas, boardId: boardCampaign, name: 'Ideas', position: positionAfter(undefined), createdBy: users.owner.id, createdAt: daysAgo(12) });
  pos = 0;
  await addCard({ id: 'seed-scenario-card-newsletter', boardId: boardCampaign, listId: listCampaignIdeas, title: 'Newsletter revamp', dueDate: daysFromNow(6), createdBy: users.admin.id, createdAt: daysAgo(4) }, nextPos());
  await addCard({ id: 'seed-scenario-card-socialcal', boardId: boardCampaign, listId: listCampaignIdeas, title: 'Social media calendar', createdBy: users.owner.id, createdAt: daysAgo(3) }, nextPos());
  await addCard({ id: 'seed-scenario-card-partnerships', boardId: boardCampaign, listId: listCampaignIdeas, title: 'Reach out to partner brands', assigneeIds: [users.admin.id], createdBy: users.owner.id, createdAt: daysAgo(2) }, nextPos());
  await addCard({ id: 'seed-scenario-card-adcreative', boardId: boardCampaign, listId: listCampaignIdeas, title: 'Draft ad creative variants', checklist: [{ text: 'Square format', done: true }, { text: 'Story format', done: false }], createdBy: users.admin.id, createdAt: daysAgo(1) }, nextPos());

  // ---------------------------------------------------------------------
  // Project 3 — "Platform Engineering" (created by admin@, target user is
  // a board member, not the project creator) — the "Shared with me" case.
  // ---------------------------------------------------------------------
  await addProject({
    id: PROJECT_ENGINEERING,
    name: 'Platform Engineering',
    description: 'Shared with you by Dev Admin.',
    createdBy: users.admin.id,
    createdAt: daysAgo(15),
  });
  const boardInfra = 'seed-scenario-board-infra';
  await addBoard({
    id: boardInfra,
    projectId: PROJECT_ENGINEERING,
    name: 'Infra Migration',
    color: 'slate',
    createdBy: users.admin.id,
    createdAt: daysAgo(15),
    members: [
      { userId: users.admin.id, role: 'owner' },
      { userId: users.owner.id, role: 'member' },
      { userId: users.auditor.id, role: 'member' },
    ],
  });
  const labelInfra = 'seed-scenario-label-infra';
  const labelBlocked = 'seed-scenario-label-blocked';
  await addLabel({ id: labelInfra, boardId: boardInfra, name: 'Infra', color: 'mist', createdAt: daysAgo(15) });
  await addLabel({ id: labelBlocked, boardId: boardInfra, name: 'Blocked', color: 'clay', createdAt: daysAgo(15) });
  const listInfraBacklog = 'seed-scenario-list-infra-backlog';
  const listInfraProgress = 'seed-scenario-list-infra-progress';
  const listInfraDone = 'seed-scenario-list-infra-done';
  const infraListPos = positionSequence();
  await addList({ id: listInfraBacklog, boardId: boardInfra, name: 'Backlog', position: infraListPos(), createdBy: users.admin.id, createdAt: daysAgo(15) });
  await addList({ id: listInfraProgress, boardId: boardInfra, name: 'In Progress', position: infraListPos(), createdBy: users.admin.id, createdAt: daysAgo(15) });
  await addList({ id: listInfraDone, boardId: boardInfra, name: 'Done', position: infraListPos(), createdBy: users.admin.id, createdAt: daysAgo(15) });
  pos = 0;
  await addCard({ id: 'seed-scenario-card-dbmigration', boardId: boardInfra, listId: listInfraBacklog, title: 'Plan database migration to Postgres', labelIds: [labelInfra], createdBy: users.admin.id, createdAt: daysAgo(14) }, nextPos());
  await addCard({ id: 'seed-scenario-card-blocked', boardId: boardInfra, listId: listInfraBacklog, title: 'Rotate signing keys (blocked on vendor)', labelIds: [labelBlocked], createdBy: users.admin.id, createdAt: daysAgo(13) }, nextPos());
  await addCard({ id: 'seed-scenario-card-backuppolicy', boardId: boardInfra, listId: listInfraBacklog, title: 'Define backup retention policy', labelIds: [labelInfra], createdBy: users.admin.id, createdAt: daysAgo(12) }, nextPos());
  await addCard({ id: 'seed-scenario-card-onc', boardId: boardInfra, listId: listInfraBacklog, title: 'Set up on-call rotation', assigneeIds: [users.owner.id], createdBy: users.admin.id, createdAt: daysAgo(11) }, nextPos());
  pos = 0;
  await addCard({ id: 'seed-scenario-card-sqldnamespaces', boardId: boardInfra, listId: listInfraProgress, title: 'Provision per-plugin sqld namespaces', labelIds: [labelInfra], assigneeIds: [users.auditor.id], dueDate: daysFromNow(3), createdBy: users.admin.id, createdAt: daysAgo(5) }, nextPos());
  await addCard({ id: 'seed-scenario-card-tlsrenewal', boardId: boardInfra, listId: listInfraProgress, title: 'Automate TLS certificate renewal', labelIds: [labelInfra], dueDate: daysFromNow(7), createdBy: users.admin.id, createdAt: daysAgo(4) }, nextPos());
  pos = 0;
  await addCard({ id: 'seed-scenario-card-sqldsetup', boardId: boardInfra, listId: listInfraDone, title: 'Stand up dev sqld container', createdBy: users.admin.id, createdAt: daysAgo(15) }, nextPos());
  await addCard({ id: 'seed-scenario-card-vpcsetup', boardId: boardInfra, listId: listInfraDone, title: 'Provision production VPC', createdBy: users.admin.id, createdAt: daysAgo(14) }, nextPos());

  client.close();

  console.log('Seed complete.');
  console.log(`  ${activityCount} activity rows across ${3} projects, ${4} boards.`);
  console.log('');
  console.log('Sign in as owner@sovereign.local (password: sovereign) to see:');
  console.log('  - "Product Launch" and "Marketing" under My projects (owner)');
  console.log('  - "Platform Engineering" under Shared with me (created by admin@)');
  console.log('  - A fully unseen Inbox — no lastSeenAt row was written for this user.');
}

await main();
