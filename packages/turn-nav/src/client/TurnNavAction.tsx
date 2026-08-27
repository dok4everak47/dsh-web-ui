/**
 * Session-header action: a button that opens the turn navigation popover.
 * Registered into `conversation.session.header.actions`; the popover stays
 * mounted only while open (like the official subagent catalog action), and
 * closes on outside pointer press or Escape.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { TurnNavPanel, type TurnNavFace } from './TurnNavPanel.tsx'
import { TurnNavIcon } from './icons.tsx'
import { TURN_NAV_PART_TRIGGER, TURN_NAV_PLUGIN_ATTR } from './semantic.ts'
import css from './turn-nav.module.css'

/** Full props for the session-header turn-nav action. */
export type TurnNavActionProps = PropsRuntime<'conversation.session.header.actions'> & {
  t: TranslateNS<'turn-nav'>
} & TurnNavFace

/** Header trigger button + lazily-mounted popover panel. */
export function TurnNavAction(props: TurnNavActionProps) {
  const { useSession, sessionId, t, loadOlder } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  // Hide the entry entirely on a blank session (nothing to navigate).
  const hasTurns = useSession(
    snapshot => snapshot.chat.timeline.turnOrder.length > 0 || snapshot.hasMore,
  )

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  if (!hasTurns && !open) return null

  return (
    <div
      className={css.root}
      ref={rootRef}
      data-dsh-plugin={TURN_NAV_PLUGIN_ATTR}
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        data-dsh-part={TURN_NAV_PART_TRIGGER}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('action.label')}
        title={t('action.label')}
        onClick={() => { setOpen(value => !value) }}
      >
        <TurnNavIcon />
      </button>
      {open && (
        <TurnNavPanel
          {...props}
          onClose={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}
