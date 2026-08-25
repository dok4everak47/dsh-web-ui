# Agent Note: Sidebar collapsed-state memory across reloads

Status: implemented

## Problem

The dsh web shell keeps the left sidebar fold state in a React useReducer inside its `layout` service. It is never written to a store, settings, or localStorage, so every fresh page load resets the column to expanded. Users who prefer the 56px rail have to collapse it again after every refresh, even though the choice is purely cosmetic and has no server-side meaning.

The dsh-web plugin family cannot change the shell, but it ships an aggregate compat shim (`packages/dsh-web-all/src/client/index.ts`) that already runs on every page load and observes the shell DOM to stamp legacy attributes. That is the natural place to remember the last fold choice.

## Decision

`packages/dsh-web-all/src/client/sidebar-memory.ts` installs a singleton controller alongside the compat shim. The design is deliberately conservative because it runs on every page, including while the user types, and must never cause layout or focus feedback:

- It waits for the sidebar column (`[data-pane="sidebar"]`, stamped by the shim, or the shell's `[class*="sidebarCol"]`) 500ms after boot, then reads its settled `offsetWidth`. Widths below 120px are classified as the 56px rail; everything above is the expanded column. This deliberately avoids relying on the shell's css-module class hashes, which rotate between rc versions.
- On first visit it seeds localStorage (`dsh:sidebar-collapsed`) with the shell default; on later visits, if the persisted value disagrees with the measured state, it flips the column once through `ctx.layout.toggleSidebar()`. There is no synthetic DOM-button click fallback: a programmatic click on the shell's toggle button can scroll it into view and steal focus from the composer, which is the exact failure mode we are avoiding. When the layout service is absent, restore is skipped.
- State is persisted only at natural pause points — `pagehide`, `visibilitychange` to hidden, and a slow 5-second heartbeat — not through a MutationObserver. An early draft observed the sidebar's `class`/`style` attributes and persisted on every change with a 250ms debounce, but React re-renders during typing can fire those observers, and reading width plus writing localStorage inside a React commit caused the page to scroll on every keystroke. The pause-point approach has zero per-keystroke work.
- A kill switch at localStorage `dsh:sidebar-memory="off"` disables the controller before load, so a user can turn it off without waiting for a new build.
- Every external touch is defensive: missing sidebar, storage that throws in private mode, an absent layout service, and a layout service that throws during toggle all degrade to a no-op. The controller never sets an explicit width or className on the sidebar, so it cannot fight React's reconciliation.

## Alternatives considered

- File an upstream issue and wait for the shell to persist the state: correct for the long term, but leaves every current user with the refresh-reset behaviour. The controller is additive and can be removed the day the shell persists its own state.
- Inject a new dedicated `dsh-sidebar-memory` package: cleaner ownership, but costs a new npm name, a new cordis.patch.yml row, and an aggregate entry for ~150 lines of code. The memory rides the shim that already observes the same DOM, so adding a package would duplicate the MutationObserver and body watcher.
- Persist on every click by listening to the toggle button: simpler, but requires holding a reference to the shell button and breaks when the shell changes its internal class. The width-based classifier is class-name independent.
- Persist via a MutationObserver on the sidebar's attributes: tried in the first draft and reverted. React re-renders during typing fire attribute mutations; the width read + localStorage write inside a React commit caused the page to scroll on every keystroke. The pause-point approach (`pagehide`, `visibilitychange`, 5-second heartbeat) has no per-keystroke cost and matches when the data actually matters: at unload.
- Programmatically click the shell's toggle button as a fallback when `ctx.layout` is missing: tried and reverted. A programmatic `.click()` on a button that the browser considers out of its scroll viewport triggers `scrollIntoView`, which is what was scrolling the page. When the layout service is missing we now skip restore rather than fall back to a click.
- Use `window.name` or a session cookie instead of localStorage: `window.name` survives reloads in the same tab only and is cleared by external links; a cookie would ride every HTTP request for no reason. localStorage is the same surface the family already uses for telemetry.

## Consequences

- The first time a user loads a build with this shim, the persisted flag is seeded from whatever state the shell defaulted to (expanded), so no visible change happens on that first load. From then on, refresh preserves the last choice.
- The 120px threshold is a heuristic. A future shell that widens the rail or narrows the expanded column below that threshold would misclassify; the constant lives at the top of `sidebar-memory.ts` and is covered by tests if it ever needs to move.
- The feature ships inside `@linxin666/dsh-web-all`, so standalone installs of individual subpackages without the aggregate do not get the memory. That matches the existing compat-shim ownership: the aggregate is the supported install surface.
- Mobile (<= 768px) is unaffected: the responsive CSS already drives its own `data-sidebar-collapsed` drawer state, and the width-based classifier treats the 52px mobile rail the same as the desktop rail, which matches the user's last desktop intent when they resize.
