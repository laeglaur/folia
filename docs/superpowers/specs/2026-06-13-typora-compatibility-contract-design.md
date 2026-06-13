# Typora Compatibility Contract

Date: 2026-06-13

## Purpose

Typora themes should render notebook content with Typora-level fidelity without letting raw Typora CSS take over the notebook app shell.

The key decision is to adopt Typora's content-page contract, not Typora's full application contract. The notebook keeps its own block model, sidebar, page tree, toolbar, pin cards, and sync/state architecture. The rich-text content inside a block must look enough like Typora's `#write` document for Typora theme selectors to land on the right semantic elements.

## Why Previous Adaptation Failed

Typora themes are consistent because they target a stable DOM vocabulary:

- `#write` as the document surface
- `.md-heading`, `.md-end-block`, `.md-fences`, `.md-table`, `.md-image`
- `.task-list-item`, `.md-task-list-item`, `.task-list-done`
- `.md-toc`, `.md-toc-content`, `.md-toc-item`
- `.footnotes`, `.md-def-footnote`, `.md-footnote`
- `.md-math-inline`, `.md-math-block`, `.mathjax-inline`, `.mathjax-block`

Our app currently has different wrappers:

- `.page-surface`, `.block`, `.block-content`, `.composer`
- Tiptap-native elements such as `pre`, `table`, `li[data-type="taskItem"]`
- app shell elements such as `.sidebar`, `.right-panel`, `.desktop-card`, `.format-toolbar`

The earlier approach tried to translate too much CSS into our DOM. That creates fragile selector rewrites, huge font mismatches, code/table misses, overflow, and theme leakage into sidebar, TOC, toolbar, and pin cards.

## Architecture

Use four explicit layers.

### 1. Shell Layer

Owned by notebook CSS and theme tokens.

Includes:

- app background
- left navigation
- notebook/page tree
- page toolbar
- block rail and fold controls
- composer shell
- right outline panel
- pin card shell
- import notices and dialogs

Raw Typora CSS must not style this layer.

### 2. Block Layer

Owned by notebook layout CSS.

Blocks are still the unit of editing, pinning, moving, collapsing, calendar/kanban views, and future sync operations. A block may contain a complete rich-text mini-document.

The block wrapper should be visually transparent when a Typora content theme is active. It provides interaction affordances but should not create an extra visible "card inside a page" unless the shell theme explicitly asks for it.

### 3. Typora Content Layer

Owned by imported Typora CSS plus a small bridge stylesheet.

This is the only layer that receives Typora theme typography and content styling. It covers:

- headings
- paragraphs
- bold, italic, underline, strike, mark
- links
- inline code and code fences
- blockquotes and horizontal rules
- ordered, unordered, and task lists
- tables
- images, video, audio, embeds
- footnotes
- math
- right outline as the app equivalent of Typora TOC

### 4. Token Bridge Layer

Owned by notebook CSS.

This layer maps a chosen content theme into shell-safe tokens:

- page background
- app background
- sidebar text color
- outline text color
- accent color
- soft border color
- pin card background and text

The bridge can be explicit per theme at first. Later it may be inferred from audited CSS variables and declarations.

## Required DOM Contract

The app should expose these stable content classes.

### Content Host

The page content area:

```html
<section class="page-surface typora-content-surface typora-write">
  ...
</section>
```

Rules:

- There must be no repeated `id="write"`.
- `#write` selectors from Typora are rewritten to `.typora-write`.
- `html` and `body` selectors from Typora are rewritten to `.typora-write`.
- Fixed `width`, `max-width`, and large page paddings from Typora are contained so they do not push outside the app viewport.

### Editable Content Root

Each editor root keeps Tiptap behavior but participates in Typora content styling:

```html
<div class="block-content editable tiptap-editor typora-block-doc">
  ...
</div>
```

Composer:

```html
<div class="composer tiptap-editor typora-block-doc">
  ...
</div>
```

Rules:

- `.typora-block-doc` inherits the active `.typora-write` typography.
- It must not reset font size or line height back to notebook defaults when a Typora content theme is active.
- It must remain width-constrained by the page and block layout.

### Blocks

```html
<article class="block">
  <div class="block-rail">...</div>
  <div class="block-main">
    <div class="block-content ... typora-block-doc">...</div>
  </div>
</article>
```

Rules:

- Typora CSS should not target `.block` directly.
- Block margins and interaction chrome are app-owned.
- In Typora themes, block background is transparent and borders are subtle or absent unless the shell theme opts in.

### Headings

Target DOM:

```html
<h1 class="md-heading md-end-block" data-heading-level="1">Title</h1>
```

Rules:

- Support `h1` through `h6`.
- Keep the real heading element for accessibility and outline extraction.
- Add Typora aliases, do not replace semantic HTML.

### Paragraphs And Inline Marks

Target DOM:

```html
<p class="md-end-block">Text <mark>highlight</mark> <code>inline</code></p>
```

Rules:

- Paragraphs should carry `.md-end-block`.
- Inline mark/code/link/bold/italic/underline/strike remain semantic HTML.
- Theme CSS may style `mark`, `code`, `a`, `strong`, `em`, `u`, `s`, and `del`.

### Code Fences

Target DOM:

```html
<pre class="md-fences md-end-block"><code>const ok = true;</code></pre>
```

Rules:

- Keep `pre > code`.
- Add `.md-fences` to `pre`.
- Do not rewrite `.md-fences` selectors to generic `pre` once this class exists.
- Preserve overflow containment.

### Tables

Target DOM:

```html
<table class="md-table">
  ...
</table>
```

Rules:

- Add `.md-table` to `table`.
- Keep native `thead`, `tbody`, `tr`, `th`, `td`.
- Wrap or constrain wide tables at the content layer so the page does not overflow.

### Lists And Tasks

Target DOM:

```html
<ul>
  <li class="md-list-item md-end-block" data-list-collapsed="false">...</li>
</ul>
<ul data-type="taskList" class="contains-task-list">
  <li class="task-list-item md-task-list-item md-end-block" data-type="taskItem" data-checked="false">...</li>
</ul>
```

Rules:

- All bullet and numbered list items remain collapsible through `data-list-collapsed`.
- The fold affordance is app-owned. It should align with the first line and not be styled by Typora list markers.
- `task-list-item` and `md-task-list-item` classes are aliases for Typora CSS.
- Bracket todos keep notebook-specific `data-todo-style="bracket"` and can receive shell theme styling.

### Media

Target DOM:

```html
<img class="md-image" src="..." />
<video class="md-media" controls src="..."></video>
<audio class="md-media" controls src="..."></audio>
<iframe class="media-embed md-media" src="..."></iframe>
```

Rules:

- Typora image rules can apply to images.
- Video, audio, and embeds use notebook fallback styles when Typora themes do not define them.
- Media must stay within the block width.

### Footnotes

Target DOM:

```html
<sup class="md-footnote"><a href="#fn-a">[a]</a></sup>
<section class="footnotes">
  <div class="md-def-footnote" id="fn-a">...</div>
</section>
```

Rules:

- Use Typora-compatible classes.
- Keep notebook fallback styles for themes that omit footnotes.

### Math

Target DOM:

```html
<span class="md-math-inline mathjax-inline" data-type="inline-math">...</span>
<div class="md-math-block mathjax-block" data-type="block-math">...</div>
```

Rules:

- Add Typora aliases around the Tiptap math output.
- Keep KaTeX rendering.
- Keep overflow containment for block math.

### Right Outline As Typora TOC

The right outline is the app equivalent of Typora TOC:

```html
<div class="outline-list typora-toc md-toc md-toc-content">
  <button class="outline-entry md-toc-item">...</button>
</div>
```

Rules:

- Typora TOC typography may influence the right outline through a controlled selector map.
- The outline panel background, sizing, and readability remain shell-owned.
- Dark content themes must not make the outline unreadable.

### Pin Cards

Pin cards are not Typora pages.

Rules:

- Pin cards must not inherit the full Typora content font scale, page padding, or layout.
- They may borrow colors through shell tokens.
- Pin content should stay compact and readable.

## CSS Import Contract

Imported Typora CSS goes through a prefixer.

Allowed rewrites:

- `#write` -> `.typora-write`
- `html`, `body`, `:root` -> `.typora-write`
- `.md-toc*` -> right outline aliases under the theme root
- Typora task selectors -> the alias classes and Tiptap task attributes
- Typora math selectors -> alias classes and `data-type` attributes

Avoid rewrites when aliases exist:

- Do not rewrite `.md-fences` to generic `pre`.
- Do not rewrite `.md-table` to generic `table`.
- Do not rewrite `.md-image` to generic `img`.

Discard or sandbox:

- Typora sidebar/file tree
- CodeMirror/source mode
- menu, context menu, quick open, search panel
- window chrome
- print-only export hacks that force fixed page size

Containment rules:

- Prevent horizontal overflow on `.typora-write`, `.typora-block-doc`, `pre`, `table`, media, and math.
- Clamp imported `#write`/body widths and paddings to the app page surface.
- Normalize `box-sizing: border-box` inside the content layer.
- Prevent pseudo-elements from escaping block boundaries.

## Fallback Contract

Typora themes vary. Missing semantics should use notebook fallbacks only for missing pieces.

Fallbacks should be semantic, not global:

- If a theme lacks task styles, use notebook task fallback.
- If a theme lacks image styles, use notebook media fallback.
- If a theme lacks footnote styles, use notebook footnote fallback.
- If a theme lacks CJK fonts, append a notebook CJK fallback stack.
- If a theme lacks media styles, video/audio/embed use notebook media fallback.

Fallbacks must not flatten the theme's identity. They only fill uncovered elements.

## First Implementation Scope

Focus on two correctness sample themes first:

- `typora-konayuki`: bright, soft, image/code/table coverage, high user priority.
- `typora-swiss`: boxy, CJK-aware, light adaptation cost, good test for sharp layout.

Then expand to the first wave:

- `typora-zeus`
- `typora-bit-clean`
- `typora-blackout`
- `typora-salamander`
- `typora-alise`

Special writing modes stay separate:

- `typora-bonne-nouvelle`
- later `screenplay`-style themes

## Acceptance Criteria

Visual:

- No content theme creates a block-inside-block look.
- No content theme pushes text, code, tables, or pseudo-elements outside the page.
- Typora font size and spacing are respected inside content, but shell controls remain readable.
- Dark themes produce coherent page/app surroundings and readable TOC.
- Pin cards stay compact regardless of content theme.
- Code and table styles visibly match the original theme's intent.

DOM:

- Headings, paragraphs, code fences, tables, images, task items, footnotes, math, and TOC expose Typora-compatible aliases.
- There is exactly one `.typora-write` content surface for the page, not one fake Typora page per block.
- There is no repeated `id="write"`.

Tests:

- Build passes.
- Editor smoke still passes.
- Markdown import smoke still passes.
- Theme smoke verifies DOM aliases, shell isolation, pin compactness, overflow containment, and content style application.
- Playwright screenshots are taken for at least Konayuki and Swiss before a theme is marked adapted.

## Versioning

Every substantial step should be committed:

1. Contract document.
2. DOM aliases and prefixer contract update.
3. First two adapted themes with smoke tests.
4. First-wave expansion.

