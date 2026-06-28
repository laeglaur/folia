# Typora Page Thumbnails Design

## Goal

Add a Typora-style thumbnail view to the left sidebar. The view shows pages in the current notebook as compact square-ish page previews with icon, title, and leading text. It is a page navigation surface only; it does not use or change the block model.

## Scope

- Add the feature only to `TyporaShell`.
- Keep the existing file tree intact as the default `Files` view.
- Add a second sidebar view named `Thumbnails`.
- Show pages from the active notebook in existing page order.
- Clicking a thumbnail selects the page through the existing page navigation path.
- Do not change pinned card behavior, block rendering, native shell layout, or right-side outline behavior.

## UI

The Typora sidebar gets a small two-option tab strip at the top of the active pane:

- `Files`: current notebook/page tree, search, notebook list, pages list, and pinned section.
- `Thumbnails`: current notebook pages as preview cards.

Each thumbnail card includes:

- page emoji/icon when present;
- page title, falling back to `Untitled`;
- a short text excerpt from the page's first available block content;
- active styling for the current page.

Cards should be dense enough for a sidebar, with stable dimensions and no nested cards. The view scrolls inside the existing sidebar.

## Data Flow

`App` already owns active notebook, pages, active page, and loaded page documents. It should derive a lightweight thumbnail list and pass it to `TyporaShell`.

Each thumbnail item should contain:

- `pageId`;
- `title`;
- optional `emoji`;
- `excerpt`;
- `active`;

For excerpts, use currently available page document/block data. If a page document is not loaded, show an empty excerpt rather than triggering broad eager loads in the first version.
The first version renders a flat thumbnail list and does not add indentation by page-tree depth.

## Components

Add small local pieces in `shells.tsx`:

- a sidebar view state for `files` vs `thumbnails`;
- a `PageThumbnails` renderer for thumbnail buttons.

Keep tree rendering in `App` unchanged. The thumbnail renderer receives prepared data and an `onSelectPage(pageId)` handler from existing shell props.

## Styling

Extend `typora-shell.css` with scoped styles under `.typora-app-shell`:

- tab strip using the existing `.sidebar-tabs` / `.sidebar-tab` styling hooks if possible;
- thumbnail grid/list styles with fixed card proportions;
- active, hover, empty-state styles aligned with Typora shell tokens.

## Testing

- Build succeeds.
- In Typora shell, `Files` remains the default and existing file tree behavior is unchanged.
- Switching to `Thumbnails` shows current notebook pages only.
- Clicking a thumbnail switches pages.
- Active page card updates after navigation.
- Native shell is visually unchanged.
