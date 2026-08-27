import { describe, expect, it } from 'vitest'
import { jumpToTurn } from '../src/client/TurnNavPanel.tsx'

/** Build the minimal DOM the jump helper walks: root -> scrollport -> rows. */
function mountDom(keys: string[]): { host: HTMLElement; rows: HTMLElement[] } {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.setAttribute('data-phase', 'active')
  const scrollport = document.createElement('div')
  scrollport.setAttribute('data-conversation-scroll', '')
  const rows = keys.map((key) => {
    const row = document.createElement('div')
    row.setAttribute('data-chat-anchor-key', key)
    scrollport.append(row)
    return row
  })
  const header = document.createElement('div')
  root.append(scrollport, header)
  document.body.append(root)
  return { host: header, rows }
}

describe('jumpToTurn', () => {
  it('scrolls the owning conversation row into view and flashes it', () => {
    const { host, rows } = mountDom(['k-1', 'k-2', 'k-3'])
    const scrolled: unknown[] = []
    for (const row of rows) {
      row.scrollIntoView = ((opts?: ScrollIntoViewOptions) => { scrolled.push(opts) }) as Element['scrollIntoView']
    }
    const ok = jumpToTurn('k-2', host)
    expect(ok).toBe(true)
    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]).toMatchObject({ block: 'start' })
    expect(rows[1].classList.contains('dsh-turn-nav-flash')).toBe(true)
    expect(rows[0].classList.contains('dsh-turn-nav-flash')).toBe(false)
  })

  it('returns false when the anchor row is not mounted', () => {
    const { host } = mountDom(['k-1'])
    expect(jumpToTurn('k-999', host)).toBe(false)
  })

  it('scopes the lookup to the conversation root that owns the source', () => {
    document.body.innerHTML = ''
    const makeRoot = (phase: string, key: string): HTMLElement => {
      const root = document.createElement('div')
      root.setAttribute('data-phase', phase)
      const scrollport = document.createElement('div')
      scrollport.setAttribute('data-conversation-scroll', '')
      const row = document.createElement('div')
      row.setAttribute('data-chat-anchor-key', key)
      scrollport.append(row)
      const host = document.createElement('div')
      root.append(scrollport, host)
      document.body.append(root)
      return host
    }
    const hostA = makeRoot('active', 'a-1')
    const hostB = makeRoot('active', 'b-1')
    const flash = (host: HTMLElement, key: string): boolean => {
      const ok = jumpToTurn(key, host)
      return ok
    }
    expect(flash(hostA, 'a-1')).toBe(true)
    // The key present only in the OTHER root is not found from hostA.
    expect(flash(hostA, 'b-1')).toBe(false)
    // And from hostB the same lookup resolves to the other row.
    expect(flash(hostB, 'b-1')).toBe(true)
    const rowA = document.querySelectorAll('[data-chat-anchor-key="a-1"]')[0]
    const rowB = document.querySelectorAll('[data-chat-anchor-key="b-1"]')[0]
    expect(rowA.classList.contains('dsh-turn-nav-flash')).toBe(true)
    expect(rowB.classList.contains('dsh-turn-nav-flash')).toBe(true)
  })
})
