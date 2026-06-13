# Typora Theme CSS Audit

Updated: 2026-06-13

## Purpose

Audit representative Typora themes before implementing compatibility, so we know which document features and CSS hooks are actually required.

Audited themes:

- Konayuki light/dark
- Folio / Folio Noir
- Zeus
- Bonne nouvelle

These were cloned into a temporary audit directory and not added to the repository.

## High-Level Finding

Typora themes are not only color palettes. They commonly style:

- page width, paper surface, and writing area spacing through `#write`
- headings
- paragraphs
- links
- blockquotes
- horizontal rules
- ordered and unordered lists
- custom list markers
- task list checkboxes
- inline marks such as strong, emphasis, highlight, deletion/strikethrough, and link underlines
- code fences and inline code
- tables
- images and image metadata
- footnote references and footnote definitions
- inline TOC blocks
- math blocks
- source-mode CodeMirror syntax
- Typora sidebar/search/menu UI

Therefore the compatibility work should not start by blindly installing many themes. It should first add a richer document fixture and close small content gaps, then build the scoped CSS bridge.

## Selector Pattern Summary

Approximate pattern counts from the sampled CSS:

| Theme CSS | `#write` | table | code/source | inline marks | TOC | footnotes | math | Typora UI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Konayuki light | 112 | 255 | 47 code + 69 source | 154 | 18 | 4 | 2 | 174 |
| Konayuki dark | 112 | 255 | 46 code + 69 source | 154 | 18 | 4 | 2 | 174 |
| Folio | 17 | 8 | 13 code + 2 source | 61 | 19 | 1 | 0 | 15 |
| Folio Noir | 27 | 8 | 55 code + 46 source | 134 | 30 | 1 | 0 | 84 |
| Zeus | 19 | 34 | 85 code + 74 source | 83 | 9 | 1 | 7 | 14 |
| Bonne nouvelle | 9 | 10 | 10 code + 8 source | 34 | 6 | 0 | 0 | 33 |

The exact counts are less important than the shape:

- `#write` scoping is essential.
- Tables and code are heavily styled.
- TOC and footnote selectors appear across the sample.
- Source-mode and Typora UI selectors are common but should be sandboxed or ignored early.
- Math appears in enough themes to justify planned support before serious theme curation.

## Concrete Examples

### Page Surface

Folio uses `#write` as a paper sheet with physical dimensions, padding, border, and shadow. Zeus uses `#write` as a centered max-width dark writing column. This maps well to our content surface, but not directly to the whole app shell.

Compatibility implication:

- Map `#write` to `.typora-write`.
- Keep `.page-surface` and block shells controlled by notebook shell tokens.
- Let a Typora content theme influence page width only through scoped content tokens or shell presets.

### Lists And Markers

Bonne nouvelle changes list markers to an em dash. Other themes style marker colors and task list checkboxes.

Compatibility implication:

- Our CSS bridge needs list marker hooks.
- Collapsible bullet controls must remain ours.
- Theme marker styling should not break the fold affordance.

### Inline Marks

Zeus styles:

- `mark`
- `del`
- `strong`
- `em`
- link underlines

Compatibility implication:

- We already support strong, em, mark, inline code, and links.
- Markdown smoke should cover strikethrough.
- Underline should be added because Typora themes commonly style link underlines and users expect underline as a rich-text mark.

### Blockquote And HR

Folio, Zeus, and Bonne nouvelle all style blockquotes. Zeus styles dashed horizontal rules.

Compatibility implication:

- StarterKit likely supports blockquote and horizontal rule, but our smoke tests do not prove import/editor preservation.
- Add explicit Markdown smoke coverage and theme tokens for `blockquote` and `hr`.

### Images

Konayuki styles `#write img`, `.md-image`, and `.md-image > .md-meta`. Folio and Bonne nouvelle also style image metadata.

Compatibility implication:

- We already support images and media.
- We do not have Typora's `.md-image` wrapper or metadata.
- First bridge should style our plain `img`.
- Later media captions/metadata can use a notebook-specific wrapper class that also aliases `.md-image` behavior.

### Tables

Konayuki has extensive table and table-edit UI styling. Zeus and Folio style table borders, zebra rows, headers, spacing, and collapse model.

Compatibility implication:

- Content table styling is in scope.
- Typora table edit popover selectors are not in scope because our table editor DOM is different.

### Code And Source Mode

All sampled themes style code fences and inline code. Many also style `.CodeMirror`, `.cm-s-inner`, and `#typora-source`.

Compatibility implication:

- Map `.md-fences` to our `pre`.
- Map inline `code` directly.
- Ignore source-mode selectors until we add Markdown source mode.
- Do not let `.CodeMirror` rules leak into the app.

### TOC

Folio, Konayuki, Zeus, and Bonne nouvelle style `.md-toc` and `.md-toc-content`.

Compatibility implication:

- Real outline should be implemented first.
- Later, an inline TOC block can use Typora-compatible classes:
  - `.md-toc`
  - `.md-toc-content`
  - `.md-toc-item`
  - `.md-toc-h1` through `.md-toc-h6`

### Footnotes

Konayuki and Folio style `.md-footnote` and footnote metadata/definitions. Zeus styles `.md-footnote`.

Compatibility implication:

- Footnotes are not optional for good Typora compatibility.
- Use Typora-compatible class names where possible:
  - `.md-footnote`
  - `.md-def-footnote`
  - `.md-def-link`

### Math

Zeus and Konayuki include math-related styling or variables. Zeus also sets a Mermaid theme variable, but Mermaid itself is not central in these samples.

Compatibility implication:

- Math support should be in the first content feature wave.
- Mermaid can remain deferred.

### Typora UI And Sidebar

Konayuki and Bonne nouvelle include many selectors for Typora sidebar, menus, search panel, preferences, focus mode, and source mode.

Compatibility implication:

- These selectors must be ignored, sandboxed, or rewritten only if explicitly mapped.
- Notebook sidebar and toolbar should use shell tokens, not raw Typora UI CSS.

## Current Notebook Capability Matrix

| Feature | Current status | Compatibility action |
| --- | --- | --- |
| Headings | supported | add real outline anchors |
| Paragraphs | supported | scope Typora styles to content |
| Bold/italic | supported | ensure fixture coverage |
| Highlight | supported | ensure Typora `mark` bridge |
| Inline code/code block | supported | map `.md-fences` to `pre` |
| Links | supported | ensure underline/text-decoration tokens |
| Images | supported | bridge plain `img`; later add captions/wrapper |
| Video/audio/embed | supported | style as media; not native Typora priority |
| Tables | supported | bridge table styles |
| Bullet/ordered lists | supported | support marker styling without breaking collapse |
| Task list | supported | bridge `.md-task-list-item` to Tiptap task items |
| Blockquote | likely supported by StarterKit, under-tested | add smoke and theme tokens |
| Horizontal rule | likely supported by StarterKit, under-tested | add smoke and theme tokens |
| Strikethrough | likely supported by StarterKit, under-tested | add smoke/tooling if missing |
| Underline | not present | add mark extension and toolbar/shortcut later |
| Footnotes | not supported | implement before serious Typora curation |
| Inline/block math | not supported | implement before serious Typora curation |
| Inline TOC | not supported | implement after real outline |
| Frontmatter metadata | not supported | implement early for import workflow |
| Source mode / CodeMirror | not supported | defer |
| Mermaid/diagram | not supported | defer |
| Typora sidebar/file tree CSS | not applicable | do not directly support |

## Revised Implementation Priority

Before real Typora theme import:

1. Add advanced Markdown fixture coverage:
   - blockquote
   - horizontal rule
   - strikethrough
   - underline if we add support
   - subscript/superscript can remain later unless a target theme clearly needs it
2. Add or verify small editor/content marks:
   - strikethrough import/editor persistence
   - underline rich-text support
   - blockquote and horizontal rule styling tokens
3. Build real outline/TOC anchors.
4. Import YAML frontmatter into page metadata.
5. Add footnotes.
6. Add LaTeX/math.
7. Then implement Typora scoped CSS bridge and pilot themes.

This order is slightly different from the earlier plan: the audit shows small inline/block features should be verified before the heavier outline/frontmatter/footnote/math work, because many Typora themes style those basic elements heavily.

## First Practical Next Step

Add an advanced Markdown fixture and smoke coverage for the elements already supported or nearly supported:

- blockquote
- horizontal rule
- strikethrough
- basic link underline preservation
- table
- image
- code
- task list
- nested list

Then fix any failing gaps before implementing the real outline.
