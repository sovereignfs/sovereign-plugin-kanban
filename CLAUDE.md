# CLAUDE.md — sovereign-plugin-kanban

Guidance for Claude Code (and other agents) working in this repository.

## What this is

**Sovereign Kanban** — a minimalist, sovereign alternative to Trello: projects,
boards, lists, and cards, built as an installable plugin for the
[Sovereign](https://github.com/sovereignfs/sovereignfs) platform (`io.openfs.kanban`).

## Where this runs

This repo has no build/test/lint tooling of its own — `package.json` has only
a `typecheck` script, and both it (`@sovereignfs/sdk`, `@sovereignfs/ui`,
`@sovereignfs/tsconfig`, all `workspace:*`) and `tsconfig.json` (extends
`@sovereignfs/tsconfig/nextjs.json`) depend on packages that only resolve
inside a `sovereignfs/sovereignfs` monorepo checkout's pnpm workspace.

Develop this plugin by cloning this repo into that monorepo at
`plugins/<slug>.local/` (the trailing `.local` marks it as a locally-cloned
dev plugin — see that repo's `docs/plugin-development.md`) and running the
monorepo's own commands from its root, filtered to this package where
useful:

```bash
pnpm install                                    # resolves workspace: deps
pnpm dev                                         # composes + hot-reloads this plugin
pnpm --filter sovereign-plugin-kanban typecheck
pnpm lint / pnpm format:check / pnpm design:tokens:check   # repo-wide, not per-plugin
pnpm exec vitest run plugins/sovereign-plugin-kanban.local
```

`.local` plugin directories are gitignored by the monorepo, so this repo's own
git history (not the monorepo's) is this plugin's only version control while
it lives there.

## Source of truth

Read the relevant doc before any task — these are authoritative over
assumptions:

- [`CONCEPT.md`](CONCEPT.md) — product concept and interaction-model decisions
  (web vs. mobile layout, click/tap-to-open, no drag handles).
- [`SPEC.md`](SPEC.md) — technical spec: architecture, data model, and every
  task (`K.1`–`K.16`) with its goal, deliverables, dependencies, and review
  checklist. Its `Status` section carries a detailed narrative for every
  completed task, including bugs found live and scope decisions — read it,
  don't just skim the checkbox.
- [`ROADMAP.md`](ROADMAP.md) — prioritized build order, one row per task, with
  manifest-version-tracked slots and the reasoning behind the ordering.

## Task workflow

**One task at a time.** Implement a single `K.<n>` task, verify its SPEC
review checklist, then stop. Tasks are sequenced — each depends on the
previous unless SPEC marks it `[parallel]`. Don't skip ahead without being
told which task to pick up next.

Per-task loop, matching the pattern K.1–K.8 already followed:

1. Read the task's Goal/Deliverables/Dependencies/Review checklist in SPEC.md.
2. If it introduces a new screen or a materially new layout, produce a
   wireframe/design doc under `docs/adhoc/` first and get it signed off.
3. Implement, following the conventions below.
4. **Verify live in a browser**, not just via the check suite — this plugin's
   history includes several real bugs (a `closestCorners` collision-detection
   bug in K.7, a stale-`useState` activity feed in K.8) that only live testing
   caught, not typecheck/lint/tests. Prefer real `PointerEvent`/`KeyboardEvent`
   sequences via `javascript_exec` over the `computer` tool's coordinate-based
   clicks for anything drag-related — see SPEC.md's K.7 status entry for the
   established technique and why the `computer` tool proved unreliable there.
5. Run the full check suite (typecheck, lint, format:check, vitest, design
   tokens) and show the output.
6. Bump `manifest.json`'s `version`, mark the task ✅ in `ROADMAP.md`, and add
   a detailed status entry to `SPEC.md` — in that order, same as every prior
   task.

## Conventions (inherited from the host platform, still binding here)

This plugin is a guest in the Sovereign platform's runtime — these rules
exist to keep it a well-behaved one. Full rationale for each lives in the
platform repo's `docs/architecture-rules.md`.

- **SDK boundary:** import only `@sovereignfs/sdk` and `@sovereignfs/ui`.
  Never reach into the platform's `runtime/src` — plugins don't have access
  to it once installed, and the monorepo's ESLint config enforces this at
  lint time.
- **Every server action** (`app/actions.ts`) starts with `sdk.auth.requireSession()`
  (via `_lib/authz.ts`'s `requireUser()`), then a specific per-resource
  authorization check (board membership, project ownership, card access).
  Route-level gating is never sufficient — an action is a public POST
  endpoint dispatched by action id.
- **Mutations return `ActionResult`** (`_lib/action-result.ts`) — domain
  failures are values (`fail(...)`), never thrown. Denials read as "not
  found" rather than "forbidden" so resource existence isn't leaked to a
  non-member.
- **Mutation + `recordActivity()` happen in one transaction** (`_lib/activity.ts`)
  so the audit trail can never disagree with the data. New activity types go
  in `activity.ts`'s `ActivityType` union and get copy in
  `_lib/activity-copy.ts`'s `describeActivity()`.
- **Ordering uses fractional positions** (`_db/position.ts`) — midpoint
  insertion, renormalize the whole scope in one transaction when a gap
  underflows. A reorder/move is exactly one row write, never a multi-row
  shuffle.
- **Design system only:** components and semantic `--sv-*` tokens from
  `@sovereignfs/ui`, never hardcoded colors or bespoke primitives —
  `pnpm design:tokens:check` (run from the monorepo root) enforces this.
- **Plugins version only `manifest.json`.** `package.json`'s `version` stays
  pinned at `0.0.0` forever — the manifest's `version` is the sole source of
  truth the platform reads (registry, compatibility checks, export/import).
- **Tests run against real generated migrations** on an ephemeral libsql DB
  (`_db/__tests__/test-db.ts`), with the SDK mocked to impersonate switchable
  users (`app/__tests__/actions.test.ts`). Per action group: an
  authz-denial-without-side-effects test, then a happy-path test asserting
  both the mutation and its recorded activity.

## Naming

Match the host platform's split: **plugin** in code/types/schema (`kanban_boards`,
`BoardData`, `routePrefix`), **board/card/list** — never "plugin" — in
user-facing UI strings.

## Status

Current manifest version: see `manifest.json` / `ROADMAP.md`'s header. Task
history and the reasoning behind every completed task lives in `SPEC.md`'s
`Status` section — that's the changelog; don't duplicate it here.
