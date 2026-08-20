# Sovereign Kanban — Phase 1 Technical Spec

> Technical design and task breakdown for the Phase 1 concept in
> [CONCEPT.md](CONCEPT.md). Tasks follow the platform epic format
> (`docs/epics/`): one task = one branch = one PR, sequenced unless tagged
> `[parallel]`. Prioritized build order lives in [ROADMAP.md](ROADMAP.md).

## Status

✅ Phase 1 complete — K.1–K.16 shipped. 🚧 Phase 2 in progress — K.17–K.19
shipped, manifest at `0.20.7`; K.20 partially shipped within the same
version (see its own entry below and the ⬜/✅ breakdown in K.20's own
task section) — full K.20 completion is still pending, not yet a version
bump of its own.

**Card detail modal header/layout retouch, three rounds of direct
developer feedback on the same modal (0.20.6 → 0.20.7).** (1) **Header
vertical alignment + delete affordance.** The header row (title input,
ellipsis-vertical menu trigger) read as misaligned against `Dialog`'s own
independently-positioned `.close` button, and the ellipsis menu's only
non-mobile-relevant item was "Delete card" — no reason to hide a single
destructive action behind a menu on desktop. Desktop now renders a direct
trash-icon `Button` instead of the `Menu`; mobile keeps the `Menu` (still
needed there for "Move to…", the non-drag cross-list move path, K.15).
Made the header row `position: sticky` (bled to the panel's real top edge
via the same `margin`/negative-inset recipe used elsewhere in this modal)
so it stays pinned while Comments/Activity scroll beneath it — desktop
only; mobile already has its own permanently-pinned title via `Dialog`'s
`OverlayHeader`, so mobile keeps the plain non-sticky layout
(`.cardHeaderMobile`) to avoid a persistent duplicate title bar, caught
live at a real 375px viewport before shipping (worse than the old
one-time scroll-away duplication). **First sticky-alignment attempt was
wrong, caught by live measurement, not by report:** assumed bleeding to
the panel's real top edge would land the title at `.close`'s own vertical
center "as a side effect" — `getBoundingClientRect()` after implementing
showed the same 16px delta that had motivated the original hack, since
bleeding to the edge changes where the row's box starts, not its own
center's relationship to an independently-positioned sibling. Fixed with
an explicit `padding-top` reduction on the header (tuned live to
`--sv-space-2`, later `--sv-space-1` — see below); re-verified
`titleCenterY === deleteCenterY === closeCenterY` exactly via
`getBoundingClientRect()` before calling it done. (2) **Tab-panel height
stability.** Switching Comments ↔ Activity visibly resized the whole
dialog every click, since the two panels rarely have the same content
length. Added `.cardTabPanels { min-height: 14rem; }` around both panels
(kept mounted at all times, toggled via a CSS class — not conditional
rendering, so an in-progress comment draft survives a tab switch) — stops
the *common* short-content jump without making the dialog truly
fixed-height; content taller than the reserved minimum still grows it,
same as the dialog's own content-driven-height behavior everywhere else.
(3) **Multi-line description/comment rendering bug, found from developer
report, not assumed.** A card description saved via the plain multi-line
`<textarea>` composer rendered back as a single run-on line. Root cause:
`CardDescription.tsx` rendered it through `@sovereignfs/ui`'s `Markdown`
component, whose paragraph handling deliberately joins consecutive
non-blank lines with a single space (CommonMark-lite soft-wrap, meant for
authored long-form content like a privacy policy — its own docstring says
so) — collapsing every real Enter-press a user typed. Fixed at the DS
layer with a genuine new `Markdown` capability rather than a plugin-local
workaround: a `preserveLineBreaks?: boolean` prop (`packages/ui`, now
`0.59.0`) that renders each line joined by `<br />` instead of a joined
paragraph when set; `CardDescription.tsx` opts in. Added a Storybook story
(`PreserveLineBreaks`) and a new test file (`Markdown.test.tsx` — none
existed before) covering the default-unchanged case, the new
line-preserving case, that a blank line still starts a new paragraph
under the new prop, and that headings/quotes/lists are unaffected.
**Proactively found and fixed the identical bug class in
`CardComments.tsx`**, not explicitly reported but the same root cause —
comment bodies are plain text (no `Markdown` involved at all), just
rendered inside an ordinary `Typography` whose CSS default
(`white-space: normal`) collapsed newlines the same way; fixed with a
`.commentText { white-space: pre-wrap; }` class, no DS change needed
since this was a plain-text rendering choice, not a Markdown-semantics
one. (4) **Close icon.** `Dialog`'s desktop close button used a literal
`×` text character sized via `font-size`; mobile's own `OverlayHeader`
close button already used a real `Icon`. Swapped desktop to
`<Icon name="circle-x" size="md" />` (`packages/ui`, same `0.59.0`) for
visual consistency with mobile and every other icon-driven affordance in
the design system — platform-wide, since `Dialog` has no per-instance
close-icon override; every consumer gets it. Removed the now-dead
`font-size`/`line-height` overrides from `.close` (`Icon`'s own `size`
prop controls sizing now). `Dialog.test.tsx`'s existing close-button
assertions are aria-label-based (`getByRole('button', { name: 'Close' })`),
not text-content-based, so this needed no test changes — re-ran the
existing 10/10 to confirm. (5) **Breadcrumb removal.** The "in
{listName}" caption under the header was redundant with the card's
already-visible board-column context and added a second wrapped line to
an already-busy header row — removed the JSX, the now-unused `listName`
prop/plumbing (`CardHeader`'s props, `CardDetailOverlay`'s own
`list`/`listName` lookup), and the now-fully-dead `.cardBreadcrumb` CSS
rule (confirmed via grep it had no other reference). (6) **Title field
sizing.** "The title field can be a bit longer" — genuinely ambiguous
(width/height/Trello-style multi-line wrap); interpreted as taller/more
prominent given the field was already `flex: 1 1 auto` (full available
row width) and the breadcrumb's removal freed up the row for the title to
be the visually dominant element. Increased `.cardTitleInput`'s vertical
padding (`--sv-space-1` → `--sv-space-2`). This regrew the header row's
own height, which — since the header is sticky with a fixed top and the
close button is independently absolutely-positioned — shifted every
child's vertical center down relative to `.close`'s fixed position by the
same amount live-measurement had tuned away in (1). Re-measured rather
than assumed: reduced the header's `padding-top` one step further
(`--sv-space-2` → `--sv-space-1`) and re-verified
`titleCenterY === deleteCenterY === closeCenterY` exactly again. All six
changes verified live in the browser preview on both desktop (≥768px) and
a real 375px mobile viewport — including typing a real multi-line
description end-to-end (composer → save → re-render) to confirm the
`preserveLineBreaks` fix works outside its own unit tests, not just
inspected in code. Full check suite green: typecheck (this plugin),
`pnpm exec eslint` (this plugin + the two touched `packages/ui`
components), `pnpm exec prettier --check`, `pnpm design:tokens:check`,
and `pnpm exec vitest run` across this plugin + `Dialog` + `Markdown`
(114 tests, 8 files, all passing).

**Card detail modal retouch, follow-up on "item 3" from the polish batch
below — developer picked three concrete areas from a multi-select
question rather than a free-form "make it nicer" ask**: section rhythm/
spacing, the empty-state "+" buttons, and description/checklist field
styling. (1) **Section rhythm.** Labels/Due date/Assignees were three
full-width stacked `.cardSection`s, each at the same visual weight as the
much bigger Description/Checklist blocks below them — a long uniform
list with no sense of grouping. Wrapped the three in a new `.cardMetaRow`
flex row (`flex: 1 1 12rem` per field, wrapping down to one column at
narrow widths — verified at both the `xl` dialog's full 48rem and a real
375px mobile viewport, no separate mobile-specific stacking needed) with
a `border-bottom` marking where "card metadata" ends and "card content"
begins, a boundary that didn't exist before. (2) **Empty-state "+"
buttons.** `.chipAddButton` (Labels/Assignees) was a 24px dashed-circle
icon-only button regardless of whether the row already had content —
developer feedback that the dashed style specifically read as a
disabled/placeholder region (the same dashed language this codebase
otherwise reserves for full "+ Add list"/"+ New board" cards, never a
bare unlabeled icon). Split into two states: **empty** now shows a real
text CTA ("+ Add label" / "+ Add assignee", `Button variant="ghost"` with
icon + text, new `.chipAddTextButton`) — unambiguous even with nothing
else in the row for context; **populated** keeps a small icon-only
trigger beside the real chips/avatars that already establish "this is a
collection," but with the dashed border removed entirely — now matches
every other icon-only ghost `Button` in this codebase (transparent at
rest, background only on hover) instead of a bespoke style that only
existed here. (3) **Description/checklist empty-state styling.** The
empty description box used `background: var(--sv-color-surface-sunken)`
— developer feedback this read as a disabled field, not an invitation.
Added a `.descriptionViewEmpty` modifier (dashed border, transparent
background, sunken fill only on hover) applied only when
`!card.description`; a real, filled-in description keeps the original
plain sunken-card treatment unchanged — the dashed language is
specifically for "nothing here yet," not for real content. Checklist's
"+ Add an item" was plain muted ghost-button text with no visual
container, reading as inert label copy rather than a clickable row —
given the same dashed-bordered-row treatment via a new
`.checklistAddTrigger` class *added alongside* (not replacing)
`.addCardTrigger`, since that class is shared with `QuickAddCard`'s
list-footer "+ Add a card" trigger, deliberately left untouched (out of
scope, not something flagged). Verified live end-to-end at both `xl`
desktop and a real 375px mobile viewport, on both an empty card
("Newsletter revamp": Add label / No due date / Add assignee, dashed
description + checklist rows) and a populated one ("Reach out to partner
brands": one real assignee avatar next to a plain undashed "+", "Add
label" still showing since that card has no labels) — confirms the
empty/populated split renders correctly per-field, not just per-card.
Full check suite clean (100/100 tests, typecheck, design-tokens,
prettier).

**Card detail modal polish, developer-requested against a real screenshot
(four-item list; the fourth, a broader "real re-touch," is still open —
see the follow-up question)**: (1) **Width.** `Dialog`'s existing sizes
jump straight from `md` (36rem/576px) to `lg` (a true 100%/100% fixed box
— the overlay-shell-plugin size, meant to hold still while Account/Console
switch internal views). Neither fit "a bit bigger, not full screen" for a
form-heavy modal like this one. Added a genuinely new `Dialog` size,
`xl` (48rem/768px, `packages/ui`, `@sovereignfs/ui` now `0.59.0` — a
minor bump, same precedent as adding a new DS icon earlier this session:
additive, not breaking) rather than hacking a one-off width override into
this plugin's own CSS — Dialog exposes no `className`/style-override prop
at all, and a missing "in-between" size is exactly the kind of DS gap this
codebase's own DS-first placement rule says belongs in `packages/ui`, not
patched around locally. Added the matching Storybook story
(`ExtraLarge`) and a unit test (`supports the xl size`), same pattern as
the existing `sm`/`full` coverage. `CardDetailOverlay.tsx`'s own
`size={isMobile ? 'full' : 'md'}` → `'xl'`. (2) **Title border +
"weird alignment" with the close button.** Root-caused via
`getBoundingClientRect()`, not eyeballed: `Input`'s own base CSS sets
`width: 100%` unconditionally, which — as a flex item inside `.cardHeader`
(`flex: 1 1 auto`) — fought that sizing and claimed the *entire* row for
itself, wrapping the ellipsis "Card options" button onto its own line
below the title (visible live: two rows instead of one, throwing off
every alignment downstream, matching the screenshot). Measured the actual
title box before touching anything: `titleInput.right` (828px) landed
20px *inside* the close button's own span (808–840px) — a real box
underlap, not a visual illusion. Fixed with `width: auto !important` +
`min-width: 0` on `.cardTitleInput` (letting `flex: 1 1 auto` govern
sizing the way it does for every other flex-embedded control in this
file) plus `padding-right: var(--sv-space-5)` on `.cardHeader` — 20px,
computed exactly as `.close`'s width (32) + its own right offset (12)
minus `.content`'s own right padding (24), not a rounded-up guess; same
"reserve exact clearance for the fixed-position close button" technique
already established for `ManageProjectDialog`'s sticky header earlier
this session. Border/background also removed by default (restored on
hover/focus only) so the title reads as a heading with an inline-edit
affordance, not a permanently-boxed form field — the specific "get rid of
the border" ask. Re-measured after the fix: ellipsis button's own right
edge lands at exactly 808px, flush against the close button's left edge
with zero overlap. (4, done ahead of 3) **Comments/Activity as tabs on
desktop.** K.14 already built this tab-switching pattern for mobile
(`CardCommentsActivity`, `useOverlaySecondRow` handing the tab strip up to
the Dialog's mobile header) — extended the same `Tabs` component to
desktop too, rendered inline in the body instead (no mobile header to
hand it to there). Both panels stay mounted at all times on both surfaces
now (toggled via a CSS class, not conditional rendering) — unmounting the
inactive one on every switch would discard an in-progress, not-yet-
submitted comment draft, the same reasoning K.14 already established for
mobile, now extended to desktop. **A real duplication caught live while
verifying this, not by report**: `CardComments`/`CardActivity` each
render their own "Comments"/"Activity" `Typography` label heading inside
their own section — always redundant once wrapped in an already-labeled
tab (present on mobile since K.14 shipped, just newly visible now that
desktop shows the same structure). Removed both labels; the tab strip
alone names the section on both surfaces now. Verified live end-to-end on
both surfaces: desktop shows the wider `xl` panel, a borderless title
with zero close-button overlap (re-measured, not just re-screenshotted),
and working non-duplicated tabs; mobile re-checked at a real 375px
viewport to confirm the K.14 pinned-header tab behavior is unaffected by
any of the above. Full check suite clean across both packages: kanban
plugin 100/100 vitest + typecheck + design-tokens + prettier,
`@sovereignfs/ui` typecheck + 437/437 vitest (436 + the new `xl` test) +
lint + prettier. **Item 3 — "this UI needs a real re-touch" — deliberately
not guessed at**: too open-ended to implement blindly per this repo's own
wireframe-before-build convention for anything touching a materially
broad surface; asked the developer directly which specific aspects to
prioritize rather than unilaterally redesigning a dozen visual details
(see the question asked in the same turn as this entry).

**Board route renamed `/kanban/boards/[boardId]` → `/kanban/b/[boardId]`,
developer-requested** (a follow-up on the URL discussion from the
copy-link feature just below — asked directly whether `boards/`,
`board/`, or `b/` read best; picked `b/` over the codebase's one other
precedent for this pattern, `sovereign-plugin-shopper`'s `/lists/[listId]`,
a deliberate one-off rather than a mistake). **No redirect from the old
path** — a developer choice, explicitly scoped out: any already-sent
notification whose `url` was recorded before this change (real or seeded)
now 404s, since notification rows store a plain string, not a live
reference recomputed on read. Acceptable for a pre-1.0 local/dev instance;
would need revisiting before this pattern is used on a route with a real
production audience carrying old links. Mechanical rename across every
site a full-repo grep turned up: the route directory itself
(`app/boards/[boardId]/` → `app/b/[boardId]/`, `git mv` to preserve
history), 3 notification-URL sites in `actions.ts`, the board-tile `Link`
in `HomeView.tsx`, the copy-link URL in `BoardShareDialog.tsx` (today's own
feature, added earlier this session), `InboxFeedList.tsx`'s deep links, the
two `pathname.startsWith('/kanban/boards')` active-nav-state checks
(`KanbanSidebar.tsx`, `KanbanMobileFooter.tsx`), a doc comment in
`app/(home)/layout.tsx`, and 2 test assertions in `actions.test.ts`.
Confirmed via a platform-level check before starting that nothing needed
updating outside the plugin: `RESERVED_API_SEGMENTS`
(`runtime/src/api-namespace.ts`) only governs `/api/*` first-segments, has
nothing to do with plugin page routes, and no middleware/`next.config`
reference this path pattern either. Historical `Status`-section narrative
entries elsewhere in this file that cite the *old* path (K.7's drag
verification log, K.9's own share-dialog writeup, the two production
incident entries under `0.17.x`, etc.) were deliberately left unchanged —
they're accurate records of what was true when they were written, not a
live reference; only genuinely load-bearing *current* documentation (the
`## Routes` table, K.6's own review checklist, this file's own
"Notification URLs deep-link to…" line) was updated to the new path.
Verified live end-to-end: board-tile links, the copy-link field, and both
active-nav-state checks (desktop sidebar highlight and the mobile footer's
"Boards" tab, checked at a real 375px viewport) all resolve to
`/kanban/b/<id>`; navigating there directly renders the full board (lists,
cards, avatars, Share). Full check suite clean (100/100 tests, typecheck,
lint, design-tokens, prettier).

**`BoardShareDialog` title, copy-link, and project-scoped add-picker
(K.20's first deliverable), developer-requested directly**: three related
asks against the same dialog. (1) Same missing-desktop-title gap as
`ManageProjectDialog`'s own fix earlier this session (`Dialog`'s `title`
prop only renders in the mobile `OverlayHeader`) — added a `Typography
variant="h3"` heading, reusing the now-generic `.dialogStickyHeader` class
(renamed from `.manageDialogHeader` — see its own comment for why sticky
is warranted: this dialog's content, member list + candidate picker, can
genuinely scroll past a short viewport the same way `ManageProjectDialog`'s
did). (2) A new `BoardUrlRow`: a read-only `Input` showing
`${origin}/kanban/boards/${boardId}` plus a "Copy" button (`Icon`
flips `copy`→`check`, label flips "Copy"→"Copied", 2s, same pattern as
Console's `LicenseGenerator.tsx`). Built the URL from `boardId` inside a
`useEffect`, not `window.location.href` read during render — reading a
browser global at render time in a `'use client'` component is one of this
repo's own hard architectural rules (server render has no `window`, client
render does — a hydration mismatch), and `window.location.href` verbatim
would also wrongly carry a `?card=…` query param whenever the dialog is
opened while a card's detail overlay is showing, handing out a link to one
specific card instead of a general board invite. **A real robustness gap
found and fixed while live-testing this, not by report**: the initial
`copy()` had no error handling around `navigator.clipboard.writeText()` —
harmless when it succeeds, but any rejection (permission denied, a
non-focused document — the exact case this session's own browser-preview
tooling hit, `"Document is not focused"`) surfaced as a genuine unhandled
promise rejection, caught live via Next.js's dev error overlay ("1 Issue"
badge) after clicking Copy. Wrapped in a `try`/`catch`; a failure now shows
a toast ("Couldn't copy link… Copy the URL from the field above instead")
instead of crashing silently into dev-only chrome (and, in a real user's
browser, an uncaught rejection with no such overlay to at least surface it
by accident). (3) The actual K.20 deliverable: `MemberPicker` now sources
candidates from a new `getBoardMemberCandidates` action — the board's
project members not yet on the board — instead of `searchBoardMemberCandidates`'s
old live `sdk.directory.searchUsers` call. Fetched once per dialog open
(not per keystroke); the text field filters that already-fetched list
client-side, no server round-trip per character, since project membership
is a small, already-known set rather than the full user directory
`ManageProjectDialog`'s own project-level picker still legitimately
searches. Added matching "Everyone on this project is already on the
board" / "No matches" states, same `.memberResultStatus` pattern
established for `ManageProjectDialog` earlier this session. **Also
hardened `addBoardMember` itself**, not just the picker that feeds it:
added a `getProjectRole` check (after the existing directory-existence
check, so a genuinely nonexistent user still gets "could not be found,"
not a message implying they exist but lack project access) rejecting
anyone who isn't already a project member with "Add them to the project
first." — an action is a public POST endpoint dispatched by action id per
this file's own header docstring, so a picker that only *offers*
project members would still leave a forged or scripted direct call able
to hand board access to a total stranger. This rippled through roughly a
dozen existing K.9 tests that added a board member without first adding
them to the project (`setup()`'s own board owner is automatically a
project member via `createProject`, but every `newcomer`/`commenter`/
`'user-other-member'` fixture wasn't) — each now calls `addProjectMember`
first, with `harness.sentNotifications` cleared afterward where a test
asserts a specific notification count (`addProjectMember` sends its own
"added to project" notification, same fire-after-commit pattern as
`addBoardMember`). Replaced the stale "search excludes existing members"
test (assumed the old live-search behavior) with one asserting the new
project-membership-sourced set directly, and added a dedicated test for
the new `addBoardMember` rejection. **New DS icon**: no `copy` icon
existed in the curated Lucide set (`packages/ui/src/components/Icon/icons/`)
— added `'copy'` to `scripts/icon-list.ts` and regenerated via
`pnpm generate:icons`, matching the exact process this repo already used
for `user-round-plus` (same commit precedent, same `0.56.6→0.57.0` minor
bump pattern — `@sovereignfs/ui` bumped `0.57.1→0.58.0` here). Regenerating
incidentally also refreshed two other icons (`calendar`, `carrot`) whose
committed `.tsx` output had drifted from the currently-pinned `lucide`
version (`1.28.0`) — exactly the stale-icon risk `generate-icons.ts`'s own
file-level comment warns about and explicitly instructs to accept ("review
the full diff, not just the icons you meant to touch") rather than revert.
No Storybook update needed — `Icon.stories.tsx`'s `AllIcons` story derives
its icon list from `Object.keys(ICONS)` dynamically, so the new icon
appears automatically. Verified live end-to-end: title renders, the URL
field shows the correct board-scoped link (no stray `?card=` param),
"Copy" degrades to a toast instead of an unhandled rejection, and a real
project member ("Dev Auditor", not yet on this board) appears in the
picker, gets added successfully (member list, header avatar stack, and
the picker's own "everyone already on the board" empty state all update
correctly), matching this plugin's own established
derive-dialog-target-from-live-props discipline throughout. Full check
suite clean across every touched package: kanban plugin 100/100 vitest +
typecheck + lint + design-tokens + prettier, `@sovereignfs/ui` 436/436
vitest + typecheck. Manifest bumped `0.20.2` → `0.20.3` — a minor-shaped
change in substance (new server action, new authz check, new DS icon) kept
inside the `0.20.x` line rather than jumping to the `0.21.0` slot
`ROADMAP.md` reserves for K.20's *full* completion, since two of that
task's three deliverables (board-owner-parity, visibility toggle) remain
unshipped — see K.20's own task section for the itemized breakdown.

**Ellipsis padding-zeroing fix left the hover highlight unbalanced,
developer-reported from a real (non-preview-browser) screenshot** —
follow-up on the overlap fix directly below: zeroing only `padding-left`
stopped the box overlap, but left the button's own padding asymmetric (0
left, 12px right, the ghost `Button` default), so its hover/pressed
background — sized to that box — sat flush against the icon's left edge
and ballooned out on the right, reading as visibly lopsided. Worked out
the general constraint this whole class of fix is bound by: hitting an
exact target gap (here, 8px, matching the row's other gaps) while keeping
the box's own edge clear of its neighbor's requires `padding ≤ gap` —
with the *default* ghost `Button` padding (12px) bigger than the flex gap
(8px), no margin value can satisfy both non-overlap and an exact 8px match
while padding stays symmetric; that's *why* the first two attempts each
sacrificed a different thing (attempt 1: overlapped; attempt 2:
asymmetric). Landed on a third version that reduces the padding itself
(symmetric, `--sv-space-1` = 4px both sides — safely ≤ the 8px gap) via a
new `padding-left`/`padding-right` override on `.boardOptionsTrigger`,
paired with a correspondingly smaller `margin-left: calc(-1 *
var(--sv-space-1))` on `.boardOptionsMenu` (was `--sv-space-3`) — this
satisfies all three constraints together: exact gap match, zero box
overlap, and a genuinely symmetric (centered) hover highlight. Also had to
update `.boardOptionsMenu`'s existing `margin-right` formula (the
account-avatar alignment fix, an unrelated concern) to reference the same
new `--sv-space-1` padding term instead of the old `--sv-space-3`, since
that formula bakes in the button's own padding-right value — left
unchanged, it would have silently drifted the glyph out of alignment with
the avatar above once the padding itself changed. Verified live: re-
measured after the fix — `paddingLeft`/`paddingRight` both `4px`
(symmetric, confirmed via `getComputedStyle()`), a real 4px clearance
between the two buttons' boxes (`900 − 896`, zero overlap), the icon
itself landing exactly 8px from Share's edge (`900 + 4 = 904`, matching
the row's other gaps), and the avatar-alignment formula still holding (1px
residual, same as before — icon/avatar right edges essentially flush).
Full check suite clean (99/99 tests, typecheck, design-tokens, prettier).

**Board options ellipsis genuinely overlapped Share's box, reported from a
hover screenshot**: developer reported the ellipsis trigger's hover
background visibly cut into a corner of the Share button beside it.
Measured directly via `getBoundingClientRect()` before touching anything —
confirmed a real, non-visual overlap: the ellipsis button's own box
started 4px to the *left* of Share's right edge (`ellipsisRect.left −
shareRect.right = −4`), not just a perceived crowding. Root cause was an
existing fix (`.boardOptionsMenu`'s `margin-left:
calc(-1 * var(--sv-space-3))`) that aligned the ellipsis *glyph* correctly
(matching the row's other 8px gaps) but did so by shifting the trigger's
*whole box* left by its own horizontal padding (12px) — since that padding
(12px) is bigger than the flex `gap` it was shifting into (8px), the box
was mathematically guaranteed to intrude 4px into the space before it,
regardless of how carefully the margin value was chosen. Fixed by zeroing
the trigger `Button`'s own `padding-left` instead of moving its box via
margin — since `Button` (unlike `Popover`'s own root, the actual reason
for the wrapping `<span>` in the first place) takes a real `className`,
this shrinks the box rather than relocating it, so the glyph lands in the
same correct spot (`box.left` + `padding-left` = `Share.right` + `gap` +
`0` = `Share.right` + 8) with the box's own left edge staying safely at
`Share.right + gap`, never past it. New `.boardOptionsTrigger` class,
passed via `className` on the trigger `Button` in `BoardView.tsx`;
`.boardOptionsMenu`'s existing `margin-right` (an unrelated fix, aligning
the glyph with the account avatar above it) is untouched. Verified live:
re-measured the same two rects after the fix — `896` (Share's right edge)
vs. `904` (ellipsis's left edge), an 8px gap with zero overlap, matching
every other gap in the row. (Headless `hover` screenshots didn't reliably
render the `:hover` background in this browser tool, so the fix was
verified via the geometry directly — the actual root cause — rather than
a before/after hover screenshot.) Full check suite clean (99/99 tests,
typecheck, lint, design-tokens, prettier).

**Member avatars never showed real profile photos — a gap developer-asked
about directly, then fixed**: every `<Avatar>` call site across the plugin
(board header's `MemberAvatarStack`, `BoardShareDialog`/
`ManageProjectDialog`'s member rows and add-person pickers,
`CardAssignees`, `CardComments`) only ever passed `name`, so `Avatar`
always took its initials-fallback path — even though the data was already
one step away: `getBoardData`/`getHomeData` (`_lib/queries.ts`) both call
`sdk.directory.resolveUsers()`, whose `DirectoryUser` return type already
carries `image: string | null` (the platform-level profile picture URL),
but the mapping into this plugin's own `MemberIdentity` type
(`_lib/identity.ts`) only kept `userId`/`name`/`email` — `image` was
fetched from the directory and then silently discarded on every call
site, three separate times (`getHomeData`'s project-members query,
`getHomeData`'s board-members-by-project query, `getBoardData`'s own
board-members query). Fixed by adding `image: string | null` to
`MemberIdentity` and populating it at all three construction sites, then
threading `src={member.image ?? undefined}` (or, for a raw
`DirectoryUser` search result, `src={user.image ?? undefined}`) through
every `Avatar` call site that represents a real person: the two already
covered by this exact question (`MemberAvatarStack`,
`ManageProjectDialog`'s `MemberRow`/`MemberPicker`), plus the ones a full
grep for every `<Avatar>` usage in the plugin turned up along the way —
`BoardShareDialog`'s equivalent `MemberRow`/`MemberPicker`,
`CardAssignees`' assignee chips, and `CardComments`' author avatar (the
last two look the user's own `userId` up against the already-resolved
`members` array passed down as a prop, rather than needing a separate
directory call). `KanbanHeader`'s own account-menu avatar was already
correctly wired (`src={user.image ?? undefined}`, from the richer
session-level user object, not this plugin's `MemberIdentity`) — nothing
to fix there, confirmed by reading it rather than assumed. `Avatar` itself
(`@sovereignfs/ui`) needed no changes — it already handles the image vs.
initials fallback (including a broken-image-URL fallback via its own
`onError`) entirely on its own; this was purely a data-plumbing gap, not
a component bug. Verified live: board view and the manage-project dialog
both still render correctly (initials, as expected — the dev seed users
have no `image` set, so this exercises the fallback path, not the photo
path; the actual `<img>` path is exercised by `Avatar`'s own existing
Storybook/tests, not re-tested here since `Avatar` itself is unchanged),
no console errors. Full check suite clean (99/99 tests, typecheck, lint,
design-tokens, prettier).

**Board-header `MemberAvatarStack` polish, reported from a screenshot**:
developer feedback that the overlapping member avatars in the board
toolbar felt cluttered — asked to clarify, the concrete points were "not
exactly circular", "size also can be a bit bigger", and "redundant when
you're the only member". The circularity concern turned out not to be a
geometry bug — `getBoundingClientRect()`/`getComputedStyle()` confirmed
each avatar was already an exact 28×28 `border-box` square with
`border-radius: 50%`, a true circle — the perceived distortion was almost
certainly the overlap cutout itself (the front avatar's ring notching out
part of the one behind it) reading as *less* circular at a small, hand-
tuned 28px than it would at a standard size. Three changes: (1) the
stack now returns `null` below 2 members (`MemberAvatarStack` in
`BoardView.tsx`) — solo-owned boards (the common case for a new board)
no longer show a redundant one-avatar "stack" next to Share, which does
the same "who's here" job; verified live on a real solo board (Test
Board) that the stack is absent entirely, only Share and the ellipsis
remain. (2) Since the case that justified the hand-tuned 28px (`Avatar`'s
own `md` at 32px "reads too big packed this tightly") was reasoned
against a *dense*, always-visible stack — no longer true once it's gated
to 2+ real members — switched to `Avatar`'s plain built-in `size="md"`
(32px) instead of a custom width/height override, removing a magic-number
CSS rule and directly satisfying "bigger" against an existing size step
rather than another arbitrary value. (3) `.stackedAvatarOverflow`'s badge
size updated to match (32px, was 28px). Verified live at 32px:
`getComputedStyle()` confirmed each avatar is still an exact `32×32`
`border-box` circle (`border-radius: 50%`) on a real 2-member board.
Full check suite clean (99/99 tests, typecheck, lint, design-tokens,
prettier).

**Sticky header regression, caught by the developer immediately from a
screenshot of the fix above**: pinning `.manageDialogHeader` at `z-index:
1` tied it with `Dialog`'s own `.close` button (`packages/ui`), which also
has an explicit `z-index: 1` — both sit in `.panel`'s stacking context
(the nearest positioned ancestor), and for equal z-index values the later
element in DOM order wins the paint order. Since `.close` renders before
`.content` in `Dialog.tsx`'s JSX, my header (nested inside `.content`,
painted later) covered it completely once scrolled — the close button
became invisible and, unlike a purely visual z-index bug, also stopped
being the topmost hit-tested element at its own coordinates (confirmed via
`document.elementFromPoint()` before the fix: it resolved to the scrim,
not the button — a real interaction bug, not just a rendering one).
Fixed by dropping the header's `z-index` to `0` instead of `1` — CSS
stacking order compares z-index by numeric value first and only falls
back to DOM order for exact ties, so `0` unconditionally loses to
`.close`'s `1` regardless of paint order, while still correctly painting
above the plain unpositioned scrolling content behind it (static content
sits below any explicit `z-index: 0`/`auto` positioned layer in the
stacking order, sticky-positioned or not). Verified live at the same
1280×640 viewport, scrolled to the same absolute max: this time confirmed
with `document.elementFromPoint()` at the close button's own center
coordinates that the button itself (not the scrim) is the top hit-test
target — genuinely clickable, not just visually present. (One dead end
along the way: my first `document.querySelector('button[aria-label="Close"]')`
returned a 0×0-rect element and falsely looked like the button had
vanished entirely — turned out to be `OverlayHeader`'s own mobile close
button, which shares the same `aria-label` and is simply
`display: none`-d on desktop; had to select all matches and filter for
the one with a non-zero rect to test the real desktop button.) Full check
suite clean (99/99 tests, typecheck, design-tokens, prettier).

**`ManageProjectDialog`'s own title left un-pinned, follow-up on the same
scroll work**: the "Manage project" heading added earlier this session
(the desktop-title fix, since `Dialog`'s `title` prop only renders on
mobile) sat as an ordinary first child inside `.content` — it scrolled
away with the rest of the form on a short viewport, same screenshot
evidence as the cramped-scrollbar issue below. Kanban-local fix, not a
`Dialog`/`packages/ui` change: the other dialogs in this plugin that use
the identical "manual `Typography h3` as first content child" pattern
(`BoardSettingsDialog`, `BoardShareDialog`, `MoveCardDialog`,
`HomeDialogs`) are all `size="sm"` with short, non-scrolling content, so
they were never actually exposed to this — only `ManageProjectDialog`
(`size="md"`, a form plus a members list plus a danger zone) has content
long enough to scroll on a real screen. Made the heading `position:
sticky` via a new `.manageDialogHeader` class, matching `.boardToolbar`'s
existing sticky-header precedent one level up in this same file — with one
addition `.boardToolbar` didn't need: `.content`'s `padding:
var(--sv-space-6)` (from `Dialog.module.css`) means the header has to
bleed out to the panel's edges (`margin: calc(-1 * var(--sv-space-6))` on
top/left/right) and restore its own padding, and sticky's `top` offset has
to be the *negative* of that same padding value (not `0`) since the
offset is measured against the scroll container's padding box, not where
the negative margin visually moved the element — the standard "sticky
header inside a padded scroll container" recipe. Background set to
`--sv-color-surface-raised`, matching `Dialog`'s own `.panel` background
exactly so there's no visible seam once content scrolls underneath.
Verified live at the same 1280×640 cramped viewport: scrolled `.content`
to its absolute max and confirmed via `getBoundingClientRect()` that the
header stays at the same `top`, spans edge-to-edge with the panel (`left`/
`right` within 1px, the border), and never overlaps the close button
(`z-index: 1` only needs to clear the scrolling members list/danger zone
underneath it, not the close button — that one is already always pinned,
being `.panel`'s own `position: absolute` sibling of `.content`, never a
`.content` descendant). Full check suite clean (99/99 tests, typecheck,
lint, design-tokens, prettier).

**Cramped-viewport scroll polish, reported from a screenshot on a 13"
laptop screen**: on a short viewport, `Dialog`'s `md` size correctly
shrinks its `max-height` cap to fit (`min(42rem, 100%)`, by design — see
`Dialog.module.css`'s file-level comment), which is right, but the
resulting internal `.content` scroll region was rendering the browser's
default OS scrollbar — on non-overlay-scrollbar platforms/settings, wide
enough to visually crowd `.panel`'s rounded corner and read as a layout
bug rather than an intentional scroll affordance, especially with the
panel already filling nearly the whole short viewport (little margin above
or below to soften it). This is a `@sovereignfs/ui` fix, not a kanban-local
one — `Dialog` is a shared component every plugin's dialogs render
through, and this codebase already has an established slim, token-colored
scrollbar pattern (`ScrollArea`, `MessageScroller`: `scrollbar-width: thin`
+ `scrollbar-color`/`::-webkit-scrollbar-thumb` with
`--sv-color-border-strong`) that `Dialog.module.css`'s `.content` simply
hadn't adopted yet. Applied the identical pattern there (`packages/ui`,
now `0.57.1` — patch, purely additive CSS, no API change, so no
`docs/upgrade.md` note needed per NFR-04). Left `.content`'s existing
`overscroll-behavior: none` untouched — that's a deliberate, documented
iOS-bounce fix unrelated to scrollbar appearance. Verified live at a
1280×640 viewport (approximating a real 13" laptop's cramped browser inner
height once chrome/tabs are subtracted): `getComputedStyle()` confirmed
`scrollbar-width: thin` and the token color actually apply, against a
`.content` region that genuinely overflows (784px content vs. 574px
available) — a real scroll case, not simulated. Full check suite clean
across both affected packages: `@sovereignfs/ui` typecheck + 436/436
vitest, kanban plugin's own 99/99 vitest, `pnpm design:tokens:check`,
prettier. No Storybook update needed (no new component, no prop/API
change — Dialog already has no story file in this repo, so nothing to
touch there either way).

**Five `ManageProjectDialog` UX issues, reported together from a
screenshot**: (1) No visible title — `Dialog`'s own `title` prop only
renders in the mobile `OverlayHeader`; on desktop it's invisible (only sets
`aria-label`), by design (see the component's own doc comment). Same
established fix as `BoardSettingsDialog`: an explicit `Typography
variant="h3"` heading as the first element in the dialog body, in addition
to the `title` prop. (2) The Public/Private `SegmentedControl` stretched to
the dialog's full width, leaving a large empty gap between the two pills —
root cause is a genuine CSS gotcha, not specific to this component:
`SegmentedControl`'s track is `display: inline-flex` (shrink-to-fit by
design), but `FormField`'s `.field` wrapper is a flex column with the
default `align-items: stretch`, and a flex column's stretch overrides a
child's own display-driven sizing regardless of what that child's display
type would normally do standalone. Fixed with `align-items: flex-start` on
a new `.visibilityField` class, passed via `FormField`'s existing
`className` prop — scoped to just this one field, since Name/Description
legitimately need to stay full width. (3) "Save changes" spanned the full
form width for the identical root cause one level up: `.manageSection` is
also a flex column with default stretch, and `Button`'s own base rule is
`display: inline-flex` (`Button.module.css`). Fixed with `align-self:
flex-start` on a new `.saveProjectButton` class. (4) "Add a member doesn't
seem to be working" — live-tested end-to-end (typing, the debounced
search, and clicking a result to add) and the underlying mutation actually
works correctly; the apparent brokenness was a real, separate UX gap: the
search shows nothing at all while the 250ms debounce is in flight, and
shows nothing (not even an empty state) when a query matches no
candidates — indistinguishable from a silently broken input. Added
`searching`/`searched` state to `MemberPicker` and two new caption rows,
"Searching…" (while the debounced request is in flight) and "No matches"
(query resolved, zero candidates) — both target
`.memberResultStatus`. (Separately: my own first live-test pass on this
item mis-clicked due to a screenshot/viewport coordinate-scaling mismatch
in the browser tool, not an app bug — re-tested via DOM refs/JS dispatch
once realized, confirming the actual handler was always correct.) (5)
Danger zone border read as barely red against the already-pale
`--sv-color-error-surface` fill — swapped `.dangerZoneBox`'s border color
from `--sv-color-error-border` (a pale red, meant for subtle borders) to
`--sv-color-error-solid` (a saturated red, normally reserved for solid
error surfaces/icons), keeping the pale fill so the zone still reads as
"contained danger" rather than a full alert block. All five verified live:
screenshot + `getComputedStyle()`/DOM checks for each, including a real
add-member round trip (member count 2→3) and both new search states.
Full check suite clean (99/99 tests, typecheck, lint, design-tokens,
prettier) — one first-draft `eslint-disable-next-line
react-hooks/exhaustive-deps` comment had to be removed because this repo's
ESLint config doesn't have that rule installed at all (`react-hooks`
plugin absent), so the disable comment itself failed lint
("Definition for rule ... was not found") — the effect's dependency array
needed no suppression here since nothing enforces it.

**Two DS-override regressions, reported together from a screenshot**: (1)
`.newBoardCard`'s dashed border had gone missing — `Button`'s own base
rule (`border: 1px solid transparent`) was winning over the plugin's
`border: 1px dashed var(--sv-color-border-strong)` at equal specificity,
same injection-order cause documented elsewhere in this file
(`@sovereignfs/ui`'s stylesheet loads after the plugin's). Fixed with
`!important` on both `border` and `border-radius`, matching
`.addListCard`'s established precedent. (2) Board name text
(`Typography variant="h4"`) rendered bold — h1–h4 all share the DS's
semibold weight, too heavy for a small tile caption. Fixed by giving the
board-name `Typography` its own `className` (`.boardCardName`, passed
from `HomeView.tsx` alongside the existing `variant`/`as` props — not a
bare `:global()` guess at the DS's hashed class name) with
`font-weight: var(--sv-font-weight-regular) !important`, same
injection-order reasoning as (1). Verified live: `getComputedStyle()`
confirmed `border: 1px dashed …` on every "New board" tile across all
three projects and `font-weight: 400` on board names ("Campaign Q1",
"Sprint 12", etc.), plus a screenshot match. Full check suite clean
(99/99 tests, pure CSS + one className prop, no logic changed).

`0.20.1` → `0.20.2` swaps the manage-project trigger's bespoke `all: unset`
button for the DS's real `Button` (`variant="ghost" size="sm"`) wrapping an
`Icon name="settings" size="xs"` — the exact idiom `BoardView`'s own "Board
options" ellipsis trigger already established, rather than a lookalike
built from scratch. Prompted by developer feedback that the icon-only
trigger felt visually inconsistent with Board View's labeled Share button
one level down; the fix wasn't to match that specific button (a labeled
`variant="secondary"` button repeated per project row would be too heavy
for a list), but to reuse the *closest real precedent* for "small
icon-only management trigger" already in this codebase, trading a few
pixels of size (the DS's own `sm` padding, ~28–36px vs. the previous
hand-tuned 20px) for real componentry — actual hover/focus/pressed states
from `@sovereignfs/ui`, not hand-copied color tokens. `.projectManageButton`
is now just an `align-self: center` override (the padded `Button` doesn't
sit right on `.projectHeader`'s `baseline` alignment, tuned for the
Typography name/caption pair) — no bespoke sizing/color CSS left at all.

**A second visual regression, caught immediately by the developer from a
screenshot**: the swap left an unintentionally wide gap on both sides of
the icon (name→icon and icon→caption both read roughly double the row's
intended rhythm). Same root cause `.boardOptionsMenu` already documents
one level down: `.projectHeader`'s flex `gap` is structurally correct, but
ghost `Button`'s own horizontal padding (`--sv-space-3`) insets the glyph a
further step inside its own invisible button box, so the *visible* gap on
each side reads as `gap + padding`, not just `gap`. Fixed with the exact
same fix, reused rather than reinvented: `margin-left`/`margin-right:
calc(-1 * var(--sv-space-3))` on `.projectManageButton`, cancelling the
Button's own padding on both sides (this trigger has text on both sides,
unlike the board-level one which only needed one side compensated).
Verified live with a direct `getBoundingClientRect()` measurement, not
just eyeballed — 0px external gap on both sides across all four project
rows (Product Launch, Platform Engineering, Marketing, Test Project),
meaning the *glyph* itself now sits exactly `--sv-space-3` from the
adjacent text on both sides, matching every other gap in the row.

**Still too loose per developer follow-up feedback** (a screenshot showing
their own devtools live-edit of `.projectHeader`, demonstrating the wanted
result directly): the negative-margin fix above was correct as far as it
went, but `.projectHeader`'s own `gap` was still `--sv-space-3` (12px) —
tightened to `--sv-space-2` (8px), and `align-items` changed from
`baseline` to `center` (baseline suited plain Typography text but reads
oddly once a padded `Button` sits between the name and caption). A third,
independent issue in the same round: the ghost `Button`'s own
`:hover:not(:disabled)` rule painted a visible gray background behind the
icon on hover, which the developer explicitly wanted removed — fixed with
`.projectManageButton:hover:not(:disabled) { background-color: transparent
!important; }`, matching `.addListCard`'s own already-documented
`!important`-override precedent for winning over a DS component's own
rule (this build's CSS injection order puts `@sovereignfs/ui`'s stylesheet
after the plugin's, so a plain override loses regardless of selector
specificity). Verified live: screenshot matches the developer's own
devtools preview exactly. Full check suite clean (99/99 tests, no logic
changed) after all three rounds of this same UI polish pass.

**Sidebar divider added** in the same pass, requested separately: a
`.sidebarDivider` between the top Boards/Inbox nav and the "My
projects"/"Shared with me" groups, reusing `sovereign-plugin-shopper`'s own
`Sidebar.module.css` `.divider` values verbatim (`margin: var(--sv-space-2)
var(--sv-space-4); border-top: 1px solid var(--sv-color-border);`) for
visual consistency between the two plugins' sidebars — Shopper's own
divider sits in a different spot (above its "Combined view" link, which
Kanban has no equivalent of), so only the token values carried over, not
the placement.

**Divider spacing asymmetry, caught live from a developer screenshot**:
the space above the divider (nav→divider) read visibly tighter than the
space below it (divider→"My projects"). Root cause: `.sidebarGroup`
already carried its own `margin-top: var(--sv-space-4)` (16px, predating
the divider — originally what separated the top nav from "My projects" at
all), so the space below the divider was stacking three things (the
sidebar's own flex `gap`, the divider's own `margin-bottom`, *and* this
group's `margin-top`) while the space above only had two. Fixed with a
`.sidebarGroupAfterDivider` modifier (`margin-top: 0`) applied to "My
projects" specifically — "Shared with me" (no divider directly above it)
keeps the original `margin-top` unchanged, since it still needs it to
separate from "My projects". Verified live via
`getBoundingClientRect()`, not eyeballed: exactly 12px on both sides.

**First-heading vertical alignment, requested separately**: the first
project section's heading ("Product Launch") sat ~35px lower than the
sidebar's own first link ("Boards"), even though both columns start at the
same y-coordinate under `.contentRow`. Root cause: `PageContainer`'s
default `padding="md"` top padding (`--sv-space-8` = 32px) is double
`.sidebar`'s own top padding (`--sv-space-4` = 16px), and
`.projectSection:first-of-type` added a further `--sv-space-4` (16px) on
top of that. Fixed by flipping that same margin negative
(`calc(-1 * var(--sv-space-4))`) rather than touching `PageContainer`
itself — a shared platform-wide component, not something to special-case
for one page's two-column alignment. Verified live via
`getBoundingClientRect()`: delta closed from 35px to 3px (font-metrics
residual between an `<a>` and an `<h2>` line box, imperceptible). Full
check suite clean (99/99 tests) after this round too.

**Home listing grouped into "My projects" / "Shared with me"**, matching
`KanbanSidebar`'s own split (previously a flat list here while the sidebar
already had two sections) — new `.projectGroup` wrapper per section in
`HomeView.tsx`, each with an `h2` label (`.projectGroupLabel`) sized one
level above the individual project `h3` headings. `getHomeData` (`queries.ts`)
now sorts `projectRows` A–Z by `name.localeCompare(...)` instead of
`created_at`, in JS rather than a SQL `orderBy` — SQLite's default `BINARY`
collation is case-sensitive (every uppercase name would sort before every
lowercase one), and the list is never large enough to need the DB to do the
sorting. Sorting at the query source means both the sidebar and this
listing get the same A–Z order for free, no duplicate sort logic.

**The sidebar-alignment fix from the entry above had to move**: introducing
`.projectGroup` as a wrapper changes what `.projectSection:first-of-type`
matches — it now correctly means "first section within *each* group"
(both groups' first section, not just the page's first section overall).
The negative-margin compensation moved to `.projectGroup:first-of-type`
instead, and `.projectSection:first-of-type` reverted to its original,
un-hacked `margin-top: var(--sv-space-4)` (now correctly scoped per group).
Re-verified live after the restructure: 0px delta between "My projects"
and "Boards" (better than the 3px residual before — the `<h2>` "My
projects" line box happens to match the `<a>` exactly this time). Full
check suite clean (99/99 tests, no logic changed — only `getHomeData`'s
sort comparator changed, no authz/action code touched).

**Sidebar sticky + border-right ending partway, reported together (same
underlying cause)**: `.body` (`app/layout.tsx`) is the shared scroll
boundary for every page — Board View and Home alike — but on Home,
`.sidebar` and `.main` are both inside it via `.contentRow`, so `.body`'s
scroll carried the *whole row*, including the sidebar, instead of just
`.main`'s content. A first attempt fixed this with `.sidebar { position:
sticky; top: 0; }`, reasoning that `.contentRow`'s inherited `align-items:
stretch` would size `.sidebar` to match `.main`'s full (taller) content,
giving sticky "room" to stay pinned for the whole scroll range — this was
verified live at a small forced-overflow viewport and looked correct, but
was **live-tested wrong at a larger, more realistic overflow amount**: the
developer reported directly, from a real screenshot, that the sidebar
still scrolled away and the border-right still ended partway. Re-testing
with an actual max-scroll (`main.scrollTop = main.scrollHeight`, not just
a small forced overflow) showed the sticky sidebar's real height only
tracked the *viewport* (352px), not the full content — so sticky ran out
of room and the sidebar scrolled itself fully off-screen (`top: -352`
measured). Fixed properly by abandoning `position: sticky` entirely for
the standard two-independent-scroll-panes architecture: `.contentRow`
gets `overflow: hidden; min-height: 0` to cap it at `.body`'s available
height, and `.main`/`.sidebar` each get their own `overflow-y: auto` —
neither column is part of any shared scrolling content, so neither can
"run out of room" or leave the other behind. This also fixes the
border-right ending partway, same root cause: `align-items: stretch` now
sizes `.sidebar` to `.contentRow`'s own capped (viewport) height at all
times, so the border always spans exactly the visible column. Re-verified
live this time at absolute max scroll (not just a forced-overflow probe):
confirmed via both `getBoundingClientRect()` and a screenshot that the
sidebar's full project list stays rendered and unmoved while `.main`
scrolls into "Marketing"/"Product Launch". Board View re-checked live too
(shares `.body`, no `.sidebar` of its own) — unaffected, no console
errors. Full check suite clean (99/99 tests, pure CSS change). Lesson
worth keeping: a first live-test pass at a small, artificial overflow
isn't sufficient to trust a scroll-behavior fix — this one only reproduced
"wrong" at a larger overflow closer to a real usage.

**Group label typography, developer follow-up on the same session**: the
new `.projectGroup` `h2` labels ("My projects" / "Shared with me") used
`variant="h2"`, sized one level above the `h3` project-name headings — but
`Typography`'s h1–h4 variants share the same font-weight and differ only
in size, so an h2 sitting directly above h3 project names and h4 board
names read as barely distinguishable weight-wise, just a size step
(developer: "section title and project names are a bit similar... all
section title, project names, and board names are bold"). Swapped both
labels to `variant="label" as="h2"` — the DS's small/uppercase/muted style,
a genuinely different axis (colour + case, not just size) rather than
another point on the same heading scale — matching `KanbanSidebar`'s own
"MY PROJECTS"/"SHARED WITH ME" treatment for the identical semantic
content; `as="h2"` keeps the real heading level for accessibility while
using the label's visual style, the same pattern `ProjectSection`'s own
project-name heading already uses (`variant="h3" as="h2"`). This shrank
the label from a 20px heading to an 11px label, which shifted the
first-group sidebar-alignment compensation (`.projectGroup:first-of-type`)
out of calibration — re-measured live via `getBoundingClientRect()`
(9.125px delta after the swap) and adjusted the negative margin from
`calc(-1 * var(--sv-space-4))` to `calc(-1 * var(--sv-space-6))`;
re-verified at 0.125px delta between "My projects" and the sidebar's
"Boards" link. Full check suite clean (99/99 tests, no logic changed —
pure Typography prop + one CSS value).

`0.20.0` → `0.20.1` is a developer-requested redesign of K.19's own UI,
landed the same day: three separate entry points into project management
(sidebar's Edit/Delete/Share icons, K.19's own `ProjectShareDialog`)
consolidated into one — a single settings-gear icon in the Home listing's
project header (`HomeView.tsx`'s `ProjectSection`, right after the project
name) opening one combined `ManageProjectDialog`: name/description/
visibility, members (list + add-picker, unchanged from K.19), and a
"Danger zone" section folding in delete (previously its own confirm-only
dialog). Read-only for a non-owner (name/description/visibility as plain
text, member list with no controls) — same "everyone can view, owner-only
management" precedent K.9's `BoardShareDialog` established. The sidebar
lost its own per-row icons entirely; it's pure navigation now (a deliberate
call — two inconsistent entry points into overlapping state was worse than
one). `EditProjectDialog`, `DeleteProjectConfirm`, and `ProjectShareDialog`
are all deleted, not deprecated — `ManageProjectDialog.tsx` is the sole
successor.

Went through this repo's `sv-ui-design` wireframe-before-build process
before any code: several placement options for the trigger icon
(leading/trailing the name, hover-reveal, far-right) were wireframed as
SVGs under `docs/adhoc/manage-project/`, sent to the developer, and
iterated twice — the icon itself was swapped from `user-round-plus` to
`settings` (more accurate once the CTA covers more than membership) and
shrunk after live feedback that the first render was illegible at its
initial size. Final: `settings` icon, right after the project name, board
count still follows it.

Verified live end-to-end: opened the combined dialog as an owner (edit
form, members, danger zone all present) and as a plain member (read-only,
no controls); saved a visibility change and confirmed the dialog stays
open with a "Project updated" toast rather than closing (unlike the old
standalone `EditProjectDialog`, since this dialog is meant to stay open
across repeated actions, matching the members section's existing
behavior); opened the nested delete confirm on top of the open dialog and
cancelled it without deleting anything. Full check suite clean (99/99
tests — no test changes were needed, since no authz/action logic changed,
only how existing actions are composed into one surface); no
`pnpm-lock.yaml` drift.

**A mobile touch-target fix was added then reverted mid-session**: the new
20px icon is under the DS's 44px `--sv-touch-target-min` minimum, a real
gap on mobile (there's no separate mobile Home component — this same
`ProjectSection` renders there too). An invisible expanded hit-area was
added and verified working at a 375px viewport, then explicitly reverted
per developer direction mid-session ("don't work on mobile UIs for now, we
need to tackle them separately") — consistent with this phase's own
"web only" scoping (CONCEPT.md's Phase 2 section). Left as a known,
documented follow-up rather than fixed inline.

`0.19.0` → `0.20.0` is K.19 — Project membership UI & sharing, the first
Phase 2 task with a user-facing surface. Backend actions
(`searchProjectMemberCandidates`, `addProjectMember`, `removeProjectMember`,
`updateProjectMemberRole`), a new `ProjectShareDialog` (mirrors
`BoardShareDialog`'s K.9 pattern, one tier up), and a visibility toggle on
`EditProjectDialog`.

**Ownership invariant, not present on boards**: unlike boards (never gained
a promote-to-owner UI, so removing "the owner" was always just "the sole
owner"), projects support co-owners, so `removeProjectMember` and
`updateProjectMemberRole` both guard against a project ending up with zero
owners (`countProjectOwners`) rather than just blocking self-removal.
Stepping down as owner while another owner remains — including removing
yourself — is allowed.

**Deliberately not cascading**: removing someone from a project does NOT
remove their independent `kanban_board_members` rows. A board membership
is still separate access, same as Phase 1; project removal only affects
K.18's `'viewer'` path and their eligibility for a NEW board (K.20). This
was a real design choice, not an oversight — covered by its own test
(`removes a member without touching their independent board access`).

**A second real bug, found live** (after K.18's own live-found regression,
this is becoming the pattern for this phase — unit tests keep passing while
genuine UI staleness bugs slip through, since the test suite never
round-trips through client state): added a member via the new
`ProjectShareDialog`, and the dialog kept showing the pre-add list until a
full page reload — the mutation had actually succeeded server-side
(confirmed by reloading fresh), but the UI didn't reflect it. Root cause:
`KanbanSidebar`'s `sharing` state stored the whole `HomeProject` object
(`useState<HomeProject | null>`), captured at click-time — a stale
snapshot that a `revalidatePath()`-driven prop refresh doesn't update,
exactly K.8's `CardActivity` staleness bug from Phase 1. `BoardShareDialog`
never has this problem because `BoardView` only keeps a `boolean` toggle
and passes its own `board` prop straight through — the prop itself is what
gets fresh data on refresh, not a copy. Fixed by changing `sharing` to
`sharingId: string | null` and deriving the live object from `projects`
(already a prop, already fresh) on every render, matching `BoardView`'s
pattern instead of `editing`/`deleting` (safe to keep as full-object state,
since those dialogs submit-and-close rather than staying open across
repeated mutations).

**A related UI-scope fix, opened up by K.18 becoming reachable rather than
theoretical**: `KanbanSidebar`'s "My projects"/"Shared with me" split and
`HomeView`'s "New board" button were still gated on `isCreator`
(`created_by === actor.userId`), left over from Phase 1 when creator and
owner were always the same person. Once this task added the first way to
promote a co-owner, a co-owner who didn't create the project would have had
no way to edit/delete the project or create a board — despite the backend
(`requireProjectOwner`, K.18) already allowing it. Moved both to
`role === 'owner'`, matching backend truth; `isCreator` itself is untouched
as a data field.

Verified end-to-end live, not just via the unit suite: opened
`ProjectShareDialog` from both "My projects" (owner — full management) and
"Shared with me" (member — view-only, matches K.9's "every member can view,
owner-only management" precedent); searched and added a real dev-seed user
via the picker; promoted/demoted via "Make owner"/"Make member"; removed a
member and watched the list update immediately (post-fix); toggled a
project's visibility to Private and confirmed the change persisted across
a dialog reopen, then reverted it. 99/99 tests passing (90 K.17/K.18 +
9 new K.19 tests: denial-without-side-effects, add + notification, reject
duplicate/unknown, no-cascade-on-removal, last-owner protection on both
removal and demotion, promote-then-remove-original-owner, search
exclusion, and `updateProject`'s `visibility` field immediately changing
`getBoardData`'s viewer resolution). Typecheck, lint, design-tokens-check
all clean; no `pnpm-lock.yaml` drift.

`0.18.0` → `0.19.0` is K.18 — Project & board access authz (view vs.
edit), the task that actually makes K.17's schema do something. Three
pieces:

**Authz primitives** (`_lib/authz.ts`): `getProjectRole`/
`requireProjectMember`/`requireProjectOwner`, mirroring the existing board
helpers exactly. `requireProjectCreator` is gone — every call site
(`updateProject`, `deleteProject`, `createBoard`) now uses
`requireProjectOwner`, so any co-owner can manage a project, not just its
original creator. `createProject` now wraps its insert and a
`kanban_project_members` owner-row insert in one transaction — without
this, a brand-new project would have no owner row until K.19's UI existed
to add one, and `createBoard`'s new `requireProjectOwner` check would deny
the very person who just created the project. Caught this by reasoning
through the sequencing before writing any code, not by hitting it live.

**Read path** (`_lib/queries.ts`): `getBoardData`'s single membership-gated
query became a `leftJoin` plus a fallback resolution — explicit
`kanban_board_members` role unchanged (`'owner'`/`'member'`), or a new
`'viewer'` via `getProjectRole` (project owner on any board, or project
member when both project and board are `'public'`), or `null` (project
`'private'` overrides an individual board's own `'public'` flag, exactly
per CONCEPT.md's Phase 2 table). `getHomeData` rewritten to source "my
projects" from `kanban_project_members` instead of created-by/board-
membership-derived, with each project's board list including explicit
memberships plus any boards the actor can merely view. **Edit gates are
completely untouched** — every mutation action still calls
`requireBoardMember`/`requireBoardOwner`/`requireCardAccess`/
`requireListAccess` directly against `kanban_board_members` alone, which
never produces `'viewer'`, so `'viewer'` denies every mutation the exact
same way a stranger would. Audited every existing `role === 'owner'` UI
check (`BoardShareDialog`, `BoardView`'s settings/label management) per the
task's own review checklist — all of them are positive `=== 'owner'`
comparisons, none use a `!== 'owner'` pattern that `'viewer'` could slip
through, so none needed to change.

**A real regression, found live, not by the unit suite**: after this
shipped, "Platform Engineering" (a dev-seed project deliberately built to
model "target user is a board member, not the project creator" — see
`scripts/seed.ts`'s own comment) vanished from "Shared with me" on a live
reload. Root cause: the seed script predates K.17 and only ever inserted
`kanban_board_members` rows, never `kanban_project_members` — exactly the
legacy state Phase 2 makes unreachable going forward (a board member must
now be a project member first), but the old seed data still modeled the
Phase-1-only shape. The six new authz unit tests (real generated
migrations, not mocks) never caught this because they seed their own
membership rows directly and don't touch `scripts/seed.ts` at all. Fixed
the seed script itself, not the authz logic: `addProject` now seeds the
creator as project owner, and `addBoard` seeds every board member as a
project member too (`onConflictDoNothing()` covers the owner and anyone
already added via an earlier board in the same project) — reproducing the
same "shared via board access" demo scenario the way K.19/K.20's real UI
flow will actually produce it. Reran the seed script with `--reset` and
confirmed live: "Platform Engineering" reappeared under "Shared with me",
its board rendered fully, and a plain board `'member'`'s own board (no
ownership) still renders with full edit affordances — unaffected by any of
this. Full suite: 90/90 tests passing (84 Phase 1 + 6 new K.18 authz
tests), typecheck and lint clean, no `pnpm-lock.yaml` drift.

**Known, deliberate gap until K.21 ships**: a `'viewer'` board renders with
the *same* editable UI as a real member today — no read-only mode exists
yet. Attempting a mutation is correctly denied server-side (the edit gates
above), but the UX (a button that silently fails or throws a toast) is
confusing until K.21's read-only mode lands. This is the explicit
sequencing call already recorded in this file's K.18/K.21 task
descriptions and `ROADMAP.md`'s rationale — not a bug to fix here.

`0.17.2` → `0.18.0` is K.17 — Project members & visibility schema, the
first Phase 2 task (see CONCEPT.md's "Phase 2" section for the decided
product rules, and this file's Data model section for the schema detail).
Adds `kanban_project_members` (mirrors `kanban_board_members` — `owner`/
`member`, multiple owners) and a `visibility` column (`'public' |
'private'`, default `'public'`) on `kanban_projects` and `kanban_boards`.
Generated migrations for both dialects via `drizzle-kit generate`; the new
table's Postgres `created_at` column uses `bigint({ mode: 'number' })` from
the start, applying the lesson from `0.17.1`'s incident rather than
repeating it on a table that didn't exist yet. Migration includes a
hand-written backfill (`INSERT ... SELECT`, added on top of drizzle-kit's
generated DDL, same pattern `docs/plugin-database.md` documents for
Postgres FK-qualifier stripping): one `owner` row per existing project,
seeded from `created_by`. Not a data-preservation backfill for other
users' access — this instance only has one user today — it's what lets
K.18's authz layer resolve ownership for projects that existed before this
table did. **Verified against the live dev database, not just the unit
test suite**: `app/_db/__tests__/schema.test.ts` only exercises a fresh
in-memory DB via `createTestDb()`, which has no pre-existing projects to
backfill, so it can't actually prove the backfill logic works — restarted
the local `pnpm dev` runtime (triggering its startup migration run against
the already-seeded dev sqld namespace, several real projects including
"Product Launch" and "Platform Engineering" from earlier manual testing),
then queried the plugin's isolated sqld namespace directly
(`plugin_fs_sovereign_kanban` via the `x-namespace` header) to confirm
every existing project got exactly one `owner` row in
`kanban_project_members` matching its `created_by`, `visibility` defaulted
to `'public'` on every existing row, and `kanban_boards` gained the new
column — all while the plugin's Home page continued rendering the same
projects with zero errors. This is schema-only: nothing reads
`kanban_project_members` or either `visibility` column yet — every action
still enforces exactly the Phase 1 rules (see Data model's Access model
note). K.18 is what actually changes access behavior.

`0.17.1` → `0.17.2` fixes a second production bug found immediately after
`0.17.1` unblocked project creation on the same user's deployment: opening
any board (`/kanban/boards/[boardId]`) 500'd with `useToast() must be used
inside <ToastProvider>`. Root cause is the same `shell: "default"` →
`"minimal"` migration from `1.0.0`/`0.17.0` (see that entry above) — under
`shell: default`, the platform's own `ClientShell` (`runtime/app/(platform)/
_components/ClientShell.tsx`) wraps every plugin page in a `ToastProvider`,
but `runtime/app/(minimal)/layout.tsx` (what `shell: minimal` composes into)
is deliberately chrome-free and supplies no providers of its own — a
`minimal` plugin owns its whole tree, including any context providers its
components need. This plugin calls `useToast()` throughout board/card
actions (`BoardView`, `ListColumn`, `CardDetailOverlay`, and others) and had
never supplied its own `ToastProvider`, since it never needed to under the
old `shell: default` manifest. Fixed by wrapping `KanbanLayout`'s
(`app/layout.tsx`) returned tree in `<ToastProvider>` — the one shell-level
layout common to every route in the plugin (Home, Inbox, and Board View all
compose under it), so no per-route fix was needed. Verified live: cleared a
stale local `.next` build cache that was independently producing unrelated
500s, then loaded `/kanban/boards/[boardId]` in a fresh browser tab with no
console history — zero errors, board rendered fully (5 lists, cards,
avatars, menus) where it previously threw on first render. `pnpm --filter
sovereign-plugin-kanban typecheck` also passes.

`0.17.0` → `0.17.1` fixes a real Postgres-only production bug, reported
directly by a user deploying via Docker Compose to a fresh (non-upgrade)
instance: every "Create project" (and, by the same root cause, every
timestamp-writing mutation across the plugin) failed with a 500, server logs
showing `value "..." is out of range for type integer` (Postgres error
22003, `pg_strtoint32_safe`) on `kanban_projects`/`kanban_inbox_state`
inserts. Root cause: `app/_db/schema.postgres.ts` (the migration-twin schema
that drives `drizzle-kit generate --dialect postgresql`) declared every
timestamp column (`createdAt`, `updatedAt`, `dueDate`, `lastSeenAt`) as
plain `integer`, matching `./schema.ts`'s (SQLite) column type — SQLite's
`integer` affinity has no real width limit, so this was silently fine there,
but Postgres's `integer` is a real, fixed 32-bit type (max 2147483647), and
a Unix millisecond timestamp is a 13-digit number already ~800x past that.
This wasn't a future-dated overflow — it broke on the very first insert on
any Postgres-dialect deployment, immediately upon shipping `0.17.0`'s
Postgres schema. Fixed by switching every timestamp column in
`schema.postgres.ts` to `bigint({ mode: 'number' })` (safe to 2^53, far
beyond any real timestamp); `./schema.ts` (SQLite, what application code
actually queries through) is unchanged. Generated the corresponding
migration via `drizzle-kit generate --config=drizzle.config.pg.ts` —
`migrations/postgres/0002_romantic_terror.sql`, a clean set of `ALTER
COLUMN ... SET DATA TYPE bigint` statements, no `REFERENCES "public"...`
qualifiers to strip since it's a pure type change. `done` (0/1) intentionally
stays `integer` — no overflow risk. No test caught this before it shipped:
`app/_db/__tests__/schema.test.ts` only exercises the real generated
migrations against SQLite (per this plugin's own `CLAUDE.md`, there's no
Postgres test harness here) — verified via `pnpm --filter
sovereign-plugin-kanban typecheck` and the full plugin Vitest suite (84
passed) after the fix, but the actual Postgres-dialect regression can only
be caught by a live Postgres deployment, which is how the user found it.

`1.0.0` → `0.17.0` re-identifies the plugin as first-party rather than
community, and moves it to the chrome-free minimal shell — a deliberate
identity change, not a bug fix, hence the major bump (breaking: the id
change alone moves the plugin's isolated DB namespace from
`plugin_io_openfs_kanban` to `plugin_fs_sovereign_kanban`, orphaning any
existing local dev data under the old namespace). Three manifest fields
changed together: `id: "io.openfs.kanban"` → `"fs.sovereign.kanban"` (matches
the `fs.sovereign.*` convention already used by `sovereign-tasks`/`shopper`),
`type: "community"` → `"sovereign"` (first-party, project-maintained — see
`docs/plugin-development.md`'s `type` reference), and `shell: "default"` →
`"minimal"` (chrome-free, full-bleed). The `shellConfig: { mobileFooter: false }`
field was removed outright rather than emptied — `shellConfig.mobileHeader`/
`mobileFooter` are only valid under `shell: "default"` and fail manifest
validation otherwise (`packages/manifest/src/schema.ts`'s `.refine` checks).

The shell change is less disruptive than a bare reading of "no sidebar, no
header, no footer" suggests: this plugin already self-renders its own
complete navigation chrome (`KanbanLayout` → `KanbanSidebar` + K.12's
`KanbanMobileFooter`), the RFC 0075 self-rendered-chrome pattern —
`shell: minimal` only removes the platform's own, now-redundant icon
rail/header wrapping around it. One real gap this exposed and fixed:
desktop's `KanbanSidebar` had no way back to Launcher or any other installed
plugin once the platform's icon rail is gone — mobile already covered this
via `KanbanMobileFooter`'s real `MobileAppsDrawer` (K.12), but the desktop
sidebar had never needed an equivalent since the platform chrome was always
there alongside it. Fixed by adding a plain `Link href="/launcher"` at the
top of `KanbanSidebar`, matching the documented minimal-shell nav convention
(`example-plugins/example-minimal/app/page.tsx`'s own bare Launcher link) —
deliberately not a full desktop apps-switcher drawer, which would be
over-engineering relative to the platform's own established precedent for
this exact situation.

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

- **id:** `fs.sovereign.kanban` (reverse-DNS per platform convention; table
  slug prefix stays `kanban_`)
- **routePrefix:** `/kanban`
- **type:** sovereign (first-party plugin maintained by the project,
  installed from its own repo; the manifest schema requires a `repository`
  URL for this type)
- **shell:** `minimal` (chrome-free, full-bleed — docs/plugin-development.md).
  No `shellConfig` — its fields are only valid under `shell: default`. The
  plugin already self-renders 100% of its own navigation chrome (this file's
  K.16 status entry's `KanbanSidebar`/`KanbanMobileFooter`), so `minimal`
  removes the now-redundant platform icon rail/header rather than the plugin
  losing anything it relied on the platform for. `KanbanSidebar` gained a
  plain Launcher link (the documented minimal-shell nav convention,
  `example-minimal/app/page.tsx`) so desktop users still have a way back —
  mobile already had one via `KanbanMobileFooter`'s Apps drawer.
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
kanban_projects         id, tenant_id, name, description, created_by,
                        visibility ('public' | 'private'), timestamps
kanban_boards           id, project_id, name, color, created_by,
                        visibility ('public' | 'private'), timestamps
kanban_board_members    board_id, user_id, role ('owner' | 'member'), added_by, created_at
kanban_project_members  project_id, user_id, role ('owner' | 'member'), added_by,
                        created_at
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
- **Access model (Phase 1):** project creator manages the project; board
  access is via `kanban_board_members` (creator becomes `owner`). Every
  board/card action verifies membership; every project mutation verifies
  creator. Phase 1 has no project-level member list — sharing happens per
  board.
- **Access model (Phase 2, see CONCEPT.md's "Phase 2" section for the
  decided rules):** `K.17` (shipped) adds `kanban_project_members` (mirrors
  `kanban_board_members` — `owner`/`member`, multiple owners allowed) and a
  `visibility` column (`'public' | 'private'`, default `'public'`) on both
  `kanban_projects` and `kanban_boards`, plus a migration seeding one
  `owner` row per existing project. The schema exists but nothing reads it
  yet — `K.18` is what actually changes access behavior (the view/edit
  split, `getBoardData`'s three-tier role resolution, `getHomeData`
  reading from the new table). Until `K.18` ships, every action still
  enforces exactly the Phase 1 rules above; `visibility` and
  `kanban_project_members` are inert. Board-add will be sourced from
  project members only once `K.20` ships, never a fresh directory search.
  Edit rights don't change in this phase at all — still strictly
  `kanban_board_members` — the new tier only ever *adds* a read-only view
  path (project owner, or project+board both `public`), never a new edit
  path. `created_by` on `kanban_projects` remains a historical "who created
  this" field; ownership authority moves to `kanban_project_members` rows,
  since projects support co-owners. **Postgres timestamp columns on the new
  table use `bigint({ mode: 'number' })`, never `integer`, in
  `schema.postgres.ts`** — see this file's `0.17.1`/`0.17.2` Status entries
  for why plain `integer` overflows immediately on Postgres for any real
  Unix-ms timestamp; verified directly against the live dev database (not
  just unit tests) that the migration both applies cleanly to a fresh DB
  and correctly backfills an already-populated one.

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
`/kanban/b/<id>?card=<id>` (renamed from `/kanban/boards/<id>` — see the
Status section's own entry; no redirect from the old path, a deliberate
developer choice). The Inbox screen renders the plugin's own activity feed
(board-scoped `kanban_activity` for boards you're a member of), not the
platform bell — the two complement each other.

## Routes

```
/kanban                      Home (Boards overview)          [web + mobile]
/kanban/inbox                Inbox                           [web + mobile]
/kanban/b/[boardId]          Board view                      [web + mobile]
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

**Review checklist:** deep link `/kanban/b/<id>?card=<id>` (renamed from
`/kanban/boards/<id>` post-launch — see Status) opens the modal cold; every
edit persists and reflects in the board's card tile; checklist quick-entry
commits on Enter and blur.

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

---

### Phase 2 — Project & board membership + visibility

See CONCEPT.md's "Phase 2" section for the decided product rules this
implements. Web only — mobile read-only parity is a documented follow-up,
not part of K.17–K.22.

---

#### K.17 — Project members & visibility schema

**Goal:** The data layer Phase 2 builds on.

**Deliverables:**

- `kanban_project_members` table (`project_id, user_id, tenant_id, role
  ('owner' | 'member'), added_by, created_at`), structurally mirroring
  `kanban_board_members`.
- `visibility` column (`'public' | 'private'`, default `'public'`) on both
  `kanban_projects` and `kanban_boards`.
- Generated migrations for both dialects. `schema.postgres.ts`'s new
  `created_at` column uses `bigint({ mode: 'number' })` from the start — not
  plain `integer` (see this file's `0.17.1`/`0.17.2` Status entries for why
  that overflows immediately on Postgres).
- Migration seeds one `kanban_project_members` row per existing project:
  its `created_by` user as `owner`. Required regardless of install size —
  it's what lets `K.18`'s authz layer resolve ownership for
  already-existing projects at all, not a data-preservation backfill for
  other users' access (there is none to preserve on this instance today).

**Dependencies:** K.16.

**Review checklist:** migrations run clean on a fresh dev DB and on the
existing seeded dev DB (backfill verified); Postgres migration reviewed for
the `bigint`-timestamp convention; no `runtime/src` imports.

---

#### K.18 — Project & board access authz (view vs. edit)

**Goal:** A read path that can tell "can edit," "can view only," and "no
access" apart, without touching any existing edit-authorization code.

**Deliverables:**

- `getProjectRole`/`requireProjectOwner`/`requireProjectMember` in
  `_lib/authz.ts`, mirroring the existing board helpers.
- `createBoard` moves from `requireProjectCreator` to `requireProjectOwner`
  (any co-owner, not just the original creator).
- `getBoardData`'s role resolution becomes three-tier: `'owner' | 'member'`
  (unchanged — still strictly `kanban_board_members`) or new `'viewer'`
  (project owner on any board, or project member when both the project and
  the board are `'public'`). `BoardData['role']` type gains `'viewer'`.
- Audit of every existing `role === 'owner'` / owner-only branch (board
  settings, label management, share dialog) to confirm `'viewer'` denies
  the same way `'member'` already does — no code should need to change here
  if the audit passes, since `'viewer'` was never a possible value before.
- `getHomeData` rewritten to source "my projects" from
  `kanban_project_members` (owner or member) instead of
  created-by/board-membership-derived; within each project, board list
  includes explicit board memberships plus any `'viewer'`-eligible boards.

**Dependencies:** K.17.

**Review checklist:** authz unit tests prove (a) a non-member/non-viewer
still gets denied everywhere Phase 1 already denied them, (b) a project
owner can read but not mutate a board they're not a member of, (c) a
project member sees a public board in a public project read-only, (d) a
private project hides a `'public'`-flagged board from a non-board-member
project member entirely.

---

#### K.19 — Project membership UI & sharing

**Goal:** Real multi-user projects.

**Deliverables:**

- New project share dialog (mirrors `BoardShareDialog`'s K.9 pattern):
  list members, add by directory picker (the search moves here from the
  board dialog), remove, owner-only management, promote/demote co-owner.
- `createProject` auto-adds the creator as project `owner`.
- Project visibility toggle (`public`/`private`) in project settings.
- Notifications: added-to-project, via `sdk.notifications.send()`.

**Dependencies:** K.18.

**Review checklist:** two-user manual test — inviting to a project works
end-to-end with a working notification deep link; only owners can manage
project members or promote a co-owner; visibility toggle persists.

---

#### K.20 — Board membership UI & board visibility

**Goal:** Board sharing sourced from the project, not the directory.

**Deliverables:**

- ✅ `BoardShareDialog`'s add-picker changes from `sdk.directory.searchUsers`
  to a plain list of "project members not yet on this board" — no more
  live directory search inside a board. Shipped ahead of the rest of this
  task (manifest `0.20.3`, see the Status section's own entry) as
  `getBoardMemberCandidates`, developer-requested directly alongside two
  unrelated `BoardShareDialog` asks (a visible title, a copy-URL row) that
  aren't part of this task's own scope. `addBoardMember` itself also now
  enforces project membership server-side, not just in the picker — not
  originally listed as a separate deliverable here, but required by this
  repo's own "route/UI gating is never sufficient" convention once the
  picker stopped being the only path to calling that action.
- ⬜ Board-membership management stays open to that board's own owner(s)
  and is additionally opened to any project owner.
- ⬜ Board visibility toggle (`public`/`private`) in the board options menu.

**Dependencies:** K.19.

**Review checklist:** adding a non-project-member to a board is impossible
through the UI (picker never lists them) — ✅ done, and also now
impossible through the action directly, a stronger guarantee than this
checklist item asked for; a project owner who isn't a board owner can
still add/remove that board's members — ⬜ not yet; visibility toggle
persists and is reflected in K.18's access checks immediately — ⬜ not yet.
Task stays ⬜ in `ROADMAP.md` until the remaining two deliverables ship.

---

#### K.21 — Read-only view mode (web)

**Goal:** A `'viewer'` can see a board fully and touch nothing.

**Deliverables:**

- A `canEdit` flag (`role !== 'viewer'`) threaded through every interactive
  board component: `BoardView`, `ListColumn`, `CardDetailOverlay`,
  `CardChecklist`, `CardComments`, `CardLabels`, `CardAssignees`,
  `CardDueDate`, `QuickAddCard`, `AddListSlot`, `MoveCardDialog`.
- Drag-and-drop disabled entirely for viewers (no sensors registered, or a
  no-op drop handler — whichever keeps the dnd-kit wiring simplest).
- Every mutation affordance (add/edit/delete, checklist toggles, comment
  input, label/assignee/due-date editors, list/card option menus, Share
  CTA) hidden or disabled for viewers rather than merely failing silently
  on submit.
- Home page board tiles show a "view only" indicator for boards the actor
  can see but not edit.

**Dependencies:** K.20.

**Review checklist:** a project-owner-only viewer can open every part of a
board (lists, cards, checklist, comments, activity) with zero console
errors and zero visible mutation affordances; attempting a mutation via
direct action call (not just the hidden UI) still gets denied server-side
by K.18's unchanged edit gates.

---

#### K.22 — Phase 2 hardening & verification pass

**Goal:** Close the gaps a feature-by-feature build leaves, mirroring K.16's
role for Phase 1.

**Deliverables:**

- End-to-end verification of the full visibility matrix (CONCEPT.md's
  Phase 2 table) with a second real test user/tenant, not just unit tests.
- Loading/empty/error state audit for the new project-share and
  board-visibility surfaces.
- A11y pass on the new dialogs and read-only affordances (viewers still
  need working keyboard/focus paths, just no mutation controls).
- SPEC.md/CONCEPT.md/ROADMAP.md reconciled against what actually shipped.

**Dependencies:** K.17, K.18, K.19, K.20, K.21.

**Review checklist:** demo script exercised end-to-end covering every row
of the visibility matrix with two real users; no console errors/warnings;
docs match shipped behavior.
