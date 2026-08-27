// @vitest-environment jsdom
/**
 * TurnNavPanel: renders the outline from the session snapshot, filters by
 * query, pages older history, and closes on Escape / outside press / jump.
 */
import { useEffect, useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  ChatConversationViewNode,
  ConversationSnapshot,
  SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { TurnNavPanel, type TurnNavPanelProps } from '../src/client/TurnNavPanel.tsx'
import { zh, type TurnNavKey } from '../src/client/locales.ts'

// The SDK primitives bundle targets the GUI module loader; stub the two icons.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconCloseOutline16: () => <svg data-testid="icon-close" />,
  IconSearchOutline16: () => <svg data-testid="icon-search" />,
}))

const sid = (value: string): SessionId => value as SessionId

/** Minimal translate over the zh dictionary (template params included). */
function makeTranslate() {
  return (key: TurnNavKey, params?: Record<string, unknown>): string => {
    let text: string = zh[key] ?? key
    if (params !== undefined) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

function userNode(turn: number, seq: number, text: string): ChatConversationViewNode {
  return {
    key: `key-${turn}`,
    kind: 'user',
    id: `msg-${turn}`,
    target: 'chat',
    anchorSeq: seq,
    location: { kind: 'turn', turn: { turn } },
    visibility: 'visible',
    data: { kind: 'user', seq, time: 1_700_000_000_000 + turn * 1000, content: [{ type: 'text', text }] },
  } as unknown as ChatConversationViewNode
}

/** Fake snapshot: three turns in the window, turn 1 without a user node (unloaded). */
function makeSnapshot(overrides?: Partial<ConversationSnapshot['chat']>): ConversationSnapshot {
  const nodes = [userNode(2, 1, 'Refactor the parser'), userNode(3, 2, 'Fix login bug')]
  const turnOrder = [1, 2, 3]
  const turns = new Map<number, unknown>()
  for (const turn of turnOrder) {
    turns.set(turn, {
      turn,
      start: { time: 1_700_000_000_000 + turn * 1000 },
      end: turn < 3 ? { time: 1_700_000_001_000 } : undefined,
      status: turn < 3 ? 'closed' : 'open',
      steps: [],
      data: {},
    })
  }
  return {
    chat: {
      order: nodes.map(node => node.key),
      nodes: {
        get: (key: string) => nodes.find(node => node.key === key),
        values: () => nodes,
      },
      locations: { getTurn: () => [], getStep: () => [] },
      timeline: { turnOrder, turns },
      legacy: {},
      ...overrides,
    },
    hasMore: false,
    loadingOlder: false,
    openState: 'ready',
  } as unknown as ConversationSnapshot
}

/** Fake snapshot with `count` fully-loaded turns (each with a user node). */
function makeManySnapshot(count: number, opts: { hasMore?: boolean; startTurn?: number } = {}): ConversationSnapshot {
  const { hasMore = false, startTurn = 1 } = opts
  const last = startTurn + count - 1
  const nodes: ChatConversationViewNode[] = []
  const turnOrder: number[] = []
  const turns = new Map<number, unknown>()
  for (let turn = startTurn; turn <= last; turn++) {
    turnOrder.push(turn)
    nodes.push(userNode(turn, turn, `Prompt number ${turn}`))
    turns.set(turn, {
      turn,
      start: { time: 1_700_000_000_000 + turn * 1000 },
      end: turn < last ? { time: 1_700_000_001_000 } : undefined,
      status: turn < last ? 'closed' : 'open',
      steps: [],
      data: {},
    })
  }
  return {
    chat: {
      order: nodes.map(node => node.key),
      nodes: {
        get: (key: string) => nodes.find(node => node.key === key),
        values: () => nodes,
      },
      locations: { getTurn: () => [], getStep: () => [] },
      timeline: { turnOrder, turns },
      legacy: {},
    },
    hasMore,
    loadingOlder: false,
    openState: 'ready',
  } as unknown as ConversationSnapshot
}

/** Minimal observable snapshot store so history paging can update the panel. */
type SnapStore = {
  get(): ConversationSnapshot
  set(next: ConversationSnapshot): void
  subscribe(listener: () => void): () => void
}

function createStore(initial: ConversationSnapshot): SnapStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: (next) => {
      state = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** Injects the store-backed useSession / loadOlder face into the panel. */
function Harness({ store, loadOlder, onClose }: {
  store: SnapStore
  loadOlder: Mock
  onClose: Mock
}) {
  const useSession = useMemo(() => (
    ((selector: (snap: ConversationSnapshot) => unknown) => {
      const [snap, setSnap] = useState<ConversationSnapshot>(store.get())
      useEffect(() => store.subscribe(() => setSnap(store.get())), [store])
      return selector(snap)
    }) as TurnNavPanelProps['useSession']
  ), [store])
  const panelProps = {
    useSession,
    sessionId: sid('sess-1'),
    t: makeTranslate(),
    loadOlder,
    onClose,
  } as unknown as TurnNavPanelProps
  return <TurnNavPanel {...panelProps} />
}

/**
 * A store over a window of `loadedCount` loaded turns whose loadOlder mock
 * pages in `olderCount` older turns below the window (the DSH model: history
 * loads on demand, older turns arrive behind the loaded window).
 */
function makePagedStore(loadedCount: number, olderCount: number) {
  const store = createStore(makeManySnapshot(loadedCount, { startTurn: olderCount + 1, hasMore: olderCount > 0 }))
  const loadOlder = vi.fn(() => {
    const oldest = Math.min(...store.get().chat.timeline.turnOrder)
    const newest = oldest + loadedCount - 1
    store.set(makeManySnapshot(newest, { startTurn: 1, hasMore: false }))
  })
  return { store, loadOlder }
}

/** Mount the panel against a mutable snapshot store so history paging can update it. */
function mountPanel(store: SnapStore, loadOlder: Mock = vi.fn()) {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.setAttribute('data-phase', 'active')
  const scrollport = document.createElement('div')
  scrollport.setAttribute('data-conversation-scroll', '')
  for (const node of store.get().chat.nodes.values() as Iterable<ChatConversationViewNode>) {
    const row = document.createElement('div')
    row.setAttribute('data-chat-anchor-key', node.key)
    row.scrollIntoView = vi.fn()
    scrollport.append(row)
  }
  const host = document.createElement('div')
  root.append(scrollport, host)
  document.body.append(root)

  const onClose = vi.fn()
  const utils = render(<Harness store={store} loadOlder={loadOlder} onClose={onClose} />, { container: host })
  return { ...utils, store, loadOlder, onClose, root }
}

/** Mount the panel against a static snapshot (no history paging). */
function mountSnapshot(snapshot: ConversationSnapshot) {
  return mountPanel(createStore(snapshot))
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

beforeEach(() => {
  vi.useRealTimers()
})

describe('TurnNavPanel', () => {
  it('lists loaded turns newest first and marks the unloaded turn disabled', () => {
    const { container } = mountSnapshot(makeSnapshot())
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    // Newest first: turn 3, then 2, then the unloaded turn 1.
    expect(rows.map(row => row.getAttribute('data-turn'))).toEqual(['3', '2', '1'])
    expect(rows[0].hasAttribute('disabled')).toBe(false)
    expect(rows[2].hasAttribute('disabled')).toBe(true)
    expect(rows[2].getAttribute('title')).toBe(zh['panel.notLoaded'])
    expect(container.textContent).toContain('Fix login bug')
  })

  it('jumps to the clicked turn row, flashes it, and closes the panel', () => {
    const { onClose } = mountSnapshot(makeSnapshot())
    const target = document.querySelector('[data-chat-anchor-key="key-2"]') as HTMLElement
    expect(target.classList.contains('dsh-turn-nav-flash')).toBe(false)
    fireEvent.click(screen.getAllByRole('listitem')[1])
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(target.classList.contains('dsh-turn-nav-flash')).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports a miss when the anchor row is not in the DOM', () => {
    const snapshot = makeSnapshot()
    const { onClose } = mountSnapshot(snapshot)
    // Remove the scrollport rows to simulate an inactive view tab.
    document.querySelector('[data-conversation-scroll]')?.replaceChildren()
    fireEvent.click(screen.getAllByRole('listitem')[0])
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(zh['panel.notLoaded'])).toBeTruthy()
  })

  it('filters rows by the search query', () => {
    mountSnapshot(makeSnapshot())
    const input = screen.getByPlaceholderText(zh['panel.searchPlaceholder']) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'parser' } })
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn'))).toEqual(['2'])
    fireEvent.change(input, { target: { value: 'zzz-nope' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(zh['panel.noMatch'])).toBeTruthy()
  })

  it('loads all older history on open then paginates the full outline', async () => {
    // Loaded window is turns 6..11 (two pages); older turns 1..5 are unloaded.
    const { store, loadOlder } = makePagedStore(6, 5)
    mountPanel(store, loadOlder)
    await act(async () => {})
    // The panel pages older history in until hasMore clears (one call here),
    // so the pager then reflects the real total and paging never fetches.
    expect(loadOlder).toHaveBeenCalledWith(sid('sess-1'))
    expect(loadOlder).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['11', '10', '9', '8', '7'])
    expect(screen.getByText('/ 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['panel.next'] }))
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['6', '5', '4', '3', '2'])
    // Navigation is pure now - no further fetches.
    expect(loadOlder).toHaveBeenCalledTimes(1)
  })

  it('does not fetch when there is no older history', () => {
    const { loadOlder } = mountSnapshot(makeManySnapshot(3))
    expect(loadOlder).not.toHaveBeenCalled()
    // 3 turns fit one page; the pager shows the real total immediately.
    expect(screen.getByText('/ 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['panel.next'] })).toHaveProperty('disabled', true)
  })

  it('paginates 5 turns per page and navigates with prev/next', () => {
    mountSnapshot(makeManySnapshot(12))
    // Page 1: newest five turns (12 down to 8), 3 pages total.
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['12', '11', '10', '9', '8'])
    expect(screen.getByText('/ 3')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['panel.prev'] })).toHaveProperty('disabled', true)
    const next = screen.getByRole('button', { name: zh['panel.next'] })
    fireEvent.click(next)
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['7', '6', '5', '4', '3'])
    fireEvent.click(screen.getByRole('button', { name: zh['panel.next'] }))
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['2', '1'])
    expect(screen.getByRole('button', { name: zh['panel.next'] })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: zh['panel.prev'] }))
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['7', '6', '5', '4', '3'])
  })

  it('jumps to a page typed into the input and clamps out-of-range values', () => {
    mountSnapshot(makeManySnapshot(12))
    const input = screen.getByRole('textbox', { name: zh['panel.pageAria'].replace('{total}', '3') })
    // Jump to page 1 via the input.
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['12', '11', '10', '9', '8'])
    // Out-of-range page 99 clamps to the last page (3).
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['2', '1'])
    // Non-numeric input resets back to the current page.
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect((input as HTMLInputElement).value).toBe('3')
  })

  it('pads a short last page with blank slots so the grid stays 5 rows tall', () => {
    const { container } = mountSnapshot(makeManySnapshot(12)) // pages: 5, 5, 2
    // Full first page -> no blank slots.
    expect(container.querySelectorAll('[data-row-pad]')).toHaveLength(0)
    // Last page has 2 turns -> 3 blank slots fill out to 5.
    fireEvent.click(screen.getByRole('button', { name: zh['panel.next'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['panel.next'] }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelectorAll('[data-row-pad]')).toHaveLength(3)
  })

  it('keeps the page input visible and disabled while older history loads', () => {
    // hasMore stays true and loadOlder is a no-op -> panel stays in loadingAll.
    const store = createStore(makeManySnapshot(3, { hasMore: true }))
    const loadOlder = vi.fn()
    const { container } = mountPanel(store, loadOlder)
    expect(screen.getByText(zh['panel.loadingAll'])).toBeTruthy()
    // The page input is present (the jump affordance is always visible) but
    // disabled until the full history lands and the real total is known.
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.disabled).toBe(true)
    expect(screen.getByText('/ …')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['panel.prev'] })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: zh['panel.next'] })).toHaveProperty('disabled', true)
  })

  it('restarts at page 1 when the search query changes', () => {
    mountSnapshot(makeManySnapshot(12))
    const search = screen.getByPlaceholderText(zh['panel.searchPlaceholder']) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: zh['panel.next'] }))
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['7', '6', '5', '4', '3'])
    fireEvent.change(search, { target: { value: 'Prompt number 9' } })
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['9'])
  })

  it('closes on Escape', () => {
    const { onClose } = mountSnapshot(makeSnapshot())
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the running badge only on the open turn', () => {
    mountSnapshot(makeSnapshot())
    const running = screen.getAllByText(zh['panel.running'])
    expect(running).toHaveLength(1)
    expect(running[0].closest('button')?.getAttribute('data-turn')).toBe('3')
  })
})
