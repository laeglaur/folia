# folia

[首页](README.md) · [English](README.en.md) · [完整使用说明](docs/USER_GUIDE.md)

folia 是一个本地优先的块状笔记应用，基于 Tauri、React 和 TipTap。桌面版使用 SQLite 保存笔记；网页开发预览不等同于桌面版的数据库和系统功能。

## 记录与组织

- 在顶部“写点什么”输入，按 Shift+Enter 保存为独立 block；已保存块可继续编辑、排序、折叠和收藏。
- Notebook / Page 树支持嵌套、图标、多选、移动、复制和独立窗口。笔记本默认折叠。
- Cmd+N 在选中的笔记本创建顶层空白页；未选中笔记本时使用当前页所属笔记本。
- 同一列表树可混用待办、普通 bullet 和编号。行首输入 `[] `、`- `、`1. ` 转换当前项，Tab / Shift+Tab 调整层级。
- 支持表格、数学公式、脚注、引用、代码块、附件、音视频、图片缩放及标注。
- 左栏搜索笔记；Cmd+F 查找当前页。右栏统一称为 Contents，列表项是否出现在其中可在小鱼菜单切换。

## 主题与外观

推荐先试 **Tilted Paper** 和 **Paper Collage**：前者用留白和倾斜纸框营造轻松的书写空间，后者突出亚麻、毛边纸张与拼贴装饰。两者都能搭配不同的正文主题。

**Typora Base** 是最基础、简洁的商务风；**Garden Typora** 仅在基础布局上做轻度变化，适合偏好克制外观的用户。

小鱼 → **外观调整** 打开可拖动面板，设置时可查看页面变化。

| Shell | 外观与设置 |
| --- | --- |
| Tilted Paper（推荐） | 三个上沿倾斜的纸框、独立纸色和阴影、背景与左下图片 |
| Paper Collage（推荐） | 亚麻背景、叠层毛边纸、挂画、胶带与树叶装饰 |
| Typora Base | 基础商务风，简洁的 Typora 外壳 |
| Garden Typora | 基础布局的轻度变化，支持背景设置 |
| Native Garden | 原生笔记布局，全画面背景颜色、图片与透明度 |

Typora 系列可独立选择正文主题，如 Proof、Swiss、Folio、Everforest、Torillic、Paperglow 等。两款纸张外壳保留自己的纸面；正文主题负责文字排版。纸色可跟随正文主题，包括暗色主题。

图片设置支持 URL 或选择本地图片。不同 Shell 分别保存设置。顶部文字双击编辑、位置固定；纸张外壳的左下文字和右侧题字可双击编辑，并通过边框移动、角点缩放、圆点旋转。Tilted 题字和署名在同一文本框内。

## iTerm2 原样片段

在 iTerm2 使用 Cmd+Option+C 复制带样式的输出：Cmd+V 普通粘贴，Cmd+Option+V 保留颜色和格式。双击片段后可修改文字、字号、文字色、底色、粗体、斜体、下划线及删除线；高亮预设同时设置文字和底色。

桌面版支持 HTML / RTF；浏览器依赖 HTML 剪贴板和读取权限。JSON 备份保留格式，Markdown 导出为无颜色的代码块。详见[使用说明](docs/USER_GUIDE.md)和[保存格式](docs/terminal-paste.md)。

## 卡片与小组件

侧栏收藏可打开为桌面浮窗。macOS 的 folia Block 小组件是另一种只读预览，可展示文字、图片和终端片段颜色；长内容会截断，不能在系统小组件内滚动或直接编辑。搜索入口可更换展示的 block，完整窗口入口可打开独立编辑窗口。内容变化会同步，但刷新时间由 macOS 调度。

## 导入、备份与恢复

从访达打开 Markdown，或在小鱼中使用 Import MD / Import folder。文件夹导入支持页面链接、wiki link、frontmatter、任务、公式和媒体。

Markdown 用于通用内容导出；Backup 导出笔记数据，保留终端片段格式。页面历史和 Trash 可恢复内容。外观偏好单独保存在本机，不应把 JSON 笔记备份当作整个应用环境的备份；桌面数据迁移也应保留数据库与媒体资源目录。

## 开发与打包

需要 Node.js、pnpm、Rust 和 Tauri 2 的平台依赖。macOS 小组件构建另需完整 Xcode、Xcode 命令行工具及 XcodeGen。

```bash
pnpm install
pnpm dev             # 浏览器开发预览
pnpm tauri:dev       # 桌面开发（另一个入口，不要与前者争用端口）
```

网页构建：`pnpm build`。完整 macOS 安装包：

```bash
pnpm tauri:build
bash src-tauri/macos-widget/embed-widget.sh
```

第一步的 beforeBundleCommand 编译 WidgetKit 扩展；第二步将扩展嵌入 app、签名并生成包含扩展的 DMG，不能省略。默认使用本地 ad-hoc 签名，不代表已完成 Developer ID 签名或公证。

输出位于 `src-tauri/target/release/bundle/macos/folia.app` 和 `src-tauri/target/release/bundle/dmg/`。将 app 安装至 Applications 后启动，再通过系统“编辑小组件”添加 folia Block。源码推送不会自动生成 GitHub Release；发布时需单独构建、验证并上传安装包。

```bash
pnpm exec tsc --noEmit
pnpm test:editor
pnpm test:view-model
pnpm test:markdown
pnpm test:markdown-folder
pnpm test:theme
pnpm test:persistence
```

编辑器浏览器检查需要先启动开发服务器。默认主题素材随源码提交，生成资产和构建产物的区别见[素材说明](docs/theme-assets.md)。`docs/progress.md`、审计报告和 `docs/superpowers/` 是历史设计或开发记录，不是当前操作手册。
