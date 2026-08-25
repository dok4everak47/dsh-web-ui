/**
 * The wallpaper panel of the skin-center card: lists the user's local
 * Wallpaper Engine library (video / web / scene wallpapers) with live
 * try-on, one-click apply, local import, and render tuning. Rendering and
 * persistence ride the WallpaperController (wallpaper.ts); the library,
 * media, import and scene-frame bytes come from the host's /we routes.
 *
 * Compliance: wallpapers are the user's own local files (their Workshop
 * subscriptions or manual folders). The panel never downloads or shares
 * content; import only copies files within the user's machine.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveSelection, type WallpaperDescriptor, type WallpaperHandle } from './wallpaper.ts'
import { CropEditor } from './CropEditor.tsx'
import css from './skin-center.module.css'
import { SliderControl } from './SliderControl.tsx'

/** Live-label helper: the shown value follows the in-drag thumb immediately,
 * and falls back to the store value once the store settles (issue #725). */
function useLiveValue(value: number): [number, (v: number | null) => void] {
  const [live, setLive] = useState<number | null>(null)
  useEffect(() => {
    setLive(null)
  }, [value])
  return [live ?? value, setLive]
}

/** Host base path of the wallpaper API (mirrors src/we-routes.ts). */
const WE_API = '/api/skin-center/we'

/** One wallpaper entry as served by the inventory route. */
interface WallpaperItem extends WallpaperDescriptor {
  source: 'workshop' | 'local' | 'imported' | 'system'
  playable: boolean
  updateAvailable: boolean
}

/** Inventory payload shape. */
interface InventoryPayload {
  ok?: boolean
  installDir?: string | null
  total?: number
  portableCount?: number
  /** macOS-managed wallpapers (aerials + Desktop Pictures) in the list. */
  systemCount?: number
  wallpapers?: WallpaperItem[]
  error?: string
}

/** Post one wallpaper action and return whether it succeeded. */
async function postWe(path: string, id: string): Promise<string | null> {
  try {
    const response = await fetch(WE_API + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
    if (!response.ok || payload?.ok !== true) return payload?.error ?? 'HTTP ' + String(response.status)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** The type badge copy key of one wallpaper. */
function typeKey(item: WallpaperItem): 'wallpaperTypeVideo' | 'wallpaperTypeWeb' | 'wallpaperTypeScene' | 'wallpaperTypeApp' | 'wallpaperTypeImage' {
  switch (item.type) {
    case 'video': return 'wallpaperTypeVideo'
    case 'web': return 'wallpaperTypeWeb'
    case 'scene': return 'wallpaperTypeScene'
    case 'image': return 'wallpaperTypeImage'
    default: return 'wallpaperTypeApp'
  }
}

/** Wallpaper grid page size: the grid grows one page per Load-more click
 * instead of mounting every thumbnail at once.
 *
 * The pager is per-group: each collapsible folder independently caps its
 * visible cards, so one very large folder does not pull every other folder's
 * thumbnails into the DOM along with it. */
const PAGE_SIZE = 12

/** Where one entry belongs in the grouped list. */
interface WallpaperGroup {
  /** Stable key for React + collapsed-state lookup. */
  key: string
  /** Section label shown on the collapsible header. */
  label: string
  /** Sort weight: lower comes first. System is pinned to the top; manual
   * folders sort by the configured directory add order; everything else
   * sorts after by key. */
  order: number
  /** Items under this header in inventory order. */
  items: WallpaperItem[]
}

/** Pull the display folder out of a local/imported entry id.
 *
 * Inventory ids are `<folder-basename>/<file>` for manual folder scans and
 * `<project>/<file>` for Workshop/imported projects. System wallpapers use a
 * fixed `macos-*` prefix; we group those under one translated header. The
 * returned folder is the human-facing basename, not the absolute path. */
function groupOf(item: WallpaperItem): { key: string; label: string } {
  if (item.source === 'system') return { key: 'system', label: '__system__' }
  const slash = item.id.lastIndexOf('/')
  if (slash <= 0) return { key: 'other', label: '__other__' }
  const folder = item.id.slice(0, slash)
  return { key: 'folder:' + folder, label: folder }
}

/** Basename of a path for matching inventory folder prefixes against the
 * user's configured manual directory list. Splits on both separators so it
 * works on Windows-style paths too. */
function basenameOf(path: string): string {
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return sep >= 0 ? path.slice(sep + 1) : path
}

/** Collapse a flat inventory into ordered groups, preserving inventory order
 * within each group. System wallpapers are pinned to the top; manual folders
 * follow in the order they were added (matched by basename against the
 * configured dirs); anything else sorts after by key. */
function groupWallpapers(items: readonly WallpaperItem[], dirOrder: readonly string[]): WallpaperGroup[] {
  const byKey = new Map<string, WallpaperGroup>()
  const order: WallpaperGroup[] = []
  // Build a basename -> add-order index. If two configured folders share a
  // basename (uncommon) the first one wins; the inventory prefix is only the
  // basename so we cannot disambiguate them further without a backend change.
  const dirIndex = new Map<string, number>()
  dirOrder.forEach((path, index) => {
    const name = basenameOf(path.trim())
    if (name !== '' && !dirIndex.has(name)) dirIndex.set(name.toLowerCase(), index)
  })
  for (const item of items) {
    const meta = groupOf(item)
    let group = byKey.get(meta.key)
    if (group === undefined) {
      let groupOrder: number
      if (meta.key === 'system') {
        groupOrder = -1
      } else if (meta.key.startsWith('folder:')) {
        const idx = dirIndex.get(meta.label.toLowerCase())
        groupOrder = idx === undefined ? 1_000_000 + order.length : idx
      } else {
        groupOrder = 2_000_000 + order.length
      }
      group = { key: meta.key, label: meta.label, order: groupOrder, items: [] }
      byKey.set(meta.key, group)
      order.push(group)
    }
    group.items.push(item)
  }
  order.sort((a, b) => a.order - b.order)
  return order
}

/** Render the Wallpaper Engine section of the skin-center card. */
export function WallpaperPanel({ t, wallpaper }: { t: PropsLocale<'skinCenter'>['t']; wallpaper: WallpaperHandle }): ReactNode {
  const enabled = useSyncExternalStore(wallpaper.subscribe, wallpaper.enabled)
  const selection = useSyncExternalStore(wallpaper.subscribe, wallpaper.selection)
  const mode = useSyncExternalStore(wallpaper.subscribe, wallpaper.mode)
  const fit = useSyncExternalStore(wallpaper.subscribe, wallpaper.fit)
  const dim = useSyncExternalStore(wallpaper.subscribe, wallpaper.dim)
  const blur = useSyncExternalStore(wallpaper.subscribe, wallpaper.wallpaperBlur)
  const opacity = useSyncExternalStore(wallpaper.subscribe, wallpaper.wallpaperOpacity)
  const pauseOnHidden = useSyncExternalStore(wallpaper.subscribe, wallpaper.pauseOnHidden)
  const sound = useSyncExternalStore(wallpaper.subscribe, wallpaper.sound)
  const volume = useSyncExternalStore(wallpaper.subscribe, wallpaper.volume)
  const activeId = useSyncExternalStore(wallpaper.subscribe, wallpaper.activeId)
  const trying = useSyncExternalStore(wallpaper.subscribe, wallpaper.trying)
  const dirs = useSyncExternalStore(wallpaper.subscribe, wallpaper.dirs)
  const [shownDim, setShownDim] = useLiveValue(dim)
  const [shownBlur, setShownBlur] = useLiveValue(blur)
  const [shownOpacity, setShownOpacity] = useLiveValue(opacity)
  const [shownVolume, setShownVolume] = useLiveValue(volume)
  const [dirInput, setDirInput] = useState('')
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  /** Collapsed group keys. Folders with many images start collapsed; system
   * and single-folder groups start expanded. The set flips on header click. */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  /** Collapsed state captured when a search begins, restored when the query
   * clears so searching does not permanently forget user fold choices. */
  const savedCollapsedRef = useRef<Set<string> | null>(null)
  /** Per-group "Load more" page counts; key is the group key from groupOf. */
  const [groupPages, setGroupPages] = useState<Record<string, number>>({})
  /** Whether the initial fold state has been seeded yet for the current
   * inventory. Every group starts collapsed so the panel is not a wall of
   * thumbnails. We only seed once so a user's manual expand/collapse
   * choices survive inventory refreshes. */
  const autoFoldedRef = useRef(false)

  const [items, setItems] = useState<WallpaperItem[] | null>(null)
  const [installDir, setInstallDir] = useState<string | null>(null)
  const [systemCount, setSystemCount] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<string | null>(null)
  /** True while the manual refresh button is fetching the inventory. */
  const [refreshing, setRefreshing] = useState(false)
  /** The wallpaper currently open in the fullscreen crop editor, or null. */
  const [cropTarget, setCropTarget] = useState<WallpaperItem | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /** Fetch the inventory and reconcile the mounted layer with the selection. */
  const load = useCallback((): void => {
    void fetch(WE_API + '/inventory')
      .then(async response => {
        const payload = await response.json().catch(() => null) as InventoryPayload | null
        if (!mounted.current) return
        if (!response.ok || payload?.ok !== true || !Array.isArray(payload.wallpapers)) {
          setLoadError(payload?.error ?? 'HTTP ' + String(response.status))
          setItems([])
          return
        }
        setLoadError(null)
        setItems(payload.wallpapers)
        setInstallDir(typeof payload.installDir === 'string' ? payload.installDir : null)
        setSystemCount(typeof payload.systemCount === 'number' ? payload.systemCount : 0)
        const selected = wallpaper.selection()
        wallpaper.sync(resolveSelection(payload.wallpapers, selected) ?? null)
      })
      .catch((error: unknown) => {
        if (!mounted.current) return
        setLoadError(error instanceof Error ? error.message : String(error))
        setItems([])
      })
  }, [wallpaper])

  /** Manual refresh: same as load but flips the spinner flag. */
  const refresh = useCallback((): void => {
    setRefreshing(true)
    void fetch(WE_API + '/inventory')
      .then(async response => {
        const payload = await response.json().catch(() => null) as InventoryPayload | null
        if (!mounted.current) return
        if (!response.ok || payload?.ok !== true || !Array.isArray(payload.wallpapers)) {
          setLoadError(payload?.error ?? 'HTTP ' + String(response.status))
          setItems([])
          return
        }
        setLoadError(null)
        setItems(payload.wallpapers)
        setInstallDir(typeof payload.installDir === 'string' ? payload.installDir : null)
        setSystemCount(typeof payload.systemCount === 'number' ? payload.systemCount : 0)
        const selected = wallpaper.selection()
        wallpaper.sync(resolveSelection(payload.wallpapers, selected) ?? null)
      })
      .catch((error: unknown) => {
        if (!mounted.current) return
        setLoadError(error instanceof Error ? error.message : String(error))
        setItems([])
      })
      .finally(() => {
        if (mounted.current) setRefreshing(false)
      })
  }, [wallpaper])

  useEffect(load, [load])

  /** Run one import/remove action with the shared busy + error state. */
  const runAction = (id: string, path: string, after?: () => void): void => {
    setActionError(null)
    setWorkingId(id)
    void postWe(path, id).then(error => {
      if (!mounted.current) return
      setWorkingId(null)
      if (error !== null) {
        setActionError(error)
        return
      }
      after?.()
      load()
    })
  }

  /** Open the host's native folder picker and add the chosen directory. */
  const browseDir = (): void => {
    const pick = wallpaper.pickDir
    if (pick === undefined) return
    setActionError(null)
    setPicking(true)
    void pick()
      .then(path => {
        if (!mounted.current) return
        setPicking(false)
        if (path === null || path.trim() === '') return // cancelled
        wallpaper.addDir(path)
        load()
      })
      .catch((error: unknown) => {
        // Non-loopback (paired remote) or a host without the native
        // capability: the manual input stays the fallback.
        if (!mounted.current) return
        setPicking(false)
        setActionError(t('wallpaperDirBrowseFailed') + ': ' + (error instanceof Error ? error.message : String(error)))
      })
  }

  const descriptorOf = (item: WallpaperItem): WallpaperDescriptor => ({
    id: item.id,
    title: item.title,
    type: item.type,
    videoUrl: item.videoUrl,
    webUrl: item.webUrl,
    frameUrl: item.frameUrl,
    sceneUrl: item.sceneUrl,
    previewUrl: item.previewUrl,
  })

  /** Whether one entry can be mounted at all in the current mode. */
  const renderable = (item: WallpaperItem): boolean =>
    item.playable || item.frameUrl !== null || item.previewUrl !== null

  /** Case-insensitive name / path / id / type filter for large libraries. */
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleItems = normalizedQuery === '' || items === null
    ? items
    : items.filter((item) => {
      const haystack = [item.id, item.title, item.type, ('dir' in item ? (item as { dir?: string }).dir : undefined)]
        .filter((value): value is string => typeof value === 'string')
        .join('\u0000')
        .toLocaleLowerCase()
      return haystack.includes(normalizedQuery)
    })
  const groups = visibleItems === null ? null : groupWallpapers(visibleItems, dirs)
  const searching = normalizedQuery !== ''

  // On the very first inventory load, collapse every group by default so
  // the panel is not a wall of thumbnails. The user can expand any group
  // with one click; their choices are preserved across refreshes because
  // we only seed the state once per mount.
  useEffect(() => {
    if (groups === null || autoFoldedRef.current) return
    autoFoldedRef.current = true
    const allKeys = groups.map(group => group.key)
    if (allKeys.length > 0) {
      setCollapsedGroups(prev => {
        const next = new Set(prev)
        for (const key of allKeys) next.add(key)
        return next
      })
    }
  }, [groups])

  // Reset per-group paging whenever the inventory or search filter changes so
  // a stale page count does not slice past a shorter group after refresh.
  const groupsSignature = groups === null ? '' : groups.map(g => g.key + ':' + g.items.length).join('|')
  useEffect(() => {
    setGroupPages({})
  }, [groupsSignature, searching])

  // While a search query is active every group is expanded so the matches are
  // visible; the collapse arrows still toggle. When the query clears we
  // restore the collapsed set that existed before the search started so the
  // user's prior fold choices are not lost.
  useEffect(() => {
    if (searching) {
      if (savedCollapsedRef.current === null) {
        savedCollapsedRef.current = new Set(collapsedGroups)
      }
      setCollapsedGroups(new Set())
    } else if (savedCollapsedRef.current !== null) {
      setCollapsedGroups(savedCollapsedRef.current)
      savedCollapsedRef.current = null
    }
    // We intentionally only react to the searching / normalizedQuery change;
    // reading collapsedGroups at effect-run time captures the latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, normalizedQuery])

  const activeSelection = selection

  /** Render one wallpaper card; shared between every group so markup and
   * behavior stay in sync. */
  const renderCard = (item: WallpaperItem): ReactNode => {
    const isApplied = item.id === activeSelection
    const isMounted = item.id === activeId
    const busy = workingId === item.id
    return (
      <div className={css.wallpaperCard} key={item.id}>
        <div className={css.wallpaperThumbWrap}>
          {item.previewUrl !== null
            ? <img className={css.wallpaperThumb} src={item.previewUrl} alt="" loading="lazy" />
            : item.videoUrl !== null
              // No preview image (bare .mp4 without project.json):
              // the video element's first frame is the cover.
              ? <video className={css.wallpaperThumb} src={item.videoUrl} preload="metadata" muted playsInline aria-hidden="true" />
              : <div className={css.wallpaperThumbEmpty} aria-hidden="true" />}
          <span className={css.wallpaperType}>{t(typeKey(item))}</span>
          {isMounted && (
            <span className={css.badge + ' ' + (trying ? css.badgeTrying : css.badgeActive)}>
              {trying ? t('tryingOn') : t('active')}
            </span>
          )}
        </div>
        <div className={css.wallpaperName} title={item.title}>{item.title}</div>
        <div className={css.wallpaperActions}>
          {isMounted && trying ? (
            <button type="button" className={css.button + ' ' + css.buttonPrimary} onClick={() => { wallpaper.exitTryOn() }}>
              {t('exitTryOn')}
            </button>
          ) : (
            <button
              type="button"
              className={css.button + ' ' + css.buttonPrimary}
              disabled={!renderable(item) || (isMounted && isApplied) || busy}
              onClick={() => { wallpaper.tryOn(descriptorOf(item)) }}
            >
              {t('tryOn')}
            </button>
          )}
          <button
            type="button"
            className={css.button}
            disabled={!renderable(item) || isApplied || busy}
            onClick={() => { wallpaper.applySelection(descriptorOf(item)) }}
          >
            {isApplied ? t('active') : t('apply')}
          </button>
          {item.source === 'imported' ? (
            <>
              {item.updateAvailable && (
                <button
                  type="button"
                  className={css.button}
                  disabled={busy}
                  title={t('wallpaperUpdateAvailable')}
                  onClick={() => { runAction(item.id, '/reimport') }}
                >
                  {busy ? t('loading') : t('wallpaperReimport')}
                </button>
              )}
              <button
                type="button"
                className={css.button + ' ' + css.buttonGhost}
                disabled={busy}
                onClick={() => {
                  runAction(item.id, '/remove', () => {
                    if (wallpaper.selection() === item.id) wallpaper.clearSelection()
                  })
                }}
              >
                {t('wallpaperRemove')}
              </button>
            </>
          ) : item.source === 'system' ? (
            // macOS-managed wallpapers are already local and
            // their folder is shared — nothing to import.
            <></>
          ) : (
            <button
              type="button"
              className={css.button}
              disabled={busy}
              title={t('wallpaperImportHint')}
              onClick={() => { runAction(item.id, '/import') }}
            >
              {busy ? t('loading') : t('wallpaperImport')}
            </button>
          )}
        </div>
      </div>
    )
  }

  /** Render one collapsible group (system wallpapers, one manual folder, or
   * one imported project). Paging is per group. */
  const renderGroup = (group: WallpaperGroup): ReactNode => {
    const collapsed = !searching && collapsedGroups.has(group.key)
    const pages = groupPages[group.key] ?? 1
    const shown = collapsed ? 0 : Math.min(group.items.length, pages * PAGE_SIZE)
    const visibleGroupItems = collapsed ? [] : group.items.slice(0, shown)
    const hasMore = !collapsed && group.items.length > shown
    const label = group.key === 'system'
      ? t('wallpaperLibrarySystem')
      : group.key === 'other'
        ? t('wallpaperLibraryManual')
        : group.label
    const chevron = collapsed ? '\u25B6' : '\u25BC'
    return (
      <section className={css.wallpaperGroup} key={group.key}>
        <button
          type="button"
          className={css.wallpaperGroupHeader}
          aria-expanded={!collapsed}
          onClick={() => {
            setCollapsedGroups(prev => {
              const next = new Set(prev)
              if (next.has(group.key)) next.delete(group.key)
              else next.add(group.key)
              return next
            })
          }}
        >
          <span className={css.wallpaperGroupChevron} aria-hidden="true">{chevron}</span>
          <span className={css.wallpaperGroupLabel} title={label}>{label}</span>
          <span className={css.wallpaperGroupCount}>{group.items.length}</span>
        </button>
        {!collapsed && visibleGroupItems.length > 0 && (
          <div className={css.wallpaperGrid}>
            {visibleGroupItems.map(renderCard)}
          </div>
        )}
        {hasMore && (
          <div className={css.wallpaperStatus}>
            <button
              type="button"
              className={css.button}
              onClick={() => {
                setGroupPages(prev => ({ ...prev, [group.key]: (prev[group.key] ?? 1) + 1 }))
              }}
            >
              {t('wallpaperLoadMore')} ({group.items.length - shown})
            </button>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className={css.wallpaperSection}>
      <div className={css.enableRow}>
        <span className={css.enableLabel} title={t('wallpaperEnable')}>{t('wallpaperTitle')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('wallpaperEnable')}
          className={enabled ? css.switch + ' ' + css.switchOn : css.switch}
          onClick={() => { wallpaper.setEnabled(!enabled) }}
        >
          <span className={css.switchThumb} />
        </button>
        <p className={css.enableHint}>{t('wallpaperHint')}</p>
      </div>
      {enabled && (
        <>
          <div className={css.wallpaperStatus}>
            {loadError !== null
              ? <span className={css.wallpaperStatusError}>{t('wallpaperLoadError')}: {loadError}</span>
              : items === null
                ? <span>{t('loading')}</span>
                : installDir !== null
                  ? <span>{t('wallpaperLibraryFound')} · {items.length}</span>
                  : systemCount > 0
                    ? <span>{t('wallpaperLibrarySystem')} · {items.length}</span>
                    : <span>{t('wallpaperLibraryManual')} · {items.length}</span>}
            <button type="button" className={css.button} onClick={load}>{t('wallpaperRefresh')}</button>
          </div>

          {activeSelection !== '' && (
            <div className={css.wallpaperControls}>
              <div className={css.themeRow}>
                <span className={css.themeLabel}>{t('wallpaperMode')}</span>
                <button
                  type="button"
                  className={css.themeButton + (mode === 'live' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setMode('live') }}
                >
                  {t('wallpaperModeLive')}
                </button>
                <button
                  type="button"
                  className={css.themeButton + (mode === 'frame' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setMode('frame') }}
                >
                  {t('wallpaperModeFrame')}
                </button>
                <button
                  type="button"
                  className={css.button + ' ' + css.buttonGhost}
                  onClick={() => { wallpaper.clearSelection() }}
                >
                  {t('wallpaperClear')}
                </button>
              </div>
              <div className={css.themeRow}>
                <span className={css.themeLabel}>{t('wallpaperFit')}</span>
                <button
                  type="button"
                  className={css.themeButton + (fit === 'cover' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setFit('cover') }}
                >
                  {t('wallpaperFitCover')}
                </button>
                <button
                  type="button"
                  className={css.themeButton + (fit === 'contain' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setFit('contain') }}
                >
                  {t('wallpaperFitContain')}
                </button>
                <button
                  type="button"
                  className={css.themeButton + (fit === 'fill' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setFit('fill') }}
                >
                  {t('wallpaperFitFill')}
                </button>
                {(() => {
                  const activeItem = items?.find(item => item.id === activeSelection) ?? null
                  const canCrop = activeItem !== null && activeItem.type === 'image'
                  if (!canCrop) return null
                  return (
                    <button
                      type="button"
                      className={css.themeButton}
                      onClick={() => { if (activeItem !== null) setCropTarget(activeItem) }}
                      title={t('wallpaperCropHint')}
                    >
                      {t('wallpaperCropButton')}
                    </button>
                  )
                })()}
              </div>
              <div className={css.backgroundRow}>
                <div className={css.backgroundHead}>
                  <span className={css.backgroundLabel}>{t('wallpaperDim')}</span>
                  <span className={css.backgroundValue} aria-hidden="true">{shownDim}%</span>
                </div>
                                <SliderControl
                  className={css.backgroundRange}
                  min={0}
                  max={90}
                  step={5}
                  value={dim}
                  ariaValuetext={shownDim + '%'}
                  ariaLabel={t('wallpaperDim')}
                  onChanging={setShownDim}
                  onChange={(value) => { wallpaper.setDim(value) }}
                />
                <div className={css.backgroundHead}>
                  <span className={css.backgroundLabel}>{t('wallpaperOpacity')}</span>
                  <span className={css.backgroundValue} aria-hidden="true">{shownOpacity}%</span>
                </div>
                <SliderControl
                  className={css.backgroundRange}
                  min={0}
                  max={100}
                  step={5}
                  value={opacity}
                  ariaValuetext={shownOpacity + '%'}
                  ariaLabel={t('wallpaperOpacity')}
                  onChanging={setShownOpacity}
                  onChange={(value) => { wallpaper.setOpacity(value) }}
                />
                <div className={css.backgroundHead}>
                  <span className={css.backgroundLabel}>{t('wallpaperBlur')}</span>
                  <span className={css.backgroundValue} aria-hidden="true">{shownBlur}px</span>
                </div>
                                <SliderControl
                  className={css.backgroundRange}
                  min={0}
                  max={60}
                  step={1}
                  value={blur}
                  ariaValuetext={shownBlur + 'px'}
                  ariaLabel={t('wallpaperBlur')}
                  onChanging={setShownBlur}
                  onChange={(value) => { wallpaper.setBlur(value) }}
                />
              </div>
              <div className={css.enableRow}>
                <span className={css.enableLabel}>{t('wallpaperPauseHidden')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pauseOnHidden}
                  aria-label={t('wallpaperPauseHidden')}
                  className={pauseOnHidden ? css.switch + ' ' + css.switchOn : css.switch}
                  onClick={() => { wallpaper.setPauseOnHidden(!pauseOnHidden) }}
                >
                  <span className={css.switchThumb} />
                </button>
              </div>
              <div className={css.enableRow}>
                <span className={css.enableLabel} title={t('wallpaperSoundHint')}>{t('wallpaperSound')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sound}
                  aria-label={t('wallpaperSound')}
                  className={sound ? css.switch + ' ' + css.switchOn : css.switch}
                  onClick={() => { wallpaper.setSound(!sound) }}
                >
                  <span className={css.switchThumb} />
                </button>
              </div>
              {sound && (
                <div className={css.backgroundRow}>
                  <div className={css.backgroundHead}>
                    <span className={css.backgroundLabel}>{t('wallpaperVolume')}</span>
                    <span className={css.backgroundValue} aria-hidden="true">{shownVolume}%</span>
                  </div>
                                  <SliderControl
                  className={css.backgroundRange}
                  min={0}
                  max={100}
                  step={5}
                  value={volume}
                  ariaValuetext={shownVolume + '%'}
                  ariaLabel={t('wallpaperVolume')}
                  onChanging={setShownVolume}
                  onChange={(value) => { wallpaper.setVolume(value) }}
                />
                </div>
              )}
            </div>
          )}

          <div className={css.wallpaperDirs}>
            <div className={css.wallpaperDirsHead}>
              <span className={css.themeLabel}>{t('wallpaperDirs')}</span>
              {dirs.length > 0 && (
                <span className={css.wallpaperDirsCount}>{dirs.length}</span>
              )}
            </div>
            {dirs.length === 0 && (
              <p className={css.wallpaperDirsEmpty}>{t('wallpaperDirsEmpty')}</p>
            )}
            {dirs.length > 0 && (
              <ul className={css.wallpaperDirList}>
                {dirs.map(dir => {
                  const sep = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'))
                  const parent = sep > 0 ? dir.slice(0, sep) : ''
                  const name = sep >= 0 ? dir.slice(sep + 1) : dir
                  return (
                    <li className={css.wallpaperDirCard} key={dir} title={dir}>
                      <span className={css.wallpaperDirIcon} aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h2.6c.4 0 .78.16 1.06.44l.9.9H13a1.5 1.5 0 0 1 1.5 1.5V12a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V4.5Z"
                            fill="currentColor" opacity="0.18"/>
                          <path d="M1.5 5.5v6.5A1.5 1.5 0 0 0 3 13.5h10a1.5 1.5 0 0 0 1.5-1.5V7A1.5 1.5 0 0 0 13 5.5H8L6.3 3.8A1.5 1.5 0 0 0 5.25 3.35H3A1.5 1.5 0 0 0 1.5 4.85V5.5Z"
                            stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" fill="none"/>
                        </svg>
                      </span>
                      <span className={css.wallpaperDirText}>
                        {parent !== '' && (
                          <span className={css.wallpaperDirParent}>{parent}{dir.includes('\\') ? '\\' : '/'}</span>
                        )}
                        <span className={css.wallpaperDirName}>{name || dir}</span>
                      </span>
                      <button
                        type="button"
                        className={css.wallpaperDirRemove}
                        aria-label={t('wallpaperRemove')}
                        title={t('wallpaperRemove')}
                        onClick={() => { wallpaper.removeDir(dir); load() }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className={css.wallpaperDirAdd}>
              <input
                className={css.wallpaperDirInput}
                type="text"
                value={dirInput}
                placeholder={t('wallpaperDirPlaceholder')}
                onChange={(event) => { setDirInput(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && dirInput.trim() !== '') {
                    wallpaper.addDir(dirInput.trim())
                    setDirInput('')
                    load()
                  }
                }}
              />
              <button
                type="button"
                className={css.button}
                disabled={dirInput.trim() === ''}
                onClick={() => { wallpaper.addDir(dirInput.trim()); setDirInput(''); load() }}
              >
                {t('wallpaperDirAdd')}
              </button>
              {wallpaper.pickDir !== undefined && (
                <button
                  type="button"
                  className={css.button + ' ' + css.buttonGhost}
                  disabled={picking}
                  title={t('wallpaperDirBrowseHint')}
                  onClick={browseDir}
                >
                  {picking ? t('loading') : t('wallpaperDirBrowse')}
                </button>
              )}
            </div>
            <p className={css.backgroundHintMuted}>{t('wallpaperDirsHint')}</p>
          </div>

          {actionError !== null && <div className={css.error}>{actionError}</div>}

          {items !== null && items.length > 0 && (
            <div className={css.wallpaperSearch}>
              <input
                className={css.wallpaperDirInput}
                type="search"
                value={query}
                placeholder={t('wallpaperSearch')}
                onChange={(event) => { setQuery(event.target.value) }}
              />
              <button
                type="button"
                className={css.wallpaperRefreshButton + (refreshing ? ' ' + css.wallpaperRefreshSpinning : '')}
                title={t('wallpaperRefresh')}
                aria-label={t('wallpaperRefresh')}
                disabled={refreshing}
                onClick={refresh}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
                  <path
                    fill="currentColor"
                    d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
                  />
                </svg>
              </button>
            </div>
          )}
          {visibleItems !== null && visibleItems.length === 0 && items !== null && items.length > 0 && normalizedQuery !== '' && (
            <p className={css.backgroundHintMuted}>
              {t('wallpaperSearchEmpty').replace('{query}', query.trim())}
            </p>
          )}
          {groups !== null && groups.length > 0 && (
            <div className={css.wallpaperGroups}>
              {groups.map(renderGroup)}
            </div>
          )}
          {items !== null && items.length === 0 && loadError === null && (
            <p className={css.backgroundHintMuted}>{t('wallpaperEmpty')}</p>
          )}
        </>
      )}
      {cropTarget !== null && cropTarget.previewUrl !== null && (
        <CropEditor
          t={t}
          wallpaper={wallpaper}
          wallpaperId={cropTarget.id}
          wallpaperTitle={cropTarget.title}
          previewUrl={cropTarget.previewUrl}
          onClose={() => { setCropTarget(null) }}
        />
      )}
    </div>
  )
}