/**
 * Pure turn-outline helpers over the client ConversationSnapshot.
 *
 * Compiled into both the browser bundle and the host program; imports only
 * types from the official NPM SDK and never touches a DSH source checkout.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** Structural view of a chat user node (the runtime view node types data as unknown). */
interface UserChatNodeData {
  kind: 'user'
  seq: number
  time: number
  content: readonly ContentBlock[]
}

/** One row of the turn navigation outline. */
export interface TurnOutlineEntry {
  /** Engine-owned turn number (durable, matches the chat log order). */
  turn: number
  /**
   * Chat-node DOM anchor key (`data-chat-anchor-key`): the turn's first
   * ordinary user message, when the window has one. Null for turns whose
   * opener is missing (older page not loaded yet) or attachment-only.
   */
  anchorKey: string | null
  /** One-line preview of the turn's user prompt (plain text, trimmed). */
  preview: string
  /** Full prompt text for search filtering (already plain text). */
  searchable: string
  /** Turn start time, unix epoch ms; null when the turn/start is outside the window. */
  time: number | null
  /** True once the turn's turn/end event is in the window. */
  closed: boolean
}

/** Maximum preview length; longer prompts are truncated with an ellipsis. */
export const PREVIEW_LIMIT = 120

/**
 * Join the text blocks of a user message into plain searchable text.
 * Image/attachment blocks contribute a short placeholder so attachment-only
 * prompts still produce a non-empty, non-jumpable row.
 * @param content - durable user message content blocks.
 * @returns the joined plain text ('' when there are no blocks).
 */
export function promptText(content: readonly ContentBlock[]): string {
  let text = ''
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text
    } else if (block.type === 'image') {
      text += '[image] '
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

/** Truncate to the one-line preview limit. */
export function toPreview(text: string, limit = PREVIEW_LIMIT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1).trimEnd()}…`
}

interface UserNodeInfo {
  key: string
  turn: number
  seq: number
  time: number
  text: string
}

/**
 * Collect every ordinary turn-opening user message in the chat window.
 * Steering messages (admitted into a running turn) and context injections are
 * not turn openers and stay out of the outline.
 */
function userMessages(snapshot: ConversationSnapshot): UserNodeInfo[] {
  const nodes = snapshot.chat.nodes.values()
  const found: UserNodeInfo[] = []
  for (const node of nodes) {
    if (node.kind !== 'user' || node.visibility === 'hidden') continue
    const data = node.data as Partial<UserChatNodeData> | undefined
    if (data?.kind !== 'user' || data.content === undefined
      || typeof data.seq !== 'number' || typeof data.time !== 'number') continue
    const location = node.location
    const turn = location.kind === 'turn'
      ? location.turn.turn
      : location.kind === 'step'
        ? location.turn.turn
        : undefined
    if (turn === undefined) continue
    found.push({
      key: node.key,
      turn,
      seq: data.seq,
      time: data.time,
      text: promptText(data.content),
    })
  }
  return found.sort((a, b) => (a.turn !== b.turn ? a.turn - b.turn : a.seq - b.seq))
}

/**
 * Build the turn outline for the currently loaded window of a session.
 *
 * Turns come from the engine timeline (in-window turns only); each turn's
 * opener is its earliest ordinary user message. Turns without a visible user
 * message (older pages not loaded, or purely injected context) still get a
 * row with a null anchor so the panel can show "not loaded yet" honestly.
 * @param snapshot - the live conversation snapshot.
 * @returns outline entries sorted by turn number descending (newest first).
 */
export function buildTurnOutline(snapshot: ConversationSnapshot): TurnOutlineEntry[] {
  const messages = userMessages(snapshot)
  const firstByTurn = new Map<number, UserNodeInfo>()
  for (const message of messages) {
    const existing = firstByTurn.get(message.turn)
    if (existing === undefined || message.seq < existing.seq) {
      firstByTurn.set(message.turn, message)
    }
  }

  const entries: TurnOutlineEntry[] = []
  for (const turn of snapshot.chat.timeline.turnOrder) {
    const location = snapshot.chat.timeline.turns.get(turn)
    const message = firstByTurn.get(turn)
    const text = message?.text ?? ''
    entries.push({
      turn,
      anchorKey: message === undefined || text === '' ? null : message.key,
      preview: text === '' ? '' : toPreview(text),
      searchable: text,
      time: location?.start?.time ?? message?.time ?? null,
      closed: (location?.end ?? undefined) !== undefined,
    })
  }
  return entries.sort((a, b) => b.turn - a.turn)
}

/**
 * Filter outline entries by a case-insensitive substring query against the
 * prompt text. An empty query keeps every entry.
 */
export function filterOutline(entries: readonly TurnOutlineEntry[], query: string): TurnOutlineEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return [...entries]
  return entries.filter(entry => entry.searchable.toLocaleLowerCase().includes(needle))
}
