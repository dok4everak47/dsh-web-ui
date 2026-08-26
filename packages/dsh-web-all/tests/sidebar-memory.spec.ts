/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'dsh:sidebar-collapsed'
const DISABLE_KEY = 'dsh:sidebar-memory'
const TICK_MS = 16
const RESTORE_WATCH_MS = 10_000
const SETTLE_HOLD_MS = 900
const HEARTBEAT_MS = 5000
const RAIL_WIDTH_PX = 56
const PRE_COLLAPSE_ATTR = 'data-dsh-sidebar-precollapse'
const STYLE_ATTR = 'data-dsh-sidebar-memory'

function setWidth(el: HTMLElement, width: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width })
}

function makeSidebar(width = 280): HTMLElement {
  const sidebar = document.createElement('div')
  sidebar.className = 'hash_sidebarCol'
  sidebar.setAttribute('data-pane', 'sidebar')
  const slot = document.createElement('div')
  slot.setAttribute('data-slot', 'sidebar')
  sidebar.appendChild(slot)
  setWidth(sidebar, width)
  return sidebar
}

/** Mount the sidebar inside a frame div, mirroring the shell's grid. */
function setBody(sidebar: HTMLElement | null, frameClass = 'hash_frame'): HTMLElement {
  document.body.innerHTML = ''
  if (sidebar === null) return document.body
  const frame = document.createElement('div')
  frame.className = frameClass
  frame.appendChild(sidebar)
  document.body.appendChild(frame)
  return frame
}

async function tick(n = 1): Promise<void> {
  await vi.advanceTimersByTimeAsync(TICK_MS * n)
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  document.documentElement.removeAttribute(PRE_COLLAPSE_ATTR)
  document.head.querySelectorAll(`style[${STYLE_ATTR}]`).forEach(el => el.remove())
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute(PRE_COLLAPSE_ATTR)
  document.head.querySelectorAll(`style[${STYLE_ATTR}]`).forEach(el => el.remove())
})

/** Load a fresh copy of the module so its import-time side effect runs. */
async function loadFresh() {
  vi.resetModules()
  return await import('../src/client/sidebar-memory.ts')
}

describe('sidebar memory: first-paint pre-collapse (import time)', () => {
  it('injects no pre-collapse style when nothing is persisted', async () => {
    await loadFresh()
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(false)
    expect(document.head.querySelector(`style[${STYLE_ATTR}]`)).toBeNull()
  })

  it('injects no pre-collapse style when persisted state is expanded', async () => {
    localStorage.setItem(STORAGE_KEY, '0')
    await loadFresh()
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(false)
    expect(document.head.querySelector(`style[${STYLE_ATTR}]`)).toBeNull()
  })

  it('injects a pre-collapse stylesheet at import time when persisted collapsed', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const mod = await loadFresh()
    const sheet = document.head.querySelector<HTMLStyleElement>(
      `style[${STYLE_ATTR}="precollapse"]`,
    )
    const mute = document.head.querySelector<HTMLStyleElement>(
      `style[${STYLE_ATTR}="sidebar-no-anim"]`,
    )
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(true)
    expect(sheet).not.toBeNull()
    expect(sheet?.textContent).toContain(`grid-template-columns: ${RAIL_WIDTH_PX}px`)
    expect(sheet?.textContent).toContain('!important')
    // The mount-animation mute is also installed so boot keyframes never play.
    expect(mute).not.toBeNull()
    expect(mute?.textContent).toContain('animation: none !important')
    mod._resetSidebarMemoryForTests()
  })

  it('pre-collapse CSS does not apply below the desktop breakpoint', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const mod = await loadFresh()
    const sheet = document.head.querySelector<HTMLStyleElement>(
      `style[${STYLE_ATTR}="precollapse"]`,
    )!
    // The override is wrapped in a min-width media query so it never fights
    // the shell's mobile/overlay sidebar.
    expect(sheet.textContent).toMatch(/@media\s*\(\s*min-width:\s*1025px\s*\)/)
    mod._resetSidebarMemoryForTests()
  })

  it('does not inject when the kill switch is set', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    localStorage.setItem(DISABLE_KEY, 'off')
    await loadFresh()
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(false)
    expect(document.head.querySelector(`style[${STYLE_ATTR}]`)).toBeNull()
  })
})

describe('sidebar memory: first visit', () => {
  it('seeds localStorage with the current expanded state', async () => {
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const layout = { toggleSidebar: vi.fn() }
    installSidebarMemory(layout)
    await tick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('records collapsed as 1 when the sidebar mounts at rail width', async () => {
    setBody(makeSidebar(56))
    const { installSidebarMemory } = await loadFresh()
    installSidebarMemory()
    await tick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('does not seed when the sidebar never mounts within the restore window', async () => {
    setBody(null)
    const { installSidebarMemory } = await loadFresh()
    const dispose = installSidebarMemory()
    await vi.advanceTimersByTimeAsync(RESTORE_WATCH_MS + TICK_MS * 2)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    dispose()
  })

  it('keeps waiting when the sidebar mounts with a zero width', async () => {
    const sidebar = makeSidebar(0)
    setBody(sidebar)
    const { installSidebarMemory } = await loadFresh()
    installSidebarMemory()
    await tick(3)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    setWidth(sidebar, 56)
    await tick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })
})

describe('sidebar memory: restore', () => {
  it('flips the store on the first tick after mount', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const layout = { toggleSidebar: vi.fn() }
    installSidebarMemory(layout)
    await tick()
    expect(layout.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('does not toggle when persisted state already matches the shell default', async () => {
    localStorage.setItem(STORAGE_KEY, '0')
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const layout = { toggleSidebar: vi.fn() }
    installSidebarMemory(layout)
    await tick(3)
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('does not click a toggle button when layout service is absent', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const sidebar = makeSidebar(280)
    setBody(sidebar)
    const toggle = sidebar.querySelector<HTMLButtonElement>('[data-slot="sidebar"]')!
    const clickSpy = vi.spyOn(toggle, 'click')
    const { installSidebarMemory } = await loadFresh()
    installSidebarMemory(undefined)
    await tick(3)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('does not retry after a failed toggleSidebar call', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const toggle = vi.fn(() => {
      throw new Error('service gone')
    })
    installSidebarMemory({ toggleSidebar: toggle })
    await vi.advanceTimersByTimeAsync(RESTORE_WATCH_MS)
    expect(toggle).toHaveBeenCalledTimes(1)
  })
})

describe('sidebar memory: handoff to shell state', () => {
  it('releases the pre-collapse style once the frame is marked collapsed', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const sidebar = makeSidebar(280)
    const frame = setBody(sidebar)
    const { installSidebarMemory } = await loadFresh()
    // Pre-collapse style is present from the import-time injection.
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(true)
    installSidebarMemory({ toggleSidebar: vi.fn(() => setWidth(sidebar, 56)) })
    await tick()
    // Shell has not committed the attribute yet: override stays.
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(true)
    // Shell commits its real collapsed state: hand off after the settle
    // hold (the shell mounts inner content in wide then rail waves).
    frame.setAttribute('data-sidebar-collapsed', '')
    await Promise.resolve() // MO callback is microtask-driven
    // Still holding during the settle window.
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(true)
    await vi.advanceTimersByTimeAsync(SETTLE_HOLD_MS + 10)
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(false)
    expect(document.head.querySelector(`style[${STYLE_ATTR}="precollapse"]`)).toBeNull()
    // The mount-animation mute survives handoff so keyframes cannot replay.
    expect(document.head.querySelector(`style[${STYLE_ATTR}="sidebar-no-anim"]`)).not.toBeNull()
  })

  it('releases immediately for a persisted-expanded boot', async () => {
    localStorage.setItem(STORAGE_KEY, '0')
    const frame = setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(false)
    installSidebarMemory()
    await tick()
    // Even without a pre-collapse sheet, a stray html attribute (there is
    // none here) must not linger; the frame observer resolves promptly.
    frame.setAttribute('data-sidebar-collapsed', '')
    await Promise.resolve()
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(false)
  })

  it('releases the pre-collapse style after the cap if the shell never commits', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    installSidebarMemory({ toggleSidebar: vi.fn() })
    await tick()
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(true)
    await vi.advanceTimersByTimeAsync(RESTORE_WATCH_MS + TICK_MS * 2)
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(false)
  })
  it('removes the pre-collapse style on dispose', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const dispose = installSidebarMemory()
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(true)
    dispose()
    expect(document.documentElement.hasAttribute(PRE_COLLAPSE_ATTR)).toBe(false)
    expect(document.head.querySelector(`style[${STYLE_ATTR}]`)).toBeNull()
  })
})

describe('sidebar memory: persist points', () => {
  it('persists on pagehide', async () => {
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const dispose = installSidebarMemory()
    await tick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
    const sidebar = document.querySelector<HTMLElement>('[data-pane="sidebar"]')!
    setWidth(sidebar, 56)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    dispose()
  })

  it('persists when the tab is hidden', async () => {
    setBody(makeSidebar(56))
    const { installSidebarMemory } = await loadFresh()
    const dispose = installSidebarMemory()
    await tick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    const sidebar = document.querySelector<HTMLElement>('[data-pane="sidebar"]')!
    setWidth(sidebar, 280)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
    dispose()
  })

  it('persists on the heartbeat timer for long-running sessions', async () => {
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const dispose = installSidebarMemory()
    await tick()
    const sidebar = document.querySelector<HTMLElement>('[data-pane="sidebar"]')!
    setWidth(sidebar, 56)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 50)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    dispose()
  })

  it('does not persist a zero-width reading during a transition', async () => {
    localStorage.setItem(STORAGE_KEY, '0')
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const dispose = installSidebarMemory()
    await tick()
    const sidebar = document.querySelector<HTMLElement>('[data-pane="sidebar"]')!
    setWidth(sidebar, 0)
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
    dispose()
  })
})

describe('sidebar memory: kill switch', () => {
  it('does nothing when dsh:sidebar-memory=off', async () => {
    localStorage.setItem(DISABLE_KEY, 'off')
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const layout = { toggleSidebar: vi.fn() }
    const dispose = installSidebarMemory(layout)
    await vi.advanceTimersByTimeAsync(RESTORE_WATCH_MS)
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(document.head.querySelector(`style[${STYLE_ATTR}]`)).toBeNull()
    dispose()
  })
})

describe('sidebar memory: lifecycle', () => {
  it('does not stack listeners on a second install call before dispose', async () => {
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const dispose1 = installSidebarMemory()
    const dispose2 = installSidebarMemory()
    expect(dispose2).toBe(dispose1)
    dispose1()
  })

  it('dispose stops timers and listeners and allows a fresh install afterwards', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
    const { installSidebarMemory } = await loadFresh()
    const layout1 = { toggleSidebar: vi.fn() }
    const dispose = installSidebarMemory(layout1)
    dispose()
    const layout2 = { toggleSidebar: vi.fn() }
    const dispose2 = installSidebarMemory(layout2)
    await tick()
    expect(layout2.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(layout1.toggleSidebar).not.toHaveBeenCalled()
    dispose2()
  })
})
