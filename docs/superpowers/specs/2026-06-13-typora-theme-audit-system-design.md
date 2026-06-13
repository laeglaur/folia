# Typora Theme Audit System Design

## Purpose

Before adapting more Typora themes, audit each target theme for actual CSS coverage, DOM dependencies, Chinese font readiness, layout risk, and shim/offload needs. The goal is to choose complete themes first instead of installing visually broken themes and repairing them one by one.

## Scope

This design covers a documentation and tooling pass only:

- verify target theme source links
- download raw CSS into a temporary audit cache
- analyze CSS selectors and declarations
- expand `docs/typora-theme-targets.md` with capability columns
- classify themes as ready, good candidate, needs shim, or experimental

This pass does not change runtime theme rendering, editor DOM, toolbar behavior, or the current app UI.

## Audit Fields

Each theme should be recorded with:

- Theme name
- Import ID
- Source status and verified source URL
- CSS variants, such as light, dark, noir, print, or compact variants
- Chinese font support: explicit CJK font, acceptable CJK fallback, weak fallback, or unknown
- Base typography coverage: `body`, `html`, `#write`, `p`, `h1` through `h6`
- Code coverage: inline `code`, `pre`, `.md-fences`, `.CodeMirror`, `.cm-*`
- Table coverage: `table`, `thead`, `tbody`, `th`, `td`, zebra rows, borders
- List coverage: `ul`, `ol`, `li`, marker styling, nested lists
- Task coverage: `.task-list-item`, `.md-task-list-item`, checkbox styling
- Media coverage: `img`, `.md-image`, image metadata or caption selectors
- Inline semantic coverage: `strong`, `em`, `mark`, `del`, `s`, `u`, `a`
- Block semantic coverage: `blockquote`, `hr`, callout or alert selectors
- Advanced content coverage: TOC, footnotes, math, diagrams or Mermaid
- Layout risk: fixed widths, inch/mm page sizing, large padding, absolute heading decorations, print-only assumptions
- Typora UI leakage: sidebar, search panel, menus, preferences, source mode, focus mode, tooltips
- DOM dependency notes: Typora classes we would need to emit or alias
- Offload level: none, light, medium, heavy
- Adaptation grade: ready, good candidate, needs shim, experimental
- User-facing notes: why it is aesthetically promising or risky

## Automated Analysis

Add a script, tentatively `scripts/audit-typora-themes.mjs`, that reads a theme target list and produces a Markdown audit table plus a machine-readable JSON report.

The script should use a CSS parser rather than grep-only parsing. It should count selectors and declarations by category:

- typography selectors
- code selectors
- table selectors
- list and task selectors
- media selectors
- inline mark selectors
- blockquote and hr selectors
- TOC selectors
- footnote selectors
- math and diagram selectors
- Typora UI/source selectors
- layout-risk declarations
- font-family declarations with CJK detection

The script should not install themes into the app. It may download raw CSS into a temporary cache or `src/styles/typora/audit-cache/` if we decide the cache should be committed later. The first pass should prefer a temporary cache and commit only the generated docs/report.

## Chinese Font Detection

Chinese font support should be inferred from `font-family` declarations. The detector should flag common CJK fonts and generic fallbacks, including:

- `PingFang SC`
- `Hiragino Sans GB`
- `Microsoft YaHei`
- `Noto Sans CJK`
- `Source Han Sans`
- `Songti SC`
- `STSong`
- `SimSun`
- `SimHei`
- `Sarasa`
- `LXGW`
- `霞鹜`
- `思源`
- `方正`
- generic CJK-aware fallback notes if present

Themes with only decorative Latin fonts and no CJK fallback should not be first-round candidates unless the theme is used only as an aesthetic reference.

## Scoring

The script should compute a rough readiness score:

- content coverage score from typography, headings, lists, code, table, media, inline marks, blockquote/hr
- advanced support score from TOC, footnotes, math, diagrams
- Chinese font score
- layout safety score
- Typora UI leakage penalty
- CodeMirror/source-mode dependency penalty

The score should not be treated as aesthetic truth. It is a triage tool. Manual review can override it.

## Classification

Use these grades:

- `ready`: strong content CSS coverage, acceptable CJK fallback, low layout risk, low UI leakage
- `good candidate`: mostly complete, needs small DOM aliases such as `.md-fences` or `.md-image`
- `needs shim`: attractive but missing important rendered-content styles or has moderate DOM assumptions
- `experimental`: high UI leakage, heavy CodeMirror dependency, risky fixed layout, weak CJK support, or mostly useful as design inspiration

Use these offload levels:

- `none`: raw scoped CSS plus our standard DOM aliases should work
- `light`: a few compatibility classes or safe fallback styles
- `medium`: theme-specific layout/code/media adjustments
- `heavy`: substantial shim, source-mode dependency, or better treated as inspiration

## Manual Review Workflow

After automated audit:

1. Review the generated table for the installed pilot themes first.
2. Mark any incorrect automated inference.
3. Pick the first real adaptation set from `ready` and `good candidate`, not from personal taste alone.
4. Keep `needs shim` and `experimental` themes out of the app picker until their offload plan is explicit.

## Acceptance Criteria

- `docs/typora-theme-targets.md` includes the expanded capability table.
- A JSON audit report exists for reproducible comparison.
- The five installed pilot themes are classified.
- At least the full user target list has source status, even when source verification is still pending.
- The report clearly identifies which themes should be adapted first and which should be offloaded.
- No runtime UI or theme rendering code is changed in this pass.

