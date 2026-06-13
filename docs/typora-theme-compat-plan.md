# Typora Theme Compatibility Plan

Updated: 2026-06-13

## Goal

Support Typora themes as installable content themes while keeping the notebook app model intact.

Typora themes should shape the writing surface: typography, headings, paragraphs, lists, blockquotes, code, tables, images, media, math, footnotes, and TOC. They should not directly own the app shell: sidebar, notebook/page tree, toolbar, block rail, pinned cards, outline panel, import notice, or window chrome.

The app shell may borrow visual primitives from a Typora theme, but only through explicit tokens or inferred presets. Raw Typora CSS must stay scoped to content.

## Current Project Context

Already implemented:

- React + Tauri app shell.
- Tiptap rich editor.
- SQLite state snapshot, attachment metadata, and operation log foundation.
- Markdown import as one rich block per page.
- Markdown import for headings, links, images, video, audio, embeds, lists, todos, tables, highlight, inline code, code blocks, and indented fences.
- Local attachment copying for imported images, audio, and video.
- Theme CSS token system with Garden and Ledger.
- Editor, Markdown, theme, Rust attachment, and build smoke tests.
- Progress tracker at `docs/progress.md`.

Known gaps that matter for Typora-style writing:

- Real heading/list outline is not implemented yet.
- Frontmatter metadata import is not implemented.
- Footnotes are not implemented.
- LaTeX/math is not implemented.
- Blockquote, horizontal rule, and strikethrough are not explicitly covered by smoke tests yet.
- Underline is not implemented as a first-class rich-text mark yet.
- Mermaid/diagram and Markdown source mode are desirable later but not part of this first compatibility milestone.
- Markdown export is still too basic for advanced content.

## Core Architecture

Use three layers.

### 1. Content Feature Layer

This layer defines the semantic document features the editor can actually store, render, import, and export.

First compatibility milestone:

- advanced Markdown fixture coverage for Typora-styled basics such as blockquote, horizontal rule, strikethrough, code, tables, images, task lists, and nested lists
- underline rich-text support
- real TOC/outline from headings and collapsible list parents
- YAML frontmatter import into page metadata
- footnotes
- inline math and block math

Deferred:

- Mermaid/diagram rendering
- Markdown source mode / CodeMirror
- Typora sidebar/file tree compatibility

### 2. Typora Compatibility Layer

This layer lets original Typora CSS target our content DOM safely.

Responsibilities:

- install Typora CSS and assets under a managed theme directory
- scope imported CSS so it cannot style the whole app
- rewrite common Typora selectors into notebook content selectors
- preserve relative asset URLs
- provide bridge CSS for Typora DOM assumptions that differ from Tiptap output
- expose Typora themes in the theme picker as content themes

Typora selectors to support early:

- `#write`
- `body`, `html`
- headings, paragraphs, anchors, lists, blockquotes, tables, images
- `pre`, `code`, `.md-fences`
- task list selectors such as `.task-list-item`
- footnote selectors
- math selectors
- TOC selectors

Selectors to ignore or sandbox early:

- Typora sidebar/file tree selectors
- CodeMirror/source mode selectors
- window/menu/sidebar selectors

### 3. Notebook Shell Theme Layer

This layer keeps the app coherent around the content theme.

Responsibilities:

- app background
- page surface
- sidebar and page tree
- block shells
- block rail and fold controls
- composer shell
- toolbar
- pinned card shell
- right outline panel
- import notices and controls

The shell should not be styled by raw Typora CSS. Instead, each Typora theme can choose a shell preset:

- `neutral-paper`
- `minimal-light`
- `ink-print`
- `soft-color`
- `structured-box`
- `dark-muted`

Later, the importer can infer shell tokens from the content CSS, but the first version should use explicit presets.

## DOM And CSS Scoping

Do not create repeated `id="write"` nodes. A notebook page has many editable blocks, so duplicate IDs would be invalid and hard to debug.

Instead:

- add `.typora-theme` to the scoped content host when a Typora theme is active
- add `.typora-write` to the actual writing surfaces
- apply `.typora-write` to block editors, composer, rendered card bodies, and export/preview content
- keep `.app-shell`, `.sidebar`, `.topbar`, `.block`, `.right-panel`, and other app shell selectors outside raw Typora CSS

CSS rewrite examples:

```css
/* Typora */
#write h1 { ... }

/* Notebook scoped */
.typora-theme[data-content-theme="konayuki"] .typora-write h1 { ... }
```

```css
/* Typora */
body { ... }

/* Notebook scoped */
.typora-theme[data-content-theme="konayuki"] .typora-write { ... }
```

```css
/* Typora */
.md-fences { ... }

/* Notebook bridge */
.typora-theme[data-content-theme="konayuki"] .typora-write pre { ... }
```

## Theme Manifest

Each imported Typora theme should produce a manifest entry.

```json
{
  "id": "typora-konayuki",
  "label": "Konayuki",
  "kind": "typora",
  "contentCss": "themes/typora/konayuki/konayuki.scoped.css",
  "assetRoot": "themes/typora/konayuki/",
  "shellPreset": "soft-color",
  "compatVersion": 1,
  "source": {
    "name": "Typora Theme Gallery",
    "url": "https://theme.typora.io/"
  }
}
```

Theme state should eventually distinguish:

- `shellThemeId`
- `contentThemeId`

The current `theme` field can remain for Garden/Ledger while this is introduced. A migration can map the old `theme` to both a shell and content preset.

## Advanced Writing Features In Scope

### Real TOC And Outline

Replace the current block-preview outline with a real document outline.

Sources:

- page title
- headings inside blocks
- collapsible list parents inside blocks

Behavior:

- show concise heading/list entries
- preserve hierarchy when possible
- jump to the exact heading/list item
- support Typora-style TOC rendering inside content later

Testing:

- Markdown import with h1/h2/h3 creates outline entries
- clicking an outline entry scrolls to the correct block/heading
- collapsed list parents can appear in outline

### YAML Frontmatter

Parse frontmatter during Markdown import.

Example:

```yaml
---
title: Custom title
tags: [travel, literature]
date: 2026-05-02
status: draft
aliases:
  - Hengdian notes
---
```

Initial metadata fields:

- title override
- tags
- date
- status
- aliases
- source filename

Storage:

- add page metadata to the frontend state model first
- include metadata in JSON backup
- append metadata to operation log payload
- later normalize metadata into SQLite tables

Testing:

- imported frontmatter does not appear as body text
- title can come from frontmatter
- tags/date/status/aliases persist in state

### Footnotes

Support Markdown footnote import and display.

Syntax:

```markdown
A sentence with a note.[^a]

[^a]: Footnote content.
```

Behavior:

- render references inline
- render footnotes near the bottom of the block or page
- keep footnote anchors stable enough for theme styling
- preserve content in JSON backup

Testing:

- Markdown import creates footnote references and footnote section
- Typora-like footnote selectors can style the output

### LaTeX / Math

Support inline and block math.

Syntax:

```markdown
Inline math: $E = mc^2$

$$
\int_0^1 x^2 dx
$$
```

Implementation preference:

- use a proven math rendering package
- keep original TeX source in the editor document
- render visually in normal mode
- make the output styleable by Typora-compatible selectors

Likely packages:

- `@tiptap/extension-mathematics` if it fits current Tiptap version
- KaTeX directly if the Tiptap extension is not suitable

Testing:

- inline math imports and renders
- block math imports and renders
- math survives state save/load
- math CSS can be themed

## Deferred Advanced Features

### Mermaid / Diagram

Do not implement in the first compatibility milestone.

Design expectation:

- preserve fenced `mermaid` source
- later render diagrams with a library
- keep rendering isolated for safety and performance

### Markdown Source Mode / CodeMirror

Do not implement in the first compatibility milestone.

Design expectation:

- later add block source or page source editing mode
- CodeMirror styles are only relevant after source mode exists
- raw Typora CodeMirror CSS should remain ignored until then

## Implementation Plan

### Phase 0: Design And Fixtures

- Write this plan.
- Add a theme fixture Markdown document that includes headings, blockquote, hr, nested lists, todos, bracket todos, table, image, video, audio, embed, footnote, frontmatter, and math.
- Extend smoke tests around blockquote/hr so existing content coverage is explicit.

### Phase 1: Content Features

1. Advanced fixture and small mark coverage:
   - add Markdown smoke coverage for blockquote, horizontal rule, strikethrough, nested lists, task lists, table, image/media, and code
   - verify StarterKit preserves blockquote, horizontal rule, and strikethrough
   - add underline support as a rich-text mark
   - add theme tokens for blockquote and horizontal rule

2. Real outline:
   - extract headings from block HTML
   - extract collapsible list parent text
   - render hierarchical right-panel outline
   - jump to exact headings/list items

3. Frontmatter:
   - parse YAML-ish frontmatter without overbuilding
   - add page metadata fields
   - remove frontmatter from imported body
   - show a compact metadata strip later if useful

4. Footnotes:
   - enable Markdown footnote parsing or add a preprocessing pass
   - style footnotes through theme tokens and Typora selectors

5. Math:
   - choose the package after checking current Tiptap compatibility
   - add inline/block math import/render
   - add CSS hooks

Each subfeature should be separately committed and tested.

### Phase 2: Typora Theme Infrastructure

1. Add theme registry:
   - native shell themes
   - native content themes
   - Typora content themes

2. Add content theme scope:
   - `.typora-theme`
   - `.typora-write`
   - `data-content-theme`

3. Add CSS bridge:
   - `#write` equivalent
   - `.md-fences` equivalent
   - task list equivalent
   - footnote/math/TOC equivalents

4. Add importer/prefixer:
   - use PostCSS or another CSS parser
   - rewrite selectors
   - copy assets
   - write manifest entry

5. Add UI:
   - content theme picker
   - shell preset picker or automatic preset per Typora theme

### Phase 3: Pilot Typora Themes

Install five pilot themes first:

- Konayuki
- Folio
- Zeus
- Bonne nouvelle
- Flexoki Light

Acceptance:

- theme CSS is scoped
- app shell is not polluted
- writing surface is visibly changed
- headings, paragraph, quote, code, table, image/media, todo, footnote, and math remain readable
- editor still works
- no theme breaks block collapse, drag, import, or save/load

### Phase 4: Batch Import And Curation

Import the remaining candidate themes after the bridge is stable.

Candidate list from user:

- Inkwell
- Salamander
- Maodie
- Crisp
- Folio
- Swiss
- Blue Topaz
- LaTeX Typora
- Paperglow
- Gruvbox
- Zeus
- Bit Clean
- Bonne nouvelle
- Print
- Konayuki
- Neon
- Everforest
- Screenplay
- Flexoki Light
- mdmdt
- Ravel
- Ceylon
- Blackout
- Whitelines
- LCARS
- Valve
- Alise
- Torillic
- Chocolate Box
- Eloquent
- Inside
- Law
- Minimalism

After batch import, curate:

- keep as-is themes that work well
- mark broken themes as experimental
- extract favorite parts into native notebook themes
- create hybrid themes from multiple sources

## Testing Strategy

Automated tests:

- `pnpm build`
- `pnpm test:markdown`
- `pnpm test:editor`
- `pnpm test:theme`
- Rust attachment tests
- new Typora theme smoke test

Typora theme smoke should check:

- theme scope data attributes
- app shell styles do not get overwritten by content CSS
- h1/h2/p/blockquote/code/table/media visibly receive content theme styles
- editor typing still works
- collapsed bullets still work
- imported math and footnotes remain in DOM

Visual tests:

- Playwright screenshots for desktop and narrow viewport
- one screenshot per pilot Typora theme
- compare for blank pages, overflow, unreadable text, broken media, and polluted sidebar

Manual review:

- user picks whether a pilot theme is "keep", "adjust", or "discard"
- note reusable parts such as bullet markers, code blocks, quote boxes, spacing, and image treatment

## Versioning And Commit Plan

Commit in small chunks:

1. `Plan Typora theme compatibility`
2. `Audit Typora theme CSS requirements`
3. `Add advanced markdown fixture coverage`
4. `Add underline rich text support`
5. `Build real page outline`
6. `Import markdown frontmatter metadata`
7. `Render markdown footnotes`
8. `Render latex math`
9. `Add Typora content theme scope`
10. `Add Typora CSS prefixer`
11. `Install pilot Typora themes`
12. `Add Typora theme smoke tests`

Do not batch content features and theme importer into one large commit.

## Risks

- Raw Typora CSS may rely on invalid assumptions about DOM, global body styles, or Typora-only classes.
- Some themes may use assets or fonts that need careful path rewriting.
- Math and footnote rendering can affect Markdown export fidelity.
- Tiptap may strip unsupported HTML unless matching nodes/extensions exist.
- Theme CSS can make content beautiful but app shell incoherent if shell tokens are not chosen carefully.
- Too many imported themes too early can slow the app and make theme QA noisy.

## First Implementation Recommendation

Start with Phase 1, item 1: advanced fixture and small mark coverage.

Reason:

- The audit shows Typora themes heavily style blockquote, horizontal rule, strikethrough, code, tables, images, task lists, and markers.
- Several of these are likely already supported by StarterKit, but under-tested.
- Fixing small gaps before the theme bridge prevents false assumptions during compatibility work.
- It does not depend on third-party math/theme packages.
- It gives the later Typora bridge a reliable fixture to test against.
