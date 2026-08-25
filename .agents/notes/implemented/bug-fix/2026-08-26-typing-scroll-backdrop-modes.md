# Agent Note: Typing scroll regression behind backdrop visual modes

Status: implemented

## Problem

The user reported that typing any character in the composer scrolls the whole page down, but only while a custom background image (wallpaper) is active; the stock look is unaffected. Live-browser reproduction (try-on wallpaper, existing conversation with history, scrollport pinned to the top) showed the conversation scrollport `[data-conversation-scroll]` jumping on composer focus and then scrolling about 72px further down on every keystroke until clamped at the bottom. No JavaScript scroll call was involved: the scroll events come from Chrome's native caret scroll-into-view, which honors the scrollport's `scroll-padding-bottom`.

The declaration `scroll-padding-bottom: var(--dsh-composer-height, 100px) !important` in `src/client/runtime/shell-rendering.ts` (added for #978 as a scrollIntoView clearance replacement when the physical scrollport padding was neutralized in the follow-up commit) is the cause. Scroll padding steers not only programmatic `scrollIntoView()` but also the browser's native caret scroll-into-view that runs on every keystroke in the focused composer textarea. Because the composer is the scrollport's final in-flow child, the requested bottom clearance (one composer height above the viewport bottom) is geometrically unreachable, so each keystroke kept scrolling the transcript toward the bottom. The rule is scoped to `html[data-dsh-skin]`, `html[data-dsh-custom-theme]`, and `html[data-dsh-wallpaper-active]`, which is exactly why the bug only appeared with a skin, custom theme, or wallpaper active.

## Decision

Remove the `scroll-padding-bottom` declaration and keep `padding-bottom: 0 !important` as the physical neutralizer. The stock shell ships `scroll-padding-bottom: auto` and `padding-bottom: 0` on `[data-conversation-scroll]`, and nothing in the current shell calls `scrollIntoView()` on conversation content (grep over the harness conversation/composer packages found zero call sites; the remaining shell `scrollIntoView` calls target command palettes, input-trigger dropdowns, and trajectory rows, each inside their own scroll containers). The clearance the declaration tried to reserve therefore protects a scenario that does not exist, while its caret-scroll side effect breaks typing for every backdrop visual mode.

The now-unused height-sync machinery (ResizeObserver plus body-wide MutationObserver feeding `--dsh-composer-height` with a forced layout read on every DOM mutation, i.e. on every keystroke) is removed together with `DEFAULT_COMPOSER_CLEARANCE_PX` and `COMPOSER_SEAT_SELECTORS`; the variable has no consumers outside the removed declaration (verified across packages, shared, skins catalog CSS, docs, and user-installed skins). Rejected alternatives: keeping the declaration with a smaller value (any nonzero scroll-padding keeps the caret-scroll fight), and moving the clearance to `scroll-margin-bottom` on conversation rows (couples the adapter to shell-internal row classes to preserve a behavior the stock shell does not have).

## Consequences

Typing in the composer no longer scrolls the transcript for skins, custom themes, and wallpapers; the scrollport keeps the stock scroll semantics in every visual mode. The scrollport keeps its neutralized bottom padding so dock anchoring and hero centering are unchanged. The composer-height measurement observers no longer run. `shell-rendering.ts` sits in the skins review route, not the renderer route, but the removed rule was authored in the renderer domain (commits 624043c4 and 7c09df74 by Aa728848); the domain owner is notified in the delivery report per AGENTS.md.

## Verification

- `npx vitest run` in `packages/skins/skin-center`: 31 files, 550 tests passed (includes the re-pinned #978 test asserting no `scroll-padding-bottom` declaration).
- `pnpm typecheck` across all 20 workspaces passed.
- `pnpm docs:check` and `pnpm docs:write-pair packages/skins/skin-center` passed after README updates.
- Live GUI verification against the running `dsh web` service (no restart; the served bundle is read from the linked package build): try-on wallpaper mounted (`data-dsh-wallpaper-active`, media layer at z-index -3), opened a conversation with history, pinned the scrollport to the top, then clicked into the composer and typed two lines. Before the fix the scrollport jumped to 389 on focus and advanced about 72px per keystroke to the bottom (scroll-padding-bottom computed 171px); after the fix the scrollport stayed at scrollTop 0 through focus and typing, window.scrollY stayed 0, and the wallpaper kept rendering (scroll-padding-bottom computed auto, padding-bottom 0px).
