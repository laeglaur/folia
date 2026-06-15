# Desktop Storage Engine Design

Date: 2026-06-15

## Purpose

Make the desktop app handle large local notebook libraries smoothly, including folders with many Markdown files, lots of media, and long-lived rich-text notes. The current browser-friendly snapshot model is fine for quick development and small datasets, but it does not scale well enough for the desktop target.

This design keeps the existing product behavior intact where possible. It preserves the current shells, editor, notebook/page UI, pinned blocks, import/export surfaces, and theme system. The main change is under the hood: SQLite becomes the source of truth, and React stops holding the entire notebook in one giant persisted object.

## Goals

- Make large imports stable instead of freezing the UI.
- Make persistence incremental and SQLite-backed.
- Keep rich text as the primary page format.
- Support fast search over large note collections.
- Preserve current user-facing features and shortcuts.
- Leave room for future undo/redo, history, and sync.

## Non-Goals

- Rewriting the editor UI.
- Changing shell behavior, theme behavior, or pinned-block behavior.
- Building sync in this phase.
- Making the browser build a full long-term storage target.
- Introducing a separate block-database product model before it is needed.

## Core Decision

Use **pages as the smallest persisted content unit in V1**.

A page stores one ProseMirror/Tiptap JSON document as its canonical content. That document remains the source of truth for body content, formatting, embeds, tables, lists, and future rich nodes. Blocks continue to exist in the UI as a useful interaction layer, but they do not need to become the primary database table yet.

That keeps the system aligned with the current Typora-like writing experience and avoids premature block normalization.

## Data Model

The desktop database should center on these tables:

- `notebooks`
  - notebook identity, name, sort order, timestamps
- `pages`
  - page identity, notebook membership, parent relationship, title, order, timestamps
  - `content_json` as the canonical body
  - `search_text` cache extracted from the JSON document
  - page metadata JSON for tags, status, aliases, source info
- `attachments`
  - attachment identity, hash, path, mime type, size, original path, timestamps
- `operation_log`
  - structural operations for rename, move, create, delete, duplicate, import, and future history
- `fts_pages`
  - FTS5 index over page title, extracted plain text, and optional metadata text

If later product needs prove that block-level persistence is worth the complexity, a `blocks` table can be introduced as a derived or migrated layer. V1 does not need it.

## Addressable Page Nodes

V1 still needs stable IDs inside page JSON.

The app already has block-like behavior: pinned cards, collapsed content, draggable content units, timestamps, and jump targets. Those features should survive the storage change. The way to keep them without a `blocks` table is to require stable `node_id` attributes on the page-level content nodes that the UI treats as block-like.

Examples:

- a pinned card stores `page_id + node_id`, not a copied HTML blob as its only source
- collapsed state can refer to `page_id + node_id`
- outline and jump targets can point into the active page document
- a future block index can be derived from the same stable node IDs

This keeps the V1 database simpler while preserving a path to real block-level features later.

## Why Page JSON First

Page JSON is the right V1 unit because it matches the editor and the current writing workflow.

- It is simpler to save and load whole documents.
- It fits Typora-like editing better than a normalized block database.
- It reduces join complexity and migration risk.
- It keeps import/export closer to the editor's native shape.
- It still leaves room for block views later, because blocks can be extracted from the page document when needed.

The important tradeoff is that page-level queries are coarser than block-level queries. That is acceptable for V1 because the current product still centers on document pages, not a block database.

The design should not remove block-like UI behavior. It only changes where the durable truth lives: inside page JSON first, with stable node IDs available for features that need targeted references.

## Storage Responsibilities

SQLite should own:

- notebook/page metadata
- page body documents
- attachments metadata
- search index data
- operation history
- import bookkeeping

The app data directory should own:

- copied media files
- any extracted attachment blobs
- database file itself

The React layer should own:

- selected notebook/page
- expanded tree state
- editor focus state
- search input state
- UI-only toggles
- transient draft text before commit

## Read Path

The UI should load data by view, not by whole-library snapshot.

- Notebook sidebar loads notebook list plus lightweight page tree metadata.
- Main editor loads only the active page document.
- Search queries hit FTS5 and return matches, not the full dataset.
- Calendar and pinned views load only the data they need.
- Outline generation can work from the active page document alone.

This means React should stop depending on a single giant persisted `AppState` for the full library.

## Write Path

Writes should be command-based and transactional.

Examples:

- create notebook
- rename notebook
- create page
- move page
- rename page
- update page document
- delete tree
- import folder
- import attachment
- pin or unpin a block reference
- update node-level UI metadata such as collapsed or pinned state

Each write updates SQLite in one transaction and, where useful, appends an operation record.

The editor can still use its own in-memory undo stack for local text edits. That is separate from structural app actions.

Page document saves should be debounced and coalesced. A single typing session should not produce a database transaction for every keystroke. Structural commands should save immediately because they change navigation or references.

## Search

FTS5 should be part of V1.

Index these fields:

- page title
- extracted plain text from page JSON
- useful metadata text such as tags, aliases, and source filename

Search should be fast enough to query a large imported library without walking every page in React.

Search results should return page IDs and highlight context, not whole notebooks.

## Import Strategy

Folder import should become a staged pipeline:

1. Scan files and classify Markdown versus media.
2. Copy/import attachments into the desktop store.
3. Parse Markdown into page documents.
4. Persist pages in batches.
5. Update FTS and operation log.
6. Reveal the imported notebook without expanding the whole tree by default.

Important rules:

- Do not pre-expand every imported page if the import is large.
- Do not read every file into one huge React state update.
- Do not rely on browser localStorage for real imports.
- Warn or block browser imports that exceed the browser-safe threshold.

## Undo And Operation Log

`operation_log` should exist in V1, but its first job is not per-keystroke undo.

It should track structural actions that matter to the app:

- notebook/page create, rename, move, duplicate, delete
- import actions
- attachment import and cleanup events
- future structural block actions if they appear later
- node-level pin/collapse changes when they are outside the editor's normal document history

This gives a clean path to history, recovery, and future sync without forcing the editor’s text undo stack into the database layer.

## Migration Plan

Migration should be gradual.

Phase 1:
- keep the current app working
- add database-backed page documents behind new commands
- continue reading legacy snapshot state when needed
- introduce stable node IDs in page JSON for block-like UI features

Phase 2:
- migrate notebooks/pages/attachments into SQLite tables
- keep the current UI contract the same
- switch active-page loads and notebook tree loads to DB queries
- migrate existing block records into page JSON documents without changing the user's visible pages

Phase 3:
- retire snapshot persistence for desktop as the primary path
- keep a JSON backup/export path for recovery
- keep browser mode only as a lightweight development/test surface

## Compatibility Constraints

This design must not regress current features already working in the app:

- notebook rename, duplicate, and delete
- page rename, duplicate, delete, drag, and keyboard shortcuts
- page selection, tab/shift-tab movement, page tree expansion, and root/page drop behavior
- rich-text editing, including typing, selection, undo inside the editor, toolbar commands, input rules, tables, math, todos, lists, highlights, links, media, and embeds
- text copy and paste, including rich HTML paste, Markdown paste, internal editor copy, external app copy, and attachment/media paste
- block click behavior, including expand/collapse, timestamp/date clicks, favorite/highlight clicks, drag handles, and block selection
- pinned blocks, pinned windows, desktop card behavior, and jump-back references
- fish desk controls, sidebar control clicks, theme/menu clicks, and other small utility click targets
- typora/native shell switching
- theme switching
- block borders and collapsed block behavior
- import/export surfaces
- outline and calendar views

If a change threatens one of those features, it should be isolated behind the new storage layer rather than rewritten at the same time. Storage migration is not permission to redesign editor behavior, page interactions, or the sticky-note/card experience.

The implementation should treat these as behavior contracts. Existing smoke tests should keep covering them, and new storage work should add regression checks before replacing the current persistence path.

## Risks

- Page JSON may feel too coarse if block-level features expand quickly.
- Stable node IDs must be preserved by editor updates, imports, and exports.
- FTS extraction must stay in sync with page saves.
- Import batching needs careful progress and error handling.
- Migration from the current snapshot format must be lossless enough for real notebooks.
- Large libraries may still stress the editor if too many page documents mount at once.

## Testing

The storage engine needs coverage at three levels:

- database unit tests in the Tauri backend
- import smoke tests on large markdown folders and media-heavy folders
- UI smoke tests for notebook/page operations and editor loading

At minimum, verify:

- notebook and page CRUD survives the migration
- page selection, keyboard operations, drag/drop, duplicate, and delete still behave the same
- editor typing, rich copy/paste, Markdown paste, media paste, tables, math, todos, and formatting commands still work
- block click interactions, including collapse/expand, timestamp/date clicks, and favorite/highlight clicks, still work
- pinned cards and pinned windows still show the right content and can jump back to the source
- fish desk and other utility controls still respond correctly to clicks
- large folder import does not freeze or silently drop data
- search returns expected pages from the FTS index
- attachments are copied once and referenced by path or asset ID
- existing shell and page interactions still work

## Decision Summary

For V1 desktop storage, use:

- SQLite as the only source of truth
- page-level JSON as the canonical body format
- attachments stored outside the database
- FTS5 for search from the start
- operation log for structural actions and future history

This gives the app a stable base for large, rich notes without forcing an early block-database rewrite.
