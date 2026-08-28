# Agent Note: skin-center pager ellipsis rendered as the literal \u2026 escape

Status: implemented

## Problem

The Skin Center wallpaper pager's ellipsis gap (shown when a group spans
more than seven pages) rendered the literal six-character text `\u2026`
instead of the `…` character. Users saw `\u2026` in the page-number row.

The cause is a JSX-text gotcha: `WallpaperPanel.tsx` wrote the ellipsis as
`<span ...>\u2026</span>`. Text between JSX tags is literal - it does not
process backslash escapes - so `\u2026` surfaced verbatim. The compiled
bundle carried the six-character string, and the DOM exposed it. The locale
strings (`locales.ts`) were unaffected because there the `…` sits inside JS
string literals, where escapes and raw non-ASCII both resolve correctly.

## Decision

Change the JSX text `\u2026` to a JS string expression `{'\u2026'}`, where
the escape is processed into the real character. The `…` is punctuation
(not an emoji), so it is allowed under the no-emoji rule.

## Testing

A new `wallpaper-panel.spec.tsx` test renders 90 image items in one folder
group (8 pages at `PAGE_SIZE` 12, so `pageRange` emits a `0` gap sentinel),
expands the group, and asserts the DOM text contains the real `…`
(`'\u2026'`) and not the literal escape (`'\\u2026'`). All 552 skin-center
tests pass; `tsc -p tsconfig.json --noEmit` is clean; the rebuilt
`lib/client.js` no longer contains the literal `\u2026`.

## Alternatives considered

Write the raw `…` character directly in the JSX text. Rejected only to keep
the source ASCII and make the non-ASCII intent self-documenting via the
escape; the raw character is equally correct and matches `locales.ts`, so a
later editor may switch to it without changing behavior.

Use the `&hellip;` HTML entity. Rejected: less idiomatic next to the `{ }`
expressions already in the file, and JSX text entities are a rarer idiom
than a string expression here.

## Consequences

The pager now shows `…` for gap pages. No behavior changes beyond the glyph.
