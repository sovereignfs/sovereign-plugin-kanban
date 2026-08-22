# Sovereign Kanban

A minimalist, sovereign alternative to Trello — projects, boards, lists, and
cards — built as an installable plugin for the
[Sovereign](https://github.com/sovereignfs/sovereignfs) platform
(`fs.sovereign.kanban`).

## Features

- **Projects → Boards → Lists → Cards** hierarchy, with full create/rename/
  archive management at every level.
- **Drag-and-drop reorder**, whole-card/whole-list, no drag handles — click
  vs. drag is disambiguated by pointer activation distance on web, and by
  long-press vs. swipe on mobile. Fully keyboard-accessible (Space to lift,
  arrow keys to move, Space to drop, per dnd-kit's `KeyboardSensor`).
- **Card detail**: description, labels, assignees, due date, checklist,
  threaded comments, and an audit-style activity log — all in one dialog on
  web, a full-screen view on mobile.
- **Inbox**: a per-user feed of cards assigned to you and replies to your own
  comments, with unread tracking. (@-mentions aren't implemented yet — no
  mention parsing exists in this plugin.)
- **Board sharing** by invite, with owner/member roles.
- Responsive: a dedicated mobile layout (swipeable list carousel, custom
  footer navigation) sharing the same data layer as web — see
  [`CONCEPT.md`](CONCEPT.md)'s interaction-model table for the exact web vs.
  mobile behavior of every gesture.

See [`CONCEPT.md`](CONCEPT.md) for the full product concept and
[`SPEC.md`](SPEC.md) for the technical design, data model, and the complete
`K.1`–`K.16` task history (including real bugs found and fixed along the way).

## Permissions

Declared in [`manifest.json`](manifest.json):

| Permission           | Why                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `auth:session`        | Every board/card action is scoped to the signed-in user (membership checks, activity authorship, assignee lookups). |
| `db:readWrite`        | Own isolated database (`plugin_fs_sovereign_kanban`) for projects, boards, lists, cards, comments, and activity. |
| `notifications:send`  | Delivers notifications for board membership, card assignment, and comment replies. |

## Running it locally

This repo has no build/test/lint tooling of its own — it depends on packages
that only resolve inside a `sovereignfs/sovereignfs` monorepo checkout's pnpm
workspace. Clone it into that monorepo at `plugins/<slug>.local/` (the
trailing `.local` marks it as a locally-cloned dev plugin — see the platform
repo's `docs/plugin-development.md`), then from the monorepo root:

```bash
pnpm install
pnpm dev
```

`pnpm dev` composes this plugin into the running Sovereign shell and
hot-reloads on changes. Visit `/kanban` on your dev instance.

```bash
pnpm --filter sovereign-plugin-kanban typecheck
pnpm lint / pnpm format:check / pnpm design:tokens:check   # repo-wide, not per-plugin
pnpm exec vitest run plugins/sovereign-plugin-kanban.local
```

### Sample data

`scripts/seed.ts` fills the dev database with realistic sample data covering
every card/board scenario (owned and shared projects, boards with varying
member/label/list counts, cards spanning every combination of due date,
labels, checklist progress, assignees, and comment threads) — useful for
manually exercising the UI without building up state by hand. Requires
`pnpm sv seed` (monorepo root) to have run at least once, since it assigns
cards to and shares boards with that command's four well-known dev accounts.
Idempotent; pass `--reset` to wipe and recreate:

```bash
pnpm exec tsx scripts/seed.ts           # from this plugin's own directory
pnpm exec tsx scripts/seed.ts --reset
```

See this plugin's own [`CLAUDE.md`](CLAUDE.md) for the full development
workflow and conventions.

## License

Same license as the [Sovereign platform](https://github.com/sovereignfs/sovereignfs).
