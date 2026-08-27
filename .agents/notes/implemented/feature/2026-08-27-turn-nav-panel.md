# Agent Note: 轮次导航面板（dsh-turn-nav）

Status: implemented

## Problem

DSH Web GUI 的长会话没有「跳到第 N 轮」的导航手段：聊天视图只提供向上分页
（「加载更早」）与「回到底部」，会话内也没有消息搜索/轮次大纲；浏览器
Ctrl/Cmd+F 只能搜到已加载页内的内容。用户在几十上百轮的会话里回到早期某轮
只能逐页滚动。dsh-web 插件族不能改 DSH 源码，但官方 ui-conversation 暴露了
会话头部槽位与稳定的 DOM 契约，使这个能力可以纯插件实现。

## Decision

新建纯浏览器插件 `packages/turn-nav`（npm 包
`@linxin666/dsh-client-ui-turn-nav`，bundle 行 id `ui-turn-nav`，聚合包内
`web-ui-turn-nav`）：

- 唯一注入点是 `conversation.session.header.actions` 槽位（会话标题行操作
  区），渲染一个图标按钮；点击弹出轮次大纲浮层，关闭即卸载。不使用
  `conversation.view` 视图标签页方案——大纲是聊天视图上的叠加导航，切到
  独立标签页后跳转目标不在 DOM 中，还要处理视图切换回切，复杂度高且与
  「边看边跳」的直觉不符。
- 轮次数据来自会话快照：轮序取 `snapshot.chat.timeline.turnOrder/turns`
  （引擎拥有的轮次号与开/合状态），每轮第一条普通用户消息取
  `snapshot.chat.nodes.values()` 中 `kind === 'user'` 且 location 落在该轮
  的最早 seq 节点。抽取逻辑放在 `src/core/turns.ts`，是 host/client 两侧可
  编译的纯函数，只 type-only 引用官方 SDK。steering 插队消息与 context
  注入消息不是轮次开头，不进列表。
- 跳转依赖两个官方稳定契约：滚动容器 `[data-conversation-scroll]`
  （ConversationRoot 输出）与每行包装的 `data-chat-anchor-key=<node key>`
  （ChatNodeSeat 输出）。命中行后 `scrollIntoView({ block: 'start' })` 并
  加全局类 `dsh-turn-nav-flash` 做 1.6s 轮廓闪烁；闪烁只用
  outline/box-shadow，不设 background——行内背景由官方子节点拥有，改背景
  会盖住消息内容。查找范围用头部所在的 `[data-phase]` 会话根限定，避免多个
  已挂载会话（分支会话）互相命中。
- 未加载页的轮次：历史按需分页是 web 客户端的既定模型（聊天视图与轨迹视图
  皆然），插件不绕过。时间线里存在但窗口内没有用户消息节点的轮次以
  `anchorKey === null` 的禁用行呈现，title 提示「更早的轮次尚未加载」；
  翻页超出已加载窗口时会自动经 `ctx.sessions.binding(id).session.loadOlder()`
  拉取更早轮次（见分页 note），加载后禁用行自动变可跳转。
- 面板内搜索框对用户提问全文做大小写无关子串过滤；Esc / 点击外部 / 跳转
  成功均关闭；空会话（无轮次且无更多历史）不显示入口按钮。

## Alternatives considered

- 独立 `conversation.view` 标签页（仿 ui-trajectory）：标签页激活时聊天视图
  卸载，`data-chat-anchor-key` 行不在 DOM 中，跳转必须先切回聊天标签再滚动，
  且两套视图的分页状态要同步；浮层方案天然在聊天视图之上，无此问题。
- 每轮尾部（`conversation.chat.turnTail`）加「定位」锚点：只能覆盖已渲染的
  轮次，长会话仍要先分页滚动，不提供全局大纲，不解决发现性问题。
- 浏览器页面内查找（Ctrl/Cmd+F）增强：只能搜已加载页，且无法自定义跳转/高亮
  体验，未加载历史完全不可见。
- 一次性加载全部历史后跳转：绕过官方分页模型，会给长会话带来突发的拉取与
  渲染开销，且官方没有提供「加载到某轮为止」的 API；保留逐页加载的既有约束。
- 高亮用背景色动画：第一反应是背景闪烁，但聊天行背景属于官方子节点（消息
  气泡、工具卡片各有背景），插件在行包装上设背景会在皮肤下产生色块/遮挡；
  outline + box-shadow 轮廓圈不侵入内容绘制。

## Consequences

- 该能力随聚合包 `@linxin666/dsh-web-all` 发布，也可单独
  `dsh plugin add @linxin666/dsh-client-ui-turn-nav` 安装；纯浏览器插件，
  host 半区为空操作，不注入系统提示词。
- 跳转锚点依赖 `data-chat-anchor-key` 与 `[data-conversation-scroll]` 两个
  官方 DOM 契约；若未来 ui-conversation 改属性名，跳转静默降级为「行未找到」
  提示（不报错），需同步更新选择器常量。两个常量集中在
  `TurnNavPanel.tsx` 顶部并有测试覆盖。
- 只支持桌面 Web GUI；移动端遥控 UI（dsh-remote-web-ui）是独立 React 页面，
  不加载该槽位，不在本插件范围。
- 面板只导航当前打开的会话；跨会话跳转（如从分支回到主干某轮）不在范围内。

## 验证期发现与修复（运行时根因）

首次安装到运行中的 profile 后按钮不出现，排查定位到两层运行时根因（均非
功能实现 bug）：

1. 启动时序：`dsh plugin add` 写入 profile 的 bundles 后，`dsh web` 在
turn-nav 的 node_modules 软链就绪前启动加载 plugin tree，聚合包的
`web-ui-turn-nav` 行 import `@linxin666/dsh-client-ui-turn-nav` 报
`ERR_MODULE_NOT_FOUND`，整个 plugin tree 加载失败、`apply()` 从未执行
（`~/Library/Logs/dsh-web.err.log` 反复报 373 次）。软链就绪后重启即解决。

2. 双重加载下的 duplicate slot entry：当同一 profile 同时含聚合包
`@linxin666/dsh-web-all`（行 `web-ui-turn-nav`）与独立包
`@linxin666/dsh-client-ui-turn-nav`（行 `ui-turn-nav`）时，浏览器侧
`window.__ModuleLoader__.load` 对同一 module id 加载两次并执行 `apply()`
两次。`conversation.session.header.actions` 是 list slot，`ui-slots` 对
重复 entry id 直接 throw（`ui-slots/src/index.ts:817`），第二次
`register({id:'turn-nav'})` 抛错；该错在**浏览器 console**（不进 node 的
err.log），且 `cordis-client-runner` 的 entry-crash supervision 会把
turn-nav entry 标记 crash 并下线，连第一次注册也失效，按钮不出现。

修复（commit 14a5e218）：`apply()` 加模块级 `applied` apply-once 守卫，第二次
加载直接 return，不触发重复注册。这是「聚合包 + 独立包共存」场景下插件作者
应做的幂等责任--官方聚合包注释明说共存不触发 loader duplicate **entry id**
（`web-ui-` vs `ui-`），但 module id 相同仍会重跑 factory，slot 层对重复
entry id 不幂等，故 apply 必须自幂等。

同时清除一个诊断障碍（commit 04f1e119）：原 `apply` 包三层 try/catch，其中
inject 工厂 `catch { return () => {} }` 会让任何注册失败静默成空注销、按钮
不渲染且无日志。已对齐官方 `ui-subagent` 的声明式注册（去 try/catch），让
apply 运行时错误能进浏览器 console。

教训：dsh-web 插件的**运行时错误在浏览器 console**，node 的
`dsh-web.err.log` 只覆盖 plugin tree 的 import / host 半区加载；浏览器侧
`apply()` / 组件渲染错误排查须看浏览器 console（`document.querySelectorAll
('[data-dsh-plugin="<id>"]').length` 可快速确认入口是否挂载）。
