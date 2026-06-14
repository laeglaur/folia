# Notebook Progress

Updated: 2026-06-13

## Done

- React + Tauri app shell is running with a block-first page editor.
- SQLite persistence is wired through Tauri, with browser localStorage fallback.
- Operation log entries are appended for core notebook/page/block changes.
- Notebook and page creation work, including nested pages and drag/tab hierarchy changes.
- Blocks can be created from the composer, edited in place, collapsed, pinned, reordered by drag, and moved with keyboard shortcuts.
- Tiptap rich text editing is in place for headings, bold, italic, highlight, inline code, code blocks, links, lists, todos, tables, images, video, audio, and embeds.
- Markdown input shortcuts are covered for headings, bullets, todos, bracket todos, highlight, inline code, and code blocks.
- Bullets and task list items can collapse and persist collapsed state in saved HTML.
- Markdown import creates one rich block per imported page by default, preserving headings, links, nested lists, todos, tables, highlight, inline code, code blocks, video, audio, and common embeds.
- Markdown import parses leading frontmatter into page metadata, including title, tags, date, status, aliases, and simple custom fields.
- Markdown import renders footnotes with Typora-compatible hooks.
- Markdown import renders inline and block LaTeX math through Tiptap Mathematics and KaTeX.
- Markdown import now shows visible success/warning/error feedback.
- Local imported image/audio/video assets are copied into app data attachments storage in Tauri and referenced through the Tauri asset protocol.
- Attachment metadata is stored in SQLite with content hash deduplication.
- Right outline now extracts page title, block headings, and imported list parents, with jump-to-heading behavior.
- Underline, strikethrough, blockquote, and horizontal rule are covered in editor/Markdown smoke tests.
- Typora Phase 1 content feature coverage is complete except intentionally deferred inline TOC, Mermaid/diagram, and source mode.
- Typora content theme scope exists with independent `contentTheme` state, `.typora-theme`, `.typora-write`, and right-outline TOC compatibility hooks.
- Typora CSS prefixer/bridge exists with a generated scoped proof theme covering `#write`, code fences, task lists, footnotes, math, and TOC-to-right-outline mapping.
- Pilot Typora content themes are installed: Konayuki, Folio, Zeus, Bonne nouvelle, and Flexoki Light.
- Markdown export and JSON backup exist.
- Theme CSS system exists with semantic tokens, Garden as the default theme, and Ledger as a contrasting layout/theme proof.
- Themes can control sidebar chrome, page width, spacing, blocks, highlights, todos, code, tables, media, outline, and card surfaces.
- Desktop card preview and pinned Tauri window foundation exist.
- Smoke tests cover editor shortcuts, Markdown import, theme switching, Rust attachment import, and TypeScript build.

## Partial

- Desktop cards exist, but source-to-card live editing, card todo toggling, and jump-back behavior are still thin.
- Outline supports page title, headings, and list-parent entries, but deeper outline filtering and richer labels are still basic.
- Markdown export is basic and not yet a faithful round trip for tables, media, todos, and embeds.
- SQLite currently stores a state snapshot plus operation log; normalized notebook/page/block tables are not fully used yet.
- Multi-device sync is designed through operation logs, but there is no sync transport or conflict UI.
- Themes are tokenized and flexible, but custom external CSS import is not implemented.
- Pilot Typora themes are selectable, but they still need visual QA, screenshots, asset polish, and per-theme adjustment decisions.
- Media import supports common URLs and local attachment copying, but there is no in-editor media picker/uploader yet.
- Block-internal columns/layout groups are still not implemented.

## Current Editor Shortcuts

- `Cmd/Ctrl+B`, `Cmd/Ctrl+I`, `Cmd/Ctrl+H`: bold, italic, highlight toggle.
- `Tab`, `Shift+Tab`: indent and outdent the current bullet, numbered item, or task item.
- `Cmd/Ctrl+↑`, `Cmd/Ctrl+↓`: move the current block up or down.
- `Shift+Enter`: commit the composer into a block, or create the next block from an existing block.
- `Enter`: native rich-editor behavior; in lists and todos it continues the list, and an empty list item exits the list.
- `[] `: start a plain task item.
- `【】 `: start a highlighted bracket task item.
- `- `: start a bullet list.
- `1. `: start a numbered list.
- `# `, `## `, `### `: start headings.
- `==text==`: highlight imported or pasted Markdown text; toolbar/`Cmd/Ctrl+H` handles selected rich text.
- `` `text` ``: inline code through Markdown parsing/import; toolbar handles selected rich text.
- Three backticks or `/code`: start a code block when typed alone in an empty paragraph.
- `> ` or `/quote`: start a blockquote.
- `$$ ` or `/math`: start a block math node.

## Not Started

- Calendar view.
- Kanban view.
- Excel-like database view.
- Tags, due dates, status fields, and block references.
- Full-text search beyond simple current-page filtering.
- Folder import with page hierarchy.
- HTML export.
- Image annotation or Apple Pencil drawing.
- iPad/mobile app work.
- Real sync via iCloud Drive, WebDAV, sync folder, or server.

## Suggested Next Work

1. Add Typora theme smoke screenshots and manually review the five pilot themes for readability, spacing, and shell isolation.
2. Polish or discard pilot themes based on review; keep reusable parts such as bullets, code blocks, quote boxes, spacing, and image treatment.
3. Improve Markdown export fidelity for todos, tables, media, embeds, footnotes, and math.
4. Return to desktop cards after Typora theme migration is usable.
5. Implement block-internal layout groups after the Typora theme path is stable.

## Recent Verified Commits

- `a3755dd` Localize imported media assets
- `45f7b32` Import common media embeds
- `11bbc57` Show markdown import feedback
- `9abbebe` Test localized asset imports
- `93ce867` Localize imported image assets
