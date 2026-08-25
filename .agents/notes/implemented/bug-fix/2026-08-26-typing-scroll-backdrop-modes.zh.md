# Agent Note: 背景视觉模式下打字滚动回归

Status: implemented

## 问题

用户反馈：只要在输入框输入文字，整个页面就会往下滚动，且仅在启用自定义背景图（壁纸）时出现，默认皮肤不受影响。真实浏览器复现（try-on 壁纸 + 打开含历史的会话 + 滚动口置顶）显示：会话滚动口 `[data-conversation-scroll]` 在输入框获得焦点时跳一下，随后每敲一个字符再向下滚动约 72px，直到触底。全程没有任何 JavaScript 滚动调用：滚动事件来自 Chrome 原生插入符滚动定位（caret scroll-into-view），该机制会遵守滚动口的 `scroll-padding-bottom`。

源头是 `src/client/runtime/shell-rendering.ts` 中的 `scroll-padding-bottom: var(--dsh-composer-height, 100px) !important` 声明（#978 为替代被中和的物理 padding 而引入，后续提交改为 0 后保留该声明作为 scrollIntoView 间隙）。scroll padding 不仅影响程序化 `scrollIntoView()`，同样影响浏览器在输入框获得焦点的每次击键时执行的原生插入符滚动定位。由于 composer 是滚动口最后一个流内子元素，请求的底部间隙（高出视口底边一个 composer 高度）在几何上不可达，于是每次击键都把正文继续往底部推。该规则的作用域是 `html[data-dsh-skin]`、`html[data-dsh-custom-theme]`、`html[data-dsh-wallpaper-active]`，这正解释了为什么只有皮肤、自定义主题或壁纸激活时才触发。

## 决策

删除 `scroll-padding-bottom` 声明，保留 `padding-bottom: 0 !important` 作为物理中和手段。默认 shell 在 `[data-conversation-scroll]` 上本来就是 `scroll-padding-bottom: auto` 且 `padding-bottom: 0`；当前 shell 也没有任何针对会话内容的 `scrollIntoView()` 调用（对 harness conversation/composer 包全文检索为零；shell 其余 scrollIntoView 调用均作用于命令面板、输入触发下拉与 trajectory 行，且各自在独立滚动容器内）。该声明试图保留的间隙保护的是当前不存在的场景，而它的插入符滚动副作用破坏了所有背景视觉模式下的输入体验。

同时移除因此失去消费者的测高机制（ResizeObserver + 全 body MutationObserver 向 `--dsh-composer-height` 写值，每次 DOM 变更即每次击键都做一次强制布局读取）以及 `DEFAULT_COMPOSER_CLEARANCE_PX`、`COMPOSER_SEAT_SELECTORS`；已核实该变量在包内、shared、皮肤目录 CSS、文档与用户已安装皮肤中均无消费者。否决的替代方案：保留声明但改小数值（任何非零 scroll-padding 都会让插入符滚动继续打架）；把间隙改到会话行的 `scroll-margin-bottom`（为了保留默认 shell 本来就没有的行为而把适配器耦合到 shell 内部行类名）。

## 影响

皮肤、自定义主题与壁纸激活时，在输入框打字不再滚动正文；滚动口在所有视觉模式下保持与默认 shell 一致的滚动语义。滚动口底部 padding 维持中和状态，dock 锚定与 hero 居中不受影响。composer 测高观察器不再运行。`shell-rendering.ts` 属 skins 评审路由而非渲染器路由，但被删除的规则出自渲染器域（提交 624043c4 与 7c09df74，作者 Aa728848）；按 AGENTS.md 要求已在交付报告中通知域负责人。

## 验证

- `packages/skins/skin-center` 内 `npx vitest run`：31 个文件、550 个测试通过（含重新钉住的 #978 测试：断言不再出现 `scroll-padding-bottom` 声明）。
- 全部 20 个工作区的 `pnpm typecheck` 通过。
- README 更新后 `pnpm docs:check` 与 `pnpm docs:write-pair packages/skins/skin-center` 通过。
- 针对运行中的 `dsh web` 服务做真实 GUI 验证（无需重启；服务按请求读取 link 安装的包构建产物）：try-on 壁纸挂载（`data-dsh-wallpaper-active`、z-index -3 媒体层）后，打开含历史会话、滚动口置顶，再点击输入框并输入两行文字。修复前：滚动口在聚焦时跳到 389，每字符约 +72px 滚到底（scroll-padding-bottom 计算值 171px）；修复后：聚焦与打字全程滚动口停在 scrollTop 0，window.scrollY 保持 0，壁纸持续渲染（scroll-padding-bottom 计算值 auto，padding-bottom 0px）。
