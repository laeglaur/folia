import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject
} from 'react';
import { Download, FilePlus, FileUp, History, NotebookTabs, PanelRight, Pin, Plus, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Block, ContentThemeId, Notebook, ShellId } from './types';
import type { PageSearchResult, TrashItemPayload } from './state';
import type { OutlineEntry } from './app-utils';
import { blockTimestampLabel } from './app-utils';
import { RichEditor, type ImageAnnotationRequest, type MediaResizeRequest } from './editor';
import { EmojiImage } from './emoji-image';
import { renderAnnotatedImagesInHtml } from './image-annotations';
import { contentThemes } from './typora-theme-registry';

type ShellThemeOption = {
  id: ShellId;
  label: string;
};

type NotebookActions = {
  addNotebook: () => void;
  selectNotebook: (notebook: Notebook) => void;
  renameNotebook: (notebookId: string, name: string) => void;
  duplicateNotebook: (notebookId: string) => void;
  deleteNotebook: (notebookId: string) => void;
  openNotebookEmojiMenu: (notebookId: string, x: number, y: number) => void;
};

type ToolControlsProps = {
  compact?: boolean;
  showToolbar: boolean;
  showComposerFooter: boolean;
  showBlockBorders: boolean;
  showPageMetadata: boolean;
  roundPinnedCards: boolean;
  glowPinnedCards: boolean;
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
  onShowBlockBordersChange: (show: boolean) => void;
  onShowPageMetadataChange: (show: boolean) => void;
  onRoundPinnedCardsChange: (round: boolean) => void;
  onGlowPinnedCardsChange: (glow: boolean) => void;
  onNewestFirstChange: (newestFirst: boolean) => void;
  onShellChange: (shell: ShellId) => void;
  onContentThemeChange: (contentTheme: ContentThemeId) => void;
  onOutlineToggle: () => void;
  onSidebarToggle: () => void;
  onMarkdownFilesChange: (files: FileList | null) => void;
  onMarkdownFolderChange: (files: FileList | null) => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
  onRestorePageVersion: () => void;
  trashItems: TrashItemPayload[];
  onRestoreTrashItem: (trashId: number) => void;
  onEmptyTrash: () => void;
  trashBusy: boolean;
};

function ToolControls({
  compact = false,
  showToolbar,
  showComposerFooter,
  showBlockBorders,
  showPageMetadata,
  roundPinnedCards,
  glowPinnedCards,
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
  onShowBlockBordersChange,
  onShowPageMetadataChange,
  onRoundPinnedCardsChange,
  onGlowPinnedCardsChange,
  onNewestFirstChange,
  onShellChange,
  onContentThemeChange,
  onOutlineToggle,
  onSidebarToggle,
  onMarkdownFilesChange,
  onMarkdownFolderChange,
  onExportMarkdown,
  onExportJson,
  onRestorePageVersion,
  trashItems,
  onRestoreTrashItem,
  onEmptyTrash,
  trashBusy
}: ToolControlsProps) {
  return (
    <div className={compact ? 'typora-tool-controls' : 'topbar-actions'}>
      <label className="view-toggle"><input type="checkbox" checked={showToolbar} onChange={(event) => onShowToolbarChange(event.target.checked)} /> Toolbar</label>
      <label className="view-toggle"><input type="checkbox" checked={showComposerFooter} onChange={(event) => onShowComposerFooterChange(event.target.checked)} /> Add</label>
      <label className="view-toggle"><input type="checkbox" checked={showBlockBorders} onChange={(event) => onShowBlockBordersChange(event.target.checked)} /> Block borders</label>
      <label className="view-toggle"><input type="checkbox" checked={showPageMetadata} onChange={(event) => onShowPageMetadataChange(event.target.checked)} /> Metadata</label>
      <label className="view-toggle"><input type="checkbox" checked={roundPinnedCards} onChange={(event) => onRoundPinnedCardsChange(event.target.checked)} /> Round pinned cards</label>
      <label className="view-toggle"><input type="checkbox" checked={glowPinnedCards} onChange={(event) => onGlowPinnedCardsChange(event.target.checked)} /> Glow pinned cards</label>
      <label className="view-toggle">
        <input
          type="checkbox"
          checked={newestFirst}
          onChange={(event) => onNewestFirstChange(event.target.checked)}
        />
        <span>Newest first</span>
      </label>
      {compact && (
        <>
          <label className="view-toggle"><input type="checkbox" checked={outlineOpen} onChange={onOutlineToggle} /> Outline</label>
          <label className="view-toggle"><input type="checkbox" checked={!sidebarCollapsed} onChange={onSidebarToggle} /> Sidebar</label>
        </>
      )}
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
      {!compact && (
        <>
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
        </>
      )}
      <button className="secondary-button" type="button" onClick={() => markdownInputRef.current?.click()}><FileUp size={15} /> Import MD</button>
      <button className="secondary-button" type="button" onClick={() => markdownFolderInputRef.current?.click()}><FileUp size={15} /> Import folder</button>
      <button className="secondary-button" type="button" onClick={onExportMarkdown}><Download size={15} /> Markdown</button>
      <button className="secondary-button" type="button" onClick={onExportJson}><Upload size={15} /> Backup</button>
      <button className="secondary-button" type="button" onClick={onRestorePageVersion}><History size={15} /> Restore page</button>
      <button className="secondary-button" type="button" onClick={onEmptyTrash} disabled={trashBusy}><Trash2 size={15} /> {trashBusy ? 'Emptying trash' : 'Empty trash'}</button>
      {compact ? (
        <section className="fish-trash">
          <div className="fish-trash-head">
            <span>Trash</span>
            <button className="mini-button" type="button" onClick={onEmptyTrash} disabled={trashBusy} aria-label={trashBusy ? 'Emptying trash' : 'Empty trash'} title={trashBusy ? 'Emptying trash' : 'Empty trash'}><Trash2 size={13} /></button>
          </div>
          {trashItems.length ? trashItems.map((item) => (
            <button className="fish-trash-item" key={item.id} type="button" onClick={() => onRestoreTrashItem(item.id)} title={`Restore ${item.title}`}>
              <span>{item.itemType}</span>
              <strong>{item.title || 'Untitled'}</strong>
            </button>
          )) : <p className="fish-trash-empty">Empty</p>}
        </section>
      ) : null}
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
          <div dangerouslySetInnerHTML={{ __html: renderAnnotatedImagesInHtml(block.content.html) }} />
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
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const cancelBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!editingNotebookId) return;
    const input = nameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editingNotebookId]);

  const beginRename = (notebook: Notebook) => {
    actions.selectNotebook(notebook);
    setDraftName(notebook.name);
    cancelBlurCommitRef.current = false;
    setEditingNotebookId(notebook.id);
  };

  const commitRename = () => {
    const notebook = notebooks.find((candidate) => candidate.id === editingNotebookId);
    if (!notebook) {
      setEditingNotebookId(null);
      setDraftName('');
      return;
    }
    const nextName = draftName.trim() || notebook.name;
    if (nextName !== notebook.name) {
      actions.renameNotebook(notebook.id, nextName);
    }
    setEditingNotebookId(null);
    setDraftName('');
  };

  const cancelRename = () => {
    cancelBlurCommitRef.current = true;
    setEditingNotebookId(null);
    setDraftName('');
  };

  const renderNotebookLabel = (notebook: Notebook) => {
    const isEditing = editingNotebookId === notebook.id;
    const isActive = notebook.id === activeNotebook.id;
    const emoji = notebook.metadata.emoji;
    const sharedInputProps = {
      ref: nameInputRef,
      className: 'notebook-name-input',
      'aria-label': `Rename notebook ${notebook.name}`,
      value: draftName,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setDraftName(event.target.value),
      onBlur: () => {
        if (cancelBlurCommitRef.current) {
          cancelBlurCommitRef.current = false;
          return;
        }
        commitRename();
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelRename();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          commitRename();
        }
      }
    } as const;

    if (variant === 'typora') {
      return isEditing ? (
        <div className={`file-node-content notebook-node notebook-editing ${isActive ? 'is-active' : ''}`}>
          <span className="file-node-open-state"><NotebookTabs size={13} /></span>
          <input {...sharedInputProps} />
        </div>
      ) : (
        <button
          className={`file-node-content notebook-node ${emoji ? 'has-node-icon' : ''} ${isActive ? 'is-active' : ''}`}
          type="button"
          onClick={() => actions.selectNotebook(notebook)}
          onDoubleClick={() => beginRename(notebook)}
          onContextMenu={(event) => {
            event.preventDefault();
            actions.selectNotebook(notebook);
            actions.openNotebookEmojiMenu(notebook.id, event.clientX, event.clientY);
          }}
        >
          <span className="file-node-open-state"><NotebookTabs size={13} /></span>
          {emoji ? <EmojiImage emoji={emoji} className="node-emoji" decorative /> : null}
          <span className="file-node-title file-name notebook-label">{notebook.name}</span>
        </button>
      );
    }

    return isEditing ? (
      <div className={`notebook-button notebook-editing ${isActive ? 'active' : ''}`}>
        <NotebookTabs size={15} />
        <input {...sharedInputProps} />
      </div>
    ) : (
      <button
        className={`notebook-button ${emoji ? 'has-node-icon' : ''} ${isActive ? 'active' : ''}`}
        type="button"
        onClick={() => actions.selectNotebook(notebook)}
        onDoubleClick={() => beginRename(notebook)}
        onContextMenu={(event) => {
          event.preventDefault();
          actions.selectNotebook(notebook);
          actions.openNotebookEmojiMenu(notebook.id, event.clientX, event.clientY);
        }}
      >
        <NotebookTabs size={15} />
        {emoji ? <EmojiImage emoji={emoji} className="node-emoji" decorative /> : null}
        <span className="notebook-label">{notebook.name}</span>
      </button>
    );
  };

  if (variant === 'typora') {
    return (
      <div className="file-library">
        {notebooks.map((notebook) => (
          <div className="file-library-node" data-is-directory="true" key={notebook.id}>
            <span className="file-node-background" aria-hidden="true" />
            <div className={`file-node-row-shell ${notebook.id === activeNotebook.id ? 'active' : ''}`}>
              {renderNotebookLabel(notebook)}
              <div className="row-actions file-node-actions">
                <button className="mini-button row-action duplicate-notebook-button" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); actions.duplicateNotebook(notebook.id); }} aria-label={`Duplicate notebook ${notebook.name}`}><FilePlus size={13} /></button>
                {canDeleteNotebook ? (
                  <button className="mini-button row-action delete-notebook-button" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); actions.deleteNotebook(notebook.id); }} aria-label={`Delete notebook ${notebook.name}`}><Trash2 size={13} /></button>
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
          {renderNotebookLabel(notebook)}
          <div className="row-actions notebook-row-actions">
            <button className="mini-button row-action duplicate-notebook-button" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); actions.duplicateNotebook(notebook.id); }} aria-label={`Duplicate notebook ${notebook.name}`}><FilePlus size={13} /></button>
            {canDeleteNotebook ? (
              <button className="mini-button row-action delete-notebook-button" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); actions.deleteNotebook(notebook.id); }} aria-label={`Delete notebook ${notebook.name}`}><Trash2 size={13} /></button>
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
  roundPinnedCards,
  glowPinnedCards,
  onClose
}: {
  block: Block | null;
  roundPinnedCards: boolean;
  glowPinnedCards: boolean;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(false);
  }, [block?.id]);

  if (!block) return null;
  const preview = block.content.plainText.replace(/\s+/g, ' ').trim();
  const dateLabel = blockTimestampLabel(block.createdAt);
  const previewLabel = preview ? `${preview.slice(0, 72)}${preview.length > 72 ? '...' : ''}` : '';
  return (
    <div className={`floating-card-window ${roundPinnedCards ? 'is-rounded' : 'is-square'} ${glowPinnedCards ? 'has-glow' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="floating-card-head">
        <button className="floating-card-title" type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>
          {dateLabel}
        </button>
        {collapsed && previewLabel ? <span className="floating-card-preview">{previewLabel}</span> : null}
        <button type="button" onClick={onClose} aria-label="Close pinned card">×</button>
      </div>
      {!collapsed ? <div className="floating-card-body" dangerouslySetInnerHTML={{ __html: renderAnnotatedImagesInHtml(block.content.html) }} /> : null}
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
  searchResults: PageSearchResult[];
  searchLoading: boolean;
  onSearchResultSelect: (pageId: string) => void;
  pageTree: ReactNode;
  typoraFileTree: ReactNode;
  workspaceContent: ReactNode;
  pinnedBlocks: Block[];
  openCardBlock: Block | null;
  roundPinnedCards: boolean;
  glowPinnedCards: boolean;
  onOpenPinnedWindow: (blockId: string) => void;
  onCloseFloatingCard: () => void;
  onRootPageDrop: (pageId: string) => void;
  onAddPage: () => void;
  controls: ShellControlsProps;
  outlineEntries: OutlineEntry[];
  onJumpToOutlineEntry: (entry: OutlineEntry) => void;
  fishIconUrl: string;
};

function SearchResults({
  query,
  results,
  loading,
  selectedIndex,
  onSelectedIndexChange,
  onSelect
}: {
  query: string;
  results: PageSearchResult[];
  loading: boolean;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onSelect: (pageId: string) => void;
}) {
  const trimmed = query.trim();
  if (!trimmed || (!loading && !results.length)) return null;

  return (
    <div className="search-results" role="listbox" aria-label="Search results">
      {loading ? <div className="search-result-empty">Searching...</div> : results.map((result, index) => (
        <button
          className={`search-result-item ${selectedIndex === index ? 'is-selected' : ''}`}
          key={result.pageId}
          type="button"
          data-search-index={index}
          onFocus={() => onSelectedIndexChange(index)}
          onMouseEnter={() => onSelectedIndexChange(index)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              const nextIndex = Math.min(index + 1, results.length - 1);
              onSelectedIndexChange(nextIndex);
              focusSearchResult(nextIndex, results.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              const nextIndex = Math.max(index - 1, 0);
              onSelectedIndexChange(nextIndex);
              focusSearchResult(nextIndex, results.length);
            }
          }}
          onClick={() => onSelect(result.pageId)}
        >
          <span className="search-result-title">{result.title}</span>
          {result.snippet ? <span className="search-result-snippet" dangerouslySetInnerHTML={{ __html: result.snippet }} /> : null}
        </button>
      ))}
    </div>
  );
}

function focusSearchResult(index: number, total: number) {
  if (!total) return;
  const nextIndex = Math.max(0, Math.min(index, total - 1));
  window.setTimeout(() => {
    const element = document.querySelector<HTMLButtonElement>(`.search-result-item[data-search-index="${nextIndex}"]`);
    element?.focus();
    element?.scrollIntoView({ block: 'nearest' });
  }, 0);
}

function SearchBox({
  query,
  onQueryChange,
  searchResults,
  searchLoading,
  onSearchResultSelect,
  placeholder,
  className = ''
}: {
  query: string;
  onQueryChange: (query: string) => void;
  searchResults: PageSearchResult[];
  searchLoading: boolean;
  onSearchResultSelect: (pageId: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, searchResults.length]);

  const moveFocus = (index: number) => {
    if (!searchResults.length) return;
    const nextIndex = Math.max(0, Math.min(index, searchResults.length - 1));
    setSelectedIndex(nextIndex);
    focusSearchResult(nextIndex, searchResults.length);
  };

  return (
    <div className={`search-box ${className}`.trim()}>
      <Search size={16} />
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveFocus(selectedIndex + 1);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(selectedIndex - 1);
          }
        }}
        placeholder={placeholder}
      />
      <SearchResults
        query={query}
        results={searchResults}
        loading={searchLoading}
        selectedIndex={selectedIndex}
        onSelectedIndexChange={setSelectedIndex}
        onSelect={onSearchResultSelect}
      />
    </div>
  );
}

export function NativeShell({
  shell,
  contentTheme,
  sidebarCollapsed,
  activeNotebook,
  notebooks,
  notebookActions,
  query,
  onQueryChange,
  searchResults,
  searchLoading,
  onSearchResultSelect,
  pageTree,
  workspaceContent,
  pinnedBlocks,
  openCardBlock,
  roundPinnedCards,
  glowPinnedCards,
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
              event.preventDefault();
              const target = event.target as HTMLElement | null;
              if (target?.closest('.page-row-shell')) return;
              const draggedId = event.dataTransfer.getData('application/page-id');
              if (draggedId) onRootPageDrop(draggedId);
            }}
          >
            {pageTree}
          </div>
        </section>

        <section className="sidebar-note">
          <strong>今天也要</strong>
          <span>记录美好的一天哦~</span>
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <SearchBox
            query={query}
            onQueryChange={onQueryChange}
            searchResults={searchResults}
            searchLoading={searchLoading}
            onSearchResultSelect={onSearchResultSelect}
            placeholder="正文、block、todo"
          />
        </header>

        {workspaceContent}
      </main>

      <aside className="right-panel">
        <section className="panel-card">
          <div className="panel-title"><Pin size={16} /> Pinned</div>
          <PinnedCards pinnedBlocks={pinnedBlocks} onOpenPinnedWindow={onOpenPinnedWindow} className="desktop-preview right-panel-pin-list" cardClassName="desktop-card right-panel-pin-card" />
        </section>
        <section className="panel-card">
          <div className="panel-title"><PanelRight size={16} /> Outline</div>
          <NativeOutline entries={outlineEntries} onJump={onJumpToOutlineEntry} />
        </section>
      </aside>

      <FishDesk fishIconUrl={fishIconUrl} controls={controls} />

      <FloatingCardWindow block={openCardBlock} roundPinnedCards={roundPinnedCards} glowPinnedCards={glowPinnedCards} onClose={onCloseFloatingCard} />
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
  searchResults,
  searchLoading,
  onSearchResultSelect,
  typoraFileTree,
  workspaceContent,
  pinnedBlocks,
  openCardBlock,
  roundPinnedCards,
  glowPinnedCards,
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
              <SearchBox
                query={query}
                onQueryChange={onQueryChange}
                searchResults={searchResults}
                searchLoading={searchLoading}
                onSearchResultSelect={onSearchResultSelect}
                placeholder="Search"
                className="typora-search-box"
              />
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
                event.preventDefault();
                const target = event.target as HTMLElement | null;
                if (target?.closest('.file-node-row-shell')) return;
                const draggedId = event.dataTransfer.getData('application/page-id');
                if (draggedId) onRootPageDrop(draggedId);
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

      <FloatingCardWindow block={openCardBlock} roundPinnedCards={roundPinnedCards} glowPinnedCards={glowPinnedCards} onClose={onCloseFloatingCard} />
    </div>
  );
}

export function CardWindowPage({
  block,
  shell,
  contentTheme,
  roundPinnedCards,
  glowPinnedCards,
  editorRef,
  onFocus,
  onSelectionUpdate,
  onUpdate,
  onBlur,
  onMediaResizeStart,
  onImageAnnotate,
  onClose,
  onDrag
}: {
  block: Block;
  shell: ShellId;
  contentTheme: ContentThemeId;
  roundPinnedCards: boolean;
  glowPinnedCards: boolean;
  editorRef: (editor: Editor | null) => void;
  onFocus: (editor: Editor) => void;
  onSelectionUpdate: (editor: Editor) => void;
  onUpdate: (html: string, plainText: string) => void;
  onBlur: (html: string, plainText: string) => void;
  onMediaResizeStart: (request: MediaResizeRequest) => void;
  onImageAnnotate: (request: ImageAnnotationRequest) => void;
  onClose: () => void;
  onDrag: (event: MouseEvent<HTMLElement>) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const preview = block.content.plainText.replace(/\s+/g, ' ').trim();
  const dateLabel = blockTimestampLabel(block.createdAt);
  const previewLabel = preview ? `${preview.slice(0, 96)}${preview.length > 96 ? '...' : ''}` : '';

  return (
    <main className={`card-window-page typora-theme ${roundPinnedCards ? 'is-rounded' : 'is-square'} ${glowPinnedCards ? 'has-glow' : ''} ${collapsed ? 'is-collapsed' : ''}`} data-content-theme={contentTheme} data-shell={shell}>
      <header className="card-window-grip" aria-label="Pinned card controls" onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, a, input, textarea, select')) return;
        event.stopPropagation();
        onDrag(event);
      }}>
        <button
          className="card-window-title"
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); setCollapsed((value) => !value); }}
          aria-expanded={!collapsed}
        >
          {dateLabel}
        </button>
        {collapsed && previewLabel ? <span className="floating-card-preview">{previewLabel}</span> : null}
        <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Close pinned card">×</button>
      </header>
      {!collapsed ? <div className="floating-card-body card-mode">
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
          onImageAnnotate={(request) => onImageAnnotate({ ...request, target: { kind: 'card', blockId: block.id } })}
        />
      </div> : null}
    </main>
  );
}
