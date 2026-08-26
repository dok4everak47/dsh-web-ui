---
title: 侧边栏刷新后首帧即收起，且无启动动画
date: 2026-08-26
package: dsh-web-all
type: bug-fix
i18n: en
---

## 摘要

已持久化为收起的侧边栏，刷新后必须从第一帧就画成收起，且之后不播放任何关闭动画。此前几次尝试分别运行在 cordis `apply()`（frame 已绘制展开态之后）和模块导入时的首帧网格覆盖（但在 frame 一出现 `data-sidebar-collapsed` 就移除抑制），都仍残留一段短暂动画。本记录说明最终修复以及每一层为何必要。

## 三层独立根因

1. **首帧**：ui-layout store 硬编码 `sidebar: 280`，而 cordis `apply()` 在 frame 挂载后才运行。shell 的 `runPluginBoot` 会先 await 每个插件模块导入再渲染 APP_SHELL，因此只有模块顶层代码能影响首帧。
2. **内部两波挂载**：即使外框被强制成 56px rail，shell 仍会先以展开态 `wide-in`（约 600ms）、再以 rail 态 `rail-in`（约 840-900ms）两波挂载内部内容。在 frame 标记 collapsed（约 490ms）时就释放抑制，会让内部的 wide→rail 切换动画漏出。
3. **CSS 关键帧优先级 / `animation:none` 重播**：用 `opacity:1 !important; transform:none !important` 无法压平入场关键帧——CSS 动画在这些属性上的优先级高于作者 `!important`。唯一能压平的是 `animation: none`，但若在挂载后移除该规则，浏览器会把它当作新动画从头重播，本身又是一次延迟的淡入/滑动。

## 修复

`packages/dsh-web-all/src/client/sidebar-memory.ts`：

1. **首帧几何样式**（导入时，`injectPreCollapseStyle`）：当 `localStorage['dsh:sidebar-collapsed'] === '1'` 时，在 `<html>` 上设置 `data-dsh-sidebar-precollapse`，注入一段仅桌面端（`min-width: 1025px`）的 `!important` 规则，把 frame 网格强制成 `56px minmax(0,1fr) 0`、列宽 56px 且 `overflow:hidden`，并对列/子树设 `transition:none`。frame 首帧即收起。
2. **保持再交接**：MutationObserver 等待 frame 的 `data-sidebar-collapsed`，随后再保持几何覆盖 `SETTLE_HOLD_MS = 900ms`（覆盖两波挂载）才移除。shell 解析出的也是同样的 56px rail，因此移除无视觉变化。若 shell 始终不提交，10 秒兜底。在样式生效期间调用一次 `toggleSidebar()` 翻转 React store（不能依据被 CSS 篡改的宽度判断，否则会跳过翻转、把样式遗留）。
3. **常驻入场动画静音**：第二段仅桌面端样式（`data-dsh-sidebar-memory="sidebar-no-anim"`）在整个会话内对 `[class*="sidebarCol"]` 及其后代设置 `animation: none !important`。交接时有意不移除（仅 dispose 时移除），使 `wide-in`/`rail-in` 关键帧从不播放、也不会重播。侧边栏手动折叠用的是 transition（列宽、max-width）而非 animation，因此手动切换仍正常动画。

持久化仍只在 pagehide/visibilitychange/心跳进行；frame 观察者只监听属性，二者都不会对打字时的 DOM 变动产生反应。

## 证据

- dsh-web-all 60 个测试通过（首帧注入、两段样式、静音在交接后保留、900ms 保持、兜底、dispose、持久化/开关/生命周期）。全仓测试通过：skin-center 550、shared 69、tool-describe-image 372；test:scripts 191/0；docs/aggregate 检查通过。
- 无头 GUI 探测（3 次）：启动期间侧边栏子树内零 `animationstart`/`transitionstart` 事件；采样到的 rail 图标从首次出现起就在最终 x 位置、`opacity:1`/`transform:none`；首帧计算出的 `grid-template-columns` 即 `56px 1384px 0px`（从未 280）；展开波次内容被裁在 56px 列内（只有图标落在 rail 内）。

## 取舍 / 范围

- 选择器用 `:has()` 与 `[class*="sidebarCol"]` 以避开哈希类名；harness Chromium 支持，且仅限桌面端。
- 常驻静音也会一并静音未来侧边栏在桌面端的任何 CSS 关键帧动画。transition（用于折叠/拖拽/悬停）不受影响。为换取无动画的收起恢复，这是可接受的、范围很窄的取舍。
