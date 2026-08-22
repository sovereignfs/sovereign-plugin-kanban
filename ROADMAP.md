# Sovereign Kanban — Roadmap

**Manifest version:** 0.24.0 · **Last updated:** 2026-08-21

Chronological build index — one row per PR, platform-`ROADMAP.md` style. Full
task detail lives in [SPEC.md](SPEC.md); the product concept in
[CONCEPT.md](CONCEPT.md).

Slot versions are the plugin's **`manifest.json`** version after that task
lands (the plugin's `package.json` stays pinned at `0.0.0` — platform
convention). Slots are volatile ordering; task IDs (`K.<seq>`) are the stable
identifiers. Each task = one branch = one PR = one review gate; tasks depend
on the previous row unless noted.

## Phase 1a — Foundation

| Slot  | Task                                    | Status | Spec task                                             |
| ----- | --------------------------------------- | ------ | ----------------------------------------------------- |
| 0.1.0 | Plugin scaffold & manifest              | ✅     | [K.1](SPEC.md#k1--plugin-scaffold--manifest)          |
| 0.2.0 | Data model & migrations                 | ✅     | [K.2](SPEC.md#k2--data-model--migrations)             |
| 0.3.0 | Server data layer & actions skeleton    | ✅     | [K.3](SPEC.md#k3--server-data-layer--actions-skeleton) |

## Phase 1b — Web experience

| Slot  | Task                                    | Status | Spec task                                                  |
| ----- | --------------------------------------- | ------ | ---------------------------------------------------------- |
| 0.4.0 | Web Home: boards overview               | ✅     | [K.4](SPEC.md#k4--web-home-boards-overview)                |
| 0.5.0 | Web Board view: layout, lists, quick-add | ✅  | [K.5](SPEC.md#k5--web-board-view-layout-lists--quick-add) |
| 0.6.0 | Card detail modal (web): core fields    | ✅     | [K.6](SPEC.md#k6--card-detail-modal-web-core-fields)       |
| 0.7.0 | Web drag-and-drop                       | ✅     | [K.7](SPEC.md#k7--web-drag-and-drop)                       |
| 0.8.0 | Comments, replies & activity log        | ✅     | [K.8](SPEC.md#k8--comments-replies--activity-log)          |
| 0.9.0 | Board members & share                   | ✅     | [K.9](SPEC.md#k9--board-members--share)                    |
| 0.10.0 | Board search/filter (web)              | ✅     | [K.10](SPEC.md#k10--board-searchfilter-web)                |
| 0.11.0 | Inbox (web) & notification wiring      | ✅     | [K.11](SPEC.md#k11--inbox-web--notification-wiring)        |

## Phase 1c — Mobile experience

| Slot   | Task                                   | Status | Spec task                                                  |
| ------ | -------------------------------------- | ------ | ---------------------------------------------------------- |
| 0.12.0 | Mobile navigation & Home               | ✅     | [K.12](SPEC.md#k12--mobile-navigation--home)               |
| 0.13.0 | Mobile Board view: carousel & list menu | ✅  | [K.13](SPEC.md#k13--mobile-board-view-carousel--list-menu) |
| 0.14.0 | Mobile card detail (full-screen)       | ✅     | [K.14](SPEC.md#k14--mobile-card-detail-full-screen)        |
| 0.15.0 | Mobile card reorder & "Move to…"       | ✅     | [K.15](SPEC.md#k15--mobile-card-reorder--move-to)          |

## Phase 1d — Release readiness

| Slot   | Task                                   | Status | Spec task                                              |
| ------ | -------------------------------------- | ------ | ------------------------------------------------------ |
| 0.17.0 | Phase 1 hardening & polish pass        | ✅     | [K.16](SPEC.md#k16--phase-1-hardening--polish-pass)    |

## Phase 2 — Project & board membership + visibility

Web only — mobile read-only parity is a documented follow-up, not part of
this phase. See `CONCEPT.md`'s "Phase 2" section for the decided product
rules and `SPEC.md`'s `K.17`–`K.22` for technical detail.

| Slot   | Task                                        | Status | Spec task                                                                 |
| ------ | -------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| 0.18.0 | Project members & visibility schema         | ✅     | [K.17](SPEC.md#k17--project-members--visibility-schema)                  |
| 0.19.0 | Project & board access authz (view vs. edit) | ✅     | [K.18](SPEC.md#k18--project--board-access-authz-view-vs-edit)            |
| 0.20.0 | Project membership UI & sharing             | ✅     | [K.19](SPEC.md#k19--project-membership-ui--sharing)                      |
| 0.21.0 | Board membership UI & board visibility      | ⬜     | [K.20](SPEC.md#k20--board-membership-ui--board-visibility)               |
| 0.22.0 | Read-only view mode (web)                   | ⬜     | [K.21](SPEC.md#k21--read-only-view-mode-web)                             |
| 0.23.0 | Phase 2 hardening & verification pass       | ⬜     | [K.22](SPEC.md#k22--phase-2-hardening--verification-pass)                |

## Prioritization rationale

- **Web before mobile** (decided in concept review): the data layer built in
  1a serves both; mobile (1c) is presentation work on a proven backend.
- **K.5 before K.4 is *not* allowed to invert silently** — K.4 is first
  because the home screen is the plugin's entry point and exercises
  project/board CRUD that the board view assumes exists. K.5 is marked
  `[parallel]`-capable with K.4 in SPEC.md only for multi-agent staffing.
- **Drag (K.7) lands after the card modal (K.6)**, so click-vs-drag
  disambiguation is tested against the real click behavior, not a stub.
- **Members/share (K.9) precede Inbox (K.11)** — notifications without
  multi-user boards have nothing meaningful to notify about.
- **Search (K.10) is deliberately late and small** — pure client-side
  filtering over an already-loaded payload; it must not grow a server API in
  Phase 1.
- **The gesture-risk task (K.15) is isolated and last in mobile** so the
  carousel (K.13) is stable before the known dnd-kit/iOS-Safari conflict is
  taken on; its review gate requires a documented simulator gesture matrix.
- **`0.17.0` is a release statement:** Phase 1 scope complete, hardened, and
  verified on both surfaces. K.16 itself actually shipped at `1.0.0`,
  matching the platform's "single jump to 1.0.0" convention — the version
  moved on from there twice more before Phase 2 started: `2.0.0` for the
  `id`/`shell`/`type` identity change (a real major bump, breaking the DB
  namespace), then a deliberate renumbering back down to `0.17.0`. This
  table's slot column tracks the version a task's *own* PR actually shipped
  at, so it reads `0.17.0` here — not `1.0.0` or `2.0.0` — to match
  `manifest.json` and avoid disagreeing with the two numbering decisions
  made after K.16 landed.
- **Schema (K.17) before authz (K.18) before any UI** — the same
  foundation-first ordering Phase 1a used, and for the same reason: every
  later Phase 2 task reads or writes the new tables/columns.
- **Authz (K.18) before either membership UI task (K.19/K.20)** — the UI
  tasks are thin surfaces over access rules that need to exist and be
  tested first, not discovered while wiring a dialog.
- **Project membership (K.19) before board membership (K.20)** — board-add
  now sources its candidate list from project members, so the picker has
  nothing to show until project membership exists.
- **Read-only view mode (K.21) is last and largest on purpose** — it's the
  one task that touches nearly every interactive board component, so it
  waits until the access rules it renders (K.18) and the surfaces that
  toggle visibility (K.19/K.20) are already stable and testable, rather
  than being built against a moving target.
- **`0.23.0` closes Phase 2 the same way `0.17.0` closed Phase 1** — a
  dedicated hardening/verification pass with a second real user, not folded
  into the last feature task.

## Phase 2 candidates (not committed)

Due-date reminder schedules (manifest `schedules`), attachments, card cover
images, board templates, cross-board search, offline support. (Project-level
membership and visibility graduated from this list — see "Phase 2" above.)
