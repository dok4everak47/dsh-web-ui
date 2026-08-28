# Agent Note: turn-nav load-all gated on a quiet scrollport (fix scroll flicker)

Status: implemented

## Problem

Opening the turn-nav panel and scrolling the chat made the page visibly jump
("open the menu, scroll, the page sometimes flickers"). The panel's
load-all-on-open loop ([paginated outline](../../implemented/feature/2026-08-27-turn-nav-paginated-outline.md))
fires `loadOlder()` back-to-back on open: on the report session, eight pages
(~300 flow nodes) landed within ~450 ms, growing the chat scrollport from
8465 px to 26313 px right as the reader starts scrolling.

Two chat-view behaviors race those prepends:

- The built-in follow-the-tip logic (`tipMoved && atBottom -> toBottom`) sees
  every history batch as a tip move. A reader who just started scrolling up
  from the bottom (the common posture after chatting) has `atBottom` still
  latched, so each landing batch flings the viewport back to the bottom. A
  read-only Playwright probe against the live GUI reproduced this
  deterministically: four of four runs yanked the viewport to the bottom
  twice (+8409 px and +3973 px) while the reader wheeled up.
- Scroll-anchoring compensation (native anchoring plus the chat view's
  anchor-row restore) is reliable when the port is at rest but is suppressed
  or re-armed late mid-gesture, so a batch landing during an active scroll
  can shift content under the reader.

Because both failure modes need a batch to land inside a scroll gesture
window, the symptom was probabilistic from the user's point of view.

## Decision

The load-all effect in `packages/turn-nav/src/client/TurnNavPanel.tsx` now
gates every `loadOlder()` call on a quiet conversation scrollport
(`SCROLL_IDLE_MS = 350`):

- A capture-phase window `scroll` listener records the last scroll activity
  (scroll does not bubble; capture catches the chat scrollport). The gate is
  deliberately conservative: any scroll in the document counts.
- The gate is armed on panel mount, so the first pages cannot land while the
  reader is starting to scroll right after opening the panel.
- A call is deferred while `lastScrollAt + 350 ms` is in the future; a
  `setTimeout` re-ticks the effect when the quiet window elapses
  (`loadTick` state; existing progress/cap guards unchanged).

Each landed page fires its own compensating scroll event (bottom re-pin or
anchoring adjustment), which re-arms the gate and paces the loop to about one
page per quiet window. The SDK contract is untouched: `loadOlder` still pages
history into the shared session window; only the calling cadence changed.

## Alternatives considered

- Revert to on-demand paging (pre-fa228e27): would remove the pager's real
  total, which is the feature the load-all loop exists to provide; the SDK
  exposes no total-turn-count RPC, so paging to the end is the only way to
  learn it.
- Fix the compensation in the chat view: the anchor-restore and follow logic
  belong to the official `@deepseek-ai/dsh-client-ui-conversation` bundle; a
  plugin must not patch host UI behavior.
- Pace the loop with a fixed delay only: a timer-paced batch can still land
  mid-gesture; only the scroll-activity signal knows when the reader is
  actually safe to prepend under.

## Consequences

- While the reader scrolls with the panel open, history loading pauses
  (the pager total shows "..." until done) and resumes about 350 ms after
  the last scroll event. Opening the panel without scrolling delays the
  first page by the same quiet window, so the panel's "loading full
  history" notice is visible slightly longer on long sessions.
- The differential probe (same live session, unfixed vs fixed bundle) went
  from two bottom-yanks per run to zero across four runs, with all eight
  history batches still landing and the pager reaching the real total.
- Residual risk: a `loadOlder` issued during a quiet window whose response
  lands after the reader starts scrolling again can still prepend
  mid-gesture. The window is one host round-trip wide and requires the
  reader to start scrolling within it; no further mitigation without
  host-side support.

## Testing

- `pnpm --filter @linxin666/dsh-client-ui-turn-nav typecheck` and `... test`
  pass (25/25). New regression test `holds history loads while the reader
  scrolls and resumes once the port is quiet` (fake timers over a stepped
  paged store) failed against the unfixed panel (loadOlder called
  immediately, twice) and passes with the gate.
- Live GUI (`127.0.0.1:3080`, read-only probes, no service restart):
  unfixed bundle yanked the viewport to the bottom twice per run (4/4
  runs); fixed bundle zero yanks (4/4), zero visible content jumps (3/3
  runs, 8 batches each), pager reached the real total in every run.
