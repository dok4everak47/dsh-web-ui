/**
 * Fullscreen crop editor for a single static wallpaper.
 *
 * The editor overlays the whole window and lets the user:
 *   - drag to pan (reposition the visible area)
 *   - wheel / pinch to zoom (1x through 4x)
 *   - use the zoom slider for precise control
 *   - reset to the default cover framing
 *   - cancel (discard) or apply (persist) the transform
 *
 * It operates on a local draft copy of the crop; only "Apply" commits the
 * change through the injected wallpaper handle, so cancelling leaves the
 * mounted wallpaper untouched.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WallpaperCrop, WallpaperHandle } from './wallpaper.ts'
import { SliderControl } from './SliderControl.tsx'
import css from './skin-center.module.css'

/** Min/max zoom exposed by the editor. Matches wallpaper.ts sanitizeCrop. */
const MIN_SCALE = 1
const MAX_SCALE = 4

interface CropEditorProps {
  t: PropsLocale<'skinCenter'>['t']
  wallpaper: WallpaperHandle
  wallpaperId: string
  wallpaperTitle: string
  previewUrl: string
  onClose: () => void
}

export function CropEditor({ t, wallpaper, wallpaperId, wallpaperTitle, previewUrl, onClose }: CropEditorProps): ReactNode {
  const initial = wallpaper.getCrop(wallpaperId)
  const [draft, setDraft] = useState<WallpaperCrop>(initial)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  /** cover overflow at scale=1: half of (rendered image - stage) per axis. */
  const overflowRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  /** Bumped after the image decodes so the pixel translate recomputes with
   * real rendered dimensions (offsetWidth is 0 until layout settles). */
  const [, setMeasured] = useState(0)
  /** Active pointer drag state. */
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null)
  /** Set when the user clicks Apply; guards the unmount cleanup so it does
   * not clobber the just-committed crop. */
  const committedRef = useRef(false)

  const measure = useCallback((): void => {
    const stage = stageRef.current
    const img = imgRef.current
    if (stage === null || img === null) return
    const stageRect = stage.getBoundingClientRect()
    const stageW = stageRect.width
    const stageH = stageRect.height
    const natW = img.naturalWidth
    const natH = img.naturalHeight
    // object-fit: cover fills the stage, so compute the cover scale from
    // the natural aspect ratio instead of measuring the (stage-filling)
    // offsetWidth. Before the image decodes or when the stage is hidden,
    // leave the overflow at zero; the load/resize listener re-measures.
    let ox = 0
    let oy = 0
    if (stageW > 0 && stageH > 0 && natW > 0 && natH > 0) {
      const coverScale = Math.max(stageW / natW, stageH / natH)
      ox = Math.max(0, (natW * coverScale - stageW) / 2)
      oy = Math.max(0, (natH * coverScale - stageH) / 2)
    }
    overflowRef.current = { x: ox, y: oy }
    // Re-render so panX/panY pick up the freshly measured overflow.
    setMeasured(n => (n + 1) % 1_000_000)
  }, [])

  useLayoutEffect(() => {
    measure()
    const img = imgRef.current
    if (img === null) return
    if (img.complete && img.naturalWidth > 0) {
      measure()
    } else {
      img.addEventListener('load', measure, { once: true })
    }
    const win = window
    win.addEventListener('resize', measure)
    return () => {
      win.removeEventListener('resize', measure)
      img.removeEventListener('load', measure)
    }
  }, [measure])

  // On unmount without Apply, restore the original crop.
  useEffect(() => {
    return () => {
      if (!committedRef.current) {
        wallpaper.setCrop(wallpaperId, initial)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const clampScale = (scale: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))

  const setScale = (scale: number): void => {
    setDraft(prev => {
      const next = clampScale(scale)
      // Keep the pan inside the available range: when zooming out, a prior
      // pan may now exceed the (smaller) overflow and reveal an edge gap.
      return { ...prev, scale: next, offsetX: clampUnit(prev.offsetX), offsetY: clampUnit(prev.offsetY) }
    })
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const step = -event.deltaY * 0.0015
    setDraft(prev => ({
      ...prev,
      scale: clampScale(prev.scale * (1 + step)),
    }))
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: draft.offsetX,
      baseY: draft.offsetY,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const overflow = overflowRef.current
    // At scale=1 cover already overflows by `overflow`; at scale S the
    // additional pannable overflow is `overflow * (S - 1)`. offsetX/Y are
    // clamped to -1..1, so dragging by exactly that many pixels pins the
    // corresponding edge to the viewport edge.
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const maxX = overflow.x * (draft.scale - 1)
    const maxY = overflow.y * (draft.scale - 1)
    const nextX = maxX > 0 ? clampUnit(drag.baseX - dx / maxX) : 0
    const nextY = maxY > 0 ? clampUnit(drag.baseY - dy / maxY) : 0
    setDraft(prev => ({ ...prev, offsetX: nextX, offsetY: nextY }))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  const reset = (): void => {
    setDraft({ scale: 1, offsetX: 0, offsetY: 0 })
  }

  const apply = (): void => {
    committedRef.current = true
    wallpaper.setCrop(wallpaperId, draft)
    onClose()
  }

  // Pixel translate for the editor image, derived from the measured cover
  // overflow at the current scale. Mirrors applyCropTransform in
  // wallpaper.ts so what the user sees is what gets applied.
  const overflow = overflowRef.current
  const panX = overflow.x * (draft.scale - 1) * draft.offsetX
  const panY = overflow.y * (draft.scale - 1) * draft.offsetY
  const imageStyle = {
    transform: `translate3d(${-panX.toFixed(2)}px, ${-panY.toFixed(2)}px, 0) scale(${draft.scale})`,
  }

  return (
    <div className={css.cropOverlay} role="dialog" aria-modal="true" aria-label={t('wallpaperCropTitle')}>
      <div className={css.cropStageBar}>
        <span className={css.cropTitle} title={wallpaperTitle}>{wallpaperTitle}</span>
        <span className={css.cropHint}>{t('wallpaperCropHint')}</span>
      </div>
      <div
        ref={stageRef}
        className={css.cropStage}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={imgRef}
          className={css.cropImage}
          src={previewUrl}
          alt=""
          draggable={false}
          style={imageStyle}
        />
      </div>
      <div className={css.cropToolbar}>
        <div className={css.cropZoomRow}>
          <span className={css.themeLabel}>{t('wallpaperCropZoom')}</span>
          <SliderControl
            className={css.cropZoomRange}
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.01}
            value={draft.scale}
            ariaLabel={t('wallpaperCropZoom')}
            onChanging={setScale}
            onChange={setScale}
          />
          <span className={css.cropZoomValue}>{draft.scale.toFixed(2)}x</span>
        </div>
        <div className={css.cropActions}>
          <button type="button" className={css.button + ' ' + css.buttonGhost} onClick={reset}>
            {t('wallpaperCropReset')}
          </button>
          <button type="button" className={css.button} onClick={onClose}>
            {t('wallpaperCropCancel')}
          </button>
          <button type="button" className={css.button + ' ' + css.buttonPrimary} onClick={apply}>
            {t('wallpaperCropApply')}
          </button>
        </div>
      </div>
    </div>
  )
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}
