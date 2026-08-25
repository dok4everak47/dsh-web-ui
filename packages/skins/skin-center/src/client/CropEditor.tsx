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
  /** Pixel offset of the image center from the stage center at scale=1. */
  const baseOverflowRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  /** Active pointer drag state. */
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  const recomputeBaseOverflow = useCallback((): void => {
    const stage = stageRef.current
    const img = imgRef.current
    if (stage === null || img === null) return
    // object-fit: cover makes the rendered image at least as large as the
    // stage. Its overflow (the part that can be panned into view) is half of
    // (renderedSize - stageSize) on each axis at scale=1.
    const stageRect = stage.getBoundingClientRect()
    // Use the actual rendered image dimensions (object-fit: cover) rather
    // than naturalWidth: the cover math gives the visible overflow directly.
    const renderedW = img.offsetWidth
    const renderedH = img.offsetHeight
    baseOverflowRef.current = {
      x: Math.max(0, (renderedW - stageRect.width) / 2),
      y: Math.max(0, (renderedH - stageRect.height) / 2),
    }
  }, [])

  useLayoutEffect(() => {
    recomputeBaseOverflow()
    const img = imgRef.current
    if (img === null) return
    // Recompute once the image has its real intrinsic size; the first layout
    // may run before decode completes, when offsetWidth/Height reflect the
    // alt-text placeholder.
    if (img.complete) {
      recomputeBaseOverflow()
    } else {
      img.addEventListener('load', recomputeBaseOverflow, { once: true })
    }
    const win = window
    win.addEventListener('resize', recomputeBaseOverflow)
    return () => {
      win.removeEventListener('resize', recomputeBaseOverflow)
      img.removeEventListener('load', recomputeBaseOverflow)
    }
  }, [recomputeBaseOverflow])

  // The editor renders its own image so the user sees WYSIWYG without
  // writing to settings on every pointermove. The persisted crop only
  // changes on Apply; on unmount we restore whatever was there before the
  // editor opened (a no-op when nothing changed).
  useEffect(() => {
    return () => {
      wallpaper.setCrop(wallpaperId, initial)
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

  const setScale = (scale: number): void => {
    setDraft(prev => ({ ...prev, scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)) }))
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    // Treat wheel delta as a multiplicative zoom step; trackpad pinch zooms
    // arrive as ctrlKey wheel events with small deltas and feel natural here.
    const step = -event.deltaY * 0.0015
    setDraft(prev => ({
      ...prev,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * (1 + step))),
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
    const overflow = baseOverflowRef.current
    // Pannable distance is the image's overflow beyond the stage. At scale=1
    // the cover fit already overflows by `overflow`; at scale S the rendered
    // size is S times the cover-fit size, so the additional pannable overflow
    // is `overflow * (S - 1)`. At scale=1 there is nothing to pan.
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
    wallpaper.setCrop(wallpaperId, draft)
    onClose()
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
          style={{
            transform: `translate(${-draft.offsetX * 50}%, ${-draft.offsetY * 50}%) scale(${draft.scale})`,
          }}
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
