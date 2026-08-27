/**
 * Browser-half entry for the turn-nav plugin.
 *
 * Mounts one session-header action (`conversation.session.header.actions`):
 * a button that opens the turn navigation popover. The popover lists every
 * loaded turn with its user prompt, filters by prompt text, pages older
 * history on demand, and scrolls the chat scrollport to the chosen turn.
 *
 * Registration is declarative (same shape as the official ui-subagent action):
 * the plugin loader catches and logs apply-time failures itself, so silent
 * try/catch here would only hide problems from the err log.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (conversation.* slots).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, zh, type TurnNavKey } from './locales.ts'
import { TurnNavAction } from './TurnNavAction.tsx'
import type { TurnNavFace } from './TurnNavPanel.tsx'

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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'turn-nav: dictionaries')

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'turn-nav',
    order: 20,
    locale: NS,
    inject: (sessionId: SessionId): TurnNavFace => ({
      loadOlder: (targetId: SessionId) => {
        void ctx.sessions.binding(targetId)?.session.loadOlder()
      },
    }),
  }, TurnNavAction))
}
