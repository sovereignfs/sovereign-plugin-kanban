# Sovereign Kanban — Roadmap

**Manifest version:** 0.11.0 · **Last updated:** 2026-08-17

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
| 0.12.0 | Mobile navigation & Home               | ⬜     | [K.12](SPEC.md#k12--mobile-navigation--home)               |
| 0.13.0 | Mobile Board view: carousel & list menu | ⬜  | [K.13](SPEC.md#k13--mobile-board-view-carousel--list-menu) |
| 0.14.0 | Mobile card detail (full-screen)       | ⬜     | [K.14](SPEC.md#k14--mobile-card-detail-full-screen)        |
| 0.15.0 | Mobile card reorder & "Move to…"       | ⬜     | [K.15](SPEC.md#k15--mobile-card-reorder--move-to)          |

## Phase 1d — Release readiness

| Slot   | Task                                   | Status | Spec task                                              |
| ------ | -------------------------------------- | ------ | ------------------------------------------------------ |
| 1.0.0  | Phase 1 hardening & polish pass        | ⬜     | [K.16](SPEC.md#k16--phase-1-hardening--polish-pass)    |

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
- **1.0.0 is a release statement:** Phase 1 scope complete, hardened, and
  verified on both surfaces — mirroring the platform's "single jump to
  1.0.0" convention.

## Phase 2 candidates (not committed)

Due-date reminder schedules (manifest `schedules`), attachments, card cover
images, board templates, cross-board search, offline support, project-level
membership.
