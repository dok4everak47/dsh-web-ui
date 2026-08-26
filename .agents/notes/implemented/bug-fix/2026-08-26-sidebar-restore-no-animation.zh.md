---
title: 侧边栏刷新恢复不再播放收起动画
date: 2026-08-26
package: dsh-web-all
type: bug-fix
i18n: en
---

## 摘要

侧边栏已记为收起时刷新页面，仍会看到明显的收起动画：列先画成展开，再播放 shell 的折叠过渡。第一版修复把恢复延迟从 500ms 降到侧边栏挂载后的 16ms 轮询，并给布局 frame 打标记、在那一拍抑制 frame 的 `grid-template-columns` 过渡。外框网格动画去掉了，但用户仍反馈有关闭动画。

## 根因

侧边栏不止外框网格一层。折叠时 shell 动画化三层，且它们并不同时提交：

- 布局 frame 动画化 `grid-template-columns`（300ms）；
- 拖拽手柄兄弟元素动画化 `left`（300ms）；
- 侧边栏**内部内容**有自己的折叠动画——头部操作区动画化
  `max-width / opacity / transform`，搜索框动画化 `width / padding`
  （约 180ms）——而这些提交发生在比 frame 网格**更晚的一次 React 渲染**。

只给 frame 打标记、并在外框宽度一匹配就移除标记，只能抑制第一层，且只持续约
18ms；随后内部内容照常播放折叠动画。`> *`（直接子元素）抑制选择器也漏掉了
嵌套的内部元素。

## 修复

恢复逻辑（`packages/dsh-web-all/src/client/sidebar-memory.ts`）现在：

1. 在侧边栏挂载后的第一个 16ms tick 通过
   `ctx.layout.toggleSidebar()` 翻转状态（不变）。
2. 期间在 `<html>` 上设置 `data-dsh-sidebar-boot` 属性。模块样式表对侧边栏列
   及其所有后代禁用 `transition`（`[data-pane="sidebar"],
   [data-pane="sidebar"] *`，加上 `[class*="sidebarCol"]` 选择器和拖拽手柄
   兄弟），覆盖外框、手柄以及延迟提交的内部内容。
3. 抑制持续到**首次用户交互**（`pointerdown` / `keydown` / `wheel` /
   `touchstart`，capture + passive）或 4 秒兜底，以先到者为准。用户一旦操作
   即移除属性，手动折叠恢复正常动画。不再绑定外框宽度的定时器，因此延迟的内
   部渲染无法漏过。

这借鉴了 shell 自带的 `[data-dragging] { transition: none }` 机制，但把范围扩
展到整个侧边栏子树，并以交互而非拖拽手势作为解除条件。

## 证据

- 46 个 sidebar-memory 测试通过，含各事件解除与兜底超时用例；dsh-web-all 全
  套（50 个测试）通过。
- 无头 GUI 探测在侧边栏子树上捕获 `transitionstart`，记录收起态刷新后前 1.5
  秒内 transitionstart 为 **0**，boot 属性生效期间没有任何侧边栏后代计算出非
  `none` 的过渡；随后点击即移除属性，恢复正常切换。

## 取舍

抑制持续到首次交互（最长 4 秒），因此该窗口内可能发生的其他侧边栏动画（例如
空闲加载时某个无关的 shell 动画）也会被静音。窗口有上限，且在用户做任何操作
时立即结束——这早于用户能触发手动折叠之前——实际效果只是让启动态看起来静止。
