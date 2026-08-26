---
title: Sidebar stays collapsed on reload, at first paint, with no boot animation
date: 2026-08-26
package: dsh-web-all
type: bug-fix
i18n: zh
---

## Summary

Reloading with the sidebar persisted as collapsed must paint collapsed from
the very first frame, with no close animation afterward. Earlier attempts
ran from cordis `apply()` (after the frame had already painted expanded),
then from module import with a first-paint grid override that removed its
suppression the instant the frame gained `data-sidebar-collapsed`. Both
still left a brief visible animation. This note records the final fix and
the reasons each layer is needed.

## Root causes (three independent layers)

1. **First paint.** The ui-layout store hard-codes `sidebar: 280`, and
   cordis `apply()` runs after the frame mounts. The shell's
   `runPluginBoot` awaits every plugin module import before rendering
   APP_SHELL, so only module top-level code can influence the first paint.
2. **Two-wave inner mount.** Even when the frame is forced to the 56px
   rail, the shell mounts the sidebar's inner content in an expanded
   `wide-in` wave (~600ms) then a rail `rail-in` wave (~840-900ms).
   Releasing suppression when the frame is marked collapsed (~490ms) let
   that internal wide-to-rail switch play.
3. **CSS keyframe precedence / `animation: none` replay.** Forcing
   `opacity:1 !important; transform:none !important` does NOT flatten the
   entry keyframes -- CSS animations outrank author `!important` on those
   properties. The only thing that flattens them is `animation: none`, but
   if that rule is removed after mount the browser treats the animation as
   new and replays it from the start, which is itself a late fade/slide.

## Fix

`packages/dsh-web-all/src/client/sidebar-memory.ts`:

1. **First-paint geometry sheet** (import-time, `injectPreCollapseStyle`):
   when `localStorage['dsh:sidebar-collapsed'] === '1'`, set
   `data-dsh-sidebar-precollapse` on `<html>` and inject a desktop-gated
   (`min-width: 1025px`) `!important` rule forcing the frame grid to
   `56px minmax(0,1fr) 0`, the column to 56px with `overflow:hidden`, and
   `transition:none` on the column/subtree. The frame paints collapsed.
2. **Hold then hand off**: a MutationObserver waits for the frame's
   `data-sidebar-collapsed`, then keeps the geometry override for another
   `SETTLE_HOLD_MS = 900ms` (covering both mount waves) before removing it.
   The shell resolves to the same 56px rail, so removal is a no-op. A 10s
   cap guards a shell that never commits. The React store is flipped once
   via `toggleSidebar()` while the sheet is active (not gated on the
   CSS-forced width, which would skip the flip and strand the sheet).
3. **Permanent mount-animation mute**: a second, desktop-scoped stylesheet
   (`data-dsh-sidebar-memory="sidebar-no-anim"`) sets
   `animation: none !important` on `[class*="sidebarCol"]` and its
   descendants for the whole session. It is intentionally NOT removed at
   handoff (only on dispose), so the `wide-in`/`rail-in` keyframes never
   play and can never replay. The sidebar's manual fold is driven by
   transitions (column width, max-width), not animations, so toggling
   still animates normally.

Persistence remains pagehide/visibilitychange/heartbeat-only; the frame
observer is attribute-only, so neither reacts to per-keystroke churn.

## Evidence

- 60 dsh-web-all tests pass (first-paint injection, both sheets, mute
  survives handoff, 900ms hold, cap, dispose, persist/kill/lifecycle).
  Full repo suites green: skin-center 550, shared 69, tool-describe-image
  372; test:scripts 191/0; docs/aggregate checks pass.
- Headless GUI probes (3 runs): zero `animationstart`/`transitionstart`
  events inside the sidebar subtree across boot; sampled rail icons are at
  their final x position with `opacity:1` / `transform:none` from first
  appearance; the first computed `grid-template-columns` is
  `56px 1384px 0px` (never 280); expanded-wave content is clipped inside
  the 56px column (only icons intersect the rail).

## Trade-offs / scope

- Selectors use `:has()` and `[class*="sidebarCol"]` to avoid hashed
  css-module names; supported by the harness Chromium and desktop-gated.
- The permanent mute also silences any future sidebar CSS keyframe
  animation on desktop. Transitions (used for folding/drag/hover) are
  unaffected. This is an acceptable, narrowly-scoped trade for a
  no-animation collapsed restore.
