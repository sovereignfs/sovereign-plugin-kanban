# Sovereign Kanban — Concept

> A minimalist, sovereign alternative to Trello, built as a Sovereign plugin.
> This is the authoritative product concept, incorporating the
> interaction-model decisions made during concept review. `SPEC.md` holds the
> technical design and task breakdown; `ROADMAP.md` holds the prioritized
> build order.

## Product statement

Sovereign Kanban brings the core Trello workflow — projects, boards, lists,
cards — to a self-hosted Sovereign instance. Phase 1 establishes that core
experience across web and mobile with a clean, focused, visually minimal UI
that feels native to the Sovereign Design System rather than a Trello clone.

**Build order: web first, then mobile.** The data layer (schema, queries,
server actions) is shared between the two; only the presentation layer
differs.

## Core hierarchy

```
Projects → Boards → Lists → Cards
```

**"List" is the decided term for a board's kanban columns** (Trello's own
vocabulary), used consistently in both code (`kanban_lists`, `listId`) and UI
copy ("Add list", "Move to list…") — never "column" for the domain object.

Users can create and manage every level, reorder lists and cards, and move
cards between lists.

### Card fields

Title · Description · Labels · Assignees · Due date · Checklist ·
Comments (with replies) · Activity log (audit-style history).

## Interaction model (decided)

These decisions are settled — do not reopen them during implementation:

| Interaction           | Web                                       | Mobile                                                     |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Open card detail      | **Single click** → modal dialog           | **Single tap** → full-screen detail (`Dialog size="full"`) |
| Card reorder in list  | Whole-card drag, no handle (Trello-style) | Whole-card touch drag, long-press activation, no handle    |
| Card move across lists| Whole-card drag between lists             | **Action menu only** ("Move to…"), never drag              |
| List reorder          | Whole-list drag, no handle                | Not via drag — list action menu                            |
| List navigation       | Horizontal scroll                         | Swipe (snap carousel, one list per screen)                 |

Rationale: on web, dnd-kit's pointer activation distance cleanly separates
click from drag, so no handles are needed. On mobile, the horizontal swipe
(list navigation) and vertical long-press drag (card reorder) live on
different axes and different activation modes, avoiding the gesture-capture
conflict documented in `sovereign-tasks`; cross-list drag on a snap-mandatory
carousel is deliberately out of scope — the action menu covers it.

## Surfaces

### Plugin Home (web)

Two-column layout:

- **Secondary sidebar** — navigation: **Boards**, **Inbox** (extensible
  later).
- **Main content** — boards grouped by project, Trello-boards-screen style.
  Each project section has a header (name, metadata, share/settings CTAs) and
  a grid of board cards; the final item in every project is always a
  **"Create New Board"** card.

### Plugin Home (mobile)

Different layout system, same data. Platform header stays visible; the plugin
renders a **custom footer** (RFC 0075 pattern) with three slots:

- **Boards** (left) — the home screen
- **Launcher** (center) — unchanged platform launcher icon
- **Inbox** (right) — notifications

Content area lists boards grouped by project, adapted to a single mobile
column.

### Board view (web)

Trello-like layout. Header: board name, card search/filter, member avatars,
Share CTA, Settings CTA. Body: horizontally arranged lists, each with its
cards; full drag-and-drop for lists and cards.

### Board view (mobile)

Renders between platform header and the plugin footer. Lists are a
**swipable carousel** (one list per screen). Each list header has an action
button (right end) opening an action menu for list operations and non-drag
card movement.

### Card detail

- **Web:** modal dialog with all card fields plus dedicated Comments & Replies
  and Activity sections.
- **Mobile:** full-screen presentation of the same functionality, prioritizing
  readability and editing efficiency over replicating the web modal.

### Inbox

Notifications and relevant activity for projects, boards, and cards —
assignments, comments, due dates, membership changes. Sidebar entry on web,
footer tab on mobile.

## Loading states

Loading states gate every surface — no partially rendered boards:

- **Home:** Loading → fetch lightweight projects + boards (id, name, color,
  metadata) → render.
- **Board:** Loading → fetch lists (id, name, order, card count) + lightweight
  cards (id, title, labels + colors, list, order) → render. Full card detail
  is fetched on open.

## Phase 1 scope

Projects · Boards · Board overview · Lists · Cards · Card details · Labels ·
Assignees · Due dates · Checklists · Comments · Replies · Activity logs ·
Drag-and-drop (per the interaction model above) · Board search/filter · Board
members · Share/settings entry points · Inbox notifications · Responsive web
experience · Mobile board and card experience · Loading states throughout.

Out of scope for Phase 1: attachments, card cover images, power-up-style
extensions, board templates, cross-board search, offline editing, project-level
membership and visibility (Phase 1 sharing is per-board only — see Phase 2
below).

## Phase 2: Project & board membership + visibility (decided)

Phase 1 has no concept of a project member — sharing happens per board only
(`kanban_board_members`), and the board-add picker searches the whole
platform directory. Phase 2 introduces a membership tier above boards and a
visibility flag at both levels. These decisions are settled — do not reopen
them during implementation:

- **Projects gain their own member list**, separate from board membership:
  `owner` (plural — a project supports co-owners, mirroring how boards
  already support more than one `owner`) and `member`. The project creator
  becomes its first owner.
- **Board membership is drawn from project membership, not the platform
  directory.** To add someone to a board, they must already be a project
  member — sharing a board is a two-step flow (invite to project, then add
  to board), never a direct directory search from inside a board. The
  directory-search picker moves from the board share dialog to a new
  project share dialog — the only place a genuinely new person enters the
  picture.
- **Only explicit board membership grants edit rights.** Project ownership
  never grants edit access to a board's content — a project owner who isn't
  also a board member can view but not touch it. This mirrors Trello/Asana's
  workspace-vs-project split, not a shortcut.
- **Two independent visibility flags**, both defaulting to `public`:
  - **Project visibility.** `public` (default): a board's own visibility
    flag governs who among project members can view it. `private`: only
    that board's own members and the project's owners can view any board in
    the project — a board's individual `public` flag is overridden, not
    consulted.
  - **Board visibility** (only consulted when its project is `public`).
    `public` (default): any project member can view the board (read-only,
    unless they're also an explicit board member). `private`: only that
    board's members and the project's owners can view it.
  - Project owners can always view every board in their project regardless
    of either flag — the one access path that isn't gated by visibility at
    all, only by ownership.
- **A genuine read-only viewing mode is new in Phase 2.** Phase 1 had no
  such thing — you were either a board member (could edit) or the board
  didn't render for you at all. A project owner or a public-project member
  viewing a board they don't belong to sees the full board — lists, cards,
  comments, activity — with every mutation affordance (add/edit/delete,
  drag-and-drop, checklist, comments, membership management) hidden or
  disabled.
- **Web only for Phase 2.** Read-only viewing ships on web first; mobile
  parity is a documented follow-up, not part of this phase — same
  "build order: web first, then mobile" principle as Phase 1 itself.

See `SPEC.md`'s Tasks section (`K.17`–`K.22`) for the technical breakdown and
`ROADMAP.md` for build order.
