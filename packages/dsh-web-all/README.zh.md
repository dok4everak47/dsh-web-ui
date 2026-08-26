# @linxin666/dsh-web-all

[English](README.md) | 中文

DSH Web UI 全家桶聚合插件：一键安装全部功能插件（task-board / git-graph / pet / remote-web-ui / web-ui-settings / skin-center / community-plugins / aionui-panel），外加外部插件 `dsh-better-sidebar`（右侧面板）与 `@mlgbnb/dsh-archive-manager`（设置页归档管理）以及皮肤全家桶（`dsh-skins`，皮肤资产内置）。compat 桥接层已并入本包（`src/client`），因此无需独立的 compat npm 包。

## 是什么

- **一次安装、全部到位**：其 dependencies 引入全部子插件包（dsh-client-ui-aionui-panel / dsh-client-ui-task-board / dsh-client-ui-git-graph / dsh-pet / dsh-remote-web-ui / dsh-ssh / dsh-client-ui-web-ui-settings / dsh-client-ui-skin-center / dsh-client-ui-community-plugins / dsh-skins），外加外部 npm 插件 `dsh-better-sidebar`（默认右侧面板：文件资源管理器 / 编辑器 / 终端 / Git / 浏览器）与 `@mlgbnb/dsh-archive-manager`（默认设置页归档管理：按项目分组、搜索筛选、预览对话、一键恢复与删除）。
- **聚合载具**：`cordis.patch.yml` 汇总各子插件的 `insert` 行与外部 `dsh-better-sidebar`、`@mlgbnb/dsh-archive-manager` 行，经 dsh 插件 profile 机制挂载。
- **右侧面板**：右侧面板固定为 `dsh-better-sidebar`（aionui-panel 已不可启用）。设置 → Web UI 插件 → 侧边卡片 声明右侧面板来自 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 并内嵌其常用设置。
- **侧边栏折叠记忆**：compat 桥接层会把左侧侧边栏的折叠/展开状态记到 localStorage——因为 dsh shell 自身只把折叠状态放在临时 React store 里，每次加载默认展开。重新加载已收起的会话时，聚合包会在模块导入时（shell 保证这一步早于布局 frame 的首帧绘制）注入一段渲染阻塞样式，用 `!important` 把外框网格强制成 56px 的 rail 宽度。因此外框首帧就是收起的：既没有先展开的首帧，也没有之后的收起动画。等 shell 自己提交收起态（frame 出现 `data-sidebar-collapsed`）后移除该样式，交给 shell 自身样式接管，计算出的仍是完全相同的 rail 几何；随后运行时调用一次 `toggleSidebar()` 把 React store 与画面状态对齐。存储键名为 `dsh:sidebar-collapsed`；清除站点数据后，下次加载侧边栏会回到 shell 默认状态（展开）。加载前把 localStorage 的 `dsh:sidebar-memory` 设为 `off` 可关闭该功能。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-web-all@latest
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
node scripts/link-profile.mjs
dsh plugin --profile web add link:$(pwd)/packages/dsh-web-all
```

安装后重启 `dsh web` 使插件生效。

### 手工升级

在 profile 的 `package.json` 中改版本后执行 `pnpm install`，顶层 `node_modules/@linxin666/*` 条目不会总是被刷新：它们可能仍链接到旧版本的 store 目录，直到手动重建。升级后请确认这些链接已指向新版本目录（Windows 下：先 `cmd /c rmdir <链接>` 再 `cmd /c mklink /J <链接> <目标>`），然后重启 `dsh web`。

## 故障排查

### "Failed to load plugins ... keyed slot `settings.plugin.item` requires options.key"（DSH 0.1.0-rc.6+）

聚合包内置的 `dsh-client-ui-web-ui-settings` 0.1.17 及更早版本把组卡片注册进 keyed 槽 `settings.plugin.item` 时传的是 `id` 而不是必填的 `key`（其他全家桶插件此前已注册进该组的 list 槽）；DSH 0.1.0-rc.6 起在 loader entry 应用阶段直接拒绝这种注册，Web GUI 因此以 "Failed to load plugins" 启动失败。

0.1.18 起该组改为一级 `settings.section` 注册，0.2.0 已发布；`main` 上的代码与 rc.6 / rc.7 兼容。仍在报错的 profile 带的是冻结的旧安装：

1. 把 profile `package.json` 里所有 `@linxin666/*` 依赖升到 `^0.2.0`（至少 `^0.1.18`）。
2. 重装 profile 依赖（`pnpm install`），并按上文「手工升级」重建陈旧的 `node_modules/@linxin666/*` 链接。
3. 重启 `dsh web`。

参见 [issue #513](https://github.com/zhu1090093659/dsh-web/issues/513)。

## 已知限制

- 各子插件随本包一起激活；若只需要其中一部分，请直接安装对应子插件包。
- 聚合行 id 统一带 `web-ui-` 命名空间，本包可与同名独立插件包共存：loader 不再拒绝重复 id，host 半区只注册一次（第二个来源为空操作），浏览器半区按包名去重。两个来源并存没有额外收益，建议只保留一个。插件来自本包时，profile 里按 id 写的配置行要改用 `web-ui-` 前缀（如 remote-web-ui 的 `autoTunnel` 配置行写成 `web-ui-remote-web-ui`）；独立安装时仍用插件原 id。
- `dsh-better-sidebar` 与 `@mlgbnb/dsh-archive-manager` 是外部 npm 依赖（均非本仓库出品），本包发版前必须先发布它们（发布顺序见 `docs/publish-prep.md`）。
- 依赖的 `@deepseek-ai/*` SDK 版本已锁定，兼容性跟随本仓库的发版节奏。
