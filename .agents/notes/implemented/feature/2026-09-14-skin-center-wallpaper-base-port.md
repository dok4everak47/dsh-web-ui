# Agent Note: Replay the fork's Skin Center wallpaper work onto the upstream dev base

Status: implemented

## Problem

The Skin Center fork carried 17 local commits that the upstream tree never received: a manual crop editor, a folder-grouped grid with per-group pagination and collapse state, name/id/type search, native-aspect thumbnails, a page-number jump input, and several lifecycle fixes. They sat on a base 770 commits behind `dev`, and the dsh 0.1.5 SDK removed the settings API that base compiled against, so the package could not load in an updated harness: rebasing the whole fork was the only alternative to dropping the work.

## Decision

The 17 commits are replayed as one squashed patch onto `dev`. Six files conflicted; each was resolved by keeping the side that owns the newer contract:

- `src/client/runtime/shell-rendering.ts`: upstream's implementation supersedes the fork's older caret-scroll fix and carries the same intent, so the fork's version is dropped.
- `src/client/WallpaperPanel.tsx`, `src/client/skin-center.module.css`, `tests/wallpaper-panel.spec.tsx`: the fork's grouped, collapsible grid with per-group pagination and search is the shipped grid. Upstream's content-rating filter is merged into it as an additional dimension over the same item list.
- `src/we-library.ts`: both additions are kept (the used-image-stem tracking and the `contentrating` field).
- `tests/skin-runtime.spec.ts`: the `--dsh-skin-scrim` test is deleted. Upstream replaced that variable with the `data-dsh-backdrop-active` marker in `runtime/backdrop-scene.ts` and covers it with its own test.
- `README.i18n.yaml`: re-recorded with `node scripts/verify-docs.mjs --write` after the merge.

Two port-specific decisions follow from the merge:

- `WallpaperItem` regains the `rating?: 'g' | 'pg13' | 'r18'` field the fork's copy had dropped, because the host inventory carries it.
- The rating filter offers `All` as well as `G` / `PG-13` / `R18`, and defaults to `All`. Upstream defaults to `G`; a default of `G` would hide the fork's manual library folders whose titles derive an `r18` rating, which reads as a missing library rather than a filter.

## Testing

`pnpm --filter @linxin666/dsh-client-ui-skin-center run typecheck` passes. The package suite passes 650 tests in 40 files, including the added rating-filter case that covers the `All` default, narrowing to one rating, and the `'g'` fallback for an entry without a rating. `pnpm i18n:check`, `pnpm docs:check`, `pnpm libs:check`, and `pnpm skin-center:check` pass; the Skin Center is not in the ru dictionary manifest, so the ported keys need no ru entries.

## Alternatives considered

- Rebasing the fork's 38 commits individually: rejected because 21 of them touch unrelated packages, which multiplies conflict work without improving the result.
- Dropping the fork's panel and shipping the upstream grid: rejected because the manual crop editor has no upstream counterpart and is the main reason the fork exists.
- Keeping both grids behind a switch: rejected because two pagination models in one panel make the state machine and the tests carry a compatibility path no consumer needs.

## Consequences

- The fork's wallpaper surface works again on the 0.1.5 API and inherits the newer upstream behavior around it (unified backdrop scenes, decoration layers, macOS format validation, content ratings).
- Upstream's global 24-per-page pagination is gone; per-group pagination is the only model.
- The fork tracks upstream `dev` on a branch instead of a 770-commit-old base, so the next upstream sync is a normal merge.
