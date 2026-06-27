# Collection Catalog Requirements

## Overview
Collection is a view layer for child pages under a parent page.
It should help the user browse a small domain of pages such as reading lists, cooking notes, and home inventory, without changing the underlying notebook or editor model.

## User Goals
- Browse related child pages in a compact workspace.
- Switch between table, gallery, and calendar views.
- Surface useful metadata from imported pages without manual model cleanup.
- Use the same underlying page data in every collection view.
- Keep the rest of the notebook stable while collection is enabled.

## Data Model
- A collection is attached to a parent page.
- The collection source is the parent page's child pages.
- Collection items are pages, not a separate database row type.
- The collection should read real metadata from each page.
- Metadata key names should remain visible as they were imported.
- The collection must not invent field names that are not present in the imported metadata.
- Hidden pages remain part of the collection config and can be restored later.

## Views
### Table
- Show one row per page.
- Show the page title and selected metadata fields.
- Keep the title column easy to scan.
- Allow long content to wrap naturally, then truncate after several lines.
- Support horizontal scrolling when there are many columns.

### Gallery
- Show one card per page.
- Show the first real image from the page body as the card image.
- Do not use decorative header art in place of body content.
- Show the title and a small metadata preview under the image.
- Keep the card image inside the card bounds.

### Calendar
- Show items on a calendar grid by date metadata.
- Support a single date field or a date range.
- When the data represents a range, display the item across the full range.
- When multiple date-like fields are present, let the user choose which one or ones drive the view.

## Field Behavior
- `Fields` should list real metadata keys found in the collection items.
- `Date` should list real date-like metadata keys found in the collection items.
- `Color` should use a categorical field when one exists.
- Metadata values should remain tied to their original key names.
- Chinese and English keys should both work when they represent the same imported metadata concept.
- The UI may normalize aliases for matching, but should not hide the original key names from the user.

## Automatic Color
- Table and gallery can color items automatically.
- The preferred color source is a field that behaves like a select field:
  - short values
  - repeated values across many items
  - a limited number of distinct values
- If no such field exists, the collection may fall back to a sensible categorical field already present in metadata.
- Calendar item coloring may remain date-driven.

## Gallery Image Selection
- Prefer an image from the page body.
- If several images exist, use the first real body image.
- If the page body has no usable image, fall back to a quiet placeholder.
- Images imported into the notebook should continue to render correctly in collections.

## Interaction
- Clicking a collection item opens the page.
- Hidden items can be shown again from the collection UI.
- Collection state should remember the current view and other user choices that affect browsing.
- Returning to the collection from a child page should preserve the user’s place as much as possible.

## Constraints
- Do not change notebook editing behavior to satisfy collection.
- Do not require the user to re-enter imported metadata in a separate editor.
- Do not force a database-style schema on top of imported notes.
- Do not break browser-only development or desktop Tauri behavior.
- Do not make theme-specific behavior define data meaning.
- Do not make collection depend on a full reload to stay usable.

## Quality Bar
- Collection should feel like a lightweight browsing layer, not a second notebook engine.
- The UI should stay readable across themes.
- Collection should not noticeably slow down ordinary editing.
- Importing many pages should still leave the notebook usable.
- The feature should be understandable without reading implementation details.

## Acceptance Criteria
- Child pages appear in the collection with stable titles and metadata.
- Table, gallery, and calendar all render the same underlying items.
- The user can choose the useful metadata fields without losing the original keys.
- Range-backed calendar items visibly span their ranges.
- Gallery cards render from body images.
- Automatic coloring works on table and gallery when the metadata supports it.
- The notebook editor remains stable while collection is enabled.

## Out Of Scope
- Notion-style relations, rollups, formulas, and database templates.
- A separate collection database schema.
- Renaming imported metadata keys.
- Editing imported metadata through a separate field editor.

