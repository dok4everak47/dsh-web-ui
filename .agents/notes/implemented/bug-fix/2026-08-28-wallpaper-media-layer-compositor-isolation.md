# Agent Note: wallpaper media layer on its own compositor layer (fix menu flicker on scroll)

Status: implemented

## Problem

Opening `:r3:-menu` (the composer model-select dropdown) and then scrolling
the conversation made the menu visibly flicker. It only happened with a
custom static-image wallpaper; the default (video/scene) wallpaper did not
flicker.

`:r3:-menu` is the host `ui-model-selection` `ModelSelect` dropdown: React
`useId()` yields `:r3:` and the dropdown id is `${id}-menu`. It opens directly
above the composer/input card, which skin-center gives
`backdrop-filter: blur(var(--dsh-input-card-blur, 10px))` while
`data-dsh-backdrop-active` is set ([backdrop-scene](../../implemented/architecture) composer frost).

Investigation against the live GUI established that the menu itself is
stable during scroll: its `getBoundingClientRect()` is constant across rAF
samples and its clipped pixel bbox is byte-stable in CDP captures. The
flicker is a compositor repaint artifact, not a layout change.

Root cause. A static `image` wallpaper (the macOS Desktop Pictures kind:
HEIC rendered by the host as a JPEG, e.g. a user photo selected via
`skin-wallpaper.selection`) mounts as a plain `<img>` inside a
`position: fixed` `mediaLayer`. `styleLayer` / `styleCover` set no
compositor-promoting property on either the layer or the image, and
`applyCropTransform` only adds `transform` / `willChange` when
`crop.scale > 1`. So at the default crop the full-viewport image is not on a
dedicated compositor layer. When the conversation scrolls - or an overlay
menu opens above the backdrop-filtered composer card - Chromium re-rasterizes
the wallpaper in horizontal bands; the overlapping menu catches the
per-frame repaint and flickers.

`video` / `web` / `scene` wallpapers render as `<video>` / `<iframe>`, which
Chromium auto-promotes to their own compositor layer, so they never
re-rasterize on scroll. This matches the user's differential exactly: custom
image flickers, default (video/scene) does not.

Precedent. The skin background *decoration* layer already does this:
`decoration-layers.ts` sets the background layer's `cssText` to include
`will-change:transform`, and `skin-runtime.spec.ts` issue #1013 test documents
the same mechanism ("a full-viewport skin background image is costly to
re-rasterize; without compositing isolation, unrelated repaint bursts
(streaming chat, animated pets, overlay menus) make Chromium re-rasterize it
in horizontal bands, visible as vertical band flicker. Keep will-change on the
layer so the raster stays cached"). The wallpaper `mediaLayer`, which serves
the identical full-viewport purpose for wallpapers, was missing the same
treatment.

## Decision

Promote the wallpaper `mediaLayer` to its own compositor layer by setting
`will-change: transform` in `styleLayer` for the `media` layer only. The
`scrim` layer (a solid-color dim overlay) is left unpromoted: re-rasterizing
a flat color is trivial and it carries no image to cache.

## Testing

A `wallpaper.spec.ts` test "isolates the media layer on its own compositor
layer (issue #1013)" asserts `media.style.willChange === 'transform'` and
`scrim.style.willChange === ''`. All 551 skin-center tests pass; `tsc -p
tsconfig.json --noEmit` is clean.

Verification gap. The flicker could not be reproduced in headless or headed
Playwright (compositor behavior does not surface the same way as a real
browser). The fix is grounded in the code differential (image lacks
promotion; video/iframe get it for free), the user's differential (custom
image flickers, default does not), and the existing issue #1013 fix for the
sibling decoration layer. The change needs a skin-center rebuild and a DSH
restart to take effect, and must be eyeballed in the user's real browser.

## Alternatives considered

Promote the `<img>` child instead of the `mediaLayer` parent. Rejected: the
parent is the stable full-viewport surface and is the layer the decoration
precedent promotes; promoting the parent caches the image backing uniformly
for image / video / iframe media (video/iframe are already auto-promoted, so
this is consistent and harmless). One site, one rule.

Use `transform: translateZ(0)` instead of `will-change: transform`. Rejected:
`WallpaperController.render()` sets `mediaLayer.style.transform` dynamically
(`scale(1.05)` when `blurValue > 0`, else `''`) and would clobber a
`translateZ`. `will-change` is not clobbered by the transform assignment and
matches the `decoration-layers` precedent exactly.

Disable the composer-card `backdrop-filter` while a menu is open. Rejected:
A/B testing in the live GUI showed removing `data-dsh-backdrop-active` did not
reduce the menu pixel change, and it would regress the intended frost effect.
The root cause is the wallpaper layer, not the frost rule.

## Consequences

A full-viewport wallpaper `mediaLayer` now occupies a dedicated compositor
layer with a cached backing store - one extra GPU texture the size of the
viewport. That cost was already effectively paid for video/iframe wallpapers
(auto-promoted) and is the same cost the skin background decoration layer
already pays.

Domain ownership. `wallpaper.ts` is in the Wallpaper Engine / renderer domain
owned by Aa728848 (EDDYCRAZY-CC) per CONTRIBUTING.md and
.github/pr-review-routes.json. This change is a one-line promotion mirroring
the existing issue #1013 pattern in the same package; the domain owner should
review.
