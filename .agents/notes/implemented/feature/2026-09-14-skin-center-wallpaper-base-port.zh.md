# Agent Note: 把 fork 的 Skin Center 壁纸工作重放到上游 dev 基线上

Status: implemented

## Problem

Skin Center fork 上带着 17 个上游从未收到的本地提交：手动裁剪编辑器、按文件夹分组并逐组分页与折叠的网格、名称/id/类型搜索、原生比例缩略图、页码跳转输入，以及若干生命周期修复。它们所在的基线落后 `dev` 770 个提交，而 dsh 0.1.5 的 SDK 删除了该基线所编译的 settings API，导致这个包在升级后的 harness 里无法加载：除了逐个重放，唯一的选择就是丢掉这些工作。

## Decision

这 17 个提交以一次压缩补丁的形式重放到 `dev` 上。六个文件冲突，每个都按"保留拥有较新契约的一方"解决：

- `src/client/runtime/shell-rendering.ts`：上游实现取代了 fork 较早的 caret 滚动修复，且承载同样意图，因此丢弃 fork 版本。
- `src/client/WallpaperPanel.tsx`、`src/client/skin-center.module.css`、`tests/wallpaper-panel.spec.tsx`：以 fork 的分组、可折叠、逐组分页并带搜索的网格作为出厂网格；上游的内容分级过滤并入其中，作为作用于同一份条目列表的额外维度。
- `src/we-library.ts`：双方的新增都保留（已用图片 stem 记录与 `contentrating` 字段）。
- `tests/skin-runtime.spec.ts`：删除 `--dsh-skin-scrim` 测试。上游已用 `runtime/backdrop-scene.ts` 中的 `data-dsh-backdrop-active` 标记取代该变量，并自带了对应测试。
- `README.i18n.yaml`：合并后用 `node scripts/verify-docs.mjs --write` 重新记录。

合并本身带来两个移植决定：

- `WallpaperItem` 恢复 fork 版本丢掉的 `rating?: 'g' | 'pg13' | 'r18'` 字段，因为 host 的清单里带着它。
- 评级过滤除 `G` / `PG-13` / `R18` 外提供 `All`，且默认 `All`。上游默认 `G`；若默认 `G`，fork 的手动库文件夹里按标题推导为 `r18` 的壁纸会被隐藏，看起来像素材库丢了而不是被过滤。

## Testing

`pnpm --filter @linxin666/dsh-client-ui-skin-center run typecheck` 通过。包测试在 40 个文件里通过 650 条，包含新增的评级过滤用例，覆盖 `All` 默认、收窄到单一评级、以及无评级条目回退到 `'g'`。`pnpm i18n:check`、`pnpm docs:check`、`pnpm libs:check`、`pnpm skin-center:check` 均通过；Skin Center 不在 ru 字典清单内，因此移植的键不需要 ru 条目。

## Alternatives considered

- 逐个 rebase fork 的 38 个提交：否决，因为其中 21 个触及无关包，会成倍增加冲突处理量却不改善结果。
- 放弃 fork 的面板、直接采用上游网格：否决，因为手动裁剪编辑器在上游没有对应实现，而它正是 fork 存在的主要理由。
- 用开关同时保留两套网格：否决，因为一个面板里两套分页模型会让状态机与测试背负没有任何消费者需要的兼容路径。

## Consequences

- fork 的壁纸界面在 0.1.5 API 上重新可用，并继承其周边更新的上游行为（统一背景场景、装饰层、macOS 格式校验、内容分级）。
- 上游的全局每页 24 条分页移除，逐组分页成为唯一模型。
- fork 在分支上跟随上游 `dev`，不再是落后 770 个提交的基线，下一次上游同步是普通合并。
