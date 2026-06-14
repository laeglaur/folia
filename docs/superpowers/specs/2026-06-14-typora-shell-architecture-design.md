# Typora Shell Architecture Redesign

Date: 2026-06-14

## Problem

The previous shell experiment mixed three ownership layers:

- native Garden/Ledger shell classes and tokens
- Typora content CSS scoped to `.typora-write`
- partial Typora sidebar selectors plus guard overrides

That made weak shell themes such as Swiss fall back to Garden capsule navigation, while strong shell themes such as Konayuki had to fight native shell defaults. The result was visually unstable and hard to reason about.

The fix is not another override. The app needs two explicit shell contracts.

## Goals

- Keep Garden and Ledger as native notebook shells with the existing three-column layout.
- Add a separate Typora shell that is parallel to Garden/Ledger, not layered on top of them.
- Use TyporaShell for all Typora themes.
- Do not add a user-facing left/right vs left/middle/right layout switch in this phase.
- TyporaShell is always left sidebar plus writing surface.
- Tools, outline, and pinned blocks live inside TyporaShell left sidebar tabs.
- Swiss and other weak shell themes fall back to TyporaShellBase, not Garden.
- Konayuki and other strong shell themes can override TyporaShellBase through their own Typora selectors.
- Preserve current Typora content fidelity for code, math, table, tasks, highlights, and import behavior.

## Non-Goals

- Do not redesign Garden or Ledger.
- Do not make Garden/Ledger use Typora DOM.
- Do not implement a layout mode selector.
- Do not clone Typora menus, status bar, quick open, preferences, search panel, or source mode.
- Do not make pin cards inherit full Typora page typography.

## Shell Model

The app has one theme selection concept for users, but two shell families internally.

```txt
Theme
├─ native
│  ├─ garden -> NativeShell, native content style
│  └─ ledger -> NativeShell, native content style
└─ typora
   ├─ typora-swiss -> TyporaShell + Swiss content/shell CSS
   ├─ typora-konayuki -> TyporaShell + Konayuki content/shell CSS
   ├─ typora-folio -> TyporaShell + Folio content/shell CSS
   └─ ...
```

The implementation may keep separate `theme` and `contentTheme` state fields temporarily for migration, but the UI and component architecture should treat Typora themes as whole-app themes.

## NativeShell Contract

NativeShell is the existing Garden/Ledger app shell.

Layout:

```txt
native sidebar | workspace/write surface | right panel
```

Responsibilities:

- notebook list
- nested page tree
- Garden/Ledger decorative brand block and note
- current right outline panel
- current pinned panel
- current topbar/tools layout unless later redesigned for native shells

CSS scope:

- NativeShell uses native classes such as `.sidebar`, `.notebook-button`, `.page-button`, `.right-panel`, `.panel-card`.
- These classes must not appear inside TyporaShell.
- Native shell CSS must not be used as fallback for TyporaShell.

## TyporaShell Contract

TyporaShell is a separate shell component and DOM contract.

Layout:

```txt
typora sidebar | #write/page surface
```

TyporaShell owns the whole Typora app canvas:

- app background outside `#write`
- sidebar background and border
- write-area surrounding whitespace
- shell/content boundary
- tab strip surface
- scroll container color

Typora themes often express this through `html`, `body`, `content`, `#typora-sidebar`, and `#write`. Those declarations must be routed to TyporaShell equivalents instead of being dropped or applied only to the editor body.

Sidebar tabs:

```txt
Files | Outline | Pin | Tools
```

DOM contract:

```html
<div class="typora-app-shell" data-typora-theme="typora-swiss">
  <aside id="typora-sidebar" class="typora-sidebar active-tab-files">
    <div class="sidebar-tabs">
      <button id="info-panel-tab-file" class="sidebar-tab active">Files</button>
      <button id="info-panel-tab-outline" class="sidebar-tab">Outline</button>
      <button class="sidebar-tab">Pin</button>
      <button class="sidebar-tab">Tools</button>
    </div>

    <div id="sidebar-content" class="sidebar-content">
      ...
    </div>
  </aside>

  <main class="typora-workspace">
    <section id="write" class="page-surface typora-write">
      ...
    </section>
  </main>
</div>
```

Files tab DOM:

```html
<div class="file-library">
  <div class="file-library-node" data-is-directory="true">
    <span class="file-node-background"></span>
    <button class="file-node-content active">
      <span class="file-node-open-state"></span>
      <span class="file-node-title file-name">Page title</span>
    </button>
  </div>
</div>
```

Outline tab DOM:

```html
<div id="outline-content" class="outline-content">
  <div class="outline-item outline-item-active">
    <span class="outline-expander"></span>
    <span class="outline-label">Heading</span>
  </div>
</div>
```

Pin tab DOM:

```html
<div class="typora-pin-list">
  <button class="typora-pin-card">...</button>
</div>
```

Pin cards intentionally do not use `#write`, `.typora-write`, or full Typora page styles.

Tools tab contains:

- search
- theme selector
- import/export
- toolbar visibility
- add composer visibility

There is no topbar in TyporaShell in this phase.

## TyporaShellBase

TyporaShellBase is the fallback shell for Typora themes that do not define shell styles.

It should approximate Typora's native shell, not Garden:

- left sidebar plus right writing surface
- Typora app background around the writing area
- non-decorative sidebar
- flat or lightly bordered tab strip
- file tree rows that are rectangular or minimally rounded
- no Garden capsule pills
- no Garden brand block
- no Garden sticky note
- no soft Garden shadows or aura decorations

TyporaShellBase must define stable dimensions:

- sidebar width close to Typora's default left sidebar, initially `260px`
- sidebar/content boundary: one subtle border or theme-derived divider
- sidebar full-height behavior with internal scrolling
- write surface centered independently of sidebar

The exact width can be adjusted after visual comparison, but it must live in TyporaShellBase tokens, not Garden layout tokens.

## Typora Theme CSS Pipeline

Typora raw CSS should be split by intent during prefixing.

Outputs:

```txt
typora-content.generated.css
typora-shell.generated.css
typora-vars.generated.css
```

Rules:

- `#write`, `.typora-export`, content elements -> content CSS under TyporaShell.
- `html`, `body`, and `content` background/color declarations -> TyporaShell app canvas when they describe shell-level background/color.
- `#typora-sidebar`, `.sidebar-tabs`, `.file-*`, `.outline-*`, `.active-tab-*` -> shell CSS under TyporaShell.
- pure CSS variable rules from `:root`, `html`, or `body` -> Typora theme root, so both content and shell can use them.
- `html/body` layout declarations are not applied globally; content-relevant declarations map to `#write`, shell variables map to theme root.
- CodeMirror/source mode, quick open, preferences, menu, modal, context menu, status/footer rules are ignored unless a future feature implements matching DOM.

Cascade order:

```css
@layer reset;
@layer native-shell;
@layer typora-shell-base;
@layer typora-theme-vars;
@layer typora-theme-shell;
@layer typora-theme-content;
@layer typora-bridge;
@layer safety;
```

Ownership:

- Native shell styles only target NativeShell.
- TyporaShellBase only targets TyporaShell.
- Typora theme shell CSS overrides TyporaShellBase.
- Safety rules only prevent invisibility, overflow, and unusable controls. Safety rules must not impose Garden visual language.

## Theme Behavior

Swiss:

- Swiss CSS mostly defines root colors and `#write`.
- Swiss sets `html, body` background to `--bg`; TyporaShell app canvas must receive that background.
- It has no full `#typora-sidebar`/file tree styling.
- Result: TyporaShellBase controls sidebar layout and shape; Swiss variables influence colors where applicable.
- No Garden capsule fallback.

Konayuki:

- Konayuki defines sidebar tokens and explicit `#typora-sidebar`, `.file-node-content`, `.file-list-item`, and `.outline-item` rules.
- Result: Konayuki overrides TyporaShellBase and gets its floating rounded sidebar style.

Folio:

- Folio defines `#typora-sidebar` and outline styles.
- Result: Folio uses TyporaShellBase for missing file-tree details and Folio CSS for sidebar/outline it defines.

## Component Boundaries

Target component structure:

```txt
App
├─ NativeShell
│  ├─ NativeSidebar
│  ├─ NativeWorkspace
│  └─ NativeRightPanel
└─ TyporaShell
   ├─ TyporaSidebar
   │  ├─ TyporaFilesTab
   │  ├─ TyporaOutlineTab
   │  ├─ TyporaPinTab
   │  └─ TyporaToolsTab
   └─ TyporaWorkspace
```

Shared behavior should be passed as props:

- active notebook/page
- page tree render data
- outline entries
- pinned blocks
- editor/write surface
- import/export actions
- theme selection

Shared panels should not share shell class names. A page row may share data and event handlers, but NativeShell and TyporaShell render different class names.

## Migration Plan

1. Keep the revert of the mixed shell-layout experiment.
2. Add shell family resolver:
   - Garden/Ledger -> NativeShell
   - Typora themes -> TyporaShell
3. Extract NativeShell around the current JSX with minimal behavior changes.
4. Create TyporaShell separately with Typora DOM/class contract.
5. Add TyporaShellBase CSS.
6. Update the Typora CSS prefixer to emit variables/content/shell with clear selector routing.
7. Re-enable Typora shell selectors only inside TyporaShell.
8. Add smoke tests for:
   - Garden remains three-column and keeps Garden decorations.
   - Ledger remains three-column and hides decorations as before.
- Swiss TyporaShell has no Garden capsule nav items.
- Swiss TyporaShell app canvas uses Swiss background rather than Garden background.
- Swiss uses TyporaShellBase fallback sidebar.
   - Konayuki sidebar receives its own background, border radius, shadow, and active item rules.
   - Outline and Pin are inside Typora sidebar tabs.
   - Pin remains compact.
   - Topbar is absent in TyporaShell.

## Testing

Required commands:

```bash
pnpm build
APP_URL=http://127.0.0.1:5173/ pnpm test:theme
APP_URL=http://127.0.0.1:5173/ pnpm test:markdown
```

Add visual/computed assertions:

- `typora-swiss` file row `border-radius` is not `999px`.
- `typora-swiss` file row does not use native Garden shadow.
- `typora-konayuki` sidebar background image includes a gradient from its CSS.
- `typora-konayuki` sidebar radius matches its theme rule.
- TyporaShell contains `#typora-sidebar`; NativeShell does not.
- TyporaShell does not render `.brand-block` or `.sidebar-note`.

## Open Decisions

- Exact TyporaShellBase sidebar width after visual comparison with Typora.
- Whether TyporaShell Files tab should combine notebooks and pages in one file tree or keep notebooks as a small selector above pages.
- Whether Pin tab should show cards or a compact list first.

These should be resolved during implementation review, not by reintroducing a layout selector.
