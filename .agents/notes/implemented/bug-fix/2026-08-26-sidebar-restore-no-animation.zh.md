# Agent Note：侧边栏记忆恢复时不再播放收起动画

Status: implemented

## 问题

侧边栏折叠记忆（功能记录 2026-08-25-sidebar-collapsed-memory）能记住折叠状态，但之前是在固定 500ms 定时器里通过 `ctx.layout.toggleSidebar()` 恢复。刷新时 shell 先把侧边栏画成展开态，500ms 后恢复调用翻转 React 状态，布局 frame 再照常播放 `transition: grid-template-columns 0.3s` 动画，从展开（280px）缩到导轨（56px）。用户反馈：刷新前已关闭的侧边栏刷新后应保持关闭，而不是再收一遍，这样记忆看起来并没有生效。

## 决策

把恢复从「等 500ms 后」改成「挂载后按帧粒度立即恢复」，并在恢复那一帧抑制 frame 网格过渡。安装时启动一个 16ms 轮询，在列挂载且宽度可读的第一个 tick 就调用 `toggleSidebar()`。该 tick 期间，给 frame（侧边栏的父网格容器，即承载 `grid-template-columns` 过渡的元素）打 `data-dsh-sidebar-restore` 标记，由模块自有的一个页面级样式表应用：

```css
[data-dsh-sidebar-restore],
[data-dsh-sidebar-restore] > * { transition: none !important; }
```

这与 shell 自身的机制一致：ui-layout 的 AppFrame 在拖拽 resize 手柄时就用 `[data-dragging] { transition: none }` 禁用同一条过渡。标记同时覆盖 frame 的直接子元素（包括动画 `left` 的 8px 拖拽手柄），列宽跳变时没有任何东西滑动。测量宽度一旦与持久化目标一致就移除标记；若 toggle 始终未生效，600ms settle 窗口后也会移除；`toggleSidebar()` 抛错则立即移除。抑制样式表在没有元素携带标记时完全无效，并在 shim dispose 时移除。

shell 的 layout 服务只暴露 `toggleSidebar()`、`openDetails()`、`closeDetails()`；面板 store 明确是临时态（`init` 总是以 `sidebar: SIDEBAR_DEFAULT` 启动），没有注入初始状态的入口，所以通过 shell 自己的 toggle 再加一次过渡抑制是受支持的路径。用 16ms `setTimeout` 轮询而不是 MutationObserver，保留模块「不用 MutationObserver」的保证；最坏情况只是抑制 toggle 落地前冷启动那一帧（约 16ms）的默认展开态，与应用冷启动绘制叠加，肉眼不可察。

## 影响

刷新前关闭的侧边栏，刷新后直接就位，没有 300ms 收起动画，也没有 500ms 延迟。持久化时机（pagehide、visibilitychange 隐藏、5 秒心跳）、基于宽度的状态判定、kill switch（`localStorage['dsh:sidebar-memory'] = 'off'`）以及「不点击 DOM 按钮」的兜底策略均保持不变。恢复翻转仍只走 `ctx.layout.toggleSidebar()`，React 仍是唯一状态源；新增的只是一个临时的、作用域受限的 `!important` 过渡抑制，settle 观察器和 dispose 都会清除，不会残留。

## 验证

- `packages/dsh-web-all` 内 `npx vitest run`：4 个文件、50 个测试通过。新增用例覆盖：首个 tick 即恢复、toggle 期间存在抑制且 settle 后移除、宽度始终不变时 600ms 上限后移除抑制、`toggleSidebar` 抛错时立即清理、样式表生命周期、以及零宽列在一拍后变可读的等待场景。
- 全部工作区 `pnpm typecheck` 通过。
- README 更新后 `pnpm docs:check` 与 `pnpm docs:write-pair packages/dsh-web-all` 通过。
- 针对运行中的 `dsh web` 服务做真实 GUI 验证（无需重启；聚合包按请求读取 link 安装的构建产物）：导航前预设 `localStorage['dsh:sidebar-collapsed']='1'`，以 16ms 间隔轮询列宽与 frame 过渡。列在约 t=298ms 先以 280px 挂载；t=318ms 已为 56px，frame transition-property 计算值为 `none` 且 `data-dsh-sidebar-restore` 存在；t=336ms 标记移除、过渡恢复，列稳定在 56px、无网格动画。修复前同一场景会保持展开 500ms 再播放 0.3s 收起动画。
