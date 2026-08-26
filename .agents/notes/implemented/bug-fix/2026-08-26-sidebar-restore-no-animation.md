---
title: Sidebar stays collapsed on reload, at first paint
date: 2026-08-26
package: dsh-web-all
type: bug-fix
i18n: zh
---

## Summary

Reloading with the sidebar persisted as collapsed still showed it closing:
earlier fixes cut the restore delay and suppressed various transition
layers, but every one of them ran from the cordis `apply()` hook, which
fires AFTER the layout frame has already rendered and painted its expanded
boot state (the ui-layout store hard-codes `sidebar: 280`). No amount of
transition suppression can un-paint the first expanded frame or the flip
that follows. The user's requirement was explicit: a collapsed session
should stay collapsed on reload, with no transition "telling" them it
closed.

## Root cause

The dsh web shell's `runPluginBoot` awaits EVERY plugin module import and
only then creates/renders the `APP_SHELL` layout frame. Two facts follow:

1. Plugin `apply()` (cordis lifecycle) runs after the frame is mounted --
   too late for first paint. Restoring there always produces an
   expanded-to-collapsed visual change, animated or not.
2. Plugin module TOP-LEVEL code runs during the awaited import phase,
   BEFORE the frame's first paint. A `<style>` appended to `document.head`
   at import time is render-blocking and applies to the frame's very first
   paint.

The pre-collapse CSS also had a secondary trap: forcing the frame to 56px
with `!important` makes `offsetWidth` read 56/57, so a width-based
"already collapsed?" check skipped the `toggleSidebar()` call and left the
React store at 280; the frame then never gained `data-sidebar-collapsed`
and the pre-collapse sheet was never released (stranded override).

## Fix

`packages/dsh-web-all/src/client/sidebar-memory.ts`:

1. **First-paint pre-collapse CSS** (`injectPreCollapseStyle`, called at
   module import, bottom of file). When `localStorage['dsh:sidebar-collapsed']
   === '1'`, set `data-dsh-sidebar-precollapse` on `<html>` and inject a
   stylesheet that, inside `@media (min-width: 1025px)` (desktop only),
   forces:
   - the frame (`[class*="frame"]:has([class*="sidebarCol"])`) to
     `grid-template-columns: 56px minmax(0,1fr) 0 !important`;
   - the sidebar column to 56px with `overflow:hidden`;
   - `transition/animation: none` on the column and its descendants.
   The frame paints already collapsed.
2. **Runtime store reconciliation**. When the column mounts, if the
   pre-collapse sheet is active and the frame lacks
   `data-sidebar-collapsed`, call `layout.toggleSidebar()` unconditionally
   (NOT gated on the CSS-forced width) so the React store flips to 0 and
   the shell renders its real collapsed state.
3. **Handoff**. A document MutationObserver watches the frame for
   `data-sidebar-collapsed`; the moment the shell commits it, the
   pre-collapse sheet is removed. The shell's own rules resolve to the
   same 56px rail, so removal is visually identical. A 10s cap releases
   the sheet if the shell never commits (defensive; never strands the
   override).

The MutationObserver is attribute-only on the frame, so it does not react
to per-keystroke content churn; persistence still happens only at
pagehide/visibilitychange/heartbeat.

## Evidence

- 60 dsh-web-all tests pass (first-paint injection, media-query gating,
  handoff on the frame attribute, cap release, dispose cleanup, all prior
  persist/kill-switch/lifecycle cases). Full repo suites green
  (skin-center 550, shared 69, tool-describe-image 372; test:scripts
  191/0; docs/aggregate checks pass).
- Headless GUI probe with `requestAnimationFrame` sampling from the first
  frame the sidebar exists: the very first computed
  `grid-template-columns` was `56px 1384px 0px` (never 280), width 57,
  `data-sidebar-collapsed` present and the pre-collapse sheet released by
  the next sample (~23ms later). Zero `grid-template-columns` /
  `left` / width transitions fired in the sidebar subtree. The only
  later transitions are the shell's own rail-entry opacity fades, which
  are not a close animation.

## Trade-offs / scope

- The pre-collapse selector uses `:has()` to reach the frame without
  relying on its hashed css-module class name. The desktop harness runs on
  a Chromium version that supports `:has()`; the rule is desktop-gated and
  removed as soon as the shell commits its own state.
- For the handful of frames before the shell applies its collapsed
  styling, expanded-width inner content is clipped to 56px by
  `overflow:hidden`. The shell's collapsed commit lands within a frame or
  two, so this is not perceptible.
