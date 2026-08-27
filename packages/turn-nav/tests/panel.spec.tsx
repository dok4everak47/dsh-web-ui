// @vitest-environment jsdom
/**
 * TurnNavPanel: renders the outline from the session snapshot, filters by
 * query, pages older history, and closes on Escape / outside press / jump.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    hasMore: true,
    loadingOlder: false,
    openState: 'ready',
  } as unknown as ConversationSnapshot
}

/** Fake snapshot with `count` fully-loaded turns (each with a user node). */
function makeManySnapshot(count: number): ConversationSnapshot {
  const nodes: ChatConversationViewNode[] = []
  const turnOrder: number[] = []
  const turns = new Map<number, unknown>()
  for (let turn = 1; turn <= count; turn++) {
    turnOrder.push(turn)
    nodes.push(userNode(turn, turn, `Prompt number ${turn}`))
    turns.set(turn, {
      turn,
      start: { time: 1_700_000_000_000 + turn * 1000 },
      end: turn < count ? { time: 1_700_000_001_000 } : undefined,
      status: turn < count ? 'closed' : 'open',
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
    hasMore: true,
    loadingOlder: false,
    openState: 'ready',
  } as unknown as ConversationSnapshot
}

/** Mount the panel inside a conversation root with a scrollport of chat rows. */
function mountPanel(snapshot: ConversationSnapshot) {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.setAttribute('data-phase', 'active')
  const scrollport = document.createElement('div')
  scrollport.setAttribute('data-conversation-scroll', '')
  for (const node of snapshot.chat.nodes.values() as Iterable<ChatConversationViewNode>) {
    const row = document.createElement('div')
    row.setAttribute('data-chat-anchor-key', node.key)
    row.scrollIntoView = vi.fn()
    scrollport.append(row)
  }
  const host = document.createElement('div')
  root.append(scrollport, host)
  document.body.append(root)

  const useSession = ((selector: (snap: ConversationSnapshot) => unknown) => selector(snapshot)) as
    TurnNavPanelProps['useSession']
  const loadOlder = vi.fn()
  const onClose = vi.fn()
  const panelProps = {
    useSession,
    sessionId: sid('sess-1'),
    t: makeTranslate(),
    loadOlder,
    onClose,
  } as unknown as TurnNavPanelProps
  const utils = render(<TurnNavPanel {...panelProps} />, { container: host })
  return { ...utils, loadOlder, onClose, root }
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
    const { container } = mountPanel(makeSnapshot())
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
    const { onClose } = mountPanel(makeSnapshot())
    const target = document.querySelector('[data-chat-anchor-key="key-2"]') as HTMLElement
    expect(target.classList.contains('dsh-turn-nav-flash')).toBe(false)
    fireEvent.click(screen.getAllByRole('listitem')[1])
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(target.classList.contains('dsh-turn-nav-flash')).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports a miss when the anchor row is not in the DOM', () => {
    const snapshot = makeSnapshot()
    const { onClose } = mountPanel(snapshot)
    // Remove the scrollport rows to simulate an inactive view tab.
    document.querySelector('[data-conversation-scroll]')?.replaceChildren()
    fireEvent.click(screen.getAllByRole('listitem')[0])
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(zh['panel.notLoaded'])).toBeTruthy()
  })

  it('filters rows by the search query', () => {
    mountPanel(makeSnapshot())
    const input = screen.getByPlaceholderText(zh['panel.searchPlaceholder']) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'parser' } })
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn'))).toEqual(['2'])
    fireEvent.change(input, { target: { value: 'zzz-nope' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(zh['panel.noMatch'])).toBeTruthy()
  })

  it('pages older history through the injected face', () => {
    const { loadOlder } = mountPanel(makeSnapshot())
    fireEvent.click(screen.getByRole('button', { name: zh['panel.loadOlder'] }))
    expect(loadOlder).toHaveBeenCalledWith(sid('sess-1'))
  })

  it('paginates 5 turns per page and navigates with prev/next', () => {
    mountPanel(makeManySnapshot(12))
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
    mountPanel(makeManySnapshot(12))
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

  it('restarts at page 1 when the search query changes', () => {
    mountPanel(makeManySnapshot(12))
    const search = screen.getByPlaceholderText(zh['panel.searchPlaceholder']) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: zh['panel.next'] }))
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['7', '6', '5', '4', '3'])
    fireEvent.change(search, { target: { value: 'Prompt number 9' } })
    expect(screen.getAllByRole('listitem').map(row => row.getAttribute('data-turn')))
      .toEqual(['9'])
  })

  it('closes on Escape', () => {
    const { onClose } = mountPanel(makeSnapshot())
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the running badge only on the open turn', () => {
    mountPanel(makeSnapshot())
    const running = screen.getAllByText(zh['panel.running'])
    expect(running).toHaveLength(1)
    expect(running[0].closest('button')?.getAttribute('data-turn')).toBe('3')
  })
})
