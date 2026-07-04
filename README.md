# folia

<p align="right">
  <a href="#中文">中文</a> | <a href="#english">English</a>
</p>

## 中文

folia 是一个本地优先的块状笔记应用，基于 Tauri、React 和 TipTap 构建。它适合快速记录、Markdown 写作、桌面便签卡片、图片标注，以及使用 Typora 风格主题阅读正文。

### 功能概览

- 块状笔记：先在顶部输入框记录，再保存成独立 block。
- 本地存储：桌面版使用 SQLite 保存数据。
- Notebook / Page 树：支持嵌套页面、图标、多选、移动、复制、删除和独立页面窗口。
- 收藏卡片：可以把 block 收藏到侧栏，并打开为置顶桌面浮窗。
- Markdown 支持：可打开 `.md`、`.markdown`、`.txt`，也可以临时查看后再导入。
- 文件夹导入：支持 Markdown 文件夹、frontmatter、wiki link、页面链接、任务、数学公式、脚注、提示块和媒体资源。
- Typora 正文主题：内置 Proof、Swiss、Folio、Flexoki、Gruvbox、Chocolate Box、Torillic、Everforest、Paperglow、LaTeX 等主题。
- Shell 外观：支持 Native Garden、Typora Base、Garden Typora。
- 搜索与导航：支持全局页面搜索、当前页搜索、outline 和页面缩略图。
- 粘贴清理：针对网页、论文和 LLM 输出做了清理，尽量移除脏 span、转义 HTML、数学 HTML 和空代码块占位。
- 图片编辑：支持插入本地图片、缩放、缩进/反缩进和内置图片标注。
- 富文本能力：支持表格、行内公式、块级公式、脚注、键帽、代码块、引用、todo、附件、音视频嵌入和日期插入。
- 元数据与日历：支持 page metadata 和 notebook calendar view。
- 外部卡片调用：支持 `.notecard` 文件，方便桌宠或其他工具打开某个 page 的新 block 浮窗。

### 使用方式

1. 在左侧栏创建 notebook 和 page。
2. 在页面顶部输入框里写内容。
3. 按 `Shift+Enter` 或点击 `Add block`，把草稿保存成 block。
4. 点击 block 日期可以收藏或取消收藏。
5. 点击收藏卡片可以打开桌面浮窗。
6. 右键 page 可以设置图标、单独开窗、移动、收藏首个 block。
7. 拖动 block 左侧轨道可以调整顺序。
8. 从访达打开 Markdown，或在应用内使用 `Import MD` / `Import folder` 导入。

### Sidebar

- 左栏管理 notebook、page、缩略图和收藏 block。
- Page 支持嵌套层级、图标、多选和右键菜单。
- 右键 page 可执行 `Set Icon`、`Open in Window`、`Move...`、`Pin First Block`。
- `Shift+click` 可连续选择同层 page，`Cmd/Ctrl+click` 可切换多选。
- 收藏 block 会出现在侧栏下方，并可打开为桌面卡片。

### 正文编辑

- 页面顶部是 composer，适合快速输入新 block。
- 已保存的 block 可以单独编辑、拖拽排序、收藏、打开为浮窗。
- 选中文本后可使用浮动 toolbar；如果关闭 toolbar 开关，右键不会呼出 toolbar。
- 图片可以缩放、缩进/反缩进，也可以打开内置图片标注工具。
- Typora 正文主题只影响正文阅读和编辑区域，shell 主题影响左右栏和整体框架。

### 小鱼 / Desk

- 右下角小鱼是桌面控制入口。
- 可切换 toolbar、metadata、排序、outline、sidebar、shell theme 和 content theme。
- 可导入 Markdown 文件或文件夹，也可导出 Markdown / JSON。
- Trash 区可恢复最近删除内容。

### 主题

folia 把主题分成两层：

- Content theme：正文主题，来自 Typora 风格 CSS，例如 Proof、Swiss、Folio、Everforest、Torillic、LaTeX。
- Shell theme：应用外壳，例如 Native Garden、Typora Base、Garden Typora。

推荐组合：

- Native Garden + notebook：更像安静的本地笔记应用。
- Typora Base + Typora content theme：更接近 Typora 的阅读和写作体验。
- Garden Typora + Typora content theme：保留 Typora 正文，同时使用更轻的悬浮左右栏。

### Markdown 输入规则

更完整的编辑器快捷键和自动触发规则见 [docs/editor-shortcuts.md](docs/editor-shortcuts.md)。

| 输入 | 效果 |
| --- | --- |
| `[] ` 或 `【】 ` | todo |
| `- [ ] ` / `- [x] ` | 默认任务列表 |
| `- ` / `+ ` / `* ` | 无序列表 |
| `1. ` | 有序列表 |
| `# ` 到 `###### ` | 标题 |
| `> ` 或 `/quote ` | 引用块 |
| `` ``` `` 或 `/code ` | 代码块 |
| `$$ ` 或 `/math ` | 块级公式 |
| `$a+b$` | 行内公式 |
| `/table ` 或 `[[[ ` | 3x3 表格 |
| `/link ` | 插入链接或媒体 URL |
| `/at ` | 插入本地附件 |
| `/date ` | 插入当前日期时间 |
| `**text**` 或 `__text__` | 加粗 |
| `*text*` 或 `_text_` | 斜体 |
| `` `code` `` | 行内代码 |
| `~text~` | 下划线 |
| `~~text~~` | 删除线 |
| `---` / `___ ` / `*** ` | 分割线 |

容易记错的点：

- `-text-` 不会触发删除线。
- 删除线的自动触发写法是 `~~text~~`。
- `$text$` 是行内公式。
- 公式块是 `$$` 或 `/math`。

### 快捷键

macOS 使用 `Cmd`，Windows/Linux 使用 `Ctrl`。

| 快捷键 | 功能 |
| --- | --- |
| `Cmd/Ctrl+F` | 搜索当前页 |
| `Cmd/Ctrl+[` | 显示/隐藏左侧栏 |
| `Cmd/Ctrl+]` | 显示/隐藏 outline / 右侧抽屉 |
| `Cmd/Ctrl+B` | 加粗 |
| `Cmd/Ctrl+I` | 斜体 |
| `Cmd/Ctrl+U` | 下划线 |
| `Cmd/Ctrl+D` | 删除线 |
| `Cmd/Ctrl+E` | 行内代码 |
| `Cmd/Ctrl+H` | 高亮 |
| `Cmd/Ctrl+Alt+1..6` | 标题 1 到标题 6 |
| `Cmd/Ctrl+Alt+0` | 普通段落 |
| `Cmd/Ctrl+Shift+7` | 有序列表 |
| `Cmd/Ctrl+Shift+8` | 无序列表 |
| `Shift+Enter` | 在 composer 中保存为 block；在 block / 卡片中保存并退出编辑 |
| `Tab` | 缩进列表项或选中的图片 |
| `Shift+Tab` | 反缩进列表项或选中的图片 |
| `Cmd/Ctrl+ArrowUp` | 当前 block 上移 |
| `Cmd/Ctrl+ArrowDown` | 当前 block 下移 |
| `Cmd/Ctrl+Backspace` | 删除当前 block 或选中的 page |

### 安装

普通使用时，从 GitHub Release 下载 macOS DMG，然后把 `folia.app` 拖进 `Applications`。

当前本地打包产物路径：

```txt
src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg
src-tauri/target/release/bundle/macos/folia.app
```

如果 macOS 因为应用未签名而阻止打开，可以在访达里右键 `folia.app`，选择“打开”；也可以到“系统设置 -> 隐私与安全性”里允许打开。

### 开发

依赖：

- Node.js 和 pnpm
- Rust toolchain
- 当前平台的 Tauri 2 依赖

```bash
pnpm install
pnpm dev
pnpm tauri:dev
```

构建：

```bash
pnpm build
pnpm tauri:build
```

常用检查：

```bash
pnpm exec tsc --noEmit
pnpm test:editor
pnpm test:view-model
pnpm test:markdown
pnpm test:markdown-folder
pnpm test:theme
pnpm test:persistence
```

`pnpm test:editor` 需要先启动 `http://127.0.0.1:5173/` 的开发服务器。

录制截图或短视频时，可以用 [docs/demo-database.md](docs/demo-database.md) 里的脚本切换到干净的演示数据库。

### 发布

1. 把源码推到 GitHub。
2. 运行 `pnpm tauri:build`。
3. 创建 GitHub Release。
4. 上传 `src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg`。

### 注意

- 目前主要面向 macOS。
- 上面的本地安装包是 Apple Silicon (`aarch64`) 版本。
- 应用暂时还没有签名和 notarize。
- 打包产物、生成的 Typora assets、Tauri target 不会提交到 git。

<p align="right"><a href="#folia">回到顶部</a></p>

---

## English

folia is a local-first, block-based notebook built with Tauri, React, and TipTap. It is designed for quick capture, Markdown-friendly writing, pinned desktop cards, image annotation, and Typora-style reading themes.

### Features

- Block-first notes: write in the composer, then save the draft as an independent block.
- Local persistence: the desktop app stores data in SQLite.
- Notebook and page tree: nested pages, icons, multi-select, move, duplicate, delete, and separate page windows.
- Pinned cards: pin a block into the sidebar and open it as an always-on-top desktop card.
- Markdown support: open `.md`, `.markdown`, and `.txt` files, or inspect them temporarily before importing.
- Folder import: supports Markdown folders, frontmatter, wiki links, page links, tasks, math, footnotes, alerts, and media assets.
- Typora content themes: includes Proof, Swiss, Folio, Flexoki, Gruvbox, Chocolate Box, Torillic, Everforest, Paperglow, LaTeX, and more.
- Shell styles: Native Garden, Typora Base, and Garden Typora.
- Search and navigation: global page search, current-page find, outline, and page thumbnails.
- Paste cleanup: cleans noisy web, paper, and LLM output, including dirty spans, escaped HTML, math HTML, and empty code block placeholders.
- Image tools: insert local images, resize, indent/outdent, and annotate with the built-in image editor.
- Rich writing tools: tables, inline math, block math, footnotes, keyboard-key marks, code blocks, quotes, todos, attachments, audio/video embeds, and date insertion.
- Metadata and calendar: page metadata and notebook calendar views.
- External card requests: `.notecard` files can be used by companion tools to open a new block card for a page.

### Basic Use

1. Create a notebook and page from the left sidebar.
2. Write in the composer at the top of the page.
3. Press `Shift+Enter` or click `Add block` to save the draft as a block.
4. Click a block date to pin or unpin it.
5. Click a pinned card to open it as a floating desktop card.
6. Right-click pages for Set Icon, Open in Window, Move, and Pin First Block.
7. Drag blocks by their left rail to reorder them.
8. Open Markdown files from Finder, or use `Import MD` / `Import folder` inside the app.

### Sidebar

- The left sidebar manages notebooks, pages, thumbnails, and pinned blocks.
- Pages support nesting, icons, multi-select, and context menus.
- Page context menu actions include `Set Icon`, `Open in Window`, `Move...`, and `Pin First Block`.
- `Shift+click` selects a continuous sibling range. `Cmd/Ctrl+click` toggles page selection.
- Pinned blocks appear near the bottom of the sidebar and can open as desktop cards.

### Editor

- The top composer is optimized for quick new blocks.
- Saved blocks can be edited, reordered, pinned, and opened as floating cards.
- The floating toolbar appears from selected text when toolbar mode is enabled.
- Images can be resized, indented/outdented, and edited with the built-in annotation tool.
- Typora content themes affect the editor and reading surface. Shell themes affect sidebars and the app frame.

### Desk

- The fish button in the bottom-right opens Desk controls.
- Desk can toggle toolbar, metadata, sorting, outline, sidebar, shell theme, and content theme.
- It also exposes Markdown import/export, JSON export, and Trash restore actions.

### Themes

folia separates themes into two layers:

- Content theme: Typora-style reading and writing CSS, such as Proof, Swiss, Folio, Everforest, Torillic, and LaTeX.
- Shell theme: app chrome, such as Native Garden, Typora Base, and Garden Typora.

Recommended combinations:

- Native Garden + notebook: a quiet local notebook experience.
- Typora Base + Typora content theme: closest to Typora reading and writing.
- Garden Typora + Typora content theme: Typora content with lighter floating side panels.

### Markdown Input Rules

See [docs/editor-shortcuts.md](docs/editor-shortcuts.md) for the fuller editor shortcut and input-rule reference.

| Type | Result |
| --- | --- |
| `[] ` or `【】 ` | todo item |
| `- [ ] ` / `- [x] ` | default task list |
| `- ` / `+ ` / `* ` | bullet list |
| `1. ` | ordered list |
| `# ` to `###### ` | headings |
| `> ` or `/quote ` | block quote |
| `` ``` `` or `/code ` | code block |
| `$$ ` or `/math ` | block math |
| `$a+b$` | inline math |
| `/table ` or `[[[ ` | 3x3 table |
| `/link ` | insert a link or media URL |
| `/at ` | insert a local attachment |
| `/date ` | insert current date and time |
| `**text**` or `__text__` | bold |
| `*text*` or `_text_` | italic |
| `` `code` `` | inline code |
| `~text~` | underline |
| `~~text~~` | strikethrough |
| `---` / `___ ` / `*** ` | horizontal rule |

Common gotchas:

- `-text-` does not trigger strikethrough.
- Use `~~text~~` for strikethrough.
- `$text$` creates inline math.
- Use `$$` or `/math` for block math.

### Shortcuts

`Cmd` on macOS maps to `Ctrl` on Windows/Linux.

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+F` | Find inside the current page |
| `Cmd/Ctrl+[` | Toggle left sidebar |
| `Cmd/Ctrl+]` | Toggle outline / right drawer |
| `Cmd/Ctrl+B` | Bold |
| `Cmd/Ctrl+I` | Italic |
| `Cmd/Ctrl+U` | Underline |
| `Cmd/Ctrl+D` | Strikethrough |
| `Cmd/Ctrl+E` | Inline code |
| `Cmd/Ctrl+H` | Highlight |
| `Cmd/Ctrl+Alt+1..6` | Heading 1 to heading 6 |
| `Cmd/Ctrl+Alt+0` | Normal paragraph |
| `Cmd/Ctrl+Shift+7` | Ordered list |
| `Cmd/Ctrl+Shift+8` | Bullet list |
| `Shift+Enter` | Save the composer as a block, or save and leave block/card editing |
| `Tab` | Indent list item or selected image |
| `Shift+Tab` | Outdent list item or selected image |
| `Cmd/Ctrl+ArrowUp` | Move current block up |
| `Cmd/Ctrl+ArrowDown` | Move current block down |
| `Cmd/Ctrl+Backspace` | Delete current block or selected page |

### Install

For normal use, download the macOS DMG from a GitHub Release and drag `folia.app` into `Applications`.

Current local build output:

```txt
src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg
src-tauri/target/release/bundle/macos/folia.app
```

If macOS blocks the app because it is unsigned, open `folia.app` from Finder with right click -> Open, or allow it in System Settings -> Privacy & Security.

### Development

Requirements:

- Node.js and pnpm
- Rust toolchain
- Tauri 2 prerequisites for your platform

```bash
pnpm install
pnpm dev
pnpm tauri:dev
```

Build:

```bash
pnpm build
pnpm tauri:build
```

Useful checks:

```bash
pnpm exec tsc --noEmit
pnpm test:editor
pnpm test:view-model
pnpm test:markdown
pnpm test:markdown-folder
pnpm test:theme
pnpm test:persistence
```

`pnpm test:editor` expects the dev server at `http://127.0.0.1:5173/`.

For screenshots or short videos, use the helper in [docs/demo-database.md](docs/demo-database.md) to switch to a clean demo database.

### Release

1. Push the source code to GitHub.
2. Run `pnpm tauri:build`.
3. Create a GitHub Release.
4. Upload `src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg`.

### Notes

- The app is currently macOS-oriented.
- The local bundle above is for Apple Silicon (`aarch64`).
- The app is not signed or notarized yet.
- Build artifacts, generated Typora assets, and Tauri targets are ignored by git.

<p align="right"><a href="#folia">Back to top</a></p>
