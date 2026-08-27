/**
 * Turn navigation panel — a popover listing every loaded conversation turn
 * with its user prompt. Clicking a row scrolls the chat scrollport to that
 * turn's first user message and briefly highlights it.
 *
 * Data rides the session-scoped slot standard kit (useSession, sessionId),
 * narrowed to the conversation snapshot by the runtime merge. The paging
 * action arrives through the registration-injected face (the slot component
 * itself only carries snapshot hooks, not the session runtime).
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
        {loading && entries.length === 0 && (
          <div className={css.notice}>{t('panel.loading')}</div>
        )}
        {!loading && entries.length === 0 && (
          <div className={css.notice}>{t('panel.empty')}</div>
        )}
        {entries.length > 0 && visible.length === 0 && (
          <div className={css.notice}>{t('panel.noMatch')}</div>
        )}
        {visible.map(entry => {
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
      </div>
      <div className={css.footer} data-dsh-part={TURN_NAV_PART_FOOTER}>
        {hasMore
          ? (
            <button
              type="button"
              className={css.loadOlder}
              disabled={loadingOlder}
              onClick={() => { loadOlder(sessionId); setJumpMiss(false) }}
            >
              {loadingOlder ? t('panel.loading') : t('panel.loadOlder')}
            </button>
          )
          : <span className={css.noMore}>{entries.length > 0 ? t('panel.noMore') : ''}</span>}
        {jumpMiss && <span className={css.miss}>{t('panel.notLoaded')}</span>}
      </div>
    </div>
  )
}
