# Agent Note: 侧边栏折叠状态跨刷新记忆

Status: implemented

## Problem

DSH web shell 把左侧侧边栏的折叠状态保存在 `layout` 服务里的 React useReducer 中，从不写入 store、settings 或 localStorage，所以每次刷新页面都会回到默认展开状态。偏好 56px 窄栏的用户每次刷新后都得再点一次折叠按钮。这个选择纯属于界面偏好，没有任何服务端含义。

dsh-web 插件族不能改动 shell，但聚合包随每个页面加载的 compat shim（`packages/dsh-web-all/src/client/index.ts`）已经在观察 shell DOM 并补打旧版属性，是承载这部分记忆的合适位置。

## Decision

`packages/dsh-web-all/src/client/sidebar-memory.ts` 在 compat shim 旁边安装一个单例控制器。设计刻意保守，因为它跑在每个页面上、包括用户输入时，绝不能引起布局或焦点的反馈：

- 启动 500ms 后等待侧边栏列（shim 补上的 `[data-pane="sidebar"]`，或 shell 的 `[class*="sidebarCol"]`）出现，读取其稳定后的 `offsetWidth`。低于 120px 视为 56px 折叠态，否则视为展开态。刻意不依赖 shell 的 css-module 类名哈希（哈希会随 rc 版本变化）。
- 首次访问把 shell 默认状态写入 localStorage（`dsh:sidebar-collapsed`）；之后的访问如果持久化值与实测状态不一致，就通过 `ctx.layout.toggleSidebar()` 翻一次。不采用模拟点击折叠按钮的回退：程序化点击 shell 折叠按钮会让浏览器把它滚动进视图并抢走输入框焦点，正是要避免的故障。layout 服务不可达时直接跳过恢复。
- 只在自然暂停点持久化状态——`pagehide`、`visibilitychange` 切到隐藏、以及 5 秒一次的慢速心跳——不挂 MutationObserver。早期草稿在侧边栏的 `class`/`style` 属性上挂观察器、用 250ms 防抖在每次变更后持久化，但输入时 React 重渲染会触发这些属性变更，在 React commit 中读宽度 + 写 localStorage 会让页面在每次按键时滚动。暂停点方案在每次按键时零开销。
- 提供本地 kill 开关：在 localStorage 里设置 `dsh:sidebar-memory="off"` 即可在加载前禁用该控制器，不用等新版本。
- 每一处外部访问都做了防御：侧边栏缺失、隐私模式下 localStorage 抛异常、layout 服务缺失、toggle 调用抛异常都会安静降级为 no-op。控制器从不在侧边栏上写 width 或 className，因此不会与 React 的协调逻辑冲突。

## Alternatives considered

- 向上游报 issue、等 shell 自己持久化：长期方向正确，但当前用户仍要承受刷新即展开的行为。该控制器是叠加式的，shell 哪天自己持久化后可以直接删掉。
- 新建独立的 `dsh-sidebar-memory` 包：归属更干净，但要为约 150 行代码新增一个 npm 包名、一条 cordis.patch.yml、一个 aggregate 条目。这段记忆和已经在观察同一片 DOM 的 shim 一起跑，单独建包会重复 MutationObserver 与 body 监听。
- 直接监听折叠按钮的 click 事件来持久化：更简单，但需要持有 shell 按钮引用，且 shell 改动内部类名时会失效。基于宽度的判定不依赖类名。
- 用 MutationObserver 监听侧边栏属性变更来持久化：第一版试过，已回退。输入时 React 重渲染会触发属性变更；在 React commit 中读宽度 + 写 localStorage 会让页面在每次按键时滚动。暂停点方案（`pagehide`、`visibilitychange`、5 秒心跳）在按键时零开销，且与真正需要写盘的时机一致：页面卸载时。
- 在 `ctx.layout` 不可达时程序化点击 shell 折叠按钮作为回退：试过并已回退。对一个浏览器认为不在滚动视口里的按钮调用 `.click()` 会触发 `scrollIntoView`，正是导致页面滚动的原因。layout 服务缺失时现在直接跳过恢复，而不是点击回退。
- 用 `window.name` 或 session cookie 而不是 localStorage：`window.name` 只在同一标签页跨刷新保留、跳到外部链接会被清掉；cookie 会无谓地随每个 HTTP 请求带上。localStorage 与本族 telemetry 使用的存储面一致。

## Consequences

- 用户第一次加载带有该 shim 的构建时，持久化标记会按 shell 默认（展开）落种，首次加载无可见变化；之后刷新即记住上一次选择。
- 120px 阈值是启发式。未来 shell 如果加宽 rail 或把展开列缩到该阈值以下会误判；常量位于 `sidebar-memory.ts` 顶部，并由测试覆盖，需要调整时改动面很小。
- 该特性随 `@linxin666/dsh-web-all` 发布，单独安装某个子包而不装聚合包的用户不会获得该记忆。这与现有 compat shim 的归属一致：聚合包是受支持的安装面。
- 移动端（<= 768px）不受影响：响应式 CSS 已经自行驱动 `data-sidebar-collapsed` 抽屉状态；基于宽度的判定把移动端 52px 窄栏与桌面端 rail 视为同一类，因此窗口尺寸变化时仍会按用户最近一次桌面端意图恢复。
