# AGENTS.md — turn-nav

DSH web GUI 的轮次导航插件（会话头部按钮 + 轮次大纲浮层，点击滚动定位到
指定轮次）。包级规则：只写本包特有约定，不重复根 AGENTS.md 与
packages/AGENTS.md 的全局/包级规则。

## 本包要点

- **挂载面**：唯一注入点是 `conversation.session.header.actions`
  （会话头部操作区）。面板组件随按钮按需挂载，关闭即卸载。
- **DOM 契约边界**：跳转只依赖官方聊天视图的两个稳定契约——
  `[data-conversation-scroll]` 滚动容器与行包装的 `data-chat-anchor-key`
  属性（值为聊天节点 key）。查找范围用头部所在的 `[data-phase]` 会话根
  限定，避免多个已挂载会话互相命中。不得抓取官方内部 class。
- **数据面**：轮次列表来自会话快照 `snapshot.chat.timeline`（轮序）与
  `snapshot.chat.nodes`（用户消息节点），抽取逻辑在 `src/core/turns.ts`
  （host/client 两侧可编译的纯函数，只 type-only 引用官方 SDK）。
- **分页**：更早历史只能通过 `ctx.sessions.binding(id).session.loadOlder()`
  拉取；未加载页的轮次以 `anchorKey === null` 的禁用行呈现，不可跳转。
- **闪烁高亮**：`dsh-turn-nav-flash` 全局类直接加在官方行包装上，动画
  只用 outline/box-shadow，不设 background（行内容背景由官方子节点拥有）。
- host 半区为空操作：本插件是纯浏览器插件，无 host 行为。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-turn-nav typecheck
pnpm --filter @linxin666/dsh-client-ui-turn-nav test
pnpm --filter @linxin666/dsh-client-ui-turn-nav build
```
