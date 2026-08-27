/**
 * Turn navigation panel - a popover listing every conversation turn with its
 * user prompt. Clicking a row scrolls the chat scrollport to that turn's
 * first user message and briefly highlights it.
 *
 * On open the panel pages older history in until the whole outline is loaded
 * (the SDK snapshot only exposes a loaded window plus a hasMore bit, never a
 * total turn count), so the footer pager reflects the real history total and
 * navigation never fetches again. Data rides the session-scoped slot standard
 * kit (useSession, sessionId); the paging action arrives through the
 * registration-injected face (the slot component itself only carries snapshot
 * hooks, not the session runtime).
 */
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconCloseOutline16, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { buildTurnOutline, filterOutline } from '../core/turns.ts'
import {
  TURN_NAV_PART_FOOTER,
  TURN_NAV_PART_PANEL,
  TURN_NAV_PART_ROW,
  TURN_NAV_PART_SEARCH,
  TURN_NAV_PLUGIN_ATTR,
} from './semantic.ts'
import css from './turn-nav.module.css'

/** Business face injected into the slot component by the plugin apply. */
export interface TurnNavFace {
  /** Load the next page of older history for the given session. */
  loadOlder(sessionId: string): void
}

/** Panel props: the session slot runtime plus the locale, paging, and close seats. */
export type TurnNavPanelProps = PropsRuntime<'conversation.session.header.actions'> & {
  t: TranslateNS<'turn-nav'>
} & TurnNavFace & {
  onClose(): void
}

/** Attribute the chat view stamps on every flow row wrapper (value = node key). */
const ANCHOR_ATTR = 'data-chat-anchor-key'
/** The chat scrollport of the active conversation (ui-conversation contract). */
const SCROLLPORT_SELECTOR = '[data-conversation-scroll]'
/** Highlight class applied to the jumped-to row while the flash animation runs. */
const FLASH_CLASS = 'dsh-turn-nav-flash'
const FLASH_MS = 1600
/** Turns shown per page in the outline list. */
const PAGE_SIZE = 5
/** Safety cap on load-all-on-open calls (each pulls up to 50 messages). */
const LOAD_ALL_CAP = 200

/** Format a turn timestamp as MM-DD HH:mm (locale-independent, compact). */
function formatTime(time: number): string {
  const date = new Date(time)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

/** CSS.escape a node key for use in an attribute selector. */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/(["\\])/g, '\\$1')
}

/** The conversation scrollport that owns this panel's header. */
function scrollportFrom(source: HTMLElement): HTMLElement | null {
  // One conversation root per mounted session carries data-phase; scope the
  // lookup to it so two open sessions never fight over the same panel.
  const root = source.closest('[data-phase]')
  const scope = root ?? source.ownerDocument
  return scope.querySelector<HTMLElement>(SCROLLPORT_SELECTOR)
}

/**
 * Scroll the active chat view to the turn opened by `anchorKey` and flash the
 * target row. Returns false when the row is not mounted (older page missing
 * or another view tab active).
 */
export function jumpToTurn(anchorKey: string, source: HTMLElement): boolean {
  const scrollport = scrollportFrom(source)
  if (scrollport === null) return false
  const row = scrollport.querySelector<HTMLElement>(`[${ANCHOR_ATTR}="${cssEscape(anchorKey)}"]`)
  if (row === null) return false
  // scrollIntoView exists in every real browser; guard for headless DOMs.
  row.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  row.classList.remove(FLASH_CLASS)
  // Force a style re-query so re-jumping the same row restarts the animation.
  void row.offsetWidth
  row.classList.add(FLASH_CLASS)
  window.setTimeout(() => { row.classList.remove(FLASH_CLASS) }, FLASH_MS)
  return true
}

/** The turn-nav popover panel. */
export function TurnNavPanel({ useSession, sessionId, t, loadOlder, onClose }: TurnNavPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [jumpMiss, setJumpMiss] = useState(false)
  const [panelPos, setPanelPos] = useState<CSSProperties>({})

  const entries = useSession(snapshot => buildTurnOutline(snapshot))
  const hasMore = useSession(snapshot => snapshot.hasMore)
  const loadingOlder = useSession(snapshot => snapshot.loadingOlder)
  const openState = useSession(snapshot => snapshot.openState)

  const visible = useMemo(() => filterOutline(entries, query), [entries, query])

  // Pagination: 5 turns per page over the FULL history. The SDK snapshot
  // only exposes the loaded window plus a hasMore boolean (no total turn
  // count), so on open we page older history in until hasMore is false, then
  // the pager reflects the real total and navigation never fetches again.
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageEntries = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const loadedCount = entries.length
  const loadingAll = hasMore || loadingOlder
  const loadStateRef = useRef<{ count: number; calls: number }>({ count: -1, calls: 0 })

  // A new search query restarts at page 1; keep the input synced to the
  // effective page when the outline shrinks (older page removed, etc.).
  useEffect(() => { setPage(1); setPageInput('1') }, [query])
  useEffect(() => { setPageInput(String(safePage)) }, [safePage])
  // Reset the load-all guard if the session binding re-targets.
  useEffect(() => { loadStateRef.current = { count: -1, calls: 0 } }, [sessionId])
  // Drive loadOlder until the whole history is in the window. The face is
  // fire-and-forget, so we re-run on every loadingOlder/hasMore/loadedCount
  // change: if hasMore still holds and the window grew, call again; stop when
  // hasMore clears, when a fetch makes no progress, or at the safety cap.
  useEffect(() => {
    if (!hasMore || loadingOlder) return
    const ref = loadStateRef.current
    if (ref.calls >= LOAD_ALL_CAP) return
    if (loadedCount === ref.count) return
    loadStateRef.current = { count: loadedCount, calls: ref.calls + 1 }
    loadOlder(sessionId)
  }, [hasMore, loadingOlder, loadedCount, loadOlder, sessionId])

  const goToPage = (next: number): void => {
    const clamped = Math.min(Math.max(1, next), totalPages)
    setPage(clamped)
    setPageInput(String(clamped))
  }
  const commitPageInput = (): void => {
    const parsed = Number.parseInt(pageInput, 10)
    if (Number.isNaN(parsed)) { setPageInput(String(safePage)); return }
    goToPage(parsed)
  }

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Keep the popover inside its clipping ancestor. The CSS pins it to the
  // trigger's right edge (right:0) and opens it leftward; when the sidebar is
  // open the conversation column's left border moves right, and the panel's
  // left edge crosses it - the session root (overflow:hidden) shears off the
  // overhang and the sidebar's session list paints on top, so the panel looks
  // half-covered. Clamp to the clip box so both edges stay in the column.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel === null) { setPanelPos({}); return }
    // Nearest overflow!=visible ancestor - the session root, which sits
    // inside the sidebar-bounded conversation column and moves with it.
    let clipAncestor: HTMLElement | null = panel.parentElement
    while (clipAncestor !== null) {
      const c = getComputedStyle(clipAncestor)
      if (c.overflow !== 'visible' || c.overflowX !== 'visible' || c.overflowY !== 'visible') break
      clipAncestor = clipAncestor.parentElement
    }
    const measure = (): void => {
      const root = panel.offsetParent as HTMLElement | null
      if (root === null) { setPanelPos({}); return }
      const rootRect = root.getBoundingClientRect()
      const panelW = panel.offsetWidth
      const margin = 8
      const clip = clipAncestor?.getBoundingClientRect() ?? null
      const minLeft = (clip?.left ?? 0) + margin
      const maxRight = (clip?.right ?? window.innerWidth) - margin
      const defaultLeftVp = rootRect.right - panelW
      const defaultRightVp = rootRect.right
      if (defaultLeftVp >= minLeft && defaultRightVp <= maxRight) {
        setPanelPos({})
      } else {
        let leftVp = defaultLeftVp
        if (leftVp < minLeft) leftVp = minLeft
        if (leftVp + panelW > maxRight) leftVp = maxRight - panelW
        if (leftVp < minLeft) leftVp = minLeft
        setPanelPos({ left: leftVp - rootRect.left, right: 'auto' })
      }
    }
    measure()
    const onResize = (): void => measure()
    window.addEventListener('resize', onResize)
    // A sticky header can shift the trigger rect on scroll; re-measure then.
    window.addEventListener('scroll', onResize, true)
    // A sidebar toggle resizes the session root without firing window resize;
    // observe the clip ancestor so the panel re-clamps while it stays open.
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && clipAncestor !== null) {
      ro = new ResizeObserver(onResize)
      ro.observe(clipAncestor)
    }
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
      ro?.disconnect()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [onClose])

  const jump = (anchorKey: string | null): void => {
    if (anchorKey === null || panelRef.current === null) {
      setJumpMiss(true)
      return
    }
    if (jumpToTurn(anchorKey, panelRef.current)) {
      setJumpMiss(false)
      onClose()
    } else {
      setJumpMiss(true)
    }
  }

  const loading = openState === 'loading'

  return (
    <div
      ref={panelRef}
      className={css.panel}
      style={panelPos}
      data-dsh-plugin={TURN_NAV_PLUGIN_ATTR}
      data-dsh-part={TURN_NAV_PART_PANEL}
      role="dialog"
      aria-label={t('panel.title')}
    >
      <div className={css.header}>
        <span className={css.title}>{t('panel.title')}</span>
        <button
          type="button"
          className={css.close}
          aria-label={t('panel.close')}
          onClick={onClose}
        >
          <IconCloseOutline16 />
        </button>
      </div>
      <div className={css.searchRow}>
        <IconSearchOutline16 className={css.searchIcon} />
        <input
          ref={searchRef}
          className={css.search}
          data-dsh-part={TURN_NAV_PART_SEARCH}
          type="search"
          value={query}
          placeholder={t('panel.searchPlaceholder')}
          onChange={event => { setQuery(event.target.value); setJumpMiss(false) }}
        />
      </div>
      <div className={css.list} role="list">
        {loadingAll && (
          <div className={css.notice}>{t('panel.loadingAll')}</div>
        )}
        {!loadingAll && loading && entries.length === 0 && (
          <div className={css.notice}>{t('panel.loading')}</div>
        )}
        {!loadingAll && !loading && entries.length === 0 && (
          <div className={css.notice}>{t('panel.empty')}</div>
        )}
        {!loadingAll && entries.length > 0 && visible.length === 0 && (
          <div className={css.notice}>{t('panel.noMatch')}</div>
        )}
        {!loadingAll && pageEntries.length > 0 && (
          <>
            {pageEntries.map(entry => {
              const disabled = entry.anchorKey === null
              return (
                <button
                  type="button"
                  key={entry.turn}
                  role="listitem"
                  className={css.row}
                  data-dsh-part={TURN_NAV_PART_ROW}
                  data-turn={entry.turn}
                  disabled={disabled}
                  title={disabled ? t('panel.notLoaded') : t('panel.rowHint')}
                  onClick={() => { jump(entry.anchorKey) }}
                >
                  <span className={css.rowHead}>
                    <span className={css.turnTag}>{t('panel.turnLabel', { turn: entry.turn })}</span>
                    {!entry.closed && <span className={css.running}>{t('panel.running')}</span>}
                    {entry.time !== null && <span className={css.time}>{formatTime(entry.time)}</span>}
                  </span>
                  <span className={css.preview}>
                    {entry.preview === '' ? t('panel.attachmentOnly') : entry.preview}
                  </span>
                </button>
              )
            })}
            {/* Pad a short last page to PAGE_SIZE so the grid height stays
                stable (blank slots, not collapsed rows). */}
            {Array.from({ length: PAGE_SIZE - pageEntries.length }, (_, i) => (
              <div key={`pad-${i}`} className={css.rowPad} data-row-pad aria-hidden="true" />
            ))}
          </>
        )}
      </div>
      <div className={css.footer} data-dsh-part={TURN_NAV_PART_FOOTER}>
        {visible.length > 0 && (
          <div className={css.pager}>
            <button
              type="button"
              className={css.pageBtn}
              disabled={loadingAll || safePage <= 1}
              aria-label={t('panel.prev')}
              onClick={() => { goToPage(safePage - 1); setJumpMiss(false) }}
            >
              ‹
            </button>
            <span className={css.pageState}>
              <input
                type="text"
                inputMode="numeric"
                className={css.pageInput}
                value={pageInput}
                disabled={loadingAll}
                onChange={event => setPageInput(event.target.value.replace(/\D/g, ''))}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitPageInput() } }}
                onBlur={commitPageInput}
                aria-label={t('panel.pageAria', { total: loadingAll ? '…' : totalPages })}
              />
              <span className={css.pageTotal}>{loadingAll ? '/ …' : `/ ${totalPages}`}</span>
            </span>
            <button
              type="button"
              className={css.pageBtn}
              disabled={loadingAll || safePage >= totalPages}
              aria-label={t('panel.next')}
              onClick={() => { goToPage(safePage + 1); setJumpMiss(false) }}
            >
              ›
            </button>
          </div>
        )}
        {jumpMiss && <span className={css.miss}>{t('panel.notLoaded')}</span>}
      </div>
    </div>
  )
}
