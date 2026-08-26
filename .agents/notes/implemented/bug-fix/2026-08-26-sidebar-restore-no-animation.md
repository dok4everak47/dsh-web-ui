# Agent Note: Sidebar memory restores without the collapse animation

Status: implemented

## Problem

The sidebar fold memory (feature note 2026-08-25-sidebar-collapsed-memory) persisted the collapsed state but restored it through `ctx.layout.toggleSidebar()` on a fixed 500ms timer. On refresh the shell first painted the sidebar expanded, then the restore call toggled React state, and the layout frame ran its normal `transition: grid-template-columns 0.3s` animation from expanded (280px) to the rail (56px). The user reported that a sidebar closed before refresh should stay closed after refresh; instead it visibly collapsed again, so the memory did not feel like it held.

## Decision

Restore the state at frame granularity instead of after a 500ms settle delay, and suppress the frame grid transition for the one restore tick. A 16ms watcher loop starts at install and calls `toggleSidebar()` on the first tick after the column mounts with a measurable width. For that tick the frame (the sidebar's parent grid container, the element that carries the `grid-template-columns` transition) is tagged `data-dsh-sidebar-restore`, and a page-lifetime stylesheet owned by the module applies:

```css
[data-dsh-sidebar-restore],
[data-dsh-sidebar-restore] > * { transition: none !important; }
```

This mirrors the shell's own mechanism: the ui-layout AppFrame disables the same transition while the resize handle is dragging (`[data-dragging] { transition: none }`). The tag covers the frame's children as well, which includes the 8px resize handle that animates `left`, so nothing slides while the columns snap. The tag is removed as soon as the measured width matches the persisted target, or after a 600ms settle window if the toggle never lands; a thrown `toggleSidebar()` removes it immediately. The suppression stylesheet is inert while no element carries the tag and is removed on shim dispose.

The shell's layout service exposes only `toggleSidebar()`, `openDetails()`, and `closeDetails()`; the panel store is explicitly transient (`init` always boots `sidebar: SIDEBAR_DEFAULT`) and has no initial-state injection point, so going through the shell toggle with a transition kill is the supported path. A 16ms `setTimeout` loop is used rather than a MutationObserver, keeping the module's "no MutationObserver" guarantee; the worst case is a single ~16ms painted frame in the boot default before the suppressed toggle lands, which is imperceptible against the app's cold-start paint.

## Consequences

A sidebar closed before refresh appears already closed after refresh, with no 300ms collapse animation and no 500ms delay. The persist points (pagehide, visibilitychange hidden, 5-second heartbeat), width-based state detection, kill switch (`localStorage['dsh:sidebar-memory'] = 'off'`), and no-DOM-click fallback are unchanged. The restore flip still flows exclusively through `ctx.layout.toggleSidebar()`, so React stays the single source of truth; the only addition is a temporary, scoped, `!important` transition kill that cannot be left behind because the settle watcher and dispose both remove it.

## Verification

- `npx vitest run` in `packages/dsh-web-all`: 4 files, 50 tests passed. New cases cover first-tick restore, suppression presence across the toggle and removal on settle, suppression removal after the 600ms cap when the width never flips, immediate cleanup when `toggleSidebar` throws, stylesheet lifecycle, and a zero-width column that becomes measurable one beat later.
- `pnpm typecheck` across all workspaces passed.
- `pnpm docs:check` and `pnpm docs:write-pair packages/dsh-web-all` passed after the README update.
- Live GUI verification against the running `dsh web` service (no restart; the served aggregate bundle is read from the linked package build): with `localStorage['dsh:sidebar-collapsed']='1'` preset before navigation, polled the column width and frame transition at 16ms intervals. The column first mounted at 280px around t=298ms; at t=318ms it was 56px with the frame transition property computed `none` and `data-dsh-sidebar-restore` present; by t=336ms the tag was removed and the transition restored, and the column stayed at 56px with no grid animation. Before the fix the same scenario left the sidebar expanded for 500ms and then animated the 0.3s collapse.
