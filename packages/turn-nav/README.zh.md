# @linxin666/dsh-client-ui-turn-nav

[English](README.md) | 中文

DSH Web GUI 的轮次导航面板：长会话里直接跳到任意一轮对话，不用再逐页滚动。

纯浏览器插件，挂载到官方 `conversation.session.header.actions` 槽位——不改
任何 DSH 源码，host 侧零行为。

## 功能

- 在会话头部（标题操作区旁）新增一个**轮次导航**按钮，点击弹出当前会话的
  大纲浮层。
- **轮次大纲**：已加载的每一轮按最新在上排列，显示轮次编号、进行中的轮次
  带「进行中」标记、开始时间，以及该轮用户提问的两行预览。
- **点击跳转**：点击某一轮，聊天滚动区会平滑滚动到该轮第一条用户消息，
  并在目标行短暂闪烁高亮圈。
- **提问搜索**：过滤框对用户提问全文做大小写无关的子串匹配，长会话可以按
  关键词定位。
- **分页列表**：轮次每页显示 5 条，面板底部提供页码输入跳转（以及
  上一页/下一页按钮），大纲不会长成一长条滚动列表。打开面板时会先把
  全部历史翻页加载进来（运行时只暴露已加载窗口加一个 hasMore 布尔，
  没有总轮次字段），因此页码总数就是真实历史总量，翻页不再触发任何
  拉取。页码输入跳转在历史加载期间也始终可见（禁用、总数显示为“…”）；
  不足 5 条的末页会留出空白占位，使列表高度跨页保持稳定。
- 按 Esc、点击浮层外部或跳转成功后自动关闭。

## 范围与限制

- 面板只导航桌面版 Web GUI 中**当前打开的会话**。
- 只能滚动到**已加载**的历史页——DSH Web 客户端按需分页加载历史，更早的
  轮次需要先点底部「加载更早」（与内置聊天视图、轨迹视图一致）。
- 跳转目标是每轮第一条**普通用户消息**；插队消息（steering）和注入的
  上下文不是轮次开头，不会出现在列表中。
- 跳转使用官方聊天行锚点（`data-chat-anchor-key`）与
  `[data-conversation-scroll]` 滚动容器契约，除这些属性外不做 DOM 抓取，
  因此对各皮肤通用。

## 安装

从 npm 安装（推荐）：

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-turn-nav@latest
```

从仓库安装（开发调试）：

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:/path/to/dsh-web/packages/turn-nav
```

然后重启 `dsh web`（或等待热更新生效），打开任意会话即可在会话头部看到
轮次导航按钮。

## 开发

```sh
pnpm --filter @linxin666/dsh-client-ui-turn-nav typecheck
pnpm --filter @linxin666/dsh-client-ui-turn-nav test
pnpm --filter @linxin666/dsh-client-ui-turn-nav build
```

## 许可证

BSD-3-Clause
