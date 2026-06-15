import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react';
import { Download, FilePlus, FileUp, NotebookTabs, PanelRight, Plus, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Block, ContentThemeId, Notebook, ShellId } from './types';
import type { OutlineEntry } from './app-utils';
import { blockTimestampLabel } from './app-utils';
import { RichEditor, type MediaResizeRequest } from './editor';
import { contentThemes } from './typora-theme-registry';

type ShellThemeOption = {
  id: ShellId;
  label: string;
};

type NotebookActions = {
  addNotebook: () => void;
  selectNotebook: (notebook: Notebook) => void;
  duplicateNotebook: (notebookId: string) => void;
  deleteNotebook: (notebookId: string) => void;
};

type ToolControlsProps = {
  compact?: boolean;
  showToolbar: boolean;
  showComposerFooter: boolean;
  newestFirst: boolean;
  shell: ShellId;
  contentTheme: ContentThemeId;
  shellThemes: ShellThemeOption[];
  markdownInputRef: RefObject<HTMLInputElement | null>;
  markdownFolderInputRef: RefObject<HTMLInputElement | null>;
  outlineOpen: boolean;
  sidebarCollapsed: boolean;
  onShowToolbarChange: (show: boolean) => void;
  onShowComposerFooterChange: (show: boolean) => void;
  onNewestFirstChange: (newestFirst: boolean) => void;
  onShellChange: (shell: ShellId) => void;
  onContentThemeChange: (contentTheme: ContentThemeId) => void;
  onOutlineToggle: () => void;
  onSidebarToggle: () => void;
  onMarkdownFilesChange: (files: FileList | null) => void;
  onMarkdownFolderChange: (files: FileList | null) => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
};

function ToolControls({
  compact = false,
  showToolbar,
  showComposerFooter,
  newestFirst,
  shell,
  contentTheme,
  shellThemes,
  markdownInputRef,
  markdownFolderInputRef,
  outlineOpen,
  sidebarCollapsed,
  onShowToolbarChange,
  onShowComposerFooterChange,
  onNewestFirstChange,
  onShellChange,
  onContentThemeChange,
  onOutlineToggle,
  onSidebarToggle,
  onMarkdownFilesChange,
  onMarkdownFolderChange,
  onExportMarkdown,
  onExportJson
}: ToolControlsProps) {
  return (
    <div className={compact ? 'typora-tool-controls' : 'topbar-actions'}>
      <label className="view-toggle"><input type="checkbox" checked={showToolbar} onChange={(event) => onShowToolbarChange(event.target.checked)} /> Toolbar</label>
      <label className="view-toggle"><input type="checkbox" checked={showComposerFooter} onChange={(event) => onShowComposerFooterChange(event.target.checked)} /> Add</label>
      <label className="view-toggle">
        <span>Newest first</span>
        <input
          type="checkbox"
          checked={newestFirst}
          onChange={(event) => onNewestFirstChange(event.target.checked)}
        />
      </label>
      <select
        className="theme-select shell-theme-select"
        value={shell}
        onChange={(event) => onShellChange(event.target.value as ShellId)}
        aria-label="Shell theme"
      >
        {shellThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
      </select>
      <select
        className="theme-select content-theme-select"
        value={contentTheme}
        onChange={(event) => onContentThemeChange(event.target.value as ContentThemeId)}
        aria-label="Content theme"
      >
        {contentThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
      </select>
      <input
        ref={markdownInputRef}
        hidden
        multiple
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        type="file"
        onChange={(event) => {
          onMarkdownFilesChange(event.target.files);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={markdownFolderInputRef}
        hidden
        multiple
        // React does not type these Chromium directory-picker attributes yet.
        {...{ webkitdirectory: '', directory: '' }}
        type="file"
        onChange={(event) => {
          onMarkdownFolderChange(event.target.files);
          event.currentTarget.value = '';
        }}
      />
      <button
        className={`secondary-button ${outlineOpen ? 'active' : ''}`}
        type="button"
        onClick={onOutlineToggle}
        aria-pressed={outlineOpen}
      >
        <PanelRight size={15} /> Outline
      </button>
      <button
        className={`secondary-button ${sidebarCollapsed ? 'active' : ''}`}
        type="button"
        onClick={onSidebarToggle}
        aria-pressed={sidebarCollapsed}
      >
        <NotebookTabs size={15} /> Sidebar
      </button>
      <button className="secondary-button" type="button" onClick={() => markdownInputRef.current?.click()}><FileUp size={15} /> Import MD</button>
      <button className="secondary-button" type="button" onClick={() => markdownFolderInputRef.current?.click()}><FileUp size={15} /> Import folder</button>
      <button className="secondary-button" type="button" onClick={onExportMarkdown}><Download size={15} /> Markdown</button>
      <button className="secondary-button" type="button" onClick={onExportJson}><Upload size={15} /> Backup</button>
    </div>
  );
}

type ShellControlsProps = Omit<ToolControlsProps, 'compact'>;

function FishDesk({ fishIconUrl, controls }: { fishIconUrl: string; controls: ShellControlsProps }) {
  return (
    <aside className="fish-desk" aria-label="Desk controls">
      <button className="fish-desk-trigger" type="button" aria-label="Open Desk controls">
        <img src={fishIconUrl} alt="" aria-hidden="true" />
      </button>
      <div className="fish-desk-panel">
        <div className="fish-desk-title">Desk</div>
        <ToolControls compact {...controls} />
      </div>
    </aside>
  );
}

function PinnedCards({
  pinnedBlocks,
  onOpenPinnedWindow,
  className = 'desktop-preview',
  cardClassName = 'desktop-card'
}: {
  pinnedBlocks: Block[];
  onOpenPinnedWindow: (blockId: string) => void;
  className?: string;
  cardClassName?: string;
}) {
  return (
    <div className={className}>
      {pinnedBlocks.length ? pinnedBlocks.map((block) => (
        <button
          className={cardClassName}
          key={block.id}
          type="button"
          onClick={() => onOpenPinnedWindow(block.id)}
        >
          <div dangerouslySetInnerHTML={{ __html: block.content.html }} />
        </button>
      )) : <p className="muted">Pin blocks to keep them close.</p>}
    </div>
  );
}

function SidebarPins({
  pinnedBlocks,
  onOpenPinnedWindow
}: {
  pinnedBlocks: Block[];
  onOpenPinnedWindow: (blockId: string) => void;
}) {
  return (
    <section className="sidebar-section pinned-sidebar-section">
      <div className="section-row">
        <div className="section-label">Pinned</div>
      </div>
      <PinnedCards pinnedBlocks={pinnedBlocks} onOpenPinnedWindow={onOpenPinnedWindow} className="sidebar-pin-list" cardClassName="sidebar-pin-card" />
    </section>
  );
}

function NotebookList({
  notebooks,
  activeNotebook,
  canDeleteNotebook,
  variant,
  actions
}: {
  notebooks: Notebook[];
  activeNotebook: Notebook;
  canDeleteNotebook: boolean;
  variant: 'native' | 'typora';
  actions: NotebookActions;
}) {
  if (variant === 'typora') {
    return (
      <div className="file-library">
        {notebooks.map((notebook) => (
          <div className="file-library-node" data-is-directory="true" key={notebook.id}>
            <span className="file-node-background" aria-hidden="true" />
            <div className={`file-node-row-shell ${notebook.id === activeNotebook.id ? 'active' : ''}`}>
              <button
                className="file-node-content notebook-node"
                type="button"
                onClick={() => actions.selectNotebook(notebook)}
              >
                <span className="file-node-open-state"><NotebookTabs size={13} /></span>
                <span className="file-node-title file-name">{notebook.name}</span>
              </button>
              <div className="row-actions file-node-actions">
                <button className="mini-button row-action duplicate-notebook-button" type="button" onClick={() => actions.duplicateNotebook(notebook.id)} aria-label={`Duplicate notebook ${notebook.name}`}><FilePlus size={13} /></button>
                {canDeleteNotebook ? (
                  <button className="mini-button row-action delete-notebook-button" type="button" onClick={() => actions.deleteNotebook(notebook.id)} aria-label={`Delete notebook ${notebook.name}`}><Trash2 size={13} /></button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="notebook-list">
      {notebooks.map((notebook) => (
        <div className={`notebook-row-shell ${notebook.id === activeNotebook.id ? 'active' : ''}`} key={notebook.id}>
          <button
            className={`notebook-button ${notebook.id === activeNotebook.id ? 'active' : ''}`}
            type="button"
            onClick={() => actions.selectNotebook(notebook)}
          >
            <NotebookTabs size={15} />
            {notebook.name}
          </button>
          <div className="row-actions notebook-row-actions">
            <button className="mini-button row-action duplicate-notebook-button" type="button" onClick={() => actions.duplicateNotebook(notebook.id)} aria-label={`Duplicate notebook ${notebook.name}`}><FilePlus size={13} /></button>
            {canDeleteNotebook ? (
              <button className="mini-button row-action delete-notebook-button" type="button" onClick={() => actions.deleteNotebook(notebook.id)} aria-label={`Delete notebook ${notebook.name}`}><Trash2 size={13} /></button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function NativeOutline({
  entries,
  onJump
}: {
  entries: OutlineEntry[];
  onJump: (entry: OutlineEntry) => void;
}) {
  return (
    <div className="outline-list typora-toc md-toc md-toc-content">
      {entries.map((entry) => (
        <button
          className={`outline-entry md-toc-item outline-kind-${entry.kind}`}
          key={entry.id}
          onClick={() => onJump(entry)}
          style={{ '--level': entry.level } as CSSProperties}
          type="button"
        >
          <span>{entry.kind === 'page' ? 'P' : entry.kind === 'block' ? 'B' : entry.kind === 'heading' ? `H${Math.max(1, entry.level - 1)}` : '•'}</span>
          <span>{entry.text}</span>
        </button>
      ))}
    </div>
  );
}

export function TyporaOutline({
  entries,
  onJump
}: {
  entries: OutlineEntry[];
  onJump: (entry: OutlineEntry) => void;
}) {
  return (
    <div id="outline-content" className="outline-content typora-toc md-toc md-toc-content">
      {entries.map((entry) => (
        <button
          className={`outline-item md-toc-item outline-kind-${entry.kind} ${entry.blockId === null ? 'outline-item-active active' : ''}`}
          key={entry.id}
          onClick={() => onJump(entry)}
          style={{ '--level': entry.level } as CSSProperties}
          type="button"
        >
          <span className="outline-expander" aria-hidden="true">{entry.kind === 'page' ? 'P' : entry.kind === 'block' ? 'B' : entry.kind === 'heading' ? `H${Math.max(1, entry.level - 1)}` : '•'}</span>
          <span className="outline-label">{entry.text}</span>
        </button>
      ))}
    </div>
  );
}

export function OutlineDrawer({
  open,
  content,
  extraContent,
  onClose
}: {
  open: boolean;
  content: ReactNode;
  extraContent?: ReactNode;
  onClose: () => void;
}) {
  return (
    <aside className={`outline-drawer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <header className="outline-drawer-head">
        <div className="panel-title"><PanelRight size={16} /> Outline</div>
        <button className="mini-button" type="button" onClick={onClose} aria-label="Close outline">×</button>
      </header>
      <div className="outline-drawer-body">
        {content}
        {extraContent}
      </div>
    </aside>
  );
}

function FloatingCardWindow({
  block,
  onClose
}: {
  block: Block | null;
  onClose: () => void;
}) {
  if (!block) return null;
  return (
    <div className="floating-card-window">
      <div className="floating-card-head">
        <span>{blockTimestampLabel(block.createdAt)}</span>
        <button type="button" onClick={onClose}>×</button>
      </div>
      <div className="floating-card-body" dangerouslySetInnerHTML={{ __html: block.content.html }} />
    </div>
  );
}

type BaseShellProps = {
  shell: ShellId;
  contentTheme: ContentThemeId;
  sidebarCollapsed: boolean;
  outlineOpen: boolean;
  activeNotebook: Notebook;
  notebooks: Notebook[];
  notebookActions: NotebookActions;
  query: string;
  onQueryChange: (query: string) => void;
  pageTree: ReactNode;
  typoraFileTree: ReactNode;
  workspaceContent: ReactNode;
  pinnedBlocks: Block[];
  openCardBlock: Block | null;
  onOpenPinnedWindow: (blockId: string) => void;
  onCloseFloatingCard: () => void;
  onRootPageDrop: (pageId: string) => void;
  onAddPage: () => void;
  controls: ShellControlsProps;
  outlineEntries: OutlineEntry[];
  onJumpToOutlineEntry: (entry: OutlineEntry) => void;
  fishIconUrl: string;
};

export function NativeShell({
  shell,
  contentTheme,
  sidebarCollapsed,
  activeNotebook,
  notebooks,
  notebookActions,
  query,
  onQueryChange,
  pageTree,
  workspaceContent,
  pinnedBlocks,
  openCardBlock,
  onOpenPinnedWindow,
  onCloseFloatingCard,
  onRootPageDrop,
  onAddPage,
  controls,
  outlineEntries,
  onJumpToOutlineEntry,
  fishIconUrl
}: BaseShellProps) {
  return (
    <div className={`app-shell typora-theme ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-content-theme={contentTheme} data-shell={shell}>
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">{shell === 'native-ledger' ? 'ledger notes' : 'garden notes'}</p>
          <div className="brand-mark"><Sparkles size={20} /></div>
          <h1>Notebook</h1>
          <p className="profile-id">block-first</p>
        </div>

        <section className="sidebar-section">
          <div className="section-row">
            <div className="section-label">Notebooks</div>
            <button className="mini-button" type="button" onClick={notebookActions.addNotebook} aria-label="New notebook"><Plus size={14} /></button>
          </div>
          <NotebookList notebooks={notebooks} activeNotebook={activeNotebook} canDeleteNotebook={notebooks.length > 1} variant="native" actions={notebookActions} />
        </section>

        <section className="sidebar-section pages-section">
          <div className="section-row">
            <div className="section-label">Pages</div>
            <button className="mini-button" type="button" onClick={onAddPage} aria-label="New page"><FilePlus size={14} /></button>
          </div>
          <div
            className="page-tree"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const draggedId = event.dataTransfer.getData('application/page-id');
              if (draggedId && event.currentTarget === event.target) onRootPageDrop(draggedId);
            }}
          >
            {pageTree}
          </div>
        </section>

        <SidebarPins pinnedBlocks={pinnedBlocks} onOpenPinnedWindow={onOpenPinnedWindow} />

        <section className="sidebar-note">
          <strong>今天也要</strong>
          <span>记录美好的一天哦~</span>
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="正文、block、todo" />
          </div>
        </header>

        {workspaceContent}
      </main>

      <aside className="right-panel">
        <section className="panel-card">
          <div className="panel-title"><PanelRight size={16} /> Outline</div>
          <NativeOutline entries={outlineEntries} onJump={onJumpToOutlineEntry} />
        </section>
      </aside>

      <FishDesk fishIconUrl={fishIconUrl} controls={controls} />

      <FloatingCardWindow block={openCardBlock} onClose={onCloseFloatingCard} />
    </div>
  );
}

export function TyporaShell({
  shell,
  contentTheme,
  sidebarCollapsed,
  outlineOpen,
  activeNotebook,
  notebooks,
  notebookActions,
  query,
  onQueryChange,
  typoraFileTree,
  workspaceContent,
  pinnedBlocks,
  openCardBlock,
  onOpenPinnedWindow,
  onCloseFloatingCard,
  onRootPageDrop,
  onAddPage,
  controls,
  outlineEntries,
  onJumpToOutlineEntry,
  fishIconUrl
}: BaseShellProps) {
  return (
    <div className={`typora-app-shell typora-theme ${outlineOpen ? 'outline-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-content-theme={contentTheme} data-shell={shell}>
      <aside id="typora-sidebar" className="typora-sidebar active-tab-files">
        <div id="sidebar-content" className="sidebar-content">
          <section className="typora-sidebar-pane is-active">
            <section className="typora-desk-search">
              <div className="search-box typora-search-box">
                <Search size={16} />
                <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search" />
              </div>
            </section>
            <div className="typora-sidebar-section-header">
              <span>Notebooks</span>
              <button className="mini-button" type="button" onClick={notebookActions.addNotebook} aria-label="New notebook"><Plus size={14} /></button>
            </div>
            <NotebookList notebooks={notebooks} activeNotebook={activeNotebook} canDeleteNotebook={notebooks.length > 1} variant="typora" actions={notebookActions} />

            <div className="typora-sidebar-section-header">
              <span>Pages</span>
              <button className="mini-button" type="button" onClick={onAddPage} aria-label="New page"><FilePlus size={14} /></button>
            </div>
            <div
              className="file-library"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const draggedId = event.dataTransfer.getData('application/page-id');
                if (draggedId && event.currentTarget === event.target) onRootPageDrop(draggedId);
              }}
            >
              {typoraFileTree}
            </div>

            <SidebarPins pinnedBlocks={pinnedBlocks} onOpenPinnedWindow={onOpenPinnedWindow} />
          </section>
        </div>
      </aside>

      <main className="typora-workspace">
        {workspaceContent}
      </main>

      <OutlineDrawer
        open={outlineOpen}
        content={<TyporaOutline entries={outlineEntries} onJump={onJumpToOutlineEntry} />}
        onClose={controls.onOutlineToggle}
      />

      <FishDesk fishIconUrl={fishIconUrl} controls={controls} />

      <FloatingCardWindow block={openCardBlock} onClose={onCloseFloatingCard} />
    </div>
  );
}

export function CardWindowPage({
  block,
  shell,
  contentTheme,
  editorRef,
  onFocus,
  onSelectionUpdate,
  onUpdate,
  onBlur,
  onMediaResizeStart,
  onClose,
  onDrag
}: {
  block: Block;
  shell: ShellId;
  contentTheme: ContentThemeId;
  editorRef: (editor: Editor | null) => void;
  onFocus: (editor: Editor) => void;
  onSelectionUpdate: (editor: Editor) => void;
  onUpdate: (html: string, plainText: string) => void;
  onBlur: (html: string, plainText: string) => void;
  onMediaResizeStart: (request: MediaResizeRequest) => void;
  onClose: () => void;
  onDrag: (event: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <main className="card-window-page typora-theme" data-content-theme={contentTheme} data-shell={shell} onMouseDown={onDrag}>
      <header className="card-window-grip" aria-label="Pinned card controls" onMouseDown={(event) => {
        event.stopPropagation();
        onDrag(event);
      }}>
        <span>{blockTimestampLabel(block.createdAt)}</span>
        <button type="button" onClick={onClose} aria-label="Close pinned card">×</button>
      </header>
      <div className="floating-card-body card-mode">
        <RichEditor
          editorRef={editorRef}
          className="card-mode-editor"
          html={block.content.html}
          onFocus={onFocus}
          onSelectionUpdate={onSelectionUpdate}
          onUpdate={onUpdate}
          onBlur={onBlur}
          onMoveBlock={() => false}
          onMediaResizeStart={onMediaResizeStart}
        />
      </div>
    </main>
  );
}
