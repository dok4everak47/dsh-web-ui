# Agent Note: skin-center 分页省略号渲染成字面 \u2026 转义

Status: implemented

## Problem

Skin Center 壁纸分页器的省略号占位（当一个分组超过 7 页时出现）渲染成了
字面的六字符文本 `\u2026`，而不是 `…` 字符。用户在页码行看到的是 `\u2026`。

原因是 JSX 文本的坑：`WallpaperPanel.tsx` 把省略号写成
`<span ...>\u2026</span>`。JSX 标签之间的文本是字面量，**不处理反斜杠转义**，
于是 `\u2026` 原样暴露。编译产物里带着这六字符字符串，DOM 也照原样显示。
`locales.ts` 的字符串不受影响，因为那里的 `…` 在 JS 字符串字面量内，转义和
原始非 ASCII 都能正确解析。

## Decision

把 JSX 文本 `\u2026` 改成 JS 字符串表达式 `{'\u2026'}`，转义在此会被处理成
真正的字符。`…` 是标点（非 emoji），符合 no-emoji 规则。

## Testing

新增 `wallpaper-panel.spec.tsx` 测试：渲染 90 个 image 项（同属一个 folder
组，`PAGE_SIZE` 12 下共 8 页，`pageRange` 会产出 `0` 占位），展开分组，断言
DOM 文本含真正的 `…`（`'\u2026'`）且不含字面转义（`'\\u2026'`）。skin-center
全部 552 条测试通过；`tsc -p tsconfig.json --noEmit` 干净；重建后的
`lib/client.js` 不再含字面 `\u2026`。

## Alternatives considered

在 JSX 文本里直接写原始 `…` 字符。仅因保持源码 ASCII、用转义自注释化非
ASCII 意图而未采用；原始字符同样正确，且与 `locales.ts` 一致，日后编辑者可
在不改变行为的前提下换成它。

用 `&hellip;` HTML 实体。否决：相对文件里已有的 `{ }` 表达式不够地道，且
JSX 文本实体在此是更少见的写法。

## Consequences

分页器现在在缺口位置显示 `…`。除该字形外无行为变化。
