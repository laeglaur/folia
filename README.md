# folia

[中文介绍与开发说明](README.zh-CN.md) · [English overview and development](README.en.md) · [使用说明 / User guide](docs/USER_GUIDE.md)

folia 是一个本地优先的块状笔记应用，基于 Tauri、React 和 TipTap。支持嵌套页面、混合列表、终端富文本、桌面卡片与 macOS 小组件，并将外壳和正文主题分开设置。

folia is a local-first, block-based notebook built with Tauri, React, and TipTap, with nested pages, mixed lists, styled terminal snippets, desktop cards, and macOS widgets. Shell and content themes are configured separately.

[![观看介绍视频 / Watch the demo](docs/assets/demo-cover.png)](https://www.bilibili.com/video/BV1sZMA6zELk/)

视频展示较早版本；当前操作以随应用提供的[使用说明](docs/USER_GUIDE.md)为准。The video shows an earlier version; the bundled guide describes current behavior.

## 开始使用 / Get started

打开 folia 后：

1. 在左侧选择或新建一个 Notebook。
2. 按 `Ctrl/Cmd+N` 新建页面。
3. 在正文中输入文字，按 `Shift+Enter` 保存为一个 block。
4. 双击页面标题重命名；点击 block 日期，将它固定到 Pinned。
5. 点击左下角的小鱼，切换主题、背景和装饰。

最常用的输入语法：

```text
**粗体**       ==高亮==       `行内代码`       ~~删除线~~
- 无序列表    1. 编号列表    [] 待办列表       > 引用
```

页面、Notebook 和 Pinned 卡片都可以右键操作。图片、表格、任务列表、日历、Markdown 导入导出、页面历史和回收站等功能按需使用；完整快捷键见[使用说明](docs/USER_GUIDE.md)。

After opening folia:

1. Select or create a Notebook in the sidebar.
2. Press `Ctrl/Cmd+N` to create a page.
3. Type in the editor and press `Shift+Enter` to save a block.
4. Double-click the page title to rename it; click a block date to pin it.
5. Open the fish menu to change themes, backgrounds, and decorations.

Common inline and block syntax:

```text
**bold**       ==highlight==       `inline code`       ~~strikethrough~~
- bullet list  1. ordered list    [] task list        > quote
```

Use the context menu on pages, Notebooks, and Pinned cards for more actions. The [user guide](docs/USER_GUIDE.md) contains the complete shortcut reference.

## 当前功能 / Current features

- 推荐外壳 / Recommended shells: **Tilted Paper**（留白与倾斜纸框 / airy, tilted paper）和 **Paper Collage**（亚麻与纸张拼贴 / linen and paper collage）。
- 基础选择 / Other shells: Typora Base（基础商务风 / minimal business style）、Garden Typora（基础布局的轻度变化 / a modest layout variation）及 Native Garden。
- 小鱼 → 外观调整：独立切换主题、设置背景 URL 或本地图片，双击编辑纸张题字。Fish → Appearance: theme selection, URL/local backgrounds, and editable captions.
- 日历视图、点击日期收藏、图片插入与标注、表格增删行列及列宽调整 / Calendar views, date-click pinning, image annotation, and table editing.
- 同一缩进树混用待办、编号和普通列表 / Mixed task, ordered, and bullet lists.
- iTerm2 普通粘贴或保留颜色粘贴，并可继续编辑 / Normal or styled iTerm2 paste with editable text and formatting.
- SQLite 本地笔记、Markdown 导入导出、JSON 备份、页面历史和回收站 / Local SQLite notes, Markdown import/export, JSON backup, history, and trash.
- 桌面浮窗与 macOS 只读小组件 / Floating editor windows and read-only macOS widgets.

## 首次安装后无法打开？

当前安装包尚未经过 Apple 公证。若出现 **Apple 无法验证“folia”是否包含可能危害 Mac 安全或泄漏隐私的恶意软件**：

1. 将 folia 拖入 **Applications（应用程序）**，先尝试打开一次。
2. 出现上述弹窗后，点击 **问号**，在帮助中选择 **为我打开“隐私与安全性”设置**。
3. 在 **安全性** 区域找到 folia 的拦截提示，点击 **仍要打开**（或对应的允许按钮），按提示确认身份并打开。

也可手动进入 **系统设置 → 隐私与安全性** 完成第 3 步；不同 macOS 版本的按钮文字可能略有不同。仅对从本仓库下载、且你信任的安装包这样操作。若提示明确为“包含恶意软件”“将损坏电脑”或“已损坏”，请先反馈具体提示，不要按此流程绕过。

## 文档 / Documentation

- [完整使用说明与快捷键（中文）](docs/USER_GUIDE.md)
- [终端片段保存格式与兼容性](docs/terminal-paste.md)
- [默认素材与构建资产](docs/theme-assets.md)
- [开发、打包及发布（中文）](README.zh-CN.md#开发与打包) / [Development and packaging](README.en.md#development-and-packaging)
- [演示数据库切换](docs/demo-database.md)

源码推送不会自动发布安装包。当前主要支持 macOS；WidgetKit 小组件需要桌面版及包含扩展的安装包。Pushing source does not publish an installer; WidgetKit requires the macOS desktop bundle with its extension embedded.
