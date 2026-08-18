# Sovereign Kanban — Phase 1 Technical Spec

> Technical design and task breakdown for the Phase 1 concept in
> [CONCEPT.md](CONCEPT.md). Tasks follow the platform epic format
> (`docs/epics/`): one task = one branch = one PR, sequenced unless tagged
> `[parallel]`. Prioritized build order lives in [ROADMAP.md](ROADMAP.md).

## Status

✅ Phase 1 complete — K.1–K.16 shipped, manifest at `1.0.0`.

K.16: Phase 1 hardening & polish pass
closed the gaps a feature-by-feature build leaves, rather than adding new
surface area. Four areas, each verified live rather than assumed from
reading the code:

**Loading/empty/error audit.** Walked every route's `loading.tsx` against
the platform's "states not pages" convention and found one real gap:
`/kanban/inbox` had no dedicated skeleton, silently falling back to the root
layout's "Loading boards" spinner label — wrong copy for that surface. Added
`app/inbox/loading.tsx`, matching the existing `PageContainer` + `Spinner`
pattern already used by `app/loading.tsx` and `app/boards/[boardId]/loading.tsx`.
`error.tsx` and the board-data query layer (`getBoardData`'s `Promise.all` +
`inArray` batching, no N+1) were both already correct on inspection — no
change needed there.

**Toast-coverage audit.** Cross-checked every `ActionResult`-returning
mutation's call site against the DS convention that a failed action must
surface via `toast.show({ category: 'error' })` or an inline error, using
`CardChecklist.tsx`'s already-correct `ChecklistComposer` (`onError(result.error)`
on failure) as the reference. Found two real, silent-failure outliers:
`AddListSlot.tsx` and `QuickAddCard.tsx` both awaited their `createList`/
`createCard` action and did nothing on `!result.ok` — a failed "Add list" or
"Add card" just silently closed the composer with no feedback, the exact
failure mode the platform's error-UX convention exists to prevent. Fixed
both to call `toast.show({ title, message: result.error, category: 'error' })`
before closing, matching every other mutation in the plugin.

**A11y pass.** Keyboard drag-and-drop reorder was verified end-to-end via
real `KeyboardEvent` dispatch (`Space` → lift, `ArrowDown` → move,
`Space` → drop) rather than just trusting `useSortable`'s built-in
`KeyboardSensor`: confirmed the correct `aria-live` announcements at each
step ("was moved over droppable area …"), the resulting DOM reorder, and a
real `POST` to the board's server-action endpoint confirming the move
persisted, not just a local optimistic update. Overlay focus management
(focus capture on open, restore on close, Tab-cycle trap, Escape-to-close)
was verified by reading `@sovereignfs/ui`'s shared `useOverlayFocusCapture`/
`useOverlayKeyboardTrap` (`overlay-shell.ts`) directly rather than via live
DOM testing — this session's browser automation environment had
`document.hasFocus()` return `false` throughout, a known limitation (real
`document.activeElement` changes still work via `.focus()`, but native
window-focus-dependent behavior can't be trusted from here), so code review
was the honest way to close this item. Every dialog surface in the plugin
(`CardDetailOverlay`, `MoveCardDialog`, `BoardShareDialog`,
`BoardSettingsDialog`, `HomeDialogs`, `form-dialog.tsx`) goes through the DS
`Dialog`, which wires both hooks internally — no plugin-local focus-trap
code exists to independently get wrong.

**Performance sanity on a large board.** Seeded a real 200-card list
directly into the dev sqld database (bypassing the app layer, via
`@libsql/client` against the `plugin_io_openfs_kanban` namespace) rather
than estimating. Payload: `transferSize` ~58KB / `decodedBodySize` ~329KB,
`domContentLoadedEventEnd` ~7.2s in dev mode (not representative of a
production build). Filter latency: effectively instant — verified via exact
match-count assertions while typing, not just eyeballing. Drag
responsiveness was the one real finding: dragging a card on the 200-card
board took ~1850–1860ms end-to-end (consistent across two runs) before any
fix, traced to `ListColumn` rebuilding its `cards` array by reference on
every `BoardView` render, cascading a re-render to every `CardTile` in the
list on every drag frame. Wrapped `CardTile` and `MobileCardTile` in
`React.memo` — safe because `cardById.get(id)` returns the same card object
across a reorder even though the containing array isn't referentially
stable, so per-key reconciliation still lets `memo`'s shallow-prop
comparison skip untouched tiles. Measured ~1520–1527ms after (consistent
across two runs), a real but modest ~18% improvement, not the dramatic fix
initially hoped for: `useSortable()` subscribes to dnd-kit's shared
drag-state context internally, so every sortable item still re-renders via
its *own* hook subscription on each drag frame regardless of `memo` on its
wrapper — `memo` only blocks parent-triggered re-renders, not this class.
The remaining ~1.5s at 200 cards (dev mode) is a known dnd-kit
characteristic at scale; closing it fully would mean list virtualization, a
change disproportionate to a hardening pass — documented here as a
deliberate scope boundary, not silently dropped. Test data and scratch
seeding scripts were removed after measurement; none of this is committed.

Also added the plugin [`README.md`](README.md) (features, permissions with
rationale, local dev setup) — the fourth K.16 deliverable, no bugs involved.

`0.15.0` → `0.15.1` fixes a real hydration mismatch
found live while testing K.14, reported directly rather than re-discovered:
`CardActivity.tsx` (and, on inspection, `CardComments.tsx` and
`InboxFeedList.tsx` too) called `timeAgo()` (`_lib/time.ts`) straight from
render — a plain function that calls `Date.now()` internally, so its output
depends on exactly when it runs. Whenever meaningful wall-clock time passed
between the server render and the client's first hydration pass, the
server's text ("2m ago") and the client's ("1m ago") disagreed, and React
couldn't reconcile the mismatch — a real, reproducible "Recoverable Error"
in the dev overlay on every card-detail open, not just a console warning:
the whole `CardDetailOverlay` dialog subtree got discarded and rebuilt
right after opening, a visible flash, and — caught live, not theorized —
this was what silently broke a programmatic `.focus()` call on the card
title input during K.14's own browser-automation testing (the input got
remounted as a new DOM node out from under the held reference). Not scoped
to K.14 at all — `CardActivity.tsx` was untouched by that task, and the
same bug hits the desktop modal (K.8) equally.

Fixed with a new `TimeAgo.tsx` client component: both the server render and
the client's first paint (before hydration compares them) render an empty
string — deterministic, nothing to mismatch — and the real relative label
fills in via a `useEffect` immediately after mount, a normal client-side
update rather than a hydration diff. This also incidentally closes a
second, separate hydration risk in `timeAgo()`'s own >30-day fallback
branch, which formats an absolute date via `Intl.DateTimeFormat(undefined,
...)` — locale-dependent, so a server whose Node locale differs from the
client browser's could mismatch there too; deferring the *entire* label to
post-mount sidesteps that class of bug as well, not just the relative-
bucket one, without needing a second fix. All three call sites (`
CardActivity`, `CardComments`, and `InboxFeedList` — the last a plain
Server Component with no `'use client'` of its own; rendering `TimeAgo` as
a child needs none, standard RSC composition) now go through this one
component rather than calling `timeAgo()` directly. `time.ts`'s own
`timeAgo()` function is unchanged — still the plain, correct-as-a-pure-
function utility; only how it gets *rendered* needed fixing, matching how
the bug was actually diagnosed.

Verified live across three separate fresh browser tabs (this session's
preview browser has had recurring React-scheduling flakiness since K.15 —
see that task's own status entry — so a single check on a possibly-stuck
tab isn't trusted on its own here): opened a card with real activity and
confirmed the dev overlay's issue count read `0` immediately after open,
where it previously read `1` on every single open; confirmed the same on a
card with real top-level comments and replies, and on `/kanban/inbox`
(exercising `InboxFeedList`'s Server-Component-parent case specifically);
and directly inspected the rendered caption elements to confirm real
relative-time text ("11h ago", "43m ago", etc.) fills in correctly post-
mount rather than the fix silently leaving them stuck blank. One check hit
a stale-looking blank state on a tab that turned out to be the
already-documented environmental flakiness, not this fix — confirmed by
immediately re-checking the identical URL in a brand new tab, which
rendered correctly; noted here rather than silently discarded since it's a
useful data point on how unreliable this session's browser surface had
become by this point, not a gap in the fix itself.

K.15: Mobile card reorder & "Move to…"
shipped — the decided mobile movement model (CONCEPT.md): long-press
vertical drag for within-list reorder, action menu only (never drag) for
cross-list moves. New `useMobileCardDndSensors()` (`_lib/dndSensors.ts`)
configures `TouchSensor` with a delay-based activation constraint (220ms +
8px tolerance) instead of web's short-distance `PointerSensor` — a plain
swipe (list navigation, even a diagonal one with real vertical wobble)
covers well more than 8px within the first frame or two, cancelling the
pending drag before the delay elapses and leaving the gesture to the
carousel's own native scroll-snap handling untouched; only a touch that
stays still for the full 220ms — a real long-press — ever activates. Each
`MobileListSlide` gets its own `DndContext`+`SortableContext` scoped to
exactly that list's own cards (a new `MobileCardTile` in `CardTile.tsx`,
reusing `CardTileBody`) — a separate instance per slide, not one shared
across the whole carousel, is what makes "within-list only" true at the
code level rather than true only because the other lists' cards happen to
be off-screen. Reorder itself mirrors `BoardView`'s existing
`useOptimistic` pattern, scoped down to one list's card-id array, computing
`moveCard`'s prev/next neighbour args via the already-tested `neighborsOf`.

**A real, proactively-caught touch-action bug, not just theory.**
`MobileCardTile` deliberately does NOT inherit `.cardTile`'s existing
`touch-action: none` (correct for web, where there's no competing
horizontal gesture) — `touch-action` is evaluated declaratively at
`touchstart`, before any JS (including dnd-kit's own delay-based
activation-constraint decision) runs, so `none` on the element a swipe
*starts* on would tell the browser to skip its own native scroll-snap
handling for that whole gesture regardless of whether dnd-kit ultimately
activates a drag or cancels — silently breaking the carousel swipe on every
touch that happens to start on top of a card (most of a slide's area).
Fixed with a `.mobileCardTile { touch-action: auto; }` override (declared
after `.cardTile` in the same file so it wins the tie), matching
`SwipableMobileCarouselSlideBody`'s own identical `.body` reasoning almost
verbatim. Also proactively gated `.cardTile:hover` behind
`@media (hover: hover)` — un-gated, it's a documented WebKit "stuck hover
after touch" risk (docs/architecture-rules.md), and `.cardTile` is now
shared with a real touch-drag surface for the first time. Both fixes are
directly responsive to this task's own review checklist items ("diagonal
swipes must navigate lists, never lift a card"; "no stuck hover states
after touch") — found by reading the DS's existing `touch-action`
documentation and this codebase's own architecture rules before writing
any test, not by trial and error.

**"Move to…"** is a new `MoveCardDialog.tsx`, reachable from `CardHeader`'s
existing "…" menu — gated `isMobile`-only (web already has drag for this,
K.7; a redundant menu entry there is outside K.15's own scope). A native
`<select>` (`@sovereignfs/ui`'s `Select`, using the OS's own picker — no
custom dropdown to fight on mobile) for the target list, deliberately
excluding the card's current list, and a `SegmentedControl` for a binary
top/bottom choice — not an arbitrary-position picker, matching SPEC's own
"top/bottom position choice" wording exactly. The prev/next-neighbour
computation for "drop at the very top/bottom of a target list" was pulled
into a new pure `topBottomNeighbors()` (`_lib/order.ts`, 4 new unit tests)
rather than left inline, matching this file's established pattern of
keeping mutation-adjacent logic testable without the DOM. Reuses `moveCard`
completely unchanged — the exact same action web's own drag-and-drop already
calls.

Verified live end-to-end, with real evidence, not just visual inspection:
opened a card, confirmed "Move to…" only appears on mobile and correctly
excludes the current list from the picker, moved a card to a different list
(target + position both selected), confirmed the dialog closed and the
card's "in `<List>`" breadcrumb updated immediately, then confirmed via a
completely fresh page reload that the move had genuinely persisted
server-side (the source list dropped to 0 cards, the target list gained
it). Long-press-drag reorder was verified via synthetic `TouchEvent`
dispatch (`touchstart`/`touchmove`/`touchend` with real ~350ms holds,
constructed after reading dnd-kit's own source to get two details right
that a naive test would have gotten wrong: (1) dnd-kit attaches its
move/end listeners directly to the *original* `touchstart` target, not
`document` — matching the real Touch Events API's own no-retargeting
behavior — so move/end events must be dispatched on that same original
element, not wherever the finger is now; (2) the delay-based activation
constraint uses `setTimeout`, confirmed by first observing the dragged
card's `opacity` flip to `0.4` and `aria-pressed="true"` after the hold,
*before* sending any move, isolating activation from the move/reorder logic
as two separately-verified steps rather than one combined guess). The full
sequence correctly re-ordered two cards in the DOM, and a
`POST /kanban/boards/…` (the `moveCard` server action) was confirmed in the
dev server's own request log; a fresh reload afterward showed the new order
had persisted. Also verified: the drag genuinely activates only after the
full hold (confirmed via the same opacity/aria-pressed check taken
immediately after touchstart+350ms, before any move was sent).

**Not verified live: the explicit swipe-vs-drag disambiguation itself**
(the review checklist's own headline scenario) **and the simulator gesture
matrix.** This session's browser preview became genuinely unreliable partway
through testing — a new, more disruptive issue than the "backgrounded tab
blocks real focus" limitation K.14 already documented: React's own
hydration/reconciliation intermittently stalled outright (a Suspense
boundary's resolved content stayed in an inert `<template>` and was never
swapped into the live tree; `useIsMobile()`'s mount effect stopped firing
at all, permanently stuck reporting desktop regardless of viewport width),
requiring a full dev-server restart to recover, and recurring again
afterward across fresh tabs despite multiple restarts and waits up to 15s.
Root cause not fully identified — plausibly this long session's accumulated
long-lived connections (the dev server's own request log showed
notification SSE streams open 100+ seconds) or React deprioritizing work it
perceives as background-tab-priority, compounding the already-documented
`visibilityState: "hidden"` limitation. The swipe-cancellation half of the
mitigation (tolerance-triggered cancellation) is dnd-kit's own standard,
widely-used `activationConstraint` mechanism — not custom logic — and the
activation-requires-holding-still half was directly verified (above), which
is the half specific to this integration; the untested half is the
library's own well-established behavior. Documented rather than
re-attempted a third/fourth time, matching K.12–K.14's own precedent for
this class of environmental limitation — including a fresh attempt at the
iOS Simulator, which was not repeated here given K.13's already-documented,
unresolved login text-entry blocker and this session's now-broader evidence
that the tooling itself, not just the simulator, is the limiting factor.

K.14: Mobile card detail (full-screen)
shipped. `CardDetailOverlay` now passes `size={isMobile ? 'full' : 'lg'}` to
`Dialog` — a real distinction only on desktop, since Dialog's own CSS
already forces every size to a full-screen sheet under 768px width
(confirmed by reading `Dialog.module.css`'s mobile media query directly);
`size="full"` is still the semantically correct value to pass for a surface
that's conceptually always-full-screen, matching the DS's existing lg/full
convention for overlay-shell plugins. Every field section (Labels, Due
date, Assignees, Description, Checklist) was already vertically stacked for
both surfaces — no change needed there. Comments and Activity, previously
two always-stacked sections, now switch via a new `Tabs`-based
`CardCommentsActivity` component **on mobile only**; desktop renders both
stacked exactly as K.6/K.8 built them, unchanged. The tab strip itself is
handed to the Dialog's mobile `OverlayHeader` second row via
`useOverlaySecondRow` — the same mechanism Account/Console already use for
their own tab strips — so it stays pinned above the scrolling content
instead of scrolling away with it. Both Comments and Activity stay mounted
at all times on mobile (toggled with a `display: none` CSS class, not
conditional rendering): unmounting the inactive one on every tab switch
would discard an in-progress, not-yet-submitted comment draft, undercutting
the "editing efficiency" CONCEPT.md explicitly calls out for mobile card
detail. Verified live: typed a draft comment, switched to Activity and
back, draft was still there.

**Two real findings from live testing, one fixed, one flagged out of
scope.** (1) Opening any card detail reliably triggered a Next.js
"Recoverable Error" — a hydration mismatch in `CardActivity.tsx`'s
`timeAgo(item.createdAt)` rendering (server and client can compute a
different relative-time bucket, e.g. "2m ago" vs "1m ago", depending on
real elapsed time between SSR and hydration). This is pre-existing (K.8),
untouched by K.14, and would affect the desktop modal too — not something
K.14 introduced or is scoped to fix. Flagged as a separate background task
rather than fixed inline, per this session's usual practice of not
absorbing unrelated bugs into an unrelated task's diff. (2) Closing the
card (both the explicit × button and the browser/device back
gesture) correctly returns to the list the card was opened from — verified
the back-button path specifically via real browser history
(`navigate({url:"back"})`, not just the × button), landing on
`?list=<id>` with `card` dropped, confirming K.13's `closeHref` mechanism
composes correctly with a real history-back navigation, not just an
in-app close click.

**Not fully verified: the review checklist's "quick-entry inputs commit on
the iOS Done key via blur" item**, and by extension the "simulator pass"
item — both for the same underlying reason. `useCommitOnEnterOrBlur`'s
`onBlur` path (the mechanism the checklist is asking about) could not be
exercised end-to-end in this session's browser preview: the preview tab
consistently reported `document.visibilityState === "hidden"` (confirmed
via direct query) regardless of which tab was created or selected, meaning
neither a real `element.focus()` call nor a `computer`-tool synthesized
click ever actually moved `document.activeElement` — a background-tab
browser restriction, not an application bug. The *identical* commit
path via Enter (`onKeyDown`, which doesn't depend on focus state at all)
was verified end-to-end with the same value-injection technique — typed a
new title, dispatched Enter, reloaded the page fresh, and the rename had
genuinely persisted server-side — giving reasonable confidence the
underlying `updateCard` plumbing is sound; only the blur-specific trigger
path itself couldn't be exercised. `useCommitOnEnterOrBlur` is a trivial,
three-line, unconditional `onBlur: onCommit` pass-through already used
identically by `CardHeader`'s title input since K.6 and `MobileListSlide`'s
rename input since K.13 — K.14 didn't touch it or introduce any new commit
path. A fresh iPhone 17 Simulator boot was attempted for real-device
verification (which would have real focus/keyboard semantics unlike the
preview tab), but hit the same login-form text-entry mechanics documented
in K.13's own status entry (`@` mistyped, no reliable way to clear/retype),
so a second full troubleshooting pass wasn't repeated — this is the same,
already-documented environmental limitation carried over from K.12/K.13,
not new information. Everything else in this task was verified live in the
browser preview at 390×844: the Comments/Activity tabs, draft preservation
across tab switches, the Labels popover and due-date `DatePicker` both
rendering correctly with zero horizontal overflow inside the full-screen
dialog, and both close paths (button and browser back) returning to the
correct list.

K.13: Mobile Board view (carousel & list
menu) shipped — a swipable, one-list-per-screen board using
`@sovereignfs/ui`'s `SwipableMobileCarousel` compound component
(`Slide`/`SlideHeader`/`SlideBody`/`SlideFooter` + `Dots`, `density="compact"`
above 5 lists). New `MobileBoardView.tsx` (the carousel + per-list slides,
each a new `MobileListSlide.tsx` — header with name/count/action-menu
`(Add card / Rename list / Delete list)`, a plain scrollable card list in
the body, `QuickAddCard` pinned in the footer) and a small `MobileBoardHeader`
(board name + a single overflow `Menu` for Share/Settings) added directly in
`BoardView.tsx`, gated by the same `useIsMobile()` branch K.12 established —
web's existing `PageHeader`/`DndContext`/`ListColumn` tree is completely
untouched. Card tap reuses K.6's existing `CardDetailOverlay` unchanged
(still `Dialog size="lg"`) as the explicitly-scoped placeholder K.13's own
spec calls for — restyling it to `size="full"` with mobile-optimized field
layout is K.14's stated deliverable, not this one's. `CardTileBody` (from
`CardTile.tsx`) and `DeleteListConfirm` (from `ListColumn.tsx`) were exported
and reused as-is for the mobile tile/delete-confirm — mobile cards are plain
`<Link>`s, deliberately not wrapped in dnd-kit's `useSortable` at all (no
`DndContext` ancestor exists on this branch): card reorder is K.15's
long-press gesture, not built yet, and list reorder isn't a K.13 or K.15
deliverable — CONCEPT.md's interaction table describes it as a future
"list action menu" affordance, but no Phase 1 task actually commits to
building it, so it's out of scope here too, noted as a deliberate gap rather
than silently dropped.

**The active slide syncs to `?list=<listId>`, but deliberately never through
Next's router** — `onNavigate` in `useCarouselRouteSync` calls
`window.history.replaceState` directly. This board's data model loads every
list and card up front in one `getBoardData` call (unlike a per-list-fetch
carousel); routing a swipe through `router.replace` would re-fetch that
entire RSC payload on every single swipe, exactly the "measurably laggier"
pattern `SwipableMobileCarousel`'s own doc comment warns against.
`usePathname()`/`useSearchParams()` are read exactly once (frozen at mount)
to seed the initial slide from a deep link or real reload; after that the
hook's own `activeIndex` state is the sole source of truth, and Next's router
state going stale relative to it is expected, not a bug. Opening a card still
goes through a real `<Link>` (existing, accepted per-open RSC cost, unchanged
from web) — each slide builds that href from its own `list.id` directly, not
from `activeIndex`, so it's correct even mid-swipe. `CardDetailOverlay`
gained an optional `closeHref` prop (defaults to the original bare-`pathname`
behavior, so web is untouched) — `BoardView` computes
`${pathname}?list=${cardDetail.listId}` for it on mobile, so closing a card
returns to the list it was opened from instead of silently resetting the
carousel to slide 0. Verified live: jumping to a non-adjacent list, opening a
card there, and closing it lands back on that same list, not "In Progress".

**Two real layout bugs found live, both via `getBoundingClientRect`
measurement, not the screenshot alone** (this session's established
technique — screenshots have repeatedly proven misleading across earlier
tasks): (1) first attempt gave the carousel `height: 100%`, expecting it to
inherit the already-correct available height from `.main` (which — confirmed
by direct measurement — genuinely does stretch to exactly the right
`100dvh`-minus-header-minus-footer span). It rendered collapsed to its own
content height instead, because `PageContainer`'s container box
(`boards/[boardId]/page.tsx`'s `<PageContainer maxWidth="full">`, unchanged
from web) is deliberately `height: auto` — most plugin pages are naturally
tall and page-scrolling, so percentage-height doesn't propagate through it
by design. (2) Switching to a direct `calc(100dvh - var(--sv-shell-header-
height) - var(--sv-shell-footer-height))` overshot 16px past the fixed
footer's own top edge, because that calc assumed the wrapper's own top
coincided with the header's bottom edge — it doesn't, `PageContainer`'s own
`padding-top` (`--sv-space-4`, confirmed via computed style: exactly 16px)
sits between them. Fixed by subtracting that token too. Final layout: a
single flex column (`MobileBoardHeader` + `.mobileBoardContent`, `flex: 1 1
auto; min-height: 0`) so the header's natural height and the carousel's
fill-the-rest height are computed relative to each other, not independently
guessed twice. Re-verified via measurement after the fix: `wrap.bottom`
(783) matched `footer.top` (783) exactly, zero overlap, zero gap.

Verified live at a 390×844 mobile viewport: dot-jump navigation between
lists (confirmed via both the settled `activeIndex` and the resulting
`history.replaceState`-updated URL); the board options menu (Share opens
`BoardShareDialog`, Settings opens the existing `BoardSettingsDialog`
full-screen, both unchanged from web); the per-list menu (Add card, Rename
list — input focuses and commits correctly; Delete list); the trailing
"Add list" slide (a plain `AddListSlot variant="empty"` slide with no
header, correctly excluded from the dot indicator's count so no dot is
active while viewing it); single-list boards correctly suppress the dot
indicator entirely (`orderedLists.length > 1` gate); and the empty-board
state (`EmptyBoard`, shared with web) still renders with `MobileBoardHeader`
above it, so Share/Settings stay reachable even on a board with zero lists —
otherwise a board created but not yet populated would have no way to reach
either on mobile at all, a real gap the K.9/K.11-established "board settings
must stay reachable" precedent made worth closing here even though K.13's
own deliverables bullet list doesn't spell it out.

**Not verified: the review checklist's "simulator pass" for a real touch
swipe gesture.** A fresh iPhone 17 Simulator boot (avoiding K.12's specific
stuck-`navigator.onLine` bug, which was tied to that simulator instance's
prior WebKit process state — this was a clean boot) reached the login screen
cleanly, but this simulator session's text-input mechanics proved
unreliable for entering a real login: the on-screen software keyboard never
rendered (an external/hardware-keyboard toolbar appeared instead), the
email field's `@` consistently typed as a literal `2`, synthetic backspace
characters were rejected outright ("only printable ASCII and newline can be
typed"), and an attempted text-selection drag gesture to clear and retype
the field instead triggered a stray navigation to a live google.com page —
a real, unrelated derailment, not a rendering bug in this plugin. After
several good-faith attempts to work around each of these independently,
concluded as a documented tooling/environmental limitation rather than
continuing to burn further attempts, matching K.12's own precedent for the
same checklist item. Everything else — including the exact settle/URL
mechanics a real swipe exercises via `onSettle`, verified identically to how
a real swipe would drive it via a direct `.click()` dispatch on the dot
indicator (bypassing only the touch input itself, not the app's handling of
it) — was verified live via the methods above. The underlying swipe/settle
mechanics themselves (`useSnapCarousel`'s "trusted run" gesture model) are
unchanged, already-hardened platform primitives (see this file's own
`0.94.5`–`0.94.10` CLAUDE.md history) — K.13 consumes them as-is rather than
modifying them, so this gap is about verifying a real device gesture
specifically, not about undiscovered risk in new code.

K.12: Mobile navigation & Home shipped —
the start of the mobile phase. `KanbanMobileFooter.tsx` (client) renders
`@sovereignfs/ui`'s `MobileFooter` (Boards left / Inbox right, each with a
`router.push` `onClick` rather than `FooterIcon`'s `href`, preserving
client-side navigation — same reasoning as the platform's own `MobileNav`)
plus `MobileAppsDrawer` for the center "Apps" launcher. Per SPEC's explicit
"untouched Launcher" wording, the drawer shows the *real* installed-plugins
list, not a kanban-scoped substitute: `shellConfig.mobileFooter: false`
(already set from scaffolding) removes the platform's own `MobileNav` —
including its Drawer — entirely on this plugin's routes, so there's no
shared platform drawer instance left to hook into. `sdk.plugins.list()`
(RFC 0051) is the documented, permission-free way to reconstruct it instead:
fetched server-side in `layout.tsx` alongside the existing
`hasUnseenInboxActivity()` call, filtered to `availableToUser`, and passed
down as plain serializable `MobileAppEntry[]` data — never JSX — across the
client boundary, with icon URLs built via the same `/plugin-icons/<id>.svg`
convention `runtime/app/(platform)/layout.tsx` uses. The Inbox icon carries
the same unseen-dot badge the desktop sidebar shows (K.11's
`hasUnseenInbox`, already computed once per navigation in `layout.tsx`).
Home's "adapted to one column" deliverable needed zero code changes — K.4's
original `.projectGrid { grid-template-columns: repeat(auto-fill,
minmax(200px, 1fr)) }` already collapses to a single column at mobile
widths, confirmed live rather than assumed.

**Two real bugs found live, not by any check that renders in isolation:**
(1) `layout.tsx` (an `async` Server Component) initially rendered
`<ResponsiveSurface web={null} mobile={<KanbanMobileFooter .../>} />`
directly — crashed every page load at mobile width with "Attempted to call
useResponsiveLayout() from the server but useResponsiveLayout is on the
client." `ResponsiveSurface.tsx` has no `'use client'` of its own by design
(confirmed by reading its source); every real consumer elsewhere in the
monorepo (`example-mobile/app/_components/MobileShowcase.tsx`) only ever
renders it from *inside* an already-`'use client'` component, never
straight from a Server Component's JSX. Fixed by dropping `ResponsiveSurface`
from `layout.tsx` entirely and calling `useIsMobile()` directly inside the
already-client `KanbanMobileFooter`, with an early `if (!isMobile) return
null` placed after every other hook so hook-call order never changes across
renders. (2) After fixing (1), the footer visibly squeezed `.main` to a
143px-wide column at a 390px viewport — confirmed via `getBoundingClientRect()`
measurement, not trusted from the screenshot alone, since this session's
earlier tasks repeatedly showed screenshots can carry capture/scaling
artifacts. Root cause: `MobileFooter.module.css`'s `.footer` is
`position: relative` by design (the platform's own `MobileNav` instead uses
`grid-row: 3` in a CSS Grid shell to take it out of flow), so as a third
child of kanban's plain `display: flex` `.shell` it competed with the
sidebar and `.main` for horizontal space instead of overlaying the viewport
bottom. Fixed with a new `.mobileFooterFixed` wrapper
(`position: fixed; bottom: 0; left: 0; right: 0`) around
`KanbanMobileFooter`'s return, taking it out of `.shell`'s flex flow;
re-verified via measurement that `.main` returned to full width with zero
scroll overflow, and that `--sv-shell-footer-height` still self-published
correctly (`"61px"`) from inside the fixed wrapper onto `#sv-app-shell`.

Verified live at a 390×844 mobile viewport (matching iPhone dimensions),
using precise DOM measurement rather than screenshots alone for the
layout-correctness claims: `.main` full-width with no overflow; footer
correctly pinned to the viewport bottom with content clearing it via the
platform's own `--sv-shell-footer-height` consumption
(`shell.module.css`'s `.content` padding-bottom); the Board settings
`Dialog` renders as a full-screen sheet with all content clear of the
footer; the Apps drawer shows the real installed-plugins list (including
Kanban and Launcher); navigating Kanban → Launcher → back to Kanban shows
exactly one footer element at every step (no double-footer); Home renders
correctly in one column; the Boards footer icon shows the correct active
state on `/kanban`. **Not verified: the review checklist's explicit
"verified on iOS simulator, not just narrow-viewport browser" item.**
Attached to a booted iPhone 17 Simulator and navigated to `/kanban`, which
redirected to `/login` fully blocked by this codebase's own documented
offline gate ("You're offline. Connect to the internet to sign in.") with
no form fields reachable. Investigated rather than assumed broken: pressing
HOME showed the native Maps app rendering real live map tiles, proving the
simulator has genuine working connectivity at the OS level; the login
page's own HTML/CSS/JS visibly loaded successfully first (the full "Sign in
to Sovereign" card rendered) before the client-side offline check ran,
meaning the actual HTTP fetch to `localhost` succeeded — so the gate's
`navigator.onLine`-based signal is a false positive, not a real network
failure. Tried reloading (no change) and a full force-quit + relaunch of
Safari via the app switcher (no change, same result on the very first
load) — ruling out simple cache/process-state staleness. This matches a
known WebKit-in-Simulator quirk where `navigator.onLine` initializes
`false` and only updates on a genuine interface transition event, which
never fires if the interface was already up at process start; this
particular simulator's Settings app exposes no Wi-Fi/Airplane Mode toggle
to force one (Simulator networking proxies the host Mac directly). Concluded
as a documented environmental limitation of this session's tooling, not a
defect in K.12's code — which was already verified thoroughly via precise
DOM measurement at the same viewport dimensions — rather than attempting a
full simulator erase, which would risk discarding unrelated state (an
already-authenticated session for a different plugin was already present on
this same simulator on first attach). Matches K.9's precedent for a
documented good-faith-effort limitation.

K.11: Inbox (web) & notification wiring
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
