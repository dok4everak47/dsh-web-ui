---
title: 侧边栏刷新后首帧即保持收起
date: 2026-08-26
package: dsh-web-all
type: bug-fix
i18n: en
---

## 摘要

侧边栏已记为收起时刷新，仍会看到它「关闭」：此前几次修复缩短了恢复延迟、抑制了不同过渡层，但它们都运行在 cordis 的 `apply()` 钩子里——而该钩子在布局 frame 已经渲染并绘制了展开的启动态之后才触发（ui-layout store 硬编码 `sidebar: 280`）。无论怎么抑制过渡，都无法抹掉第一帧展开态以及随后的翻转。用户的要求很明确：已收起的会话刷新后应保持收起，不要用过渡动画「告诉」它关闭了。

## 根因

dsh web shell 的 `runPluginBoot` 会先 `await` 每个插件模块的导入，之后才创建并渲染 `APP_SHELL` 布局 frame。由此得到两个事实：

1. 插件的 `apply()`（cordis 生命周期）在 frame 挂载之后才运行——对首帧来说太晚，在那里恢复必然产生从展开到收起的视觉变化，动不动画都一样。
2. 插件模块的**顶层代码**在被 await 的导入阶段执行，**早于 frame 的首帧**。在导入时往 `document.head` 插入的 `<style>` 会阻塞渲染，并作用于 frame 的第一次绘制。

首帧 CSS 还有一个次生陷阱：用 `!important` 把外框强制成 56px 后，`offsetWidth` 读到 56/57，于是基于宽度的「已经收起?」判断会跳过 `toggleSidebar()`，导致 React store 停在 280；frame 永远不会出现 `data-sidebar-collapsed`，首帧样式也就永远不被释放（override 被 stranded）。

## 修复

`packages/dsh-web-all/src/client/sidebar-memory.ts`：

1. **首帧预收起 CSS**（`injectPreCollapseStyle`，在文件末尾、模块导入时调用）。当 `localStorage['dsh:sidebar-collapsed'] === '1'` 时，在 `<html>` 上设置 `data-dsh-sidebar-precollapse`，并注入一段样式，在 `@media (min-width: 1025px)`（仅桌面端）内强制：
   - frame（`[class*="frame"]:has([class*="sidebarCol"])`）的 `grid-template-columns: 56px minmax(0,1fr) 0 !important`；
   - 侧边栏列宽 56px、`overflow:hidden`；
   - 该列及其后代的 `transition/animation: none`。
   这样 frame 首帧就是收起的。
2. **运行时对齐 store**。列挂载后，若预收起样式仍生效且 frame 没有 `data-sidebar-collapsed`，则无条件调用 `layout.toggleSidebar()`（不依赖被 CSS 篡改的宽度），让 React store 翻到 0、shell 渲染出真实收起态。
3. **交接**。用 MutationObserver 监听 frame 的 `data-sidebar-collapsed`；shell 一提交该属性就移除预收起样式。shell 自身规则算出的也是同样的 56px rail，因此移除在视觉上完全一致。若 shell 始终不提交，10 秒兜底释放（防御性，绝不把 override 遗留）。

MutationObserver 只监听 frame 的单个属性，不会对打字时的内容变动产生反应；持久化仍只在 pagehide/visibilitychange/心跳时进行。

## 证据

- dsh-web-all 60 个测试通过（首帧注入、媒体查询门控、按 frame 属性交接、兜底释放、dispose 清理，以及此前全部持久化/开关/生命周期用例）。全仓测试通过（skin-center 550、shared 69、tool-describe-image 372；test:scripts 191/0；docs/aggregate 检查通过）。
- 无头 GUI 探测：从侧边栏存在的第一帧起用 `requestAnimationFrame` 采样，第一帧计算出的 `grid-template-columns` 就是 `56px 1384px 0px`（从未出现 280），宽 57，下一帧（约 23ms 后）即出现 `data-sidebar-collapsed` 并移除预收起样式。侧边栏子树内零 `grid-template-columns`/`left`/width 过渡触发。之后仅有的过渡是 shell 自身的 rail 条目淡入，不属于关闭动画。

## 取舍 / 范围

- 预收起选择器用 `:has()` 触达 frame，避免依赖其哈希类名。桌面端 harness 运行在支持 `:has()` 的 Chromium 版本上；该规则仅限桌面端，并在 shell 提交自身状态后立即移除。
- 在 shell 应用其收起样式之前的几帧，展开宽度的内部内容会被 `overflow:hidden` 裁到 56px。shell 的收起提交在一两帧内完成，肉眼不可察。
