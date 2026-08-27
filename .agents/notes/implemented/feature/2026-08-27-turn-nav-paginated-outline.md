# Agent Note: 轮次导航面板分页列表

Status: implemented

## Problem

大纲浮层会随会话轮次增多长成一长条滚动列表：面板在 600px 的 max-height
内滚动，长会话里要拖很久才能翻到早期某轮，也没有「跳到第 N 页」的入口。
用户要求把列表改成「一页显示 5 条 + 底部页码控件 + 可输入页码跳转」。

## Decision

在 `packages/turn-nav` 的 `TurnNavPanel.tsx` 引入本地分页，全部改动收敛在
面板组件、样式、i18n 与测试内：

- 常量 `PAGE_SIZE = 5`。新增 `page`（1 起始）与 `pageInput` 两个 state。
- 搜索过滤后的 `visible` 按页切片：`totalPages = max(1, ceil(visible/5))`；
  `safePage = clamp(page, 1, totalPages)`（加载窗口收缩、列表变短时越界页
  自动回落到最后一页）；`pageEntries = visible.slice((safePage-1)*5, safePage*5)`。
- footer 内新增 pager 行（置于 loadOlder/状态行之下，即面板最底部）：
  ‹ 上一页 / 页码输入框 "/ N" / 下一页 ›。输入框用
  `type="text" + inputMode="numeric"`，onChange 只保留数字，Enter 或失焦
  提交；非数字回退当前页，越界 clamp 到 `[1, totalPages]`；页码输入框与
  上一页/下一页按钮带 aria-label。
- query 变化自动重置到第 1 页；`safePage` 变化时同步 `pageInput`（切页、
  列表收缩后输入框显示实际页码）。
- 因每页固定 5 行、不再需要滚动，`.list` 去掉 `flex: 1` 与 `overflow-y`，
  面板高度收缩为内容高度（不再撑满 max-height）。
- **打开即全量加载历史，去掉「加载更早」按钮**：SDK 的 ConversationSnapshot
  只暴露已加载窗口的 `turnOrder` 加一个 `hasMore` 布尔，没有「总轮次」字段，
  ISession 也没有取总数的 RPC（SessionSummary 同样无消息数/轮次数）；
  因此让页码覆盖全部历史的唯一办法是 loadOlder 翻到底。面板打开时由一个
  effect 驱动循环 `loadOlder(sessionId)` 直到 `hasMore=false`（fire-and-forget
  face，靠 loadingOlder/hasMore/loadedCount 变化重新触发；无进展即停、
  LOAD_ALL_CAP=200 兜底）。加载期间（loadingAll = hasMore || loadingOlder）
  列表区显示「正在加载全部轮次…」、隐藏 pager；完成后页码总数即真实历史
  总量，翻页纯本地不再触发任何拉取。footer 不再有独立的 loadOlder 按钮与
  「已到会话开头」文案，语义 part 仍复用 `turn-nav-footer`。
- 新增 i18n key：`panel.prev` / `panel.next` / `panel.pageAria`（zh + en），
  移除不再使用的 `panel.loadOlder` / `panel.noMore`。

## Alternatives considered

- 维持滚动列表：不满足用户「分页」诉求，长会话定位问题依旧。
- 页号按钮组（1 2 3 … / 省略号）：页数多时按钮行本身会过长，还要处理
  «…» 截断；上一页/下一页 + 页码输入框对任意页数都恒定、最简洁。
- 无限滚动 / 虚拟列表：仍要滚动机翻页，与分页直觉不符，且引入虚拟化
  复杂度超出本面板量级。
- 把 loadOlder 改造成按页码请求的服务端分页：官方没有「加载到某轮/某页为
  止」的 API，需要跨 client/host 契约改动，违背最小改动原则。
- 直接从 session 读取总轮次数：SDK 契约（ConversationSnapshot / ISession /
  SessionSummary）不暴露总轮次或消息数，只有 loaded window + hasMore 布尔，
  无法直接读到，故必须 loadOlder 翻到底才能拿到真实总数。

## Consequences

- 用户可见：面板始终最多 5 行 + 底部页码控件，长会话定位更快；搜索过滤
  后自动回到第 1 页，避免停在空白页。打开面板时一次性把全部历史翻页加载
  进来（有「正在加载全部轮次…」提示），之后页码总数稳定为真实历史总量、
  翻页不再触发拉取，也没有「加载更早」按钮。
- 测试：新增 5 个分页用例（每页 5 条与 prev/next 翻页、输入跳转与越界
  clamp、搜索重置到第 1 页、打开即全量加载后按真实总数分页、无更早历史
  时不拉取），全部通过（22/22）；typecheck、build 均绿。测试 harness 改为
  store 订阅（createStore + 注入 useSession），使 loadOlder 推进快照后分页
  能真实落地。
- 现场验证（Playwright 只读 DOM 测量）：当前运行会话仅 1 轮，打开即
  hasMore=false 不触发拉取，pager 正确渲染为 "/ 1" 且 prev/next 禁用，无
  loadOlder 按钮；面板位置 288–648 在裁切祖（会话根 left=280）之内、
  elementFromPoint 采样均命中面板自身，无遮盖回归；多页与全量加载行为由
  单元测试覆盖（不污染用户会话数据造多轮次）。
- 依赖的上游 note：[轮次导航面板](2026-08-27-turn-nav-panel.md)、
  [popover 视口贴合修复](../../implemented/bug-fix/2026-08-27-turn-nav-popover-viewport-fit.md)。
