---
title: Sidebar restore without the close animation
date: 2026-08-26
package: dsh-web-all
type: bug-fix
i18n: zh
---

## Summary

Reloading the app with the sidebar persisted as collapsed still showed a
visible close animation: the column painted expanded first, then the shell
played its collapse transition. The first fix cut the restore delay from
500ms to a 16ms mount watcher and tagged the layout frame to suppress the
frame's `grid-template-columns` transition for one tick. That removed the
outer grid animation but the user still reported the close animation.

## Root cause

The sidebar is more than the frame grid. On fold the shell animates three
layers, and they do not all commit at the same time:

- the layout frame animates `grid-template-columns` (300ms);
- the resize handle sibling animates `left` (300ms);
- the sidebar's **inner content** runs its own collapse animations -- the
  header actions animate `max-width / opacity / transform` and the search
  box animates `width / padding` (~180ms) -- and those commits land in a
  **later React render** than the frame grid.

Tagging the frame and removing the tag as soon as the outer width matched
only suppressed the first layer, and only for ~18ms; the inner content
then folded with its animation fully visible. A `> *` (direct-child)
suppression selector also missed the nested inner elements.

## Fix

The restore (`packages/dsh-web-all/src/client/sidebar-memory.ts`) now:

1. Flips the state through `ctx.layout.toggleSidebar()` on the first 16ms
   tick after the sidebar mounts (unchanged).
2. Sets a `data-dsh-sidebar-boot` attribute on `<html>` for the duration.
   The module stylesheet disables `transition` on the sidebar column and
   every descendant (`[data-pane="sidebar"], [data-pane="sidebar"] *` plus
   the `[class*="sidebarCol"]` selectors and the resize handle sibling),
   covering the frame, handle, and the late-committing inner content.
3. Keeps that suppression until the **first user interaction**
   (`pointerdown` / `keydown` / `wheel` / `touchstart`, capture + passive)
   or a 4s cap, whichever comes first. Once the user acts the attribute is
   removed and manual toggles animate normally. There is no timer tied to
   the outer width, so a delayed inner render cannot slip past.

This mirrors the shell's own `[data-dragging] { transition: none }`
mechanism but extends it to the whole sidebar subtree and gates it on
interaction rather than the drag gesture.

## Evidence

- 46 sidebar-memory tests pass, including per-event release and boot-cap
  cases; the full dsh-web-all suite (50 tests) passes.
- Headless GUI probe with `transitionstart` capture on the sidebar subtree
  recorded **0** transition starts during the first 1.5s after a
  collapsed-state reload, and no sidebar descendant computed a non-`none`
  transition while the boot attribute was set. A subsequent click removed
  the attribute, restoring normal toggling.

## Trade-offs

Suppression lasts until first interaction (up to 4s), so any other sidebar
animation that might run during that window (e.g. an unrelated shell
animation on idle load) is also muted. The window is bounded and ends the
moment the user does anything, which is before they can trigger a manual
fold, so the practical effect is only that the boot state appears static.
