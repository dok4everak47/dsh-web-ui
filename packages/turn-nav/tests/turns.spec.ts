import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { buildTurnOutline, filterOutline, promptText, toPreview, type TurnOutlineEntry } from '../src/core/turns.ts'

function userNode(turn: number, seq: number, time: number, text: string): ChatConversationViewNode {
  return {
    key: `key-${turn}-${seq}`,
    kind: 'user',
    id: `msg-${turn}-${seq}`,
    target: 'chat',
    anchorSeq: seq,
    location: { kind: 'turn', turn: { turn, start: { time } as never, end: undefined, status: 'open', steps: [], data: {} as never } },
    visibility: 'visible',
    data: { kind: 'user', seq, time, content: [{ type: 'text', text }], source: { kind: 'user' } } as never,
  } as unknown as ChatConversationViewNode
}

function snapshotWith(nodes: ChatConversationViewNode[], turnOrder: number[], closedTurns: number[] = []): ConversationSnapshot {
  const turns = new Map()
  for (const turn of turnOrder) {
    turns.set(turn, {
      turn,
      start: { time: 1000 + turn },
      end: closedTurns.includes(turn) ? { time: 2000 + turn } : undefined,
      status: closedTurns.includes(turn) ? 'closed' : 'open',
      steps: [],
      data: {},
    })
  }
  const order = nodes.map(node => node.key)
  return {
    chat: {
      order,
      nodes: {
        get: (key: string) => nodes.find(node => node.key === key),
        values: () => nodes,
      },
      locations: { getTurn: () => [], getStep: () => [] },
      timeline: { turnOrder: [...turnOrder].sort((a, b) => a - b), turns },
      legacy: {} as never,
    },
  } as unknown as ConversationSnapshot
}

describe('promptText', () => {
  it('joins text blocks and collapses whitespace', () => {
    expect(promptText([{ type: 'text', text: 'hello\n  world' }])).toBe('hello world')
    expect(promptText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab')
  })

  it('marks image blocks and empties cleanly', () => {
    expect(promptText([{ type: 'image', attachment: {} as never }])).toBe('[image]')
    expect(promptText([])).toBe('')
  })
})

describe('toPreview', () => {
  it('keeps short text and truncates long text', () => {
    expect(toPreview('short')).toBe('short')
    const long = 'x'.repeat(200)
    const preview = toPreview(long)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview.length).toBe(120)
  })
})

describe('buildTurnOutline', () => {
  it('lists turns newest first with the earliest user message as anchor', () => {
    const nodes = [
      userNode(1, 1, 1000, 'first prompt'),
      userNode(2, 3, 3000, 'second prompt'),
      userNode(2, 4, 4000, 'steering-ish second message'),
      userNode(3, 6, 6000, 'third prompt'),
    ]
    const outline = buildTurnOutline(snapshotWith(nodes, [1, 2, 3], [1, 2]))
    expect(outline.map(entry => entry.turn)).toEqual([3, 2, 1])
    expect(outline[2]).toMatchObject({ turn: 1, anchorKey: 'key-1-1', preview: 'first prompt', closed: true })
    // The earliest message of the turn wins the anchor, not the latest.
    expect(outline[1].anchorKey).toBe('key-2-3')
    // The open turn reports closed: false.
    expect(outline[0].closed).toBe(false)
    expect(outline[0].time).toBe(1003)
  })

  it('keeps turns whose opener is not loaded with a null anchor', () => {
    const nodes = [userNode(3, 6, 6000, 'third prompt')]
    const outline = buildTurnOutline(snapshotWith(nodes, [1, 2, 3], [1, 2]))
    const first = outline.find(entry => entry.turn === 1) as TurnOutlineEntry
    expect(first.anchorKey).toBeNull()
    expect(first.preview).toBe('')
    expect(first.closed).toBe(true)
  })

  it('ignores non-user nodes', () => {
    const assistant = {
      key: 'a-1',
      kind: 'assistant',
      id: 'a-1',
      target: 'chat',
      anchorSeq: 2,
      location: { kind: 'turn', turn: { turn: 1 } },
      data: { kind: 'assistant' },
    } as unknown as ChatConversationViewNode
    const outline = buildTurnOutline(snapshotWith([assistant, userNode(1, 1, 1000, 'hi')], [1]))
    expect(outline).toHaveLength(1)
    expect(outline[0].anchorKey).toBe('key-1-1')
  })
})

describe('filterOutline', () => {
  const entries: TurnOutlineEntry[] = [
    { turn: 2, anchorKey: 'k2', preview: 'Refactor the parser', searchable: 'Refactor the parser', time: null, closed: true },
    { turn: 1, anchorKey: 'k1', preview: 'Fix login bug', searchable: 'Fix login bug', time: null, closed: true },
  ]

  it('returns all entries for an empty query', () => {
    expect(filterOutline(entries, '')).toHaveLength(2)
    expect(filterOutline(entries, '   ')).toHaveLength(2)
  })

  it('matches case-insensitively by substring', () => {
    expect(filterOutline(entries, 'PARSER').map(entry => entry.turn)).toEqual([2])
    expect(filterOutline(entries, 'login').map(entry => entry.turn)).toEqual([1])
    expect(filterOutline(entries, 'zzz')).toEqual([])
  })
})
