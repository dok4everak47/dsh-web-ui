# @linxin666/dsh-client-ui-turn-nav

English | [中文](README.zh.md)

Turn navigation panel for the DSH Web GUI: jump straight to any turn of a long
session instead of scrolling page by page.

A pure browser plugin mounted through the official `conversation.session.header.actions`
slot — no DSH source changes, no host-side behavior.

## What it does

- Adds a **turn navigation** button to the session header (next to the title
  actions). Clicking it opens an outline popover of the current session.
- **Turn outline**: every loaded turn is listed newest-first with its turn
  number, a running badge for the in-progress turn, the start time, and a
  two-line preview of that turn's user prompt.
- **Click to jump**: clicking a turn scrolls the chat scrollport to that
  turn's first user message and briefly flashes a highlight ring on the
  target row.
- **Prompt search**: the filter box matches the full user prompt text
  (case-insensitive substring), so long sessions can be navigated by keyword.
- **Paginated list**: loaded turns are shown 5 per page with a page-number
  jumper (and previous/next buttons) in the panel footer, so the outline
  never grows into a long scroll.
- **Load earlier turns**: the panel footer offers the same paging as the
  chat view's "Load earlier" button. Turns belonging to pages not loaded yet
  are listed disabled with a "not loaded yet" hint; once loaded they become
  jump targets.
- Closes on Escape, outside pointer press, or after a successful jump.

## Scope and limits

- The panel navigates the **currently open session** in the desktop Web GUI.
- Only **loaded** history pages can be scrolled to — the DSH web client
  pages history on demand, so turns before the loaded window are reached via
  the "Load earlier" footer button first (this mirrors the built-in chat and
  trajectory views).
- Jump targets the turn's first **ordinary user message**; steering messages
  and injected context are not turn openers and are not listed.
- The jump uses the official chat row anchors (`data-chat-anchor-key`) and the
  `[data-conversation-scroll]` scrollport contract, so it works across skins
  without DOM scraping beyond those attributes.

## Install

From npm (recommended):

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-turn-nav@latest
```

From this repository (development):

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:/path/to/dsh-web/packages/turn-nav
```

Then restart `dsh web` (or wait for the hot reload) and open any session:
the turn navigation button appears in the session header.

## Development

```sh
pnpm --filter @linxin666/dsh-client-ui-turn-nav typecheck
pnpm --filter @linxin666/dsh-client-ui-turn-nav test
pnpm --filter @linxin666/dsh-client-ui-turn-nav build
```

## License

BSD-3-Clause
