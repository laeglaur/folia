# folia

[中文](README.zh-CN.md)

folia is a local-first, block-based notebook built with Tauri, React, and TipTap. It is designed for quick capture, Markdown-friendly writing, pinned desktop cards, image annotation, and Typora-style reading themes.

## Features

- Block-first notes: write in the composer, then save the draft as an independent block.
- Local persistence: the desktop app stores data in SQLite.
- Notebook and page tree: nested pages, icons, multi-select, move, duplicate, delete, and separate page windows.
- Pinned cards: pin a block into the sidebar and open it as an always-on-top desktop card.
- Markdown support: open `.md`, `.markdown`, and `.txt` files, or inspect them temporarily before importing.
- Folder import: supports Markdown folders, frontmatter, wiki links, page links, tasks, math, footnotes, alerts, and media assets.
- Typora content themes: includes Proof, Swiss, Folio, Flexoki, Gruvbox, Chocolate Box, Torillic, Everforest, Paperglow, LaTeX, and more.
- Shell styles: Native Garden, Native Ledger, Typora Base, and Garden Typora.
- Search and navigation: global page search, current-page find, outline, and page thumbnails.
- Paste cleanup: cleans noisy web, paper, and LLM output, including dirty spans, escaped HTML, math HTML, and empty code block placeholders.
- Image tools: insert local images, resize, indent/outdent, and annotate with the built-in image editor.
- Rich writing tools: tables, inline math, block math, footnotes, keyboard-key marks, code blocks, quotes, todos, attachments, audio/video embeds, and date insertion.
- Metadata and calendar: page metadata and notebook calendar views.
- External card requests: `.notecard` files can be used by companion tools to open a new block card for a page.

## Install

For normal use, download the macOS DMG from a GitHub Release and drag `folia.app` into `Applications`.

Current local build output:

```txt
src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg
src-tauri/target/release/bundle/macos/folia.app
```

If macOS blocks the app because it is unsigned, open `folia.app` from Finder with right click -> Open, or allow it in System Settings -> Privacy & Security.

## Basic Use

1. Create a notebook and page from the left sidebar.
2. Write in the composer at the top of the page.
3. Press `Shift+Enter` or click `Add block` to save the draft as a block.
4. Click a block date to pin or unpin it.
5. Click a pinned card to open it as a floating desktop card.
6. Right-click pages for Set Icon, Open in Window, Move, and Pin First Block.
7. Drag blocks by their left rail to reorder them.
8. Open Markdown files from Finder, or use `Import MD` / `Import folder` inside the app.

## Markdown Input Rules

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
| `` ``` `` or `/code` then `Enter` | code block |
| `$$ ` or `/math ` | block math |
| `$$` or `/math` then `Enter` | block math |
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

## Shortcuts

`Cmd` on macOS maps to `Ctrl` on Windows/Linux.

### Global

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+F` | Find inside the current page |
| `Enter` / `ArrowDown` in find | Next match |
| `ArrowUp` in find | Previous match |
| `Esc` in find | Close find |
| `Cmd/Ctrl+[` | Toggle left sidebar |
| `Cmd/Ctrl+]` | Toggle outline / right drawer |

### Editor

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+B` | Bold |
| `Cmd/Ctrl+I` | Italic |
| `Cmd/Ctrl+U` | Underline |
| `Cmd/Ctrl+D` | Strikethrough |
| `Cmd/Ctrl+Shift+S` | Strikethrough, for TipTap default shortcut compatibility |
| `Cmd/Ctrl+E` | Inline code |
| `Cmd/Ctrl+H` | Highlight |
| `Cmd/Ctrl+Alt+1..6` | Heading 1 to heading 6 |
| `Cmd/Ctrl+Alt+0` | Normal paragraph |
| `Cmd/Ctrl+Shift+7` | Ordered list |
| `Cmd/Ctrl+Shift+8` | Bullet list |
| `Shift+Enter` in composer | Save draft as a block |
| `Shift+Enter` in a block/card | Save and leave editing |
| `Tab` | Indent list item or selected image |
| `Shift+Tab` | Outdent list item or selected image |
| `Cmd/Ctrl+ArrowUp` | Move current block up |
| `Cmd/Ctrl+ArrowDown` | Move current block down |
| `Cmd/Ctrl+Backspace` | Delete current block |
| `Right click` in editor | Show the floating toolbar when toolbar mode is enabled |

### Page Tree

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+C` | Copy selected page |
| `Cmd/Ctrl+V` | Duplicate copied page |
| `Cmd/Ctrl+Backspace` or `Cmd/Ctrl+Delete` | Delete selected page |
| `Tab` | Nest selected page under the previous sibling |
| `Shift+Tab` | Promote selected page to its parent level |
| `Shift+click` | Select a continuous range of sibling pages |
| `Cmd/Ctrl+click` | Toggle page selection |

## Desktop Cards and External Requests

Pinned blocks can open as small always-on-top windows. They are useful for short tasks, references, and quick capture.

The app also registers `.notecard` files. A companion tool can create a JSON file like this and open it with folia:

```json
{
  "pageId": "page_xxx"
}
```

folia will create a new pinned empty block in that page and open it as a desktop card.

## Development

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

## Release

Recommended flow:

1. Push the source code to GitHub.
2. Run `pnpm tauri:build`.
3. Create a GitHub Release.
4. Upload `src-tauri/target/release/bundle/dmg/folia_0.1.0_aarch64.dmg`.

## Notes

- The app is currently macOS-oriented.
- The local bundle above is for Apple Silicon (`aarch64`).
- The app is not signed or notarized yet.
- Build artifacts, generated Typora assets, and Tauri targets are ignored by git.
