/**
 * Host loader entry for the turn-nav plugin — runs in the DSH host process.
 *
 * A pure browser plugin: the turn navigation panel lives entirely in the web
 * GUI browser half (src/client/), mounted through the
 * `conversation.session.header.actions` slot. The host half needs no behavior.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the host half (no-op: turn-nav is browser-only). */
export function apply(_ctx: Context): void {
  // Browser-only plugin: no host-side behavior.
}
