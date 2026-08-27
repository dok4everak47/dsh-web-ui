# Agent Note: turn-nav 浮层按裁切祖先夹紧（修侧边栏打开遮盖）

Status: implemented

## Problem

`turn-nav` 的轮次浮层 `position:absolute; right:0; width:360px`，相对 trigger
容器（`.root`，会话头部操作区）向左展开。桌面端默认侧边栏打开 280px，会话根
`br5Nma_root`（`overflow:hidden`）左边界 = 280。浮层右对齐 trigger 右边、向左
展 360，左边缘 = `rootRect.right - 360`。当 trigger 偏左（实测桌面
`542 - 360 = 182 < 280`）时，浮层左部 182-280 越过会话根左边界，被
`br5Nma_root` 的 `overflow:hidden` 裁切、并落在侧边栏 `_2H5Wja_sidebarCol`
（0-280）上方被其会话列表 `vrmeZG_sessionRow` 盖住--用户看到的「打开侧边栏就
显示不全」「貌似被遮盖」。关闭侧边栏时会话根左边界退到 56px rail，浮层
`left=182 > 56` 不被切，故正常。

`b5b5b2e0`（`.list` `min-height:0` + `.panel` `overflow:hidden`）修的是**纵向**
长列表底部被切，横向遮盖未碰，本次修横向。

## Decision

`packages/turn-nav/src/client/TurnNavPanel.tsx` 加 `useLayoutEffect`，挂载时及
`resize` / 捕获 `scroll` 时测量，把浮层夹紧到**最近的 `overflow!=visible` 祖先**
（裁切祖先 = 会话根 `br5Nma_root`，随侧边栏开/关移动）的 padding box，而非
视口：

- 向上遍历 `parentElement` 找第一个
  `overflow/overflowX/overflowY != visible` 的祖先，取其
  `getBoundingClientRect()` 作 `clip`；找不到则退化为视口 `[0, vw]`。
- `minLeft = clip.left + margin`、`maxRight = clip.right - margin`（margin=8）。
- 默认保留 CSS `right:0`，仅当 `defaultLeftVp = rootRect.right - panelW >=
  minLeft` 且 `defaultRightVp = rootRect.right <= maxRight` 时（桌面宽屏命中，
  行为不变）。
- 否则按视口坐标算 `leftVp`：先取 `defaultLeftVp`，若 `< minLeft` 抬到
  `minLeft`，若 `leftVp + panelW > maxRight` 抬到 `maxRight - panelW`，再兜底
  `>= minLeft`；换算到 offsetParent 坐标（减 `rootRect.left`）后以 inline
  `style` 覆盖 `right:0`。

侧边栏打开：`clip.left=280` -> 浮层夹到 `288..648`，全在会话列内、侧边栏右侧，
不再被裁切/遮盖。关闭：`clip.left=56` -> 夹到 64 起。逻辑随侧边栏宽度自适应
（打开时测一次；开着切换由 `ResizeObserver` 兜底重测），无需显式监听侧边栏状态。

### 坐标系陷阱

`left` 是**相对 offsetParent**（trigger 容器）的偏移，不是视口坐标。夹紧值必须
统一减 `rootRect.left` 换算到 offsetParent 坐标，否则把视口坐标当 `left` 直接设
会重复叠加 offsetParent 自身偏移（早期版本踩过：portrait768 设 `left=274` 后
浮层视口左缘 = 548，反而右溢）。

### 为什么不用 portal

`createPortal(..., document.body)` + `position:fixed` 能彻底摆脱祖先 overflow 与
层叠，但要重写关闭逻辑（panel 不在 `rootRef` 内，`rootRef.contains` 失效）、加
scroll/resize 跟随与 focus 管理，改动大风险高。裁切祖先夹紧足以解决桌面侧边栏
遮盖，不过度工程。

## Alternatives considered

- clamp 到视口（早版本）：错误抽象--侧边栏打开时会话列左边界 > 0，视口夹紧仍
  允许浮层越过会话根被侧边栏遮盖（实测桌面打开侧边栏 `panel.left=182 < 280`
  被 `vrmeZG_sessionRow` 盖）。必须 clamp 到裁切祖先。
- 纯 CSS：无法据 trigger 实际位置条件翻转，媒体查询不知道 trigger rect，且
  trigger 位置随侧边栏宽漂移。
- 仅窄屏缩 `max-width`：治标，trigger 偏左时 `right:0` 仍越过会话根。

## Consequences

- 桌面宽屏（>=1024）行为不变，仍走 CSS `right:0`。
- 侧边栏打开时浮层左移夹到会话列内，不再被侧边栏遮盖；关闭时自适应到 rail
  右侧。不改官方 DOM 契约（`data-chat-anchor-key` /
  `[data-conversation-scroll]` 不变），`panelRef` / `jumpToTurn` 不受影响。
- 监听 `resize`、捕获 `scroll`、并对裁切祖（会话根）挂 `ResizeObserver`：
  sticky 头部滚动或**侧边栏开/关切换**（改会话根宽度但不触发 window resize）时
  重测夹紧，panel 开着切侧边栏也不会跑回被遮盖位置；`typeof ResizeObserver`
  守卫跳过 jsdom（测试环境无此 API），卸载移除全部监听；`useLayoutEffect` 在
  paint 前同步定位，避免首帧闪移。
- 窄屏（<1024，如 768/375）：turn-nav 按本包语义为**桌面专用**，窄屏 DSH 布局
  存在既有的层叠遮盖（`_row_9cl6j_10` / `_title_` / svg 等元素盖住浮层，与夹紧
  逻辑无关，HEAD 版本同样存在），属布局域既有问题，不在本修范围。

## Testing

- `pnpm --filter @linxin666/dsh-client-ui-turn-nav typecheck` 通过；
  `... test` 18/18 通过（3 文件）；`... build` 成功。
- 真实 DSH Web GUI（`127.0.0.1:3080`，web profile，turn-nav `link:` 安装）headless
  Playwright 注入 20 行克隆模拟长列表，`elementFromPoint` 跨浮层宽度采样检测
  遮盖：
  - 侧边栏打开（用户场景）修复前：panel `left=182 right=542`，
    `br5Nma_root` `left=280`，侧边栏 `right=280`；y=348 采样 x=182/242 命中
    `vrmeZG_sessionRow`（侧边栏会话列表盖住浮层左部），x>=302 才命中 panel。
  - 修复后：panel `left=288 right=648`（= `clip.left 280 + 8`），采样
    x=288..588 全命中 panel，无遮盖；全在 `br5Nma_root`(280-1440) 内、
    侧边栏(0-280) 右侧。
  - 跨 5 视口（1440/1280/1024/768/375）：桌面三档 `within_clip` 与
    `bottom_in_vw` 均 ok、左右无遮盖；窄屏 768/375 的遮盖为 DSH 布局既有
    （HEAD 同样存在），非本改动引入。
- 不重启运行中的 DSH 服务；探测为只读 HTTP + 独立 headless 浏览器，未改会话
  数据；HMR（`dsh-client-hmr`）build 后自动更新 3080 的 turn-nav bundle。
