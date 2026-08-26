/**
 * Sidebar collapsed-state memory.
 *
 * The official dsh web shell keeps the sidebar fold state in a transient
 * React store (see the ui-layout panel store: `init` always boots the
 * sidebar open); it is never written to a store, localStorage, or settings,
 * so every fresh page load starts the column expanded. This module persists
 * the last user-chosen fold state in localStorage and restores it as soon as
 * the sidebar column mounts.
 *
 * Safety-first design (this runs on every page, including while the user
 * types, so it must not fight the shell or cause layout feedback):
 *
 *  - No MutationObserver: previous drafts observed the sidebar's class/style
 *    attributes, but React re-renders during typing can fire those observers
 *    and the resulting width-read / localStorage-write loop could interact
 *    badly with the shell's focus management. We now persist only at
 *    natural pause points: pagehide, visibilitychange to hidden, and a slow
 *    5-second heartbeat. None of these run per keystroke.
 *  - Width-based state detection: offsetWidth < 120px classifies the 56px
 *    rail; anything wider is expanded. We never read hashed css-module
 *    class names, so the detection survives shell rc upgrades.
 *  - Restore is instant and animation-free: a 16ms watcher loop starts at
 *    install and flips the state through ctx.layout.toggleSidebar() on the
 *    first tick after the sidebar mounts (one frame at most is painted in
 *    the boot default). The shell's frame grid animates
 *    `grid-template-columns` on every toggle, and the sidebar's inner
 *    content runs additional collapse animations (header actions fade, the
 *    search box narrows) in a LATER React render than the frame grid, so a
 *    one-shot frame tag is not enough. The restore sets a `data-dsh-sidebar-boot`
 *    attribute on <html> that disables transitions across the whole sidebar
 *    subtree until the first user interaction (pointer / key / wheel /
 *    touch) or a 4s cap, covering every delayed inner render; once the user
 *    acts the attribute is removed and manual toggles animate normally.
 *    There is NO synthetic button click fallback: a programmatic click on
 *    the shell's toggle button could scroll the button into view and steal
 *    focus from the composer.
 *  - When the layout service is absent, restore is skipped and the shell
 *    default stands.
 *  - Kill switch: setting localStorage `dsh:sidebar-memory` to `"off"`
 *    before load disables the feature entirely (refresh to apply).
 *
 * Every external access is defensive: a missing sidebar, a storage that
 * throws in private mode, a layout service that disappears mid-run, and a
 * sidebar that never mounts all degrade to a no-op.
 * @module dsh-web-all/client/sidebar-memory
 */

/** localStorage key under which the last collapsed flag is stored. */
const STORAGE_KEY = 'dsh:sidebar-collapsed'

/** Kill switch: when set to "off" the controller never installs. */
const DISABLE_KEY = 'dsh:sidebar-memory'

/**
 * Widths below this threshold are treated as the collapsed rail. The shell's
 * rail is 56px (plus ~20px inline padding baked into the root) and its
 * expanded column is user-resizable starting around 240px; a midpoint
 * threshold gives a wide margin against future tweaks.
 */
const COLLAPSED_WIDTH_THRESHOLD = 120

/** Watcher tick: find the mounted sidebar at frame granularity. */
const TICK_MS = 16

/** Give up restoring when the sidebar has not mounted after this long. */
const RESTORE_WATCH_MS = 10_000

/**
 * Hard cap for the interaction-gated suppression: even if no user input ever
 * arrives, stop suppressing after this long so the shell's own animations
 * cannot stay disabled on an idle page.
 */
const BOOT_SUPPRESS_MS = 4000

/** Attribute on <html> that keeps sidebar transitions suppressed until first interaction. */
const BOOT_ATTR = 'data-dsh-sidebar-boot'

/** Attribute identifying the suppression stylesheet owned by this module. */
const STYLE_ATTR = 'data-dsh-sidebar-memory'

/**
 * Transition suppression for the sidebar restore. The frame grid animates
 * `grid-template-columns`, its children include the resize handle that
 * animates `left`, and the sidebar's INNER content runs its own collapse
 * animations when the rail state flips (header actions animate
 * max-width/opacity/transform, the search box animates width/padding, and so
 * on) — and those inner commits land in a later React render than the frame
 * grid, so a one-shot tag removed as soon as the outer width matched still
 * let the ~0.18s content collapse play through and read as the old close
 * animation.
 *
 * The rule therefore keys off an attribute on <html> that stays set from the
 * restore toggle until the first user interaction (pointer / key / wheel /
 * touch) or the BOOT_SUPPRESS_MS cap, covering every delayed inner render.
 * `transition: none` on every descendant of the sidebar frame kills the lot.
 * This is deliberately broad but only active before the user does anything;
 * once they interact it is removed and manual toggles animate normally. It
 * mirrors how the shell itself disables the frame transition while dragging
 * (`[data-dragging] { transition: none }`).
 */
const SUPPRESS_CSS = `
html[${BOOT_ATTR}] [data-pane="sidebar"],
html[${BOOT_ATTR}] [data-pane="sidebar"] *,
html[${BOOT_ATTR}] [class*="sidebarCol"],
html[${BOOT_ATTR}] [class*="sidebarCol"] *,
html[${BOOT_ATTR}] [class*="sidebarCol"] ~ [class*="handle"] {
  transition: none !important;
}`

/** Heartbeat: if the page stays open for a long time without unloading,
 *  still persist the current state occasionally (cheap: one width read +
 *  one localStorage write). */
const HEARTBEAT_MS = 5000

/** Minimal face of the cordis layout service this module depends on. */
interface LayoutService {
  toggleSidebar(): void
}

/** Read the persisted collapsed flag; null when never stored or storage fails. */
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

/** Persist the collapsed flag. Silent on storage failure (private mode, quota). */
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

/** Find the shell sidebar column once the compat shim has stamped it. */
function findSidebar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
}

/**
 * Classify a sidebar element as collapsed by its measured width. A zero-width
 * element (detached, display:none during a transition) returns undefined so
 * the caller can skip persisting a false reading rather than treat it as
 * expanded.
 */
function isCollapsedByWidth(sidebar: HTMLElement): boolean | undefined {
  const width = sidebar.offsetWidth
  if (width <= 0) return undefined
  return width < COLLAPSED_WIDTH_THRESHOLD
}

/**
 * Install the sidebar memory controller. Idempotent: a second call before
 * the previous instance is disposed returns the previous disposer and does
 * not stack listeners.
 * @param layout - the cordis layout service when reachable; undefined when
 *   the host shell does not expose one, in which case restore is skipped.
 * @returns disposer that stops all listeners and timers.
 */
export function installSidebarMemory(layout?: LayoutService): () => void {
  if (installAnchor !== undefined) return installAnchor
  if (isDisabled()) return () => {}

  let disposed = false
  let sidebar: HTMLElement | null = null
  let restored = false
  let watchTimer: ReturnType<typeof setTimeout> | undefined
  let bootCapTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let lastPersisted = readPersisted()
  let toggleFailed = false
  let bootSuppressing = false
  let suppressStyle: HTMLStyleElement | null = null

  const stopTimers = (): void => {
    if (watchTimer !== undefined) {
      clearTimeout(watchTimer)
      watchTimer = undefined
    }
    if (bootCapTimer !== undefined) {
      clearTimeout(bootCapTimer)
      bootCapTimer = undefined
    }
  }

  /**
   * First-interaction release: the boot suppression exists only to hide the
   * restore collapse on a fresh load. Once the user points, types, scrolls,
   * or touches, normal transitions must return so manual toggles animate.
   * Deferred a task so the very event that releases suppression does not see
   * a mid-dispatch style change.
   */
  function releaseSuppression(): void {
    setTimeout(removeSuppression, 0)
  }

  /** End the boot transition suppression (safe to call repeatedly). */
  const removeSuppression = (): void => {
    if (!bootSuppressing) return
    bootSuppressing = false
    if (bootCapTimer !== undefined) {
      clearTimeout(bootCapTimer)
      bootCapTimer = undefined
    }
    const opts: AddEventListenerOptions = { capture: true }
    window.removeEventListener('pointerdown', releaseSuppression, opts)
    window.removeEventListener('keydown', releaseSuppression, opts)
    window.removeEventListener('wheel', releaseSuppression, opts)
    window.removeEventListener('touchstart', releaseSuppression, opts)
    document.documentElement.removeAttribute(BOOT_ATTR)
  }

  const cleanup = (): void => {
    disposed = true
    stopTimers()
    removeSuppression()
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    window.removeEventListener('pagehide', persistNow)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (suppressStyle !== null) {
      suppressStyle.remove()
      suppressStyle = null
    }
    sidebar = null
    installAnchor = undefined
  }
  installAnchor = cleanup

  /** Read the current width and write it to localStorage if it changed. */
  const persistNow = (): void => {
    if (disposed) return
    const current = sidebar !== null ? isCollapsedByWidth(sidebar) : undefined
    if (current === undefined) return
    if (lastPersisted !== current) {
      lastPersisted = current
      writePersisted(current)
    }
  }

  /** Save when the tab is hidden (refresh, navigation, tab switch). */
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') persistNow()
  }

  /**
   * Restore the persisted state now that the sidebar has mounted with a
   * readable width. Runs exactly once; never retries because a retry loop
   * during ongoing React re-renders is what we are deliberately avoiding.
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
      return
    }
    if (lastPersisted === current) return
    if (layout === undefined || toggleFailed) return

    // State mismatch: flip once through the shell's own layout service and
    // suppress every sidebar transition until the first user interaction,
    // so the restored state appears already in place instead of playing the
    // collapse animation. The shell's frame grid, the resize handle, and
    // the sidebar's inner content all animate on collapse, and the inner
    // content commits in a later render than the frame; an interaction-
    // gated <html> attribute covers them all. We never call .click() on a
    // DOM button here, because that can scroll the button into view and
    // steal focus from whatever the user is doing.
    bootSuppressing = true
    document.documentElement.setAttribute(BOOT_ATTR, '')
    // Releasing on the first interaction uses capture so it cannot be
    // prevented by the shell; passive so it never blocks the event.
    const cap: AddEventListenerOptions = { capture: true }
    const passive: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('pointerdown', releaseSuppression, passive)
    window.addEventListener('keydown', releaseSuppression, cap)
    window.addEventListener('wheel', releaseSuppression, passive)
    window.addEventListener('touchstart', releaseSuppression, passive)
    bootCapTimer = setTimeout(removeSuppression, BOOT_SUPPRESS_MS)
    try {
      layout.toggleSidebar()
    } catch {
      // The service disappeared or rejected the call; stop trying so a
      // future shell upgrade that renames the method cannot cause a loop.
      removeSuppression()
      toggleFailed = true
      return
    }
    // The shell's state has flipped; update our cached expectation so the
    // next persist reads the new width without immediately rewriting it.
    lastPersisted = !current
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
      if (budgetLeft <= TICK_MS) return // never mounted; shell default stands
      watchForSidebar(budgetLeft - TICK_MS)
    }, TICK_MS)
  }

  // The suppression stylesheet is inert until the frame carries the tag;
  // install it up front so the rule is guaranteed to exist before the
  // restore tick fires.
  const style = document.createElement('style')
  style.setAttribute(STYLE_ATTR, '')
  style.textContent = SUPPRESS_CSS
  document.head.appendChild(style)
  suppressStyle = style

  // Restore as soon as the sidebar mounts; at frame granularity this is at
  // most one painted frame after the shell's boot layout.
  watchForSidebar(RESTORE_WATCH_MS)

  // Persist at natural pause points. These do not fire on keystrokes:
  //  - pagehide fires on refresh / navigation / tab close,
  //  - visibilitychange hidden fires on tab switch / lock screen,
  //  - the 5s heartbeat catches long sessions that never hide.
  window.addEventListener('pagehide', persistNow, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true })
  heartbeatTimer = setInterval(persistNow, HEARTBEAT_MS)

  return cleanup
}

/**
 * Reset the singleton install anchor. Test-only: production never needs this
 * because the compat shim is installed once per page. Exposed so unit tests
 * can get a fresh controller between cases without re-importing the module.
 */
export function _resetSidebarMemoryForTests(): void {
  installAnchor = undefined
}

/** Singleton anchor: guards against double-install from HMR / re-apply. */
let installAnchor: (() => void) | undefined
