# Agent Note: task-board commands.execute 丢失 images 参数（eab9ecc0 回归）

Status: implemented

## Problem

commit `eab9ecc0`（"fix: task-board execution signal argument
misalignment"）把 `packages/dsh-task-board/src/index.ts` 里
`ctx.commands.execute` 调用的第 3 个参数删掉了：

- 改前：`ctx.commands.execute(agent, line, [], signal)`
- 改后：`ctx.commands.execute(agent, line, signal)`

但权威的 `Commands.execute` 签名（`@deepseek-ai/dsh-commands` 的
`lib/types/index.d.ts:127`）要求 4 个参数：

```ts
execute(agent: Agent, line: string, images: readonly EncodedImageAttachment[], signal: AbortSignal): Promise<CommandExecution | undefined>
```

4 个都必填。删掉 `[]` 后 `signal` 被塞进 `images` 的位置、第 4 个参数缺失，
调用不再通过类型检查（`TS2554: Expected 4 arguments, but got 3`），
`pnpm -r build` 失败--也连带打断 `dsh-web-reload` 快速路径（它在重链/重启
3080 服务前先跑 `pnpm -r build`）。

那个 `[]` 是 `images` 参数（空数组 = 无 composer 图片），不是错位的值；原
调用本就正确。

## Decision

恢复空 images 数组，使调用匹配 4 参数签名：
`ctx.commands.execute(agent, line, [], signal)`。空数组对 task-board host 侧
执行是正确值（不提交 composer 图片）。

## Testing

`pnpm -r build` exit 0、无 TS 错误；`dsh-task-board` 构建干净。除恢复构建外
无行为变化（产物 `lib/index.js` 本就带 4 参数调用，因 `eab9ecc0` 只改了源
码、没重建 lib）。

## Residual / follow-up

`eab9ecc0` 的提交信息声称在修 "signal argument misalignment"。本次回退恢复
了类型正确的调用和构建，但**没有**调查或处理 `eab9ecc0` 背后可能的运行时
signal 问题。若确有真实 signal bug，需要在类型正确的调用之上单独做根因
分析。

## Consequences

构建和 `dsh-web-reload` 恢复；运行时行为与 `eab9ecc0` 之前完全一致。
