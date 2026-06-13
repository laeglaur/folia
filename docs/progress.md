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
- Markdown import creates one rich block per imported page by default, preserving headings, links, images, lists, todos, tables, highlight, inline code, code blocks, video, audio, and common embeds.
- Markdown import now shows visible success/warning/error feedback.
- Local imported image/audio/video assets are copied into app data attachments storage in Tauri and referenced through the Tauri asset protocol.
- Attachment metadata is stored in SQLite with content hash deduplication.
- Markdown export and JSON backup exist.
- Theme CSS system exists with semantic tokens, Garden as the default theme, and Ledger as a contrasting layout/theme proof.
- Themes can control sidebar chrome, page width, spacing, blocks, highlights, todos, code, tables, media, outline, and card surfaces.
- Desktop card preview and pinned Tauri window foundation exist.
- Smoke tests cover editor shortcuts, Markdown import, theme switching, Rust attachment import, and TypeScript build.

## Partial

- Desktop cards exist, but source-to-card live editing, card todo toggling, and jump-back behavior are still thin.
- Outline exists as block previews, but it is not yet a real heading/list outline with precise anchors.
- Markdown export is basic and not yet a faithful round trip for tables, media, todos, and embeds.
- SQLite currently stores a state snapshot plus operation log; normalized notebook/page/block tables are not fully used yet.
- Multi-device sync is designed through operation logs, but there is no sync transport or conflict UI.
- Themes are tokenized and flexible, but custom external CSS import is not implemented.
- Media import supports common URLs and local attachment copying, but there is no in-editor media picker/uploader yet.
- Block-internal columns/layout groups are still not implemented.

## Not Started

- Calendar view.
- Kanban view.
- Excel-like database view.
- Tags, due dates, status fields, and block references.
- Full-text search beyond simple current-page filtering.
- Frontmatter metadata import.
- Folder import with page hierarchy.
- HTML export.
- Image annotation or Apple Pencil drawing.
- iPad/mobile app work.
- Real sync via iCloud Drive, WebDAV, sync folder, or server.

## Suggested Next Work

1. Make the outline real: extract headings and collapsible list parents from each block, show only concise entries, and jump to exact positions.
2. Improve desktop cards: make pinned cards reflect source edits, allow todo toggling, and add a return-to-source action.
3. Implement block-internal layout groups for 2 to 4 columns, starting with image pairs and left-text/right-image.
4. Improve Markdown export fidelity for todos, tables, media, embeds, and highlights.
5. Add custom theme loading after the theme contract settles a little more.

## Recent Verified Commits

- `a3755dd` Localize imported media assets
- `45f7b32` Import common media embeds
- `11bbc57` Show markdown import feedback
- `9abbebe` Test localized asset imports
- `93ce867` Localize imported image assets
