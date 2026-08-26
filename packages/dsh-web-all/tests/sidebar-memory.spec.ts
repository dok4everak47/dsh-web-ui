/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetSidebarMemoryForTests, installSidebarMemory } from '../src/client/sidebar-memory.ts'

const STORAGE_KEY = 'dsh:sidebar-collapsed'
const TICK_MS = 16
const RESTORE_WATCH_MS = 10_000
const BOOT_SUPPRESS_MS = 4000
const HEARTBEAT_MS = 5000
const BOOT_ATTR = 'data-dsh-sidebar-boot'
const STYLE_ATTR = 'data-dsh-sidebar-memory'

function setWidth(el: HTMLElement, width: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width })
}

function makeSidebar(width = 280, withToggle = true): HTMLElement {
  const sidebar = document.createElement('div')
  sidebar.setAttribute('data-pane', 'sidebar')
  if (withToggle) {
    const slot = document.createElement('div')
    slot.setAttribute('data-slot', 'sidebar')
    const row = document.createElement('div')
    const toggle = document.createElement('button')
    toggle.className = 'hash_toggle'
    toggle.setAttribute('data-dsh-responsive-part', 'sidebar-toggle')
    row.appendChild(toggle)
    slot.appendChild(row)
    sidebar.appendChild(slot)
  }
  setWidth(sidebar, width)
  return sidebar
}

/** Mount the sidebar inside a frame div, mirroring the shell's grid. */
function setFrame(sidebar: HTMLElement): HTMLElement {
  const frame = document.createElement('div')
  frame.appendChild(sidebar)
  return frame
}

/** Mount the sidebar inside a frame div, mirroring the shell's grid; returns the frame. */
function setBody(sidebar: HTMLElement | null, framed = true): HTMLElement {
  document.body.innerHTML = ''
  if (sidebar === null) return document.body
  if (framed) {
    const frame = setFrame(sidebar)
    document.body.appendChild(frame)
    return frame
  }
  document.body.appendChild(sidebar)
  return document.body
}

/** Advance the fake clock by n watcher ticks, draining chained timers. */
async function tick(n = 1): Promise<void> {
  await vi.advanceTimersByTimeAsync(TICK_MS * n)
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  _resetSidebarMemoryForTests()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.head.querySelectorAll(`style[${STYLE_ATTR}]`).forEach(el => el.remove())
})

describe('sidebar memory: first visit', () => {
  it('seeds localStorage with the current expanded state', async () => {
    setBody(makeSidebar(280))
    const layout = { toggleSidebar: vi.fn() }
    installSidebarMemory(layout)
    await tick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('records collapsed as 1 when the sidebar mounts at rail width', async () => {
    setBody(makeSidebar(56))
    installSidebarMemory()
    await tick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('does not seed when the sidebar never mounts within the restore window', async () => {
    setBody(null)
    const dispose = installSidebarMemory()
    await vi.advanceTimersByTimeAsync(RESTORE_WATCH_MS + TICK_MS * 2)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    dispose()
  })

  it('keeps waiting when the sidebar mounts with a zero width', async () => {
    const sidebar = makeSidebar(0)
    setBody(sidebar)
    installSidebarMemory()
    await tick(3)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    // The column becomes measurable one boot beat later.
    setWidth(sidebar, 56)
    await tick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })
})

describe('sidebar memory: restore', () => {
  it('restores on the first watch tick after mount, without a settle delay', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
    const layout = { toggleSidebar: vi.fn() }
    installSidebarMemory(layout)
    await tick()
    expect(layout.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('does not toggle when persisted state already matches the shell default', async () => {
    localStorage.setItem(STORAGE_KEY, '0')
    setBody(makeSidebar(280))
    const layout = { toggleSidebar: vi.fn() }
    installSidebarMemory(layout)
    await tick(3)
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('does not click a toggle button when layout service is absent', async () => {
    // Earlier drafts clicked a DOM button as a fallback; that can scroll the
    // page, so a missing layout service must mean no restore at all.
    localStorage.setItem(STORAGE_KEY, '1')
    const sidebar = makeSidebar(280)
    setBody(sidebar)
    const toggle = sidebar.querySelector<HTMLButtonElement>('[data-dsh-responsive-part="sidebar-toggle"]')!
    const clickSpy = vi.spyOn(toggle, 'click')
    installSidebarMemory(undefined)
    await tick(3)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('does not retry after a failed toggleSidebar call', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
    const toggle = vi.fn(() => {
      throw new Error('service gone')
    })
    installSidebarMemory({ toggleSidebar: toggle })
    await vi.advanceTimersByTimeAsync(RESTORE_WATCH_MS)
    expect(toggle).toHaveBeenCalledTimes(1)
  })
})

describe('sidebar memory: transition suppression', () => {
  it('suppresses sidebar transitions until the first user interaction', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const sidebar = makeSidebar(280)
    setBody(sidebar)
    // nested descendant with its own collapse transition, mimicking the
    // header-actions / search-box elements inside the real sidebar
    const inner = document.createElement('div')
    inner.className = 'kBB5zG_headerActions'
    sidebar.appendChild(inner)
    const layout = {
      toggleSidebar: vi.fn(() => setWidth(sidebar, 56)),
    }
    installSidebarMemory(layout)
    // Suppression stylesheet is installed immediately and targets the
    // sidebar subtree under the boot attribute on <html>.
    const sheet = document.head.querySelector(`style[${STYLE_ATTR}]`)
    expect(sheet).not.toBeNull()
    expect(sheet?.textContent).toContain('[data-pane="sidebar"] *')
    await tick()
    expect(layout.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(document.documentElement.hasAttribute(BOOT_ATTR)).toBe(true)
    // The boot suppression survives delayed inner renders: it does not end
    // on a timer tied to the outer width, so advance well past any settle
    // window and the attribute is still present.
    await vi.advanceTimersByTimeAsync(600)
    expect(document.documentElement.hasAttribute(BOOT_ATTR)).toBe(true)
    // First user interaction releases it (one task later, so the event
    // that triggered the release does not observe a mid-dispatch change).
    window.dispatchEvent(new Event('pointerdown'))
    await vi.advanceTimersByTimeAsync(0)
    expect(document.documentElement.hasAttribute(BOOT_ATTR)).toBe(false)
  })

  it.each(['pointerdown', 'keydown', 'wheel', 'touchstart'])(
    'releases suppression on the first %s',
    async (eventName) => {
      localStorage.setItem(STORAGE_KEY, '1')
      const sidebar = makeSidebar(280)
      setBody(sidebar)
      installSidebarMemory({ toggleSidebar: vi.fn(() => setWidth(sidebar, 56)) })
      await tick()
      expect(document.documentElement.hasAttribute(BOOT_ATTR)).toBe(true)
      window.dispatchEvent(new Event(eventName))
      await vi.advanceTimersByTimeAsync(0)
      expect(document.documentElement.hasAttribute(BOOT_ATTR)).toBe(false)
    },
  )

  it('drops suppression after the boot cap even without user input', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const sidebar = makeSidebar(280)
    setBody(sidebar)
    // Toggle is a no-op mock: the shell never applies the new state, but
    // the boot cap still releases suppression.
    installSidebarMemory({ toggleSidebar: vi.fn() })
    await tick()
    expect(document.documentElement.hasAttribute(BOOT_ATTR)).toBe(true)
    await vi.advanceTimersByTimeAsync(BOOT_SUPPRESS_MS + TICK_MS * 2)
    expect(document.documentElement.hasAttribute(BOOT_ATTR)).toBe(false)
  })

  it('clears suppression immediately when toggleSidebar throws', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const sidebar = makeSidebar(280)
    setBody(sidebar)
    installSidebarMemory({
      toggleSidebar: () => {
        throw new Error('service gone')
      },
    })
    await tick()
    expect(document.documentElement.hasAttribute(BOOT_ATTR)).toBe(false)
  })

  it('removes the suppression stylesheet on dispose', async () => {
    setBody(makeSidebar(280))
    const dispose = installSidebarMemory()
    expect(document.head.querySelector(`style[${STYLE_ATTR}]`)).not.toBeNull()
    dispose()
    expect(document.head.querySelector(`style[${STYLE_ATTR}]`)).toBeNull()
  })
})

describe('sidebar memory: persist points', () => {
  it('persists on pagehide', async () => {
    setBody(makeSidebar(280))
    const dispose = installSidebarMemory()
    await tick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')

    // User collapses the sidebar through the shell. No observer runs; the
    // width just changes in the DOM.
    const sidebar = document.querySelector<HTMLElement>('[data-pane="sidebar"]')!
    setWidth(sidebar, 56)

    // Before any pause point, storage still holds the old value.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')

    // Navigating away triggers persistNow.
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    dispose()
  })

  it('persists when the tab is hidden', async () => {
    setBody(makeSidebar(56))
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
    const dispose = installSidebarMemory()
    await tick()
    const sidebar = document.querySelector<HTMLElement>('[data-pane="sidebar"]')!
    setWidth(sidebar, 56)

    // Before the heartbeat, no write has happened.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')

    // The heartbeat timer fires after HEARTBEAT_MS and reads the new width.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 50)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    dispose()
  })

  it('does not persist a zero-width reading during a transition', async () => {
    localStorage.setItem(STORAGE_KEY, '0')
    setBody(makeSidebar(280))
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
    localStorage.setItem('dsh:sidebar-memory', 'off')
    setBody(makeSidebar(280))
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
  it('does not stack listeners on a second install call before dispose', () => {
    setBody(makeSidebar(280))
    const dispose1 = installSidebarMemory()
    const dispose2 = installSidebarMemory()
    expect(dispose2).toBe(dispose1)
    dispose1()
  })

  it('dispose stops timers and listeners and allows a fresh install afterwards', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
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
