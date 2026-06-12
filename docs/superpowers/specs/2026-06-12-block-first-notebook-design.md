# Block-First Notebook Design

Date: 2026-06-12

## Purpose

Build a personal notebook that combines the strengths of a structured notebook and an iNote-like desktop card tool. The app should be fast for fragmented thought capture, structured enough for project tracing, and open enough to import/export Markdown without making Markdown the editing interface.

This is not a Notion clone and not a freeform OneNote canvas. The product is a local-first, block-first notebook where pages organize rich blocks, and desktop cards, outlines, search, kanban, calendar, and future database views are projections of those same blocks.

## Core Decisions

- Platform: React + Tauri, starting with macOS desktop.
- Data strategy: hybrid local-first model. SQLite is the live local store; Markdown, JSON, and HTML are import/export formats.
- Sync strategy: multi-device sync is designed from day one through operation logs, but full sync transport can be phased in.
- Product shape: a unified notebook system. Desktop cards are a feature of the same block model, not a separate app.
- Scope: v1 focuses on the core notebook and desktop card experience. Database, full kanban/calendar, Apple Pencil, and advanced sync are deferred.
- Visual priority: the app must feel beautiful and comfortable for daily writing. CSS themes are a core product feature, not an afterthought.

## Mental Model

The app has four primary concepts:

- `Notebook`: the top-level container, such as Work, Personal, Papers, or a specific project area.
- `Page`: an ordered container of blocks. A page can behave like a document, a project timeline, or a loose collection of fragments.
- `Block`: the durable content unit. A block can be edited, moved, folded, referenced, pinned to the desktop, searched, and shown in other views.
- `View`: a projection of blocks, such as a page editor, desktop card, outline, search result, kanban lane, calendar item, or future database row.

The important rule is that blocks are independent, addressable units. Pages provide context and order, but a block can also appear in a desktop card, search result, or future view without being duplicated.

## Writing Experience

The default page experience is continuous block capture.

When the user types into a page, they are writing into an active input area. Submitting that content turns it into a block. A new input area appears above or below the block so the user can continue writing without creating a separate note manually.

Blocks remain editable after creation. The app should make editing feel direct and normal, not like editing raw Markdown. Keyboard shortcuts and toolbar actions apply formatting while the document stays visually rendered.

Required v1 editing capabilities:

- highlight
- bold
- italic
- font size adjustment
- inline code and code blocks
- tables
- external links
- indentation
- numbered lists
- bulleted lists where every bullet can collapse and expand by default
- todo items
- drag-and-drop block reordering
- block folding and expansion
- outline navigation and block positioning
- fast aesthetic theme switching through CSS, similar to Typora's theme model

Markdown syntax may be accepted as an input shortcut where convenient, but the rendered view is the primary interface.

## Block Content Model

A block is a rich content container, not a single-purpose typed object like only text, only image, or only table.

A block can contain:

- rich text
- images
- video
- audio
- embedded URLs
- tables
- todo items
- lists
- code
- links
- layout groups

This means a block may contain text plus images, left-text/right-image layouts, image comparisons, or multi-column text comparisons. The block is still one movable, foldable, referenceable unit from the page's perspective.

### Layout Groups

The app supports structured freeform layout inside a block.

Layout groups are block-internal layout regions with 2 to 4 columns. They are intended for common note-taking layouts such as:

- two images side by side
- left text and right image
- left image and right text
- multiple text columns for comparison
- small image groups

Layout groups are not a global page layout system and not a freeform canvas. v1 should avoid:

- arbitrary coordinate placement
- infinite nested columns
- complex cross-column spanning
- OneNote-style click-anywhere writing
- real-time collaborative editing inside the same layout group

On mobile or narrow screens, layout groups should stack into a readable vertical order.

## Theme CSS System

The app should support fast visual theme switching similar to Typora. The goal is not merely light/dark mode; the goal is for the notebook to feel beautiful, calm, and pleasant enough to write in every day.

The editing surface should render with stable semantic classes so themes can change typography, spacing, colors, block borders, code styles, table styles, highlights, callouts, cards, and page width without changing stored content.

The default visual direction should avoid the feeling of a heavy productivity dashboard. It should be more polished and expressive than typical Notion or Obsidian defaults, while staying structured and readable.

V1 should support:

- several built-in polished writing themes, not just one light theme and one dark theme
- quick theme switching from the app UI
- importing or selecting custom CSS theme files
- applying the selected theme to the editor and rendered page/card previews where practical

Theme CSS is presentation only. It must not alter block content, layout group structure, sync data, or export data. Markdown and JSON export should remain content-focused; HTML export may include or reference the chosen theme.

## Desktop Cards

Desktop cards are block-based views. They reference blocks instead of copying content.

V1 desktop card capabilities:

- pin a single block to the desktop
- pin a list of blocks from a page
- quickly create a new block into a target page or notebook
- collapse or expand cards based on line count
- check todo items directly from the card
- show highlights, links, and image thumbnails
- jump from a card back to the original page and block location
- support basic always-on-top behavior, resizing, and light visual customization

The desktop card feature should stay tightly connected to the notebook model. It is not a separate sticky-note database.

## Page Organization

Pages organize blocks in order and provide navigation around them.

V1 page capabilities:

- ordered block list
- drag-and-drop block ordering
- outline generated from headings and collapsible list structure
- jump to a block from the outline
- page-level metadata such as title, notebook, tags, created time, updated time, and optional cover/icon later
- block-level metadata such as tags, status, due date, created time, updated time, references, and pinned state

The app should support both document-like pages and project-fragment pages without forcing the user to choose a different mode.

## Data Storage

SQLite stores the canonical local state.

The database should include at least:

- notebooks
- pages
- blocks
- block content trees
- block ordering and parent/page relationships
- tags and references
- saved views
- desktop card configuration
- attachments metadata
- operation log entries

Large attachments such as images, audio, and video should live outside the database in the app data directory. SQLite stores metadata, content hash, path, size, mime type, and references.

Each block needs a stable ID so it can be referenced from pages, desktop cards, search results, imported content, exported content, and future synced devices.

## Sync Design

The app is local-first. It must work fully offline on the Mac.

At the same time, multi-device sync is a first-class architectural requirement. Every meaningful edit should update local state and append an operation to a syncable operation log.

Operation log entries should capture:

- operation ID
- device ID
- timestamp or logical clock
- target entity type and ID
- operation kind
- payload
- dependency or base revision when needed

V1 should implement the operation log even if the first release only uses it for local history and backup. V1.1 can use iCloud Drive, WebDAV, or a user-selected sync folder to exchange logs. A later version can add a self-hosted or managed sync service.

Initial conflict strategy should be conservative:

- Edits to different blocks can merge automatically.
- Simultaneous edits to the same block should preserve both versions and ask the user to resolve or merge.
- Attachment conflicts should preserve both files unless exact content hashes match.

The first implementation does not need full real-time collaborative editing.

## Import And Export

Markdown is an exchange format, not the internal storage format.

V1 import should support:

- Markdown files and folders
- headings as page outline structure
- links
- images and attachment references
- lists
- todo items
- code blocks
- tables where feasible
- frontmatter as metadata

V1 export should support:

- Markdown for portability
- JSON backup for lossless app-native recovery
- HTML snapshot for readable sharing or archiving

Some rich layouts, especially layout groups, may export to Markdown through a compatible HTML block or a graceful linear fallback. JSON backup should remain the lossless format.

## Later Features And Non-Goals

The following features are useful later but intentionally not v1 goals:

- full Excel-like database system
- full kanban view
- full calendar view
- Apple Pencil drawing and handwriting
- advanced image annotation comparable to Snipaste
- self-hosted sync service

The following are explicit non-goals, not merely deferred features:

- arbitrary freeform canvas
- infinite nested layout groups
- multiplayer real-time collaboration
- full Notion API import

Later features should remain compatible with the architecture but not block the first usable version. Non-goals should actively guide the design away from unnecessary complexity.

## Suggested V1 Scope

The first usable product should include:

- React + Tauri app shell
- SQLite local store
- notebook/page/block creation
- block-first page editor
- rich block content editing
- structured layout groups with 2 to 4 columns
- bulleted lists with default collapse controls, plus todo items
- drag-and-drop block ordering
- page outline and jump-to-block navigation
- desktop block cards and quick block creation
- CSS-based theme switching with custom theme support
- Markdown import
- Markdown, JSON, and HTML export
- attachment storage for images and common media
- operation log foundation for future sync

## Testing Strategy

Core tests should focus on the areas that can corrupt user data or make the app hard to trust:

- block creation, editing, ordering, and deletion
- block content serialization and deserialization
- layout group serialization and mobile stacking rules
- Markdown import/export round trips for common structures
- operation log creation for edits
- conflict-preserving behavior for simultaneous block edits
- attachment reference integrity
- desktop card updates reflecting source block edits
- theme switching without changing stored block content

UI tests should cover the primary writing loop: create page, type content, commit block, create next block, edit old block, reorder block, pin to desktop card, jump back to source block.

## Open Implementation Questions

These should be answered during implementation planning rather than product design:

- Which rich-text editor foundation to use in React.
- Whether Tauri v2 mobile support should be introduced immediately or after the Mac app stabilizes.
- Exact operation format for block content changes.
- Exact markdown fallback syntax for layout groups.
- Whether desktop cards should be separate Tauri windows from v1 or simulated inside the main app for the earliest milestone.
