/**
 * Sidebar collapsed-state memory.
 *
 * The official dsh web shell keeps the sidebar fold state in a transient
 * React store (the ui-layout panel store `init` always boots the sidebar
 * open at 280px); it is never written to a store, localStorage, or
 * settings, so every fresh page load starts the column expanded. This
 * module persists the last user-chosen fold state in localStorage and
 * restores it across reloads.
 *
 * First-paint restore (the important part)
 * ----------------------------------------
 * The shell's `runPluginBoot` awaits EVERY plugin module import, and only
 * AFTER all of them settle does it create and render the APP_SHELL layout
 * frame. That means module top-level code here runs BEFORE the frame's
 * first paint. We use that window: when the persisted state is collapsed,
 * {@link installPreCollapseCss} injects a render-blocking `<style>` at
 * import time that forces the frame grid to its 56px rail geometry with
 * `!important`. The frame therefore paints already collapsed -- there is
 * no expanded first frame and no collapse transition to suppress.
 *
 * Once the shell commits the real collapsed state (the frame carries
 * `data-sidebar-collapsed`) the pre-collapse stylesheet is removed; the
 * shell's own rules resolve to the same 56px rail, so removal causes no
 * visual change. A runtime call to `layout.toggleSidebar()` still flips
 * the React store so subsequent manual toggles and drag resize behave
 * correctly; it changes nothing visible because the frame is already at
 * the target width.
 *
 * Safety-first design (this runs on every page, including while the user
 * types, so it must not fight the shell or cause layout feedback):
 *
 *  - No MutationObserver on the sidebar: React re-renders during typing
 *    could fire observers and create a width-read/localStorage-write
 *    feedback loop with the shell's focus management. We persist only at
 *    natural pause points (pagehide, visibilitychange to hidden, and a
 *    slow 5-second heartbeat). None of these run per keystroke.
 *  - A single document-level MO only watches for the frame to gain/lose
 *    `data-sidebar-collapsed`; it reacts to attribute changes, not the
 *    per-keystroke DOM churn, and disconnects as soon as the boot state
 *    is resolved.
 *  - Width-based state detection: offsetWidth < 120px classifies the 56px
 *    rail; anything wider is expanded. We never read hashed css-module
 *    class names, so detection survives shell rc upgrades.
 *  - The pre-collapse grid override is gated to desktop widths
 *    (>= 1025px) so it never fights the shell's narrow/over-the-shell
 *    mobile sidebar.
 *  - No synthetic button click: a programmatic click on the shell's
 *    toggle button could scroll it into view and steal focus.
 *  - Kill switch: setting localStorage `dsh:sidebar-memory` to `"off"`
 *    before load disables the feature entirely (refresh to apply).
 *
 * Every external access is defensive: missing sidebar, storage that
 * throws in private mode, a layout service that disappears mid-run, and a
 * sidebar that never mounts all degrade to a no-op.
 * @module dsh-web-all/client/sidebar-memory
 */

/** localStorage key under which the last collapsed flag is stored. */
const STORAGE_KEY = 'dsh:sidebar-collapsed'

/** Kill switch: when set to "off" the controller never installs. */
const DISABLE_KEY = 'dsh:sidebar-memory'

/**
 * Widths below this threshold are treated as the collapsed rail. The
 * shell's rail is 56px and its expanded column starts around 240px; a
 * midpoint gives a wide margin against future tweaks.
 */
const COLLAPSED_WIDTH_THRESHOLD = 120

/** The shell's desktop sidebar rail width, matching computeCols(sidebar=0). */
const RAIL_WIDTH_PX = 56

/**
 * Above this viewport the sidebar is an in-flow grid column (the shell's
 * SIDEBAR_AUTO_COLLAPSE breakpoint). At or below it the sidebar becomes an
 * over-the-shell overlay, so the pre-collapse grid override must not
 * apply there.
 */
const DESKTOP_MIN_WIDTH_PX = 1025

/** Watcher tick for the runtime restore/persist settle loop. */
const TICK_MS = 16

/** Give up waiting for the sidebar to mount after this long. */
const RESTORE_WATCH_MS = 10_000

/**
 * After the frame gains `data-sidebar-collapsed`, keep the pre-collapse
 * clipping and the descendant `animation/transition: none` override in
 * place for this long before releasing. The shell mounts the sidebar's
 * inner content in two waves even when the frame is already at rail width:
 * an expanded (`wide-in`) wave around ~520ms, then the rail (`rail-in`)
 * wave around ~700ms. Releasing the instant the frame is marked collapsed
 * lets that internal wide-to-rail switch animate on screen; holding past
 * both waves keeps the column clipped and static until the shell has
 * settled into its final rail state.
 */
const SETTLE_HOLD_MS = 900

/** Heartbeat for persisting state on long-lived pages that never hide. */
const HEARTBEAT_MS = 5000

/** Attribute identifying stylesheets owned by this module. */
const STYLE_ATTR = 'data-dsh-sidebar-memory'

/**
 * First-paint pre-collapse CSS. Injected at module import time, before the
 * shell frame renders, so the frame's first paint already uses the 56px
 * rail. `!important` beats the frame's inline `gridTemplateColumns`
 * (280px at boot). Scoped to desktop and to a html-level marker so the
 * runtime controller can remove it the moment the shell commits the real
 * collapsed state.
 *
 * The sidebar column gets `overflow:hidden` so its expanded-width content
 * (search box, entry labels) is clipped to the rail for the handful of
 * frames before the shell applies its own collapsed layout. The center
 * column is untouched (its `minmax(0,1fr)` already absorbs the freed
 * space).
 */
/** Attribute on <html> that holds the pre-collapse geometry until shell commit. */
const PRE_COLLAPSE_ATTR = 'data-dsh-sidebar-precollapse'

/**
 * Marker on the permanent stylesheet that mutes the sidebar's one-shot
 * mount keyframes (`rail-in`, `wide-in`, ...). Unlike the geometry sheet
 * this one is never removed: CSS animations outrank author `!important` on
 * `opacity`/`transform`, so the only way to flatten them is
 * `animation: none`, and removing that would replay the animation from the
 * start. The sidebar's manual fold is driven by transitions (column width,
 * `max-width`), not animations, so silencing animations does not affect
 * folding; it only stops the boot-time fade/slide from ever playing on a
 * collapsed restore.
 */
const NO_ANIM_ATTR_VALUE = 'sidebar-no-anim'

/**
 * Resolve the layout frame element (the grid that parents the sidebar
 * column). We target it structurally rather than by a hashed class name so
 * this survives shell rc upgrades.
 */
function findFrame(): HTMLElement | null {
  const sidebar = document.querySelector<HTMLElement>('[class*="sidebarCol"]')
  return sidebar?.parentElement instanceof HTMLElement ? sidebar.parentElement : null
}

/** Find the shell sidebar column. */
function findSidebar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[class*="sidebarCol"], [data-pane="sidebar"]')
}

/**
 * Inject the pre-collapse stylesheet synchronously. Called once at module
 * import. Returns the injected style element, or null when not needed.
 */
function injectPreCollapseStyle(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  if (readPersisted() !== true) return null
  if (isDisabled()) return null

  // The frame is the grid container that owns grid-template-columns. We
  // cannot select it with a stable class (its name is hashed), so key the
  // rule off the presence of the sidebar column via :has(), which is
  // supported by the Chromium version the desktop harness ships. The
  // override only needs to live until the shell commits the real state.
  const css = `
@media (min-width: ${DESKTOP_MIN_WIDTH_PX}px) {
  html[${PRE_COLLAPSE_ATTR}] [class*="frame"]:has([class*="sidebarCol"]) {
    grid-template-columns: ${RAIL_WIDTH_PX}px minmax(0, 1fr) 0px !important;
    transition: none !important;
  }
  html[${PRE_COLLAPSE_ATTR}] [class*="sidebarCol"],
  html[${PRE_COLLAPSE_ATTR}] [class*="sidebarCol"] * {
    transition: none !important;
  }
  html[${PRE_COLLAPSE_ATTR}] [class*="sidebarCol"] {
    width: ${RAIL_WIDTH_PX}px !important;
    max-width: ${RAIL_WIDTH_PX}px !important;
    min-width: ${RAIL_WIDTH_PX}px !important;
    overflow: hidden !important;
  }
}
`

  const style = document.createElement('style')
  style.setAttribute(STYLE_ATTR, 'precollapse')
  style.textContent = css
  document.documentElement.setAttribute(PRE_COLLAPSE_ATTR, '')
  ;(document.head ?? document.documentElement).appendChild(style)

  // Permanent mount-animation mute for this session (see NO_ANIM_ATTR_VALUE).
  if (!document.querySelector(`style[${STYLE_ATTR}="${NO_ANIM_ATTR_VALUE}"]`)) {
    const mute = document.createElement('style')
    mute.setAttribute(STYLE_ATTR, NO_ANIM_ATTR_VALUE)
    mute.textContent = `
@media (min-width: ${DESKTOP_MIN_WIDTH_PX}px) {
  [class*="sidebarCol"],
  [class*="sidebarCol"] * {
    animation: none !important;
  }
}
`
    ;(document.head ?? document.documentElement).appendChild(mute)
  }

  return style
}

/** Read the persisted collapsed flag; null when never stored / storage fails. */
function readPersisted(): boolean | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
    return null
  } catch {
    return null
  }
}

/** Persist the collapsed flag. Silent on storage failure. */
function writePersisted(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** True when the user has turned off the feature via the kill switch. */
function isDisabled(): boolean {
  try {
    return localStorage.getItem(DISABLE_KEY) === 'off'
  } catch {
    return false
  }
}

/**
 * Classify a sidebar element by its measured width. A zero-width element
 * returns undefined so callers skip persisting a false reading.
 */
function isCollapsedByWidth(sidebar: HTMLElement): boolean | undefined {
  const width = sidebar.offsetWidth
  if (width <= 0) return undefined
  return width < COLLAPSED_WIDTH_THRESHOLD
}

/** Minimal face of the cordis layout service this module depends on. */
interface LayoutService {
  toggleSidebar(): void
}

/**
 * Install the sidebar memory controller. Idempotent.
 *
 * The pre-collapse stylesheet is already in the DOM from the import-time
 * {@link injectPreCollapseStyle} call; this function takes over once the
 * cordis context is live: it flips the React store to match, watches for
 * the shell to commit the real collapsed state so the pre-collapse sheet
 * can be removed, and persists future toggles.
 *
 * @param layout - the cordis layout service when reachable.
 * @returns disposer that stops all listeners and timers.
 */
export function installSidebarMemory(layout?: LayoutService): () => void {
  if (installAnchor !== undefined) return installAnchor
  if (isDisabled()) return () => {}

  let disposed = false
  let sidebar: HTMLElement | null = null
  let restored = false
  let watchTimer: ReturnType<typeof setTimeout> | undefined
  let bootTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let lastPersisted = readPersisted()
  let preCollapseStyle: HTMLStyleElement | null =
    document.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}="precollapse"]`)
  let mo: MutationObserver | undefined
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let resolved = false

  const stopTimers = (): void => {
    if (watchTimer !== undefined) {
      clearTimeout(watchTimer)
      watchTimer = undefined
    }
    if (bootTimer !== undefined) {
      clearTimeout(bootTimer)
      bootTimer = undefined
    }
    if (holdTimer !== undefined) {
      clearTimeout(holdTimer)
      holdTimer = undefined
    }
  }

  /** Drop the pre-collapse geometry; the shell's own state now owns it. The
   *  mount-animation mute intentionally stays installed (it is removed only
   *  on dispose) so boot keyframes can never replay when geometry hands off. */
  const releasePreCollapse = (): void => {
    if (resolved) return
    resolved = true
    document.documentElement.removeAttribute(PRE_COLLAPSE_ATTR)
    if (preCollapseStyle !== null) {
      preCollapseStyle.remove()
      preCollapseStyle = null
    }
    if (mo !== undefined) {
      mo.disconnect()
      mo = undefined
    }
    if (bootTimer !== undefined) {
      clearTimeout(bootTimer)
      bootTimer = undefined
    }
    if (holdTimer !== undefined) {
      clearTimeout(holdTimer)
      holdTimer = undefined
    }
  }

  const cleanup = (): void => {
    disposed = true
    stopTimers()
    releasePreCollapse()
    // Remove the session-scoped mount-animation mute on full dispose.
    document
      .querySelector(`style[${STYLE_ATTR}="${NO_ANIM_ATTR_VALUE}"]`)
      ?.remove()
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    window.removeEventListener('pagehide', persistNow)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    sidebar = null
    installAnchor = undefined
  }
  installAnchor = cleanup

  /** Read the current width and persist it if it changed. */
  const persistNow = (): void => {
    if (disposed) return
    const current = sidebar !== null ? isCollapsedByWidth(sidebar) : undefined
    if (current === undefined) return
    if (lastPersisted !== current) {
      lastPersisted = current
      writePersisted(current)
    }
  }

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') persistNow()
  }

  /**
   * Watch for the frame to gain/lose `data-sidebar-collapsed`. We do NOT
   * release the instant the frame is marked collapsed: the shell mounts the
   * sidebar inner content in a wide wave then a rail wave, so the column
   * stays clipped with descendant animations suppressed for
   * {@link SETTLE_HOLD_MS} after that point (see the constant). The observer
   * is attribute-only, so it never reacts to per-keystroke content churn.
   */
  const observeFrame = (frame: HTMLElement): void => {
    const check = (): void => {
      if (disposed || resolved) return
      // For a persisted-expanded boot there was no pre-collapse sheet.
      if (lastPersisted === false) {
        releasePreCollapse()
        return
      }
      if (!frame.hasAttribute('data-sidebar-collapsed')) return
      // Shell has committed the collapsed frame; detach the observer and
      // hold the clipping/animation suppression until the inner content has
      // finished its wide-to-rail mount waves.
      if (mo !== undefined) {
        mo.disconnect()
        mo = undefined
      }
      if (bootTimer !== undefined) {
        clearTimeout(bootTimer)
        bootTimer = undefined
      }
      holdTimer = setTimeout(releasePreCollapse, SETTLE_HOLD_MS)
    }
    check()
    if (resolved) return
    mo = new MutationObserver(check)
    mo.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    // Safety cap: if the shell never commits the attribute, release after
    // boot so we cannot strand the override on an idle page.
    bootTimer = setTimeout(releasePreCollapse, RESTORE_WATCH_MS)
  }

  /**
   * Restore the persisted state now that the sidebar has mounted with a
   * readable width. Runs at most once. The pre-collapse CSS already made
   * the frame paint at the rail width; here we only reconcile the React
   * store and arrange to hand off to the shell's own collapsed styling.
   */
  const restore = (): void => {
    if (sidebar === null) return
    restored = true
    const current = isCollapsedByWidth(sidebar)
    if (current === undefined) return

    if (lastPersisted === null) {
      // First visit: seed with whatever the shell defaulted to so future
      // reloads remember the user's first toggle.
      lastPersisted = current
      writePersisted(current)
      releasePreCollapse()
      return
    }

    // Seed the frame observer regardless: it releases the pre-collapse
    // sheet once the shell commits the matching state.
    const frame = findFrame()
    if (frame !== null) observeFrame(frame)
    else releasePreCollapse()

    // Decide whether the React store needs flipping. When the pre-collapse
    // sheet is active the frame already PAINTS at 56px (forced by CSS), so a
    // width read says "collapsed" even though the shell's store is still at
    // 280. We must therefore flip whenever the persisted state is collapsed
    // and the sheet is still in effect, regardless of the (CSS-forced)
    // measured width. Once the sheet is gone, a matching width means the
    // shell already agrees and no flip is needed.
    const needsFlip = preCollapseStyle !== null
      ? lastPersisted === true && !frame?.hasAttribute('data-sidebar-collapsed')
      : lastPersisted !== current
    if (!needsFlip) return
    if (layout === undefined) return

    // The pre-collapse sheet has the frame at the rail width already; flip
    // the React store so the shell's internal state agrees with what is on
    // screen and future toggles/drags are coherent. Because the geometry is
    // already at the target and the sheet suppresses transitions until the
    // shell commits, this produces no visible animation.
    try {
      layout.toggleSidebar()
    } catch {
      // A future shell that renames the method must not cause a loop; fall
      // back to the pre-collapse geometry, which is released by the cap.
      return
    }
    // The store now matches the persisted collapsed state.
    lastPersisted = true
  }

  /** Poll until the sidebar column mounts with a readable width. */
  const watchForSidebar = (budgetLeft: number): void => {
    watchTimer = setTimeout(() => {
      watchTimer = undefined
      if (disposed || restored) return
      const found = sidebar ?? findSidebar()
      if (found !== null) {
        sidebar = found
        if (isCollapsedByWidth(found) !== undefined) {
          restore()
          return
        }
      }
      if (budgetLeft <= TICK_MS) {
        // Never mounted; release any pre-collapse override so we cannot
        // strand the shell at 56px on an unexpected host.
        releasePreCollapse()
        return
      }
      watchForSidebar(budgetLeft - TICK_MS)
    }, TICK_MS)
  }

  watchForSidebar(RESTORE_WATCH_MS)

  window.addEventListener('pagehide', persistNow, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true })
  heartbeatTimer = setInterval(persistNow, HEARTBEAT_MS)

  return cleanup
}

/**
 * Reset the singleton install anchor. Test-only.
 */
export function _resetSidebarMemoryForTests(): void {
  installAnchor = undefined
}

let installAnchor: (() => void) | undefined

// --- First-paint pre-collapse ------------------------------------------------
// Runs synchronously at module import, which the shell guarantees happens
// before the layout frame's first paint (runPluginBoot awaits every plugin
// import before rendering APP_SHELL). Keep this side effect at the bottom so
// all helpers above are initialized; it only touches the DOM when a
// collapsed state was persisted.
injectPreCollapseStyle()
