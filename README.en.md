# folia

[Home](README.md) · [中文](README.zh-CN.md) · [Complete user guide (Chinese)](docs/USER_GUIDE.md)

folia is a local-first block notebook built with Tauri, React, and TipTap. Desktop notes use SQLite; the browser development preview does not share the desktop database or all native capabilities.

## Writing and organization

Write in the composer and press Shift+Enter to save a block. Saved blocks support editing, reordering, folding, and pinning. Notebooks start collapsed; pages support nesting, icons, multi-selection, moving, duplication, and separate windows.

Cmd+N creates a root page in the selected notebook, falling back to the current page's notebook. Mixed list trees support task, bullet, and numbered items: type `[] `, `- `, or `1. ` at the beginning of an item to convert it, and use Tab / Shift+Tab to change nesting.

Writing tools include tables, math, footnotes, quotes, code, attachments, audio/video, and image resizing and annotation. Sidebar search finds notes; Cmd+F searches the current page. The right panel is called Contents, with an optional list-item display toggle in the fish menu.

## Getting started

1. Create a notebook and page, write in the composer, and press Shift+Enter.
2. Double-click a name to rename it. Right-click a notebook for **Set emoji**, or a page for **Set Icon**. Browse categories and recent choices, search English names or emoji, or clear the icon.
3. Click a block’s date to pin it; click the sidebar card to open a floating window.
4. Open **外观调整 (Appearance)** from the fish menu to choose a theme; enable Toolbar for formatting tools.

The bundled [user guide](docs/USER_GUIDE.md) covers page selection and movement, batch icons, metadata, temporary Markdown, recovery, and shortcuts by editing context. The fish menu opens this same guide.

## Calendar, pins, images, and tables

Enable Calendar view from a notebook context menu to arrange pages by date or date range, select visible fields, and color entries by a field. Click a block’s date to toggle sidebar pinning; the adjacent pin icon sends it to the system widget instead. Insert images with `/at `, resize from the bottom-right corner, and double-click to annotate. Insert tables with `/table `, then add/delete rows or columns and drag column boundaries to resize. Detailed behavior and limits are in the [user guide](docs/USER_GUIDE.md).

## Appearance

Start with **Tilted Paper** or **Paper Collage**: Tilted offers generous spacing and slanted paper frames; Collage adds linen, torn paper, and layered decorations. Both support independent content themes. **Typora Base** is the minimal business-style option, while **Garden Typora** offers a modest variation on the basic layout.

Open **外观调整 (Appearance)** from the fish menu for a draggable live-preview panel.

| Shell | Appearance |
| --- | --- |
| Tilted Paper (recommended) | Three skewed-top paper frames, paper color, shadows, background and footer image |
| Paper Collage (recommended) | Linen, overlapping torn paper, framed picture, tape, and leaves |
| Typora Base | Minimal business-style shell |
| Garden Typora | A modest variation on the basic layout, with configurable backgrounds |
| Native Garden | Native notebook layout with full background color, image, and opacity settings |

Typora shells support independent content themes such as Proof, Swiss, Folio, Everforest, Torillic, and Paperglow. The two paper shells keep their own paper surface while content themes control typography. Automatic paper colors also respond to dark themes.

Choose an image URL or a local file. Each shell keeps its own settings. Double-click upper sidebar text to edit it in place; its position is fixed. Lower captions on the paper shells can be edited, moved by the top border, scaled with the corner handle, and rotated with the circular handle. Tilted's caption and signature share one text box.

## Styled terminal paste

Copy with Styles in iTerm2 using Cmd+Option+C. Cmd+V uses normal paste; Cmd+Option+V preserves terminal colors and formatting. Double-click a snippet to edit text, font size, foreground/background colors, bold, italic, underline, or strikethrough. Highlight presets apply both foreground and background colors.

The desktop app supports HTML and RTF; browsers require HTML clipboard data and permission. JSON backup retains snippet styles; Markdown exports plain code fences. See the [format reference](docs/terminal-paste.md).

## Cards and widgets

Pinned sidebar blocks can open as floating desktop windows. The macOS folia Block widget is a separate, read-only preview supporting text, images, and terminal colors. Long content is clipped, without scrolling or inline editing. Search can select another block; the full-window action opens a separate editor. Updates are synchronized, but macOS schedules widget redraws.

## Import and recovery

Open Markdown from Finder or use Import MD / Import folder in the fish menu. Folder import supports links, wiki links, frontmatter, tasks, math, and media. Markdown export is for portable content; Backup preserves note data and terminal styles. Page history and Trash provide recovery.

Appearance preferences are stored separately on the device. A JSON note export is not a full application-environment backup; preserve the database and media directories when migrating desktop data.

## Development and packaging

Requirements: Node.js, pnpm, Rust, and Tauri 2 platform prerequisites. Building the macOS widget additionally requires full Xcode, its command-line tools, and XcodeGen.

```bash
pnpm install
pnpm dev             # browser preview
pnpm tauri:dev       # desktop development; use instead of a competing dev server
```

Use `pnpm build` for the web build. For the complete macOS bundle:

```bash
pnpm tauri:build
bash src-tauri/macos-widget/embed-widget.sh
```

The beforeBundleCommand builds the widget extension. The second command embeds it, signs the app, and creates the DMG containing the extension. Default signing is ad-hoc for local use, not Developer ID signing or notarization.

Outputs: `src-tauri/target/release/bundle/macos/folia.app` and `src-tauri/target/release/bundle/dmg/`. Install in Applications and launch before adding folia Block through the system widget gallery. A source push does not create a GitHub Release: installers must be built, verified, and uploaded separately.

```bash
pnpm exec tsc --noEmit
pnpm test:editor
pnpm test:view-model
pnpm test:markdown
pnpm test:markdown-folder
pnpm test:theme
pnpm test:persistence
```

Editor browser checks require the dev server. See [theme assets](docs/theme-assets.md) for bundled versus generated files. Progress logs, audits, and `docs/superpowers/` are historical engineering records rather than current user instructions.
