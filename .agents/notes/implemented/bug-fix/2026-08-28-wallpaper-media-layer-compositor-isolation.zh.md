# Agent Note: 壁纸媒体层独立合成器层（修复滚动时菜单闪动）

Status: implemented

## Problem

打开 `:r3:-menu`（composer 模型选择下拉菜单）后滚动对话，菜单会出现可见的
闪动。只有自定义静态图片壁纸才会触发；默认（视频/场景）壁纸不会闪动。

`:r3:-menu` 是 host `ui-model-selection` 的 `ModelSelect` 下拉菜单：React
`useId()` 返回 `:r3:`，下拉菜单 id 为 `${id}-menu`。它在 composer/输入卡片
正上方打开，而 skin-center 在 `data-dsh-backdrop-active` 置位时给该卡片加了
`backdrop-filter: blur(var(--dsh-input-card-blur, 10px))`（[backdrop-scene](../../implemented/architecture) 的 composer frost）。

对真实 GUI 的排查确认：滚动期间菜单本身是稳定的——`getBoundingClientRect()`
在各 rAF 采样中恒定，CDP 截取的菜单 bbox 像素也字节稳定。闪动是合成器重绘
伪影，而非布局变化。

根因。静态 `image` 壁纸（macOS Desktop Pictures 类型：host 把 HEIC 转成 JPEG，
例如通过 `skin-wallpaper.selection` 选中的用户照片）以一个普通 `<img>` 挂在
`position: fixed` 的 `mediaLayer` 内。`styleLayer` / `styleCover` 既不在层上也不
在图片上设置任何合成器提升属性，`applyCropTransform` 只在 `crop.scale > 1` 时
才加 `transform` / `willChange`。因此默认裁剪下，这张全视口图片不在独立合成器
层上。当对话滚动——或一个浮层菜单在带 backdrop-filter 的 composer 卡片上方
打开——Chromium 会以水平条带方式重新光栅化壁纸，重叠在上面的菜单被逐帧重绘
波及，表现为闪动。

`video` / `web` / `scene` 壁纸渲染为 `<video>` / `<iframe>`，Chromium 会自动将
其提升到独立合成器层，因此滚动时不会重新光栅化，也就不闪动。这与用户的差异
完全吻合：自定义图片闪动，默认（视频/场景）不闪动。

先例。skin background *装饰* 层早已这么做：`decoration-layers.ts` 把 background
层的 `cssText` 设为包含 `will-change:transform`，`skin-runtime.spec.ts` 的
issue #1013 测试记录了同一机制（"全视口皮肤背景图重新光栅化代价高昂；若没有
合成隔离，无关的重绘突发（流式对话、动画宠物、浮层菜单）会让 Chromium 以水平
条带重绘它，表现为竖向条带闪动。在层上保留 will-change，让光栅缓存常驻"）。
对壁纸承担相同全视口职责的 `mediaLayer`，缺少了同样的处理。

## Decision

在 `styleLayer` 中仅对 `media` 层设置 `will-change: transform`，把壁纸
`mediaLayer` 提升到独立合成器层。`scrim` 层（纯色暗化浮层）不提升：重绘纯色
代价可忽略，且没有需要缓存的图片。

## Testing

新增 `wallpaper.spec.ts` 测试 "isolates the media layer on its own compositor
layer (issue #1013)"，断言 `media.style.willChange === 'transform'` 且
`scrim.style.willChange === ''`。skin-center 全部 551 条测试通过；
`tsc -p tsconfig.json --noEmit` 干净。

验证缺口。在无头/有头 Playwright 下无法复现该闪动（合成器行为在真实浏览器之外
不以后一致）。本次修复依据是：代码差异（图片缺提升、video/iframe 天然提升）、
用户差异（自定义图片闪、默认不闪），以及同包内既有 issue #1013 对姐妹装饰层的
修复。改动需重新构建 skin-center 并重启 DSH 后才生效，须在用户真实浏览器中目视
验证。

## Alternatives considered

提升 `<img>` 子元素而非 `mediaLayer` 父层。否决：父层才是稳定的全视口表面，也是
装饰先例提升的对象；提升父层对 image / video / iframe 媒体统一缓存图片背景
（video/iframe 本就自动提升，此处一致且无害）。一处定位，一条规则。

用 `transform: translateZ(0)` 而非 `will-change: transform`。否决：
`WallpaperController.render()` 会动态写入 `mediaLayer.style.transform`（`blurValue > 0`
时为 `scale(1.05)`，否则 `''`），会覆盖掉 `translateZ`。`will-change` 不被 transform
赋值覆盖，且与 `decoration-layers` 先例完全一致。

在菜单打开时禁用 composer 卡片的 `backdrop-filter`。否决：在真实 GUI 的 A/B 中，
去掉 `data-dsh-backdrop-active` 并未减少菜单的像素变化，且会回退预期的毛玻璃效果。
根因在壁纸层，而非 frost 规则。

## Consequences

全视口壁纸 `mediaLayer` 现在占用一个独立合成器层并带缓存背景——多一个视口大小
的 GPU 纹理。此开销对 video/iframe 壁纸本就（因自动提升）实际存在，也与 skin
background 装饰层已有的开销相同。

域归属。`wallpaper.ts` 属于 Aa728848（EDDYCRAZY-CC）负责的 Wallpaper Engine /
渲染器域，见 CONTRIBUTING.md 与 .github/pr-review-routes.json。本次改动是镜像同包
既有 issue #1013 模式的一行提升；域负责人应 review。
