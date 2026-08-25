/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetSidebarMemoryForTests, installSidebarMemory } from '../src/client/sidebar-memory.ts'

const STORAGE_KEY = 'dsh:sidebar-collapsed'
const RESTORE_DELAY_MS = 500
const HEARTBEAT_MS = 5000

function setWidth(el: HTMLElement, width: number): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width })
}

function setBody(sidebar: HTMLElement | null): void {
  document.body.innerHTML = ''
  if (sidebar !== null) document.body.appendChild(sidebar)
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

/** Flush the restore delay plus any queued microtasks. */
async function flushRestore(): Promise<void> {
  await vi.advanceTimersByTimeAsync(RESTORE_DELAY_MS + 10)
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  _resetSidebarMemoryForTests()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('sidebar memory: first visit', () => {
  it('seeds localStorage with the current expanded state', async () => {
    setBody(makeSidebar(280))
    const layout = { toggleSidebar: vi.fn() }
    installSidebarMemory(layout)
    await flushRestore()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('records collapsed as 1 when the sidebar mounts at rail width', async () => {
    setBody(makeSidebar(56))
    installSidebarMemory()
    await flushRestore()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('does not seed when the sidebar never mounts within the restore window', async () => {
    setBody(null)
    installSidebarMemory()
    await flushRestore()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('sidebar memory: restore', () => {
  it('calls toggleSidebar once when persisted collapsed but shell booted expanded', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
    const layout = { toggleSidebar: vi.fn() }
    installSidebarMemory(layout)
    await flushRestore()
    expect(layout.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('does not toggle when persisted state already matches the shell default', async () => {
    localStorage.setItem(STORAGE_KEY, '0')
    setBody(makeSidebar(280))
    const layout = { toggleSidebar: vi.fn() }
    installSidebarMemory(layout)
    await flushRestore()
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
    await flushRestore()
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('does not retry after a failed toggleSidebar call', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setBody(makeSidebar(280))
    const toggle = vi.fn(() => {
      throw new Error('service gone')
    })
    installSidebarMemory({ toggleSidebar: toggle })
    await flushRestore()
    expect(toggle).toHaveBeenCalledTimes(1)
  })
})

describe('sidebar memory: persist points', () => {
  it('persists on pagehide', async () => {
    setBody(makeSidebar(280))
    const dispose = installSidebarMemory()
    await flushRestore()
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
    await flushRestore()
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
    await flushRestore()
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
    await flushRestore()

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
    await flushRestore()
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
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
    await flushRestore()
    expect(layout2.toggleSidebar).toHaveBeenCalledTimes(1)
    dispose2()
  })
})
