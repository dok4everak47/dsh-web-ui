/**
 * Browser-half entry for the turn-nav plugin.
 *
 * Mounts one session-header action (`conversation.session.header.actions`):
 * a button that opens the turn navigation popover. The popover lists every
 * loaded turn with its user prompt, filters by prompt text, pages older
 * history on demand, and scrolls the chat scrollport to the chosen turn.
 *
 * Failure policy: nothing here throws at apply time — an external plugin must
 * never take the GUI down.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.* slots).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, zh, type TurnNavKey } from './locales.ts'
import { TurnNavAction } from './TurnNavAction.tsx'

/** Locale namespace this plugin owns. */
const NS = 'turn-nav'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** turn-nav surface copy. */
    'turn-nav': TurnNavKey
  }
}

/** Services required by this plugin. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Register the turn-nav header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => {
      try {
        return ctx.locale.register(NS, { zh, en })
      } catch {
        return () => {}
      }
    }, 'turn-nav: dictionaries')

    ctx.slots.inject('conversation.session.header.actions', () => {
      try {
        return ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'turn-nav',
          order: 20,
          locale: NS,
          inject: () => ({
            loadOlder: (sessionId: SessionId) => {
              void ctx.sessions.binding(sessionId)?.session.loadOlder()
            },
          }),
        }, TurnNavAction)
      } catch {
        return () => {}
      }
    })
  } catch {
    // Registration failure must never break the GUI.
  }
}
