# folia

folia is a local-first, block-based notebook built with Tauri, React, and TipTap. It is designed for fast capture, Markdown-friendly writing, pinned desktop cards, image annotation, and Typora-style reading themes.

folia 是一个本地优先的 block 笔记应用，基于 Tauri、React 和 TipTap 构建。它面向快速记录、Markdown 写作、桌面便签卡片、图片标注，以及 Typora 风格正文主题。

## Highlights / 主要功能

- Block-first notes: write into the composer, then turn the draft into a reusable block.
- Local SQLite persistence in the Tauri desktop app.
- Notebook and page tree with nested pages, page icons, multi-select, move, duplicate, delete, and separate page windows.
- Pinned blocks: pin a block into the sidebar and open it as an always-on-top desktop card.
- Finder integration on macOS: open `.md`, `.markdown`, and `.txt` files with folia.
- Temporary Markdown opening: inspect a Markdown file first, then import it into a notebook when needed.
- Markdown folder import with page links, wiki links, embeds, frontmatter, tasks, math, footnotes, alerts, and media handling.
- Typora-compatible content themes, including Proof, Swiss, Folio, Flexoki, Gruvbox, Chocolate Box, Torillic, Everforest, Paperglow, LaTeX, and others.
- Multiple shells: Native Garden, Native Ledger, Typora Base, and Garden Typora.
- Outline, page thumbnails, global page search, and current-page find.
- Rich paste cleanup for web/LLM content, including noisy spans, escaped HTML, math HTML, and empty code block artifacts.
- Image tools: insert local images, resize, indent/outdent, and annotate images with the built-in image editor.
- Tables, inline math, block math, footnotes, keyboard-key marks, code blocks, quotes, todos, attachments, audio/video embeds, and date insertion.
- Metadata fields and notebook calendar views.
- External card requests via `.notecard` files for companion tools.

## Install / 安装

For normal use, download the macOS DMG from a GitHub Release and drag `folia.app` into `Applications`.

普通使用时，从 GitHub Release 下载 macOS DMG，然后把 `folia.app` 拖进 `Applications`。

Current local build output:

```txt
src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg
src-tauri/target/release/bundle/macos/folia.app
```

If macOS blocks the app because it is unsigned, open it from Finder with right click -> Open, or allow it in System Settings -> Privacy & Security.

如果 macOS 因未签名阻止打开，可以在访达里右键 -> 打开，或到系统设置 -> 隐私与安全性里允许打开。

## Basic Use / 基本用法

1. Create a notebook and page from the left sidebar.
2. Write in the composer at the top of the page.
3. Press `Shift+Enter` or click `Add block` to save the draft as a block.
4. Click a block date to pin or unpin it.
5. Click a pinned card to open it as a floating desktop card.
6. Right-click pages for Set Icon, Open in Window, Move, and Pin First Block.
7. Drag blocks by their left rail to reorder them.
8. Open Markdown files from Finder, or use `Import MD` / `Import folder` from the app controls.

1. 在左侧栏创建 notebook 和 page。
2. 在页面顶部输入框里写内容。
3. 按 `Shift+Enter` 或点击 `Add block`，把草稿保存成 block。
4. 点击 block 日期可以收藏或取消收藏。
5. 点击收藏卡片可以打开桌面浮窗。
6. 右键 page 可以设置图标、单独开窗、移动、收藏首个 block。
7. 拖动 block 左侧轨道可以调整顺序。
8. 可以从访达直接打开 Markdown，也可以在应用内使用 `Import MD` / `Import folder`。

## Markdown and Input Rules / Markdown 与输入规则

| Type this | Result |
| --- | --- |
| `[] ` or `【】 ` | todo item |
| `> ` or `/quote ` | block quote |
| `` ``` `` or `/code ` | code block |
| `$$ ` or `/math ` | block math |
| `$a+b$` | inline math |
| `/table ` or `[[[ ` | 3x3 table |
| `/link ` | insert a link or media URL |
| `/at ` | insert a local attachment |
| `/date ` | insert current date and time |
| `~text~` | underline |
| `~~text~~` | strikethrough |

## Shortcuts / 快捷键

`Cmd` on macOS maps to `Ctrl` on Windows/Linux.

macOS 使用 `Cmd`，Windows/Linux 使用 `Ctrl`。

### Global / 全局

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+F` | Find inside the current page |
| `Enter` / `ArrowDown` in find | Next match |
| `ArrowUp` in find | Previous match |
| `Esc` in find | Close find |
| `Cmd/Ctrl+[` | Toggle left sidebar |
| `Cmd/Ctrl+]` | Toggle outline/right drawer |

### Editor / 编辑器

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+B` | Bold |
| `Cmd/Ctrl+I` | Italic |
| `Cmd/Ctrl+U` | Underline |
| `Cmd/Ctrl+D` | Strikethrough |
| `Cmd/Ctrl+H` | Highlight |
| `Shift+Enter` in composer | Save draft as a block |
| `Shift+Enter` in a block/card | Save and leave editing |
| `Tab` | Indent list item or selected image |
| `Shift+Tab` | Outdent list item or selected image |
| `Cmd/Ctrl+ArrowUp` | Move current block up |
| `Cmd/Ctrl+ArrowDown` | Move current block down |
| `Cmd/Ctrl+Backspace` | Delete current block |
| `Right click` in editor | Show the floating toolbar when toolbar mode is enabled |

### Page Tree / 页面树

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+C` | Copy selected page |
| `Cmd/Ctrl+V` | Duplicate copied page |
| `Cmd/Ctrl+Backspace` or `Cmd/Ctrl+Delete` | Delete selected page |
| `Tab` | Nest selected page under the previous sibling |
| `Shift+Tab` | Promote selected page to its parent level |
| `Shift+click` | Select a continuous range of sibling pages |
| `Cmd/Ctrl+click` | Toggle page selection |

## Desktop Cards and External Requests / 桌面卡片与外部调用

Pinned blocks can open as small always-on-top windows. They are useful for short tasks, references, or quick capture.

收藏的 block 可以打开成置顶小浮窗，适合任务、参考内容和快速记录。

The app also registers `.notecard` files. A companion tool can create a JSON file like this and open it with folia:

应用也注册了 `.notecard` 文件。外部工具可以生成下面这样的 JSON 文件，并用 folia 打开：

```json
{
  "pageId": "page_xxx"
}
```

folia will create a new pinned empty block in that page and open it as a desktop card.

folia 会在对应 page 里创建一个新的收藏空 block，并打开成桌面卡片。

## Development / 开发

Requirements:

- Node.js and pnpm
- Rust toolchain
- Tauri 2 prerequisites for your platform

Install dependencies:

```bash
pnpm install
```

Run the web dev server:

```bash
pnpm dev
```

Run the Tauri app in development:

```bash
pnpm tauri:dev
```

Build frontend assets:

```bash
pnpm build
```

Build desktop bundles:

```bash
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

`pnpm test:editor` 需要先启动 `http://127.0.0.1:5173/` 的 dev server。

## GitHub Release / GitHub 发布

Recommended distribution flow:

1. Push the source code to a private or public GitHub repository.
2. Run `pnpm tauri:build`.
3. Create a GitHub Release.
4. Upload `src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg`.

推荐分发流程：

1. 把源码推到 GitHub 私有或公开仓库。
2. 运行 `pnpm tauri:build`。
3. 创建 GitHub Release。
4. 上传 `src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg`。

## Notes / 注意

- The app is currently macOS-oriented and the bundled artifact shown above is Apple Silicon (`aarch64`).
- The app is not signed or notarized yet.
- Build artifacts, generated Typora assets, and Tauri targets are ignored by git.

- 目前主要面向 macOS；上面的本地安装包是 Apple Silicon (`aarch64`) 版本。
- 应用暂时还没有签名和 notarize。
- 打包产物、生成的 Typora assets、Tauri target 不会提交到 git。
