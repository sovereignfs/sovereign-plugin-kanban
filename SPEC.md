# Sovereign Kanban — Phase 1 Technical Spec

> Technical design and task breakdown for the Phase 1 concept in
> [CONCEPT.md](CONCEPT.md). Tasks follow the platform epic format
> (`docs/epics/`): one task = one branch = one PR, sequenced unless tagged
> `[parallel]`. Prioritized build order lives in [ROADMAP.md](ROADMAP.md).

## Status

🚧 In progress — K.1–K.11 complete. K.11: Inbox (web) & notification wiring
shipped. New `kanban_inbox_state` table (one row per user — `user_id` PK,
`last_seen_at` nullable) is the entire read/unread model, matching SPEC's
"lightweight — no per-row read state" instruction exactly; migrations
regenerated for both dialects via `drizzle-kit generate` (no FK qualifier
stripping needed — the table has no foreign keys). `/kanban/inbox`
(`app/inbox/page.tsx`) is a plain Server Component — `getInboxFeed()`
aggregates `kanban_activity` across every board the actor is a member of
(scoped by `kanban_board_members`, the same membership gate `getBoardData`
already uses) and unions `lists`/`labels`/directory-resolved `members`
across those boards so `describeActivity()`/`displayName()` (K.8/K.9) can
render every row without per-board context switching — global nanoid ids
mean a flat union never collides across boards. Capped at
`INBOX_PAGE_SIZE = 100` rows with no further pagination, a deliberate Phase
1 scope decision the review checklist doesn't ask for. New pure
`_lib/inbox.ts` (`dayLabel`/`groupByDay`, 7 unit tests) groups the
already-newest-first feed into "Today"/"Yesterday"/dated sections via a
single sequential pass — no re-sort. Each item deep-links to
`/kanban/boards/<id>[?card=<id>]`, reusing K.9's URL convention exactly.
`activity-copy.ts`'s `ActivityCopyContext` was narrowed from the full
`BoardData['lists']`/`['labels']` to the minimal `{id,name}`/`{id,name,color}`
shape it actually reads — required for `getInboxFeed`'s leaner
multi-board union to satisfy the type, and a more honest signature either
way.

**Notification triggers** (`addComment`, extended): a recipient map is
built per comment — the parent comment's author for a reply
("New reply to your comment"), every card assignee for any comment,
top-level or reply ("New comment on your card") — deduplicated so a person
who is both (e.g. the assignee replied to their own earlier comment) is
notified exactly once, and the commenter is never notified about their own
comment. **Unseen-badge design decision, not explicitly specified but
necessary for correctness:** marking the Inbox "seen" happens in a
client-side `useEffect` on real mount (`InboxSeenMarker.tsx`), never as a
side effect of the page's own server render — Next.js prefetches `<Link>`
targets in the background (hovering the sidebar entry is enough), which
would otherwise run the Server Component render, and the write inside it,
purely from a hover the user never turned into an actual visit. The sidebar
badge itself is computed in `layout.tsx` (now `async`), which runs on every
in-plugin navigation, not just visits to Inbox specifically, so it stays
current without the (client-component) sidebar needing its own fetch;
`hasUnseenInboxActivity()` deliberately excludes the viewer's *own* activity
from the "is there something new" check — commenting on your own card
shouldn't light up your own unseen indicator, though the full feed still
shows your own actions for a complete history.

**A real gap caught live, not by tests, from muscle memory built earlier
this session (K.9's identical migration mistake):** the first live visit to
`/kanban/inbox` after adding the new table 500'd with
`SQLite error: no such table: kanban_inbox_state` — this plugin's dev
sqld instance runs plugin migrations at server *startup* only (confirmed via
`docs/plugin-database.md` and this session's own established pattern), so a
migration file added mid-session never applies to an already-running dev
server without a restart. Recognized immediately from the exact same
failure shape hit earlier for K.9's `sdk.directory` bundling issue — not a
new class of bug, just a reminder that a schema change always needs a dev
server restart in this environment, not just a file save. Fixed by
restarting the dev server (`preview_stop`/`preview_start`); re-verified
clean afterward.

Verified live end-to-end in dev, including against real notification
delivery, not stubs: visited `/kanban/inbox` and saw a real, correctly
day-grouped, correctly-attributed cross-board history built from every
action taken across this session's K.7–K.10 live verification (list/card
mutations, label/assignee/due-date changes, comments, replies, membership
changes) — board-level rows (member added/removed) correctly omit a card
title in their caption line while card-level rows correctly include one;
clicked a card-scoped row and confirmed it opened the exact right card via
the `?card=` deep link (checked both the URL and the DOM, not just the
`href`); assigned a real second directory account ("Dev Owner") to a card,
posted a comment as the primary session, and queried the live dev sqld
database directly (same technique as K.9) to confirm a real
`"New comment on your card"` notification landed for the correct recipient,
with the correct deep link and `source: "io.openfs.kanban"` (not
`"unknown"` — the K.9-established `await headers()` requirement was applied
correctly here from the start, unlike K.9's own first attempt). Reply
notifications and the dedup-when-parent-author-is-also-an-assignee case are
covered by automated tests (three dedicated cases) rather than a second live
walkthrough, since the comment-notification code path is otherwise
identical to the one just verified live and this session's time was better
spent on the two things that could plausibly differ: the recipient-selection
logic itself (test-covered in detail) and the live delivery mechanism
(verified for real once, not per code path). K.10: board search/filter shipped —
client-side only, instant, no server round trip. New `_lib/filter.ts`
(`normalizeFilterQuery`/`matchesBoardFilter`) is pure and dnd-kit/React-free
— same split as K.7's `order.ts` — so it's directly unit-tested (5 new
tests) rather than only exercised through the UI. Matches a card's title or
any attached label name, case-insensitive substring, against the
already-loaded board payload; `BoardSearchField.tsx` is a controlled input
in the header (positioned per CONCEPT.md's documented order — board name,
search, member avatars, Share, Settings) with a clear "×" affordance shown
only once there's a query. `BoardView.tsx`'s `cardsFor()` filters per list
without touching the underlying drag-order state at all — only which cards
get rendered — so clearing the query always reverts cleanly with nothing to
reconcile. Matching cards get their matched title substring wrapped in a
`<mark>` (`--sv-color-accent-subtle` background); a list with cards but zero
matches shows a "No matching cards" placeholder, distinguished from a
genuinely empty list via the list's own server-computed `cardCount` (so an
always-empty list doesn't get a misleading "no matches" message it never
earned). **Drag-disable decision (SPEC's "decide and document"):** a filter
disables dragging entirely, board-wide (lists and cards both) — done by
passing an empty `sensors` array to `DndContext` while filtering, which
dnd-kit treats as "no activator registered anywhere," a total, simple kill
switch requiring no per-component wiring. Chose disable-entirely over
keeping drag "safe": since filtering hides non-matching cards from each
list's rendered order (and thus from that list's `SortableContext` `items`),
a drop mid-filter would compute its prev/next neighbours from a visibly
incomplete order, silently reordering relative to cards the user can't see
— simpler to just not allow it than to reason about correctness of a
partial-order drag. `cursor: grab` is swapped back to `cursor: default` via
a `data-filtering` attribute while disabled, so the UI doesn't visually
promise a drag that won't start.

**A real, self-introduced responsive bug caught live, not by tests:** adding
a 200px-wide search field to the board header's already-populated action
row (avatar stack, Share, Settings) overflowed the page at completely
ordinary desktop widths — confirmed by comparing
`document.documentElement.scrollWidth` against `window.innerWidth` at
1280px (a real 152px overflow, not a screenshot-capture artifact, which the
tool's fixed-size screenshot output was initially mistaken for) and, worse,
at a narrower browser width the header action row's fixed content simply
never wrapped at all — `PageHeader`'s `.action` slot (`packages/ui`, not
this plugin's to edit) is `flex-shrink: 0` with an unconstrained child, so
without an explicit width cap the whole row claims its natural one-line
width regardless of `flex-wrap: wrap`, and 100% of any resulting deficit is
absorbed by the title's `min-width: 0`, crushing "Website relaunch" to an
unreadable ~35px sliver with the search box visually overlapping the text.
Root-caused by direct `getBoundingClientRect()` measurement (not eyeballing
screenshots, which this session's own tooling had already proven unreliable
for exact pixel judgment) after two earlier fix attempts each looked right
in a screenshot but didn't actually change the measured overflow. Fixed with
three coordinated changes in `kanban.module.css`: `.boardHeaderActions`
gets `flex-wrap: wrap` **and** an explicit `max-width: min(420px, 60vw)` —
the cap is what actually forces a second row under real space pressure,
since without one there was nothing making the row narrower than its
natural content width in the first place; `.searchField` becomes a
shrinkable flex item (`flex: 1 1 auto; min-width: 0`) so the search box is
the part that gives first, ahead of the buttons/avatars, which can't shrink
much below their own text+padding anyway. Re-verified with real
`getBoundingClientRect()` measurements at both 480px (title and search box
now have a clean 16px gap, no overlap) and 1280px (single row, comfortably
inside the viewport) before considering this closed — a `scrollWidth`
figure that persisted through the fix at 1280px turned out to be the
`.listsRow`'s own pre-existing, intentional `overflow-x: auto` scroll
content (three lists + "add list" wider than the visible column), unrelated
to the header and not a real bug.

Verified live end-to-end in dev: typed a query matching only one card's
title (label-free at the time) — the other two lists correctly showed "No
matching cards" with a `0` count badge, the match's title rendered a real
`<mark>` around exactly the matched substring; typed a different query
matching only that same card's *label*, not its title — same correct
single-match result, and confirmed **no** `<mark>` rendered anywhere (a
label match has nothing in the title to highlight, so none should appear);
attempted a real `PointerEvent` drag sequence on a card while the filter was
active — no `DragOverlay` appeared and `aria-pressed` never flipped,
confirming the sensors-disabled kill switch actually holds; cleared the
filter via the "×" button — all cards reappeared — and confirmed the exact
same drag sequence activated normally afterward (overlay appeared, drop
completed a real reorder), proving disable/re-enable both work, not just
one direction. K.9: board members & share shipped —
real multi-user boards. `sdk.directory.resolveUsers()` now resolves every
board member's name/email inside `getBoardData` (`app/_lib/queries.ts`),
carried on `BoardData.members`; `_lib/identity.ts`'s `displayName()` gained
an optional `members` param so assignees (K.6), comments (K.8), and activity
(K.8) all show real names instead of raw ids the moment someone other than
the current session is involved — the one gap those tasks deliberately left
open pending this task. Three new actions: `addBoardMember`/
`removeBoardMember` (owner-only, `requireBoardOwner`) and
`searchBoardMemberCandidates` (owner-only directory search, excludes
existing members from results so the "already a member" denial is never hit
by the UI in practice). Removing a member also detaches them from every
`cardAssignees` row on that board's cards — a removed member still showing
as an assignee with no access would be confusing — in one bulk cleanup, not
per-card activity, mirroring `deleteList`'s cascading card deletion.
`BoardShareDialog.tsx` is the header CTA: any member can open it to see who
has access; only the owner sees the remove buttons and the add-a-person
search picker (debounced, matching Console's `groups` picker pattern but in
this plugin's own DS-first style). The board header also gained a stacked
`Avatar` row (max 4 + overflow badge) replacing K.5's plain "N members"
caption text. Notifications: `sdk.notifications.send()` fires on
added-to-board and assigned-to-card (not on self-assignment), both
deep-linking per SPEC's `/kanban/boards/<id>[?card=<id>]` convention.

**Two real bugs caught live, neither by tests:**

1. Adding `sdk.directory.resolveUsers()` to `queries.ts` broke the whole
   board page with a genuine (not stale-cache) Next.js build error —
   `You're importing a component that needs "next/headers"`, tracing through
   `@sovereignfs/sdk`'s barrel to its own unrelated `activity.ts` module.
   Root cause: `CardActivity.tsx` (K.8, a client component) imports
   `activityCursorFor` — a real runtime function, not just a type — from
   `queries.ts`. A file with no `'use server'` directive gets fully bundled
   into any client component that imports a non-type binding from it, so
   `queries.ts` now newly importing `sdk` at module scope dragged the SDK's
   `next/headers`-using code into the client bundle too, which Next.js
   correctly rejects. (`actions.ts`'s own sdk usage never hit this — a
   `'use server'` file's exports become opaque RPC stubs for client
   importers instead of being bundled for real.) Fixed by extracting
   `ACTIVITY_PAGE_SIZE`/`ActivityCursor`/`activityCursorFor` into a new,
   deliberately sdk-free `_lib/activity-pagination.ts`; `CardActivity.tsx`
   now imports the runtime function from there directly, `queries.ts`
   re-exports it for server-side callers (`actions.ts`, tests) that don't
   need to know it moved.
2. Both new `sdk.notifications.send()` calls initially omitted the second
   `requestHeaders` argument the docs require (`docs/plugin-development.md`'s
   `notifications` section) — compiled fine, sent fine, no error anywhere,
   but every notification recorded `source: "unknown"` instead of
   `"io.openfs.kanban"`, confirmed by querying the live dev sqld instance
   directly (`curl` against its `/v2/pipeline` HTTP endpoint) rather than
   trusting the absence of a thrown error. Fixed by passing `await headers()`
   from `next/headers` to both calls, matching the documented convention;
   re-verified against the live database that a fresh notification correctly
   carries the plugin's own source id.

Verified live end-to-end in dev, including against real platform data, not
stubs: opened the share dialog, searched the actual `sdk.directory` (found a
real seeded second account, "Dev Owner"), added them (member row appeared,
header avatar stack updated to two avatars, `member.added` activity recorded
with the resolved name via `describeActivity`'s enriched
`member.added`/`removed` copy), confirmed the assignee picker on an existing
card now shows "Dev Owner"/"Dev User" instead of raw ids, assigned the new
member (activity: `"Dev User assigned Dev Owner"`), removed them again
(member row gone, avatar stack back to one, their card assignment cascaded
away), and queried the live sqld database directly to confirm both
notifications landed with correct recipient ids and deep links
(`/kanban/boards/<id>` and `/kanban/boards/<id>?card=<id>`). **Not verified,
environment-limited:** SPEC's checklist calls for a two-user manual test
(non-member 403s until added, then sees the board) — this session has a
single authenticated browser context, so that specific flow rests on K.3's
existing membership-gated queries (`getBoardData`/`getCardDetail` already
return null → `notFound()` for a non-member, unchanged by this task) plus
this task's own automated authz-denial tests, not a live second-session
walkthrough. K.8: comments, replies, and the card
activity log shipped. `addComment({cardId, body, parentId?})` is the single
action for both — one level of replies only (schema's existing
`kanban_comments.parent_id` nullable-self-reference), enforced server-side
(a reply's own id can never be used as a `parentId`) and mirrored in the UI
by simply not rendering a "Reply" affordance on a reply. `CardComments.tsx`
renders top-level comments with their replies nested underneath, each with
an `Avatar` + `displayName()` (extracted from K.6's `CardAssignees.tsx` into
shared `_lib/identity.ts`, now used by comments and activity too) and a
`timeAgo()` relative timestamp (new `_lib/time.ts`, ms-based sibling of
`plugins/account`'s ISO-based one, with an absolute-date fallback past 30
days). Activity is paged newest-first per SPEC: page 1 rides along with the
existing `getCardDetail` fetch (`ACTIVITY_PAGE_SIZE` unchanged at 20); a new
`getActivityPage()`/`getMoreCardActivity` action pair (`_lib/queries.ts` +
`actions.ts`) serves subsequent pages on a `(createdAt, id)` cursor rather
than `createdAt` alone, so two activity rows recorded in the same
millisecond — realistic for board-level events — can't duplicate or skip
across a page boundary; a dedicated pagination test asserts this by
inserting 24 same-timestamp rows directly and confirming 25 distinct ids
across both pages. Human-readable copy per type lives in a new
`_lib/activity-copy.ts` (`describeActivity()`) — resolves list/label names
against the already-loaded `board.lists`/`board.labels` rather than leaking
raw ids, with a `default` case so activity types added by later tasks
(K.9's `member.added/removed`) don't need an edit here just to stay
non-broken. `getMoreCardActivity` is a rare "read" server action (this
plugin's actions are otherwise all `ActionResult` mutations) — it returns
`{items, nextCursor}` directly and deliberately never calls `refresh()`.

**Real bug caught live, not by tests:** `CardActivity`'s page-1 state was
originally `useState(card.activity)` — correct only once, at mount. Every
mutation's `revalidatePath` re-fetches the card server-side and passes a
fresh `card.activity` prop into this already-mounted client component (the
overlay never remounts on a same-card revalidation), so the very next
comment after opening a card didn't appear in Activity until a hard reload
— confirmed by adding a comment, seeing Activity **not** update, then
reloading cold and seeing both the comment and its correct "commented" row
appear together. Fixed with React's documented "adjust state during render
when a prop changes" pattern rather than a `useEffect` (which would add an
extra render showing stale data first): page 1 now always renders straight
from the `card.activity` prop; only the *extra* pages fetched via "Load
more" are local state (`extraItems`), reset via an in-render
`if (card.activity !== prevPage1)` check whenever a fresh prop arrives —
correct on the very next mutation. Re-verified after the fix: added a
second comment with the card already open and watched Activity update
immediately with no reload.

Verified live end-to-end in dev, using the same JS-driven `PointerEvent`
technique K.7 established (this environment's `computer` tool remains
unreliable for drag, though plain clicks/typing worked fine here) —
exercised every K.3–K.7 mutation type that actually reaches a card-scoped
feed and confirmed each renders correct, plain-language copy: card created,
renamed (`field.changed`), due date set and cleared, assigned and
unassigned, a label added and removed, the checklist changed (add + toggle),
a top-level comment, a reply to it (with the one-level-nesting UI
enforcement and the "Reply" button correctly absent on the reply itself),
and a cross-list drag (`card.moved`, correctly naming the destination list).
`card.deleted`/`list.*`/`board.created`/`member.*` are board-level events by
design (recorded with no `cardId` — see `activity.ts`) and so never render
in this card-scoped feed; their `describeActivity()` copy exists for K.11's
board/Inbox activity feed, which will reuse this function, not for anything
K.8 itself surfaces. K.7: web drag-and-drop shipped —
`@dnd-kit/core`/`sortable`/`utilities` added (pinned to the same versions the
`account` plugin already uses). A single `DndContext` on `BoardView.tsx`
hosts both list reorder (outer `SortableContext`, `horizontalListSortingStrategy`)
and per-list card reorder/cross-list move (nested `SortableContext` per list,
`verticalListSortingStrategy`), backed by `useOptimistic`/`startTransition`
over a new pure, dnd-kit-free `_lib/order.ts` (`seedOrder`/`applyOrder`,
14 unit tests) that tracks visual order client-side and computes
`prevId`/`nextId` neighbours for K.3's existing `reorderList`/`moveCard`
actions — no new server actions needed. No drag handles anywhere, matching
SPEC's Trello-parity decision: a list's drag surface is scoped to its header
only (`ListColumn.tsx`, matching Trello's own "grab by the title bar"
behavior and sidestepping list-vs-card-inside-it ambiguity); a card's whole
tile is draggable (`CardTile.tsx`), with `PointerSensor`'s 6px activation
distance (`_lib/dndSensors.ts`) telling a real click from a drag start so
`Link` navigation to the card overlay still fires normally. Empty lists are
valid drop targets via a dedicated `useDroppable` on each list's card
container (`listDropId()`/`listIdFromDropId()` in `order.ts`, a distinct id
namespace from both list and card ids — the standard dnd-kit fix for
"nothing to sort onto" in an empty container). `KeyboardSensor` (Space to
lift, arrow keys to move, Space/Enter to drop, Escape to cancel) verified
live end-to-end, not just wired. Deliberately out of scope: `onDragOver`-time
live reparenting across lists — SPEC's checklist only requires a correct
single commit on drop plus `DragOverlay`'s drag-time visual feedback, not
hover-time DOM reparenting.

**Real bug caught live, not by tests, and it was the load-bearing one:**
`closestCorners` — the obvious, default collision-detection choice for a
Trello-style board — was applied globally across the single shared
`DndContext`, so a dragged **list**'s translated rect was compared against
every registered droppable regardless of nesting level, including individual
**card** droppables inside unrelated lists. Corner-distance sums came out
numerically close enough between "the list you're actually hovering" and
"some card two lists over" that list-reorder drops resolved to a random
card instead of a list roughly as often as not — confirmed via the
`DndContext`'s own default `DndLiveRegion` announcement text plus matching
resolved ids back to real card hrefs, and reproduced across three
independently-aimed drop attempts before being treated as a real bug rather
than a fluke of synthetic pointer-event testing. This is a well-documented
dnd-kit multi-container pitfall, not a corner case specific to this board —
their own official "multiple containers" examples solve it the same way:
`BoardView.tsx` now uses a custom `collisionDetectionStrategy` that, when
the active item is a list, filters `droppableContainers` down to
`data.current.type === 'list'` and runs `closestCenter` over just those;
card drags still fall through to plain `closestCorners` (unaffected, and
already verified working both same-list and cross-list before the list-drag
bug was found). Re-verified after the fix: list reorder now resolves and
persists correctly on every attempt, both by pointer and by keyboard, with
exactly one `reorderList`/`moveCard` POST per drop (confirmed via network
inspection) and no regression to card dragging or plain-click card-open
behavior.

Verified live end-to-end in dev, using real `PointerEvent`/`KeyboardEvent`
sequences (this session's `computer` tool's coordinate-based clicks/drags
were confirmed broadly unreliable in-environment via a control test, so
verification was scripted instead): same-list card reorder (persisted after
a full reload); cross-list card move onto a non-empty list (persisted);
list reorder by dragging a header to a new position (persisted, only after
the collision-detection fix above); keyboard reorder of a card via
Space/ArrowDown/Space (persisted); a plain click on a card still opens the
detail overlay with zero drag interference. K.6: card detail modal shipped per the
signed-off compact design spec (docs/adhoc/card-detail.md) — editable title
(quick-entry, `useCommitOnEnterOrBlur`), labels (board-scoped create/toggle/
delete via a `Popover` checkbox picker + inline "New label" swatch form),
due date (`DatePicker` + a separate Clear action, since `DatePicker` has no
null state), assignees (same picker pattern; "You" substituted for the
current session's own id — `sdk.directory` isn't wired until K.9, so other
members show by raw id, an acknowledged narrow gap that self-resolves
there), description (click-to-edit, explicit Save/Cancel, rendered via DS
`Markdown` when not editing), checklist (add/toggle/delete/reorder — reorder
is up/down neighbour-position-swap buttons, not drag, deliberately deferred
to K.7's board-level DnD scope), and an honest "Comments & activity — coming
in the next update" placeholder (K.8). Card detail fetch moved server-side:
`page.tsx` now reads the `card` search param and calls K.3's `getCardDetail`
alongside the board query, passing it down — no client-side fetch/loading
state, since a `<Link href="?card=…">` navigation already re-invokes the
Server Component tree. 10 new server actions (`createLabel`, `deleteLabel`,
`toggleCardLabel`, `assignMember`, `unassignMember`, `createChecklistItem`,
`toggleChecklistItem`, `deleteChecklistItem`, `moveChecklistItem`), each
with its own authz-denial + happy-path test — suite now at 32 tests, all
against the real generated migrations. Verified live end-to-end in dev: create
a label → toggle onto a card → set + clear a due date → assign self → write
and save a Markdown description → add three checklist items → toggle one
done → reorder → delete one → rename the card title → confirm every change
reflects on the K.5 board tile → cold deep-link the fully-populated card →
delete the card via its own destructive confirm (nested correctly over the
modal) → URL cleanly strips back to the bare board route. K.5: web Board view shipped per the
signed-off wireframes (docs/adhoc/board-view.md) — real lists/cards
(everything except drag and the real card modal, per SPEC scope), inline
list rename (`useCommitOnEnterOrBlur`), list `•••` menu (Add card/Rename/Delete
with a destructive `ConfirmDialog`), quick-add composers for lists and cards
(the platform's documented always-visible-submit-button exception — commit
on Enter/click, not blur), card tiles with conditional metadata (checklist,
comments, due date, assignees — no empty row when a card has none), and a
real board Settings dialog reusing K.3's `updateBoard` action (not stubbed —
K.4's "no dead controls" rule applied again: Search and Share stay absent
until K.10/K.9 rather than rendering inert). The `?card=<id>` card-detail
overlay is built to SPEC's full URL contract now — `Dialog` with a
placeholder body — verified working both as an in-app soft-navigation and as
a cold deep link, with `Close` deliberately using `router.push(pathname)`
rather than `router.back()` so a fresh deep link never navigates out of the
plugin (documented in `CardDetailOverlay.tsx`; this is a plain page-level
Dialog, not the platform's `@modal` overlay-shell mechanism, so
`docs/architecture-rules.md`'s back()-only rule doesn't apply here). **Real
bug caught and fixed during live verification, not by tests:** two Typography
usages (list name, card title) used `variant="label"`, which is
uppercase/muted — correct for form labels, wrong for card content — fixed to
`variant="h4"`/`"body"`. Extracted `useCloseOnSuccess`/`DialogActions` out of
K.4's `HomeDialogs.tsx` into a shared `form-dialog.tsx` so `BoardSettingsDialog`
doesn't duplicate them. Verified live end-to-end in dev: add list → add card
→ inline rename (Enter-commit) → open card overlay (both soft-nav and cold
deep-link) → close → Settings dialog (prefilled name + color) → delete list
with cascade confirm → back to empty state; mobile viewport (375px) checked
for no crash/overflow (K.5 is web-only by design, K.13 owns the real mobile
board). K.4: web Home shipped per the signed-off
wireframes (docs/adhoc/web-home.md) — sidebar + project sections + board-card
grid, project/board create/edit/delete flows on `useActionState`, empty
state, `loading.tsx`/`error.tsx`, all DS primitives (`PageHeader`,
`Typography`, `Card`, `Menu`, `ConfirmDialog`, `EmptyState`, `Dialog`,
`FormField`); board colors are data (curated TS palette, inline styles).
Verified live end-to-end in dev (create project → create board → open board
stub; menus/dialogs exercised; tokens check clean). **Layout correction
discovered in K.4, applies to all future work:** only `app/` is composed
into the runtime, so the schema/db module lives at `app/_db/` (the
`example-encrypted` pattern), NOT a plugin-root `db/` dir — root `db/`
type-checks and passes unit tests but breaks module resolution in the
composed copy at runtime. Migrations stay at plugin root (`migrations/`),
driven by `drizzle.config.ts`/`drizzle.config.pg.ts`. Also shipped early: a
minimal `boards/[boardId]` stub route (board name + honest empty state) so
K.4's board cards never link to a 404 — K.5 replaces its body. K.1: scaffold verified live in dev
(`/kanban` renders with a session, Launcher tile present, correct mobile
chrome). K.2: schema + dual-dialect migrations generated and verified — unit
tests run the real generated SQLite migrations (seed, ordering, FK cascades,
one-level replies), applied and idempotent against the live dev store's
isolated sqld namespace (`plugin_io_openfs_kanban`). K.3: query layer (home /
board / card-detail payloads), 16 server actions (project/board/list/card
CRUD + reorder/move with per-resource authz inside every action),
`recordActivity()` in-transaction, and a 22-test suite incl. full non-member
denial coverage on production-semantics (libsql) test DBs. Two findings baked
in: `kanban_activity.card_id` is `ON DELETE SET NULL` (an audit trail must
outlive its subject — caught by test), and `@libsql/client` `:memory:` DBs
are per-connection (interactive transactions silently target a fresh empty
DB; tests use a temp file instead).

---

## Architecture

### Terminology

**"List"** is the domain term for a board's kanban columns (see CONCEPT.md),
used consistently in code and UI — `kanban_lists`, `listId`, "Add list".
"Column" appears in this spec only as a layout term (e.g. the web home's
two-column layout).

### Plugin identity

- **id:** `io.openfs.kanban` (reverse-DNS per platform convention; table
  slug prefix stays `kanban_`)
- **routePrefix:** `/kanban`
- **type:** community (externally-maintained `.local` plugin during
  development; the manifest schema requires a `repository` URL for this
  type)
- **shell:** `default` (platform chrome), with
  `shellConfig: { mobileHeader: true, mobileFooter: false }` — platform header
  stays, plugin renders its own mobile footer (RFC 0075).
- **Versioning:** the plugin's version lives **only in `manifest.json`**;
  `package.json` stays pinned at `0.0.0` forever (platform convention).

### Manifest permissions

- `auth:session` (session reads via `sdk.auth`)
- `db:readWrite` (isolated database — the only mode; slug-prefixed tables)
- `notifications:send` (Inbox + platform notification bell, RFC 0015)

No `publicRoutes`, no `schedules` in Phase 1 (due-date reminder schedules are
a natural Phase 2 addition via the manifest `schedules` field).

### SDK usage

| Surface                        | Use                                                         |
| ------------------------------ | ----------------------------------------------------------- |
| `sdk.auth.requireSession()`    | First line of **every** server action and API route         |
| `sdk.db.getClient()`           | Plugin's isolated DB (zero-argument invariant — never work around it) |
| `sdk.notifications.send()`   | Inbox events (assignment, comment, due date, membership)    |
| `sdk.platform`                 | Instance metadata as needed                                 |

User lookup for assignees/members: the platform user directory
(`sdk.directory`, experimental surface) — verify its exact shape at
implementation time (task K.12); if insufficient, fall back to storing
user ids captured from sessions and rendering via `Avatar` with cached
display names.

### Hard platform rules that apply here

- Plugins import **only** `@sovereignfs/sdk` and `@sovereignfs/ui` — never
  `runtime/src` (ESLint-enforced).
- Every server action authorizes **inside the action**
  (`await sdk.auth.requireSession()` + per-resource membership checks);
  middleware path gating is never enough.
- All tables slug-prefixed `kanban_`; `tenant_id` on every user-scoped table.
- Page padding/max-width come from `PageContainer` — no local root
  padding/max-width.
- Quick-entry inputs that commit on Enter must also commit on blur
  (`useCommitOnEnterOrBlur`) — iOS Done fires only blur.
- Intra-overlay navigation uses `<Link replace>` (overlays dismiss via
  `router.back()`).
- Only `--sv-*` semantic tokens in CSS; no hardcoded colors
  (`pnpm design:tokens:check` enforces).
- User-facing strings say **app/board/list/card**, never "plugin".

---

## Data model

All tables in the plugin's isolated database, defined with Drizzle in
`app/_db/schema.ts` (SQLite) + `app/_db/schema.postgres.ts` (migration
twin) — inside `app/` because only `app/` is composed into the runtime (see
Status, K.4 correction; `example-encrypted` precedent). Generated migrations
live at plugin root under `migrations/{sqlite,postgres}/` — the layout the
platform's startup migration runner expects. `tenant_id` scopes every
table. Timestamps (`created_at`, `updated_at`) on every table; soft-delete is
**not** used in Phase 1 — deletes cascade.

```
kanban_projects         id, tenant_id, name, description, created_by, timestamps
kanban_boards           id, project_id, name, color, created_by, timestamps
kanban_board_members    board_id, user_id, role ('owner' | 'member'), added_by, created_at
kanban_lists            id, board_id, name, position, timestamps
kanban_cards            id, board_id, list_id, title, description, due_date,
                        position, created_by, timestamps
kanban_labels           id, board_id, name, color, timestamps
kanban_card_labels      card_id, label_id
kanban_card_assignees   card_id, user_id, assigned_by, created_at
kanban_checklist_items  id, card_id, text, done, position, timestamps
kanban_comments         id, card_id, parent_id (nullable → reply), author_id,
                        body, timestamps
kanban_activity         id, card_id, board_id, actor_id, type, payload (JSON),
                        created_at
```

Notes:

- **Ordering** (`position` on lists, cards, checklist items): fractional
  `REAL` positions with midpoint insertion (`(prev + next) / 2`) so a
  reorder/move writes exactly one row; renormalize a list's positions in a
  single transaction when the gap underflows. No `order`-shuffling multi-row
  updates on drag.
- **Cards carry both `board_id` and `list_id`** — board-level queries
  (search, lightweight board fetch) never join through lists.
- **`kanban_activity` is card-anchored but board-indexed** so both the card
  modal's Activity section and the Inbox/board activity queries are cheap.
- **Labels are board-scoped** (Trello model), joined to cards via
  `kanban_card_labels`.
- **Comments support one level of replies** via nullable `parent_id`
  (a reply cannot itself be replied to in Phase 1 — flatten deeper intents).
- **Access model:** project creator manages the project; board access is via
  `kanban_board_members` (creator becomes `owner`). Every board/card action
  verifies membership; every project mutation verifies creator. Phase 1 has
  no project-level member list — sharing happens per board.

## Data fetching contract

Two-stage fetch, matching CONCEPT.md's loading states:

1. **Home payload** — projects (id, name, board count) + boards (id, name,
   color, project_id). One server round trip.
2. **Board payload** — board meta + members, lists (id, name, position,
   card count), lightweight cards (id, title, list_id, position, label
   ids/colors, assignee count, due date, checklist done/total, comment
   count). One server round trip.
3. **Card detail payload** — full card, fetched when the detail surface
   opens: description, checklist items, assignees, comments + replies,
   activity page 1.

Server components fetch; `loading.tsx` per route segment provides the gate.
Mutations are server actions returning the platform `ActionResult` shape,
consumed via `useActionState` (see the `sv-ui-design` skill's error
convention). Board mutations use optimistic UI (`useOptimistic`) for drag
operations so a drop never appears to lag, with rollback on action failure.

## Drag-and-drop

`@dnd-kit/core` + `@dnd-kit/sortable` (already the platform precedent —
`plugins/account` uses the same pair).

- **Web:** `PointerSensor` with a distance activation constraint (~6px) —
  separates single-click-open from drag with no handles. Lists are one
  sortable context; each list's cards another, with `DragOverlay` for the
  lifted card and cross-list drop targets.
- **Mobile:** `TouchSensor` with `delay` (~220ms) + `tolerance` activation —
  long-press to lift, **vertical reorder within the current list only**.
  Cross-list movement is menu-driven ("Move to…" — list picker +
  top/bottom position). The carousel owns horizontal swipes; the documented
  dnd-kit iOS Safari `touchmove` behavior (see
  `docs/architecture-rules.md` / sovereign-tasks Task 12) makes real-device
  (simulator) verification a required checklist item, not optional.

## Activity & notifications

A single server-side `recordActivity(type, cardId, actorId, payload)` helper
is called from within each mutating action's transaction. Activity types:
`card.created`, `card.moved`, `field.changed`, `assignee.added/removed`,
`label.added/removed`, `due.changed`, `checklist.changed`, `comment.added`.

Notifications (`sdk.notifications.send()`) fire for events *about other
users*: you were assigned, your card was commented on, you were added to a
board, a card you're assigned to is due soon (due-soon delivery itself is
Phase 2 — Phase 1 records the data). Notification URLs deep-link to
`/kanban/boards/<id>?card=<id>`. The Inbox screen renders the plugin's own
activity feed (board-scoped `kanban_activity` for boards you're a member of),
not the platform bell — the two complement each other.

## Routes

```
/kanban                      Home (Boards overview)          [web + mobile]
/kanban/inbox                Inbox                           [web + mobile]
/kanban/boards/[boardId]     Board view                      [web + mobile]
  ?card=<cardId>             Card detail overlay (URL-addressable)
```

Card detail is a query-param overlay on the board route (shareable /
deep-linkable, back-button closes it), not a separate route segment.

## UI composition (Design System)

| Need                     | DS surface                                                        |
| ------------------------ | ----------------------------------------------------------------- |
| Page chrome              | `PageContainer`, `PageHeader`                                     |
| Card detail (web)        | `Dialog` (`lg`)                                                   |
| Card detail (mobile)     | `Dialog size="full"`                                              |
| Menus (list/card/board)  | `Menu` / `MenuEntries`                                            |
| Mobile footer            | `MobileFooter` (self-publishes shell chrome height)               |
| Mobile list carousel     | `SwipableMobileCarousel` + `Slide/Header/Body` + `Dots`           |
| Responsive split         | `useIsMobile` / `useResponsiveLayout` / `ResponsiveSurface`       |
| Quick-add inputs         | `Input` + `useCommitOnEnterOrBlur`                                |
| Labels / badges          | `Badge`, `TagInput`                                               |
| Confirmation             | `ConfirmDialog`                                                   |
| Empty / loading          | `EmptyState`, `Spinner`, skeletons per DS patterns                |
| Avatars                  | `Avatar`                                                          |
| Toasts                   | `useToast`                                                        |

Anything reusable that Kanban would otherwise invent (e.g. a generic
secondary-sidebar surface for the web home) should be checked against
`packages/ui` first per the DS-first rule; if genuinely missing, raise it as
a platform DS proposal rather than building it Kanban-locally.

---

## Tasks

Task IDs `K.<seq>` are stable identifiers. One task = one branch = one PR.
Sequenced unless tagged `[parallel]`. Every PR bumps `manifest.json`'s
version per the change (never `package.json`).

Common review checklist (implied for every task, in addition to each task's
own): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` and
`pnpm design:tokens:check` pass; no `runtime/src` imports; user-facing copy
says "app/board/list/card", never "plugin".

---

#### K.1 — Plugin scaffold & manifest

**Goal:** A composed, routable plugin skeleton with the decided manifest.

**Deliverables:**

- Scaffold via `sv plugin new` conventions: `manifest.json` (id `kanban`,
  routePrefix `/kanban`, permissions `db` + `notifications:send`,
  `shellConfig: { mobileFooter: false }`), `package.json` pinned `0.0.0`,
  `app/` with a placeholder home page inside `PageContainer`.
- Plugin icon per the icon system.
- Composes under `pnpm dev`; tile appears in Launcher.

**Dependencies:** none.

**Review checklist:** plugin loads at `/kanban` in dev; manifest validates
(`pnpm generate` clean); mobile shows platform header and (for now) no
footer regression on other routes.

---

#### K.2 — Data model & migrations

**Goal:** The full Phase 1 schema, migrated and queryable.

**Deliverables:**

- Drizzle schema for all `kanban_*` tables per the Data model section,
  including indexes: `kanban_cards(board_id)`, `kanban_cards(list_id,
  position)`, `kanban_activity(board_id, created_at)`,
  `kanban_comments(card_id)`, membership lookups.
- Generated migrations; fractional-position helpers (midpoint insert,
  renormalize-in-transaction) with unit tests.
- Seed helper for dev (a demo project/board/lists/cards).

**Dependencies:** K.1.

**Review checklist:** migrations run clean on a fresh dev DB; position
helper unit tests cover midpoint insertion, underflow → renormalization, and
concurrent-ish sequential inserts.

---

#### K.3 — Server data layer & actions skeleton

**Goal:** The query + mutation layer every surface builds on.

**Deliverables:**

- Query modules implementing the three payloads (home, board, card detail)
  from the Data fetching contract.
- Server actions for project/board/list/card CRUD and reorder/move, each
  starting with `sdk.auth.requireSession()` + membership/creator checks,
  returning `ActionResult`.
- `recordActivity()` helper wired into every mutating action.
- Authorization unit tests: a non-member cannot read or mutate a board
  through any action.

**Dependencies:** K.2.

**Review checklist:** authz tests prove non-member denial per action; all
mutations record activity rows; no action trusts client-supplied
`tenant_id`/user ids.

---

#### K.4 — Web Home: boards overview

**Goal:** The two-column web home per CONCEPT.md.

**Deliverables:**

- Secondary sidebar (Boards, Inbox) — check `packages/ui` for a reusable
  surface first (DS-first rule).
- Project sections: header (name, metadata, share/settings CTAs — CTAs may
  stub until K.12), board-card grid, trailing "Create New Board" card.
- Project CRUD (create/rename/delete with `ConfirmDialog`) and board create
  (name + color) dialogs.
- `loading.tsx` gate; `EmptyState` for zero projects.

**Dependencies:** K.3.

**Review checklist:** wireframe-first per `sv-ui-design`; create → appears
without reload; loading state shows on cold load; empty state has a clear
primary action.

---

#### K.5 — Web Board view: layout, lists & quick-add

**Goal:** The board screen rendering real data — everything except drag and
the card modal.

**Deliverables:**

- Board route with `loading.tsx`; header (board name, member avatars,
  search input placeholder wired in K.10, Share/Settings CTAs stubbed).
- Horizontal list layout; list header with name, card count, action
  menu (rename, delete, add card).
- Card tiles: title, label chips, due-date/checklist/comment indicators.
- Quick-add card and add-list inputs using `useCommitOnEnterOrBlur`.
- List rename inline; card single-click opens a placeholder overlay
  (real modal is K.6).

**Dependencies:** K.3 (K.4 not required — [parallel] with it if staffed
separately, but sequenced by default).

**Review checklist:** board payload is a single round trip (verify via
network panel); quick-add commits on Enter *and* blur; list menu operations
work end-to-end.

---

#### K.6 — Card detail modal (web): core fields

**Goal:** Single click opens the full card modal; core fields editable.

**Deliverables:**

- `?card=<id>` overlay routing (URL-addressable, back closes, `<Link
  replace>` for intra-overlay nav).
- `Dialog` (`lg`) with editable title, description (Markdown via DS
  `Markdown` for display), due date, labels (board-scoped label management +
  `TagInput`-style picker), checklist (add/toggle/reorder/delete).
- Assignee display + picker against board members (full member management is
  K.12; until then, members = creator).
- Card delete with `ConfirmDialog`.

**Dependencies:** K.5.

**Review checklist:** deep link `/kanban/boards/<id>?card=<id>` opens the
modal cold; every edit persists and reflects in the board's card tile;
checklist quick-entry commits on Enter and blur.

---

#### K.7 — Web drag-and-drop

**Goal:** Trello-grade drag: lists reorder; cards reorder and move across
lists. No handles.

**Deliverables:**

- dnd-kit `PointerSensor` (~6px distance constraint) — click still opens the
  modal; drag lifts with `DragOverlay`.
- Optimistic updates (`useOptimistic`) with rollback on `ActionResult`
  failure; fractional-position writes (one row per drop).
- Keyboard accessibility per dnd-kit sortable defaults (a11y contract).

**Dependencies:** K.6.

**Review checklist:** click vs drag never misfires (manual pass); a drop
issues exactly one UPDATE (verify via query logs); failed action visibly
rolls back with a toast; keyboard reorder works.

---

#### K.8 — Comments, replies & activity log

**Goal:** The card modal's discussion and audit sections.

**Deliverables:**

- Comments section: add, one-level replies, relative timestamps, author
  avatars.
- Activity section rendering `kanban_activity` (paged, newest first) with
  human-readable copy per activity type.
- Activity coverage audit: every K.3–K.7 mutation type renders correctly.

**Dependencies:** K.6 (activity data exists since K.3).

**Review checklist:** reply nesting capped at one level; activity copy is
plain language (no internal type names leak); pagination works past page 1.

---

#### K.9 — Board members & share

**Goal:** Real multi-user boards.

**Deliverables:**

- Share dialog (board header CTA): list members, add by user picker
  (platform directory — resolve the `sdk.directory` surface here), remove,
  owner-only management.
- Membership enforced end-to-end (queries + actions already check from K.3;
  this task makes the member list real).
- Member avatars in the board header; assignee picker now offers all
  members.
- Notifications: added-to-board, assigned-to-card via
  `sdk.notifications.send()`.

**Dependencies:** K.6.

**Review checklist:** two-user manual test — non-member 403s until added,
then sees the board; notification arrives with a working deep link; only
owners can manage members.

---

#### K.10 — Board search/filter (web)

**Goal:** The header search field filters cards in the current board.

**Deliverables:**

- Client-side filter over the loaded board payload (title + labels);
  match highlighting or dimming of non-matches; clear affordance;
  empty-result state per list.

**Dependencies:** K.5.

**Review checklist:** filter is instant (no server round trip); drag is
disabled or safe while a filter is active (decide and document in-code).

---

#### K.11 — Inbox (web) & notification wiring

**Goal:** The Inbox surface and the remaining notification triggers.

**Deliverables:**

- `/kanban/inbox` (web: sidebar entry): activity feed across boards the
  user belongs to, grouped by day, deep-linking into boards/cards.
- Comment-on-your-card and reply-to-your-comment notifications.
- Read/unread affordance (lightweight — a `last_seen_at` per user is
  enough; no per-row read state in Phase 1).

**Dependencies:** K.8, K.9.

**Review checklist:** feed shows only boards the user is a member of; deep
links land on the right card; unseen indicator clears on visit.

---

#### K.12 — Mobile navigation & Home

**Goal:** The mobile shell: custom footer + adapted boards overview. Start of
the mobile phase.

**Deliverables:**

- `MobileFooter` with Boards (left), untouched Launcher (center), Inbox
  (right); active-state per route. Footer height self-publishes (DS handles
  it — no plugin wiring).
- Home content adapted to one column (project sections stacked); Inbox
  reuses the K.11 feed in mobile layout.
- Web sidebar hidden on mobile; footer hidden on web (`useIsMobile` /
  `ResponsiveSurface`).

**Dependencies:** K.4, K.11.

**Review checklist:** verified on iOS simulator, not just narrow-viewport
browser; overlays (`Sheet`/`Dialog`) are not covered by the footer; no
double-footer on soft navigation in and out of the plugin.

---

#### K.13 — Mobile Board view: carousel & list menu

**Goal:** Swipable one-list-per-screen board.

**Deliverables:**

- `SwipableMobileCarousel` + `Slide`/`SlideHeader`/`SlideBody` + `Dots`
  (use `density="compact"` for many lists); list header shows name +
  card count + action menu (rename, delete, add card).
- Card tap opens detail (K.14 provides the full-screen surface; placeholder
  until it lands if built independently).
- Quick-add card per list; carousel index synced to URL via
  `useCarouselRouteSync` so refresh/back restores the list.

**Dependencies:** K.12.

**Review checklist:** simulator pass: fast multi-swipe never blanks a slide
(the `0.94.8`–`0.94.10` carousel fixes are load-bearing here — pin
`@sovereignfs/ui` ≥ 0.56.5); list menu reachable and complete.

---

#### K.14 — Mobile card detail (full-screen)

**Goal:** Tap a card → full-screen detail with everything the web modal has.

**Deliverables:**

- `Dialog size="full"` presentation of the K.6/K.8 card surface, restyled
  for mobile readability (sections stacked; comments and activity as
  collapsible sections or tabs).
- Same `?card=<id>` URL contract as web — one overlay routing
  implementation, two presentations.

**Dependencies:** K.13 (and K.8).

**Review checklist:** simulator pass; back gesture/button closes the detail
without leaving the board; all fields editable with the on-screen keyboard
(quick-entry inputs commit on the iOS Done key via blur).

---

#### K.15 — Mobile card reorder & "Move to…"

**Goal:** The decided mobile movement model: long-press vertical drag within
the list; menu-driven cross-list moves.

**Deliverables:**

- dnd-kit `TouchSensor` (`delay` ~220ms + `tolerance`) scoped to
  within-list vertical reorder only.
- Card action menu (long-press alternative entry: an explicit `…` affordance
  on the card or in the detail screen): "Move to…" with list picker and
  top/bottom position choice.
- Explicit gesture-conflict verification against the carousel (the
  sovereign-tasks dnd-kit/iOS-Safari `touchmove` finding): diagonal swipes
  must navigate lists, never lift a card.

**Dependencies:** K.13.

**Review checklist:** simulator gesture matrix documented in the PR: swipe
(clean + diagonal) → navigates; long-press + vertical → reorders; "Move
to…" round-trip works; no stuck hover states after touch.

---

#### K.16 — Phase 1 hardening & polish pass

**Goal:** Close the gaps a feature-by-feature build leaves.

**Deliverables:**

- Loading/empty/error state audit across every surface against the
  `sv-ui-design` checklist; toasts for every failed `ActionResult`.
- A11y pass: focus management in overlays, keyboard paths, aria labels
  ("App navigation" conventions).
- Performance sanity on a large board (200+ cards): board payload size,
  drag responsiveness, filter latency.
- README for the plugin (setup, permissions, screenshots).

**Dependencies:** K.7, K.10, K.15.

**Review checklist:** demo script exercised end-to-end on web and simulator;
no console errors/warnings on any surface; large-board numbers recorded in
the PR.
