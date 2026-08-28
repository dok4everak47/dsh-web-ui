# Agent Note: task-board commands.execute lost its images argument (eab9ecc0 regression)

Status: implemented

## Problem

Commit `eab9ecc0` ("fix: task-board execution signal argument misalignment")
trimmed the third argument from the `ctx.commands.execute` call in
`packages/dsh-task-board/src/index.ts`:

- before: `ctx.commands.execute(agent, line, [], signal)`
- after:  `ctx.commands.execute(agent, line, signal)`

But the authoritative `Commands.execute` signature
(`@deepseek-ai/dsh-commands`, `lib/types/index.d.ts:127`) requires four
arguments:

```ts
execute(agent: Agent, line: string, images: readonly EncodedImageAttachment[], signal: AbortSignal): Promise<CommandExecution | undefined>
```

All four are required. Removing the `[]` makes `signal` land in the
`images` slot and drops the fourth argument, so the call no longer
type-checks (`TS2554: Expected 4 arguments, but got 3`) and `pnpm -r build`
fails - which also breaks the `dsh-web-reload` fast path, since that runs
`pnpm -r build` before relinking and restarting the 3080 service.

The `[]` is the `images` argument (an empty array = "no composer images"),
not a misplaced value; the original call was correct.

## Decision

Restore the empty images array so the call matches the four-argument
signature: `ctx.commands.execute(agent, line, [], signal)`. An empty array
is the right value for task-board host-side execution, which submits no
composer images.

## Testing

`pnpm -r build` exits 0 with no TypeScript errors; `dsh-task-board` builds
cleanly. No behavior change beyond restoring the build (the emitted
`lib/index.js` already carried the four-argument call, since `eab9ecc0`
changed only the source and never rebuilt).

## Residual / follow-up

The `eab9ecc0` message claimed a "signal argument misalignment" was being
fixed. This revert restores the type-correct call and the build, but does
NOT investigate or address any genuine runtime signal-handling concern that
may have motivated `eab9ecc0`. If a real signal bug exists, it needs
separate root-cause work on top of the type-correct call.

## Consequences

Build and `dsh-web-reload` work again; runtime behavior is identical to the
pre-`eab9ecc0` state.
