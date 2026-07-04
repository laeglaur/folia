import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  type UIEvent
} from 'react';
import { Download, FilePlus, FileUp, Grid3X3, History, ListTree, NotebookTabs, PanelRight, Pin, Plus, Search, Trash2, Upload } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Block, ContentThemeId, Notebook, ShellId } from './types';
import type { PageSearchResult, TrashItemPayload } from './state';
import type { OutlineEntry } from './app-utils';
import { blockTimestampLabel } from './app-utils';
import { RichEditor, type ImageAnnotationRequest, type MediaResizeRequest } from './editor';
import { EmojiImage } from './emoji-image';
import { emojiAssetFor } from './emoji-assets';
import { renderAnnotatedImagesInHtml } from './image-annotations';
import { contentThemes } from './typora-theme-registry';

const appLogoUrl = '/app-assets/notebook-logo.jpg';

type GardenNoteSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};

const gardenNoteTokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*)/g;

const parseGardenNoteSegments = (value: string): GardenNoteSegment[] => {
  const segments: GardenNoteSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(gardenNoteTokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ text: value.slice(cursor, index) });
    const token = match[0];
    if (token.startsWith('**')) segments.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith('__')) segments.push({ text: token.slice(2, -2), underline: true });
    else if (token.startsWith('~~')) segments.push({ text: token.slice(2, -2), strike: true });
    else if (token.startsWith('*')) segments.push({ text: token.slice(1, -1), italic: true });
    cursor = index + token.length;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor) });
  return segments;
};

const renderGardenNoteText = (text: string, keyPrefix: string) =>
  Array.from(text).map((character, index) => emojiAssetFor(character)
    ? <EmojiImage emoji={character} className="garden-sidebar-note-emoji" key={`${keyPrefix}-emoji-${index}`} decorative />
    : <span key={`${keyPrefix}-text-${index}`}>{character}</span>);

type ShellThemeOption = {
  id: ShellId;
  label: string;
};

type NativeBrandSettings = {
  eyebrow: string;
  title: string;
  logoUrl: string;
};

type PinnedCardMenuState = {
  blockId: string;
  x: number;
  y: number;
};

const pinnedCardMenuPosition = (y: number, container: Element | null) => {
  const padding = 12;
  const menuHeight = 82;
  const rect = container?.getBoundingClientRect();
  const localY = rect ? y - rect.top : y;
  const maxY = (rect?.height ?? window.innerHeight) - menuHeight - padding;
  return {
    x: padding,
    y: Math.max(padding, Math.min(localY, Math.max(padding, maxY)))
  };
};

export type PageThumbnailItem = {
  pageId: string;
  title: string;
  emoji?: string;
  excerpt: string;
  imageSrcs: string[];
  updatedAt: string;
  active: boolean;
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
  showPageMetadata: boolean;
  newestFirst: boolean;
  shell: ShellId;
  contentTheme: ContentThemeId;
  shellThemes: ShellThemeOption[];
  markdownInputRef: RefObject<HTMLInputElement | null>;
  markdownFolderInputRef: RefObject<HTMLInputElement | null>;
  outlineOpen: boolean;
  sidebarCollapsed: boolean;
  onShowToolbarChange: (show: boolean) => void;
  onShowPageMetadataChange: (show: boolean) => void;
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
  showPageMetadata,
  newestFirst,
  shell,
  contentTheme,
  shellThemes,
  markdownInputRef,
  markdownFolderInputRef,
  outlineOpen,
  sidebarCollapsed,
  onShowToolbarChange,
  onShowPageMetadataChange,
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
      <label className="view-toggle"><input type="checkbox" checked={showPageMetadata} onChange={(event) => onShowPageMetadataChange(event.target.checked)} /> Metadata</label>
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
      {shell.startsWith('typora-') ? (
        <select
          className="theme-select content-theme-select"
          value={contentTheme}
          onChange={(event) => onContentThemeChange(event.target.value as ContentThemeId)}
          aria-label="Content theme"
        >
          {contentThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
        </select>
      ) : null}
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
  onOpenPinnedPage,
  onUnpinBlock,
  className = 'desktop-preview',
  cardClassName = 'desktop-card'
}: {
  pinnedBlocks: Block[];
  onOpenPinnedWindow: (blockId: string) => void;
  onOpenPinnedPage: (blockId: string) => void;
  onUnpinBlock: (blockId: string) => void;
  className?: string;
  cardClassName?: string;
}) {
  const [menu, setMenu] = useState<PinnedCardMenuState | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    if (!pinnedBlocks.some((block) => block.id === menu.blockId)) setMenu(null);
  }, [menu, pinnedBlocks]);

  return (
    <div className={className}>
      {pinnedBlocks.length ? pinnedBlocks.map((block) => (
        <button
          className={cardClassName}
          key={block.id}
          type="button"
          onClick={() => onOpenPinnedWindow(block.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            const container = event.currentTarget.closest('.sidebar, #typora-sidebar, .right-panel, .fish-desk-panel');
            setMenu({ blockId: block.id, ...pinnedCardMenuPosition(event.clientY, container) });
          }}
        >
          <div dangerouslySetInnerHTML={{ __html: renderAnnotatedImagesInHtml(block.content.html) }} />
        </button>
      )) : <p className="muted">Pin blocks to keep them close.</p>}
      {menu ? (
        <div
          className="emoji-context-menu pinned-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenPinnedPage(menu.blockId);
              setMenu(null);
            }}
          >
            Open page
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onUnpinBlock(menu.blockId);
              setMenu(null);
            }}
          >
            Unpin
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SidebarPins({
  pinnedBlocks,
  onOpenPinnedWindow,
  onOpenPinnedPage,
  onUnpinBlock
}: {
  pinnedBlocks: Block[];
  onOpenPinnedWindow: (blockId: string) => void;
  onOpenPinnedPage: (blockId: string) => void;
  onUnpinBlock: (blockId: string) => void;
}) {
  return (
    <section className="sidebar-section pinned-sidebar-section">
      <div className="section-row">
        <div className="section-label">Pinned</div>
      </div>
      <PinnedCards pinnedBlocks={pinnedBlocks} onOpenPinnedWindow={onOpenPinnedWindow} onOpenPinnedPage={onOpenPinnedPage} onUnpinBlock={onUnpinBlock} className="sidebar-pin-list" cardClassName="sidebar-pin-card" />
    </section>
  );
}

function PageThumbnails({
  pages,
  hasMorePages,
  onSelectPage,
  onLoadMore
}: {
  pages: PageThumbnailItem[];
  hasMorePages: boolean;
  onSelectPage: (pageId: string) => void;
  onLoadMore: () => void;
}) {
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!hasMorePages) return;
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 320) {
      onLoadMore();
    }
  };
  const [brokenImageSrcs, setBrokenImageSrcs] = useState<Record<string, string[]>>({});

  return (
    <div className="typora-page-thumbnails" aria-label="Page thumbnails" onScroll={handleScroll}>
      {pages.length ? pages.map((page) => {
        const broken = brokenImageSrcs[page.pageId] ?? [];
        const imageSrc = page.imageSrcs.find((src) => !broken.includes(src)) ?? '';
        return (
          <button
            className={`typora-page-thumbnail ${page.active ? 'is-active' : ''} ${imageSrc ? 'has-image' : 'no-image'} ${page.emoji ? 'has-page-emoji' : 'no-page-emoji'}`}
            key={page.pageId}
            type="button"
            onClick={() => onSelectPage(page.pageId)}
          >
            {imageSrc ? (
              <span className="typora-page-thumbnail-figure">
                <img
                  className="typora-page-thumbnail-image"
                  src={imageSrc}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                  onError={() => {
                    setBrokenImageSrcs((current) => ({
                      ...current,
                      [page.pageId]: [...(current[page.pageId] ?? []), imageSrc]
                    }));
                  }}
                />
              </span>
            ) : null}
            <span className="typora-page-thumbnail-body">
              <span className={`typora-page-thumbnail-head ${page.emoji ? 'has-page-emoji' : 'no-page-emoji'}`}>
                {page.emoji ? <EmojiImage emoji={page.emoji} className="node-emoji typora-page-thumbnail-emoji" decorative /> : null}
                <span className="typora-page-thumbnail-title">{page.title || 'Untitled'}</span>
              </span>
              {page.excerpt ? <span className="typora-page-thumbnail-excerpt">{page.excerpt}</span> : null}
              <span className="typora-page-thumbnail-meta">{page.updatedAt}</span>
            </span>
          </button>
        );
      }) : <p className="typora-page-thumbnails-empty">No pages in this notebook.</p>}
      {hasMorePages ? <button className="typora-page-thumbnails-more" type="button" onClick={onLoadMore}>Load more</button> : null}
    </div>
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

    const leadingIcon = emoji
      ? <EmojiImage emoji={emoji} className="node-emoji" decorative />
      : <NotebookTabs size={variant === 'typora' ? 13 : 15} />;

    if (variant === 'typora') {
      return isEditing ? (
        <div className={`file-node-content notebook-node notebook-editing ${emoji ? 'has-node-icon' : ''} ${isActive ? 'is-active' : ''}`}>
          <span className="file-node-open-state">{leadingIcon}</span>
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
          <span className="file-node-open-state">{leadingIcon}</span>
          <span className="file-node-title file-name notebook-label">{notebook.name}</span>
        </button>
      );
    }

    return isEditing ? (
      <div className={`notebook-button notebook-editing ${emoji ? 'has-node-icon' : ''} ${isActive ? 'active' : ''}`}>
        {leadingIcon}
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
        {leadingIcon}
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
          <span className="outline-expander" aria-hidden="true">{entry.kind === 'page' ? 'P' : entry.kind === 'block' ? 'B' : entry.kind === 'heading' ? `H${Math.max(1, entry.level - 1)}` : '•'}</span>
          <span className="outline-label">{entry.text}</span>
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
        {extraContent}
        {content}
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
      <div className="floating-card-head" onDoubleClick={() => setCollapsed((value) => !value)}>
        <button className="floating-card-title" type="button" aria-expanded={!collapsed} tabIndex={-1}>
          {dateLabel}
        </button>
        {collapsed && previewLabel ? <span className="floating-card-preview">{previewLabel}</span> : null}
        <button type="button" onDoubleClick={(event) => event.stopPropagation()} onClick={onClose} aria-label="Close pinned card">×</button>
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
  sidebarView: 'files' | 'thumbnails';
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
  pageThumbnails: PageThumbnailItem[];
  hasMorePageThumbnails: boolean;
  workspaceContent: ReactNode;
  pinnedBlocks: Block[];
  openCardBlock: Block | null;
  roundPinnedCards: boolean;
  glowPinnedCards: boolean;
  onOpenPinnedWindow: (blockId: string) => void;
  onOpenPinnedPage: (blockId: string) => void;
  onUnpinBlock: (blockId: string) => void;
  onCloseFloatingCard: () => void;
  onRootPageDrop: (pageId: string) => void;
  onAddPage: () => void;
  onSelectPage: (pageId: string) => void;
  onSidebarViewChange: (view: 'files' | 'thumbnails') => void;
  gardenSidebarNote: string;
  onGardenSidebarNoteChange: (note: string) => void;
  nativeBrand: NativeBrandSettings;
  onNativeBrandChange: Dispatch<SetStateAction<NativeBrandSettings>>;
  onLoadMorePageThumbnails: () => void;
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
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, searchResults.length]);

  useEffect(() => {
    if (!query.trim()) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && searchBoxRef.current?.contains(target)) return;
      onQueryChange('');
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onQueryChange, query]);

  const moveFocus = (index: number) => {
    if (!searchResults.length) return;
    const nextIndex = Math.max(0, Math.min(index, searchResults.length - 1));
    setSelectedIndex(nextIndex);
    focusSearchResult(nextIndex, searchResults.length);
  };

  return (
    <div ref={searchBoxRef} className={`search-box ${className}`.trim()}>
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

function EditableBrandText({
  value,
  className,
  maxLength,
  ariaLabel,
  onChange
}: {
  value: string;
  className: string;
  maxLength: number;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const nextValue = draft.replace(/[\r\n]+/g, ' ').trim().slice(0, maxLength);
    onChange(nextValue);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${className} native-brand-input`}
        value={draft}
        maxLength={maxLength}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <button className={`${className} native-brand-text ${value ? '' : 'is-empty'}`} type="button" onDoubleClick={() => setEditing(true)} title="Double click to edit">
      {value ? renderGardenNoteText(value, ariaLabel) : <span className="native-brand-empty-text" aria-hidden="true">&nbsp;</span>}
    </button>
  );
}

function NativeBrandBlock({
  brand,
  sidebarView,
  onSidebarViewChange,
  onChange
}: {
  brand: NativeBrandSettings;
  sidebarView: 'files' | 'thumbnails';
  onSidebarViewChange: (view: 'files' | 'thumbnails') => void;
  onChange: Dispatch<SetStateAction<NativeBrandSettings>>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setField = (field: keyof NativeBrandSettings, value: string) => {
    onChange((current) => ({ ...current, [field]: value }));
  };

  const chooseLogo = (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setField('logoUrl', reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="brand-block native-brand-block">
      <EditableBrandText
        value={brand.eyebrow}
        className="eyebrow"
        maxLength={32}
        ariaLabel="Native brand eyebrow"
        onChange={(value) => setField('eyebrow', value)}
      />
      <button
        className="brand-mark native-brand-mark-button"
        type="button"
        title="Click to change logo"
        onClick={() => inputRef.current?.click()}
        onContextMenu={(event) => {
          event.preventDefault();
          setField('logoUrl', appLogoUrl);
        }}
      >
        <img src={brand.logoUrl || appLogoUrl} alt="" aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        hidden
        accept="image/*"
        type="file"
        onChange={(event) => {
          chooseLogo(event.target.files?.[0] ?? null);
          event.currentTarget.value = '';
        }}
      />
      <EditableBrandText
        value={brand.title}
        className="brand-title"
        maxLength={32}
        ariaLabel="Native brand title"
        onChange={(value) => setField('title', value)}
      />
      <div className="native-sidebar-tabs" role="tablist" aria-label="Sidebar view">
        <button
          className={`native-sidebar-tab ${sidebarView === 'files' ? 'is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={sidebarView === 'files'}
          title="Files"
          aria-label="Files"
          onClick={() => onSidebarViewChange('files')}
        >
          <ListTree size={14} aria-hidden="true" />
        </button>
        <button
          className={`native-sidebar-tab ${sidebarView === 'thumbnails' ? 'is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={sidebarView === 'thumbnails'}
          title="Thumbnails"
          aria-label="Thumbnails"
          onClick={() => onSidebarViewChange('thumbnails')}
        >
          <Grid3X3 size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

const typoraOutlineSearch = (
  query: string,
  onQueryChange: (query: string) => void,
  searchResults: PageSearchResult[],
  searchLoading: boolean,
  onSearchResultSelect: (pageId: string) => void
) => (
  <section className="typora-desk-search typora-outline-search">
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
);

export function NativeShell({
  shell,
  contentTheme,
  sidebarCollapsed,
  sidebarView,
  activeNotebook,
  notebooks,
  notebookActions,
  query,
  onQueryChange,
  searchResults,
  searchLoading,
  onSearchResultSelect,
  pageTree,
  pageThumbnails,
  hasMorePageThumbnails,
  workspaceContent,
  pinnedBlocks,
  openCardBlock,
  roundPinnedCards,
  glowPinnedCards,
  onOpenPinnedWindow,
  onOpenPinnedPage,
  onUnpinBlock,
  onCloseFloatingCard,
  onRootPageDrop,
  onAddPage,
  onSelectPage,
  onSidebarViewChange,
  onLoadMorePageThumbnails,
  nativeBrand,
  onNativeBrandChange,
  controls,
  outlineEntries,
  onJumpToOutlineEntry,
  fishIconUrl
}: BaseShellProps) {
  return (
    <div className={`app-shell typora-theme ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-content-theme={contentTheme} data-shell={shell}>
      <aside className="sidebar">
        <NativeBrandBlock brand={nativeBrand} sidebarView={sidebarView} onSidebarViewChange={onSidebarViewChange} onChange={onNativeBrandChange} />

        {sidebarView === 'files' ? (
          <>
            <section className="sidebar-section">
              <div className="section-row">
                <div className="section-label">Notebooks</div>
                <button className="mini-button" type="button" onClick={notebookActions.addNotebook} aria-label="New notebook"><Plus size={14} /></button>
              </div>
              <NotebookList notebooks={notebooks} activeNotebook={activeNotebook} canDeleteNotebook={notebooks.length > 1} variant="native" actions={notebookActions} />
            </section>

            <section className="sidebar-section pages-section is-file-view">
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

            <SidebarPins pinnedBlocks={pinnedBlocks} onOpenPinnedWindow={onOpenPinnedWindow} onOpenPinnedPage={onOpenPinnedPage} onUnpinBlock={onUnpinBlock} />
          </>
        ) : (
          <section className="sidebar-section pages-section is-thumbnail-view">
            <PageThumbnails pages={pageThumbnails} hasMorePages={hasMorePageThumbnails} onSelectPage={onSelectPage} onLoadMore={onLoadMorePageThumbnails} />
          </section>
        )}
      </aside>

      <main className="workspace">
        {workspaceContent}
      </main>

      <aside className="right-panel">
        <SearchBox
          query={query}
          onQueryChange={onQueryChange}
          searchResults={searchResults}
          searchLoading={searchLoading}
          onSearchResultSelect={onSearchResultSelect}
          placeholder="正文、block、todo"
          className="right-panel-search-box"
        />
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

function GardenSidebarNote({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    onChange(draft.trim().slice(0, 48));
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="garden-sidebar-note-input"
        value={draft}
        maxLength={48}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        aria-label="Garden sidebar note"
      />
    );
  }

  return (
    <button
      className={`garden-sidebar-note ${value.trim() ? '' : 'is-empty'}`}
      type="button"
      onDoubleClick={() => setEditing(true)}
      title="Double click to edit"
    >
      {parseGardenNoteSegments(value.trim()).map((segment, index) => (
        <span
          className={[
            'garden-sidebar-note-segment',
            segment.bold ? 'is-bold' : '',
            segment.italic ? 'is-italic' : '',
            segment.underline ? 'is-underline' : '',
            segment.strike ? 'is-strike' : ''
          ].filter(Boolean).join(' ')}
          key={`${segment.text}-${index}`}
        >
          {renderGardenNoteText(segment.text, `garden-note-${index}`)}
        </span>
      ))}
    </button>
  );
}

export function TyporaShell({
  shell,
  contentTheme,
  sidebarCollapsed,
  outlineOpen,
  sidebarView,
  activeNotebook,
  notebooks,
  notebookActions,
  query,
  onQueryChange,
  searchResults,
  searchLoading,
  onSearchResultSelect,
  typoraFileTree,
  pageThumbnails,
  hasMorePageThumbnails,
  workspaceContent,
  pinnedBlocks,
  openCardBlock,
  roundPinnedCards,
  glowPinnedCards,
  onOpenPinnedWindow,
  onOpenPinnedPage,
  onUnpinBlock,
  onCloseFloatingCard,
  onRootPageDrop,
  onAddPage,
  onSelectPage,
  onSidebarViewChange,
  gardenSidebarNote,
  onGardenSidebarNoteChange,
  onLoadMorePageThumbnails,
  controls,
  outlineEntries,
  onJumpToOutlineEntry,
  fishIconUrl
}: BaseShellProps) {
  const isGardenTypora = shell === 'typora-garden';

  return (
    <div className={`typora-app-shell typora-theme ${outlineOpen ? 'outline-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-content-theme={contentTheme} data-shell={shell}>
      <aside id="typora-sidebar" className="typora-sidebar active-tab-files">
        <div className="sidebar-tabs" role="tablist" aria-label="Sidebar view">
          {isGardenTypora ? <GardenSidebarNote value={gardenSidebarNote} onChange={onGardenSidebarNoteChange} /> : null}
          <button
            className={`sidebar-tab ${sidebarView === 'files' ? 'active sidebar-tab-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={sidebarView === 'files'}
            title="Files"
            aria-label="Files"
            onClick={() => onSidebarViewChange('files')}
          >
            {isGardenTypora ? <ListTree size={14} aria-hidden="true" /> : 'Files'}
          </button>
          <button
            className={`sidebar-tab ${sidebarView === 'thumbnails' ? 'active sidebar-tab-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={sidebarView === 'thumbnails'}
            title="Thumbnails"
            aria-label="Thumbnails"
            onClick={() => onSidebarViewChange('thumbnails')}
          >
            {isGardenTypora ? <Grid3X3 size={14} aria-hidden="true" /> : 'Thumbnails'}
          </button>
        </div>
        <div id="sidebar-content" className="sidebar-content">
          <section className={`typora-sidebar-pane ${sidebarView === 'files' ? 'is-active' : ''}`}>
            {isGardenTypora ? null : typoraOutlineSearch(query, onQueryChange, searchResults, searchLoading, onSearchResultSelect)}
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

            <SidebarPins pinnedBlocks={pinnedBlocks} onOpenPinnedWindow={onOpenPinnedWindow} onOpenPinnedPage={onOpenPinnedPage} onUnpinBlock={onUnpinBlock} />
          </section>
          <section className={`typora-sidebar-pane is-thumbnail-pane ${sidebarView === 'thumbnails' ? 'is-active' : ''}`}>
            <div className="typora-sidebar-section-header">
              <span>Thumbnails</span>
              <button className="mini-button" type="button" onClick={onAddPage} aria-label="New page"><FilePlus size={14} /></button>
            </div>
            <PageThumbnails pages={pageThumbnails} hasMorePages={hasMorePageThumbnails} onSelectPage={onSelectPage} onLoadMore={onLoadMorePageThumbnails} />
          </section>
        </div>
      </aside>

      <main className="typora-workspace">
        {workspaceContent}
      </main>

      <OutlineDrawer
        open={outlineOpen}
        content={<TyporaOutline entries={outlineEntries} onJump={onJumpToOutlineEntry} />}
        extraContent={isGardenTypora ? typoraOutlineSearch(query, onQueryChange, searchResults, searchLoading, onSearchResultSelect) : undefined}
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
      <header className="card-window-grip" aria-label="Pinned card controls" onDoubleClick={() => setCollapsed((value) => !value)} onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, a, input, textarea, select')) return;
        event.stopPropagation();
        onDrag(event);
      }}>
        <button
          className="card-window-title"
          type="button"
          onMouseDown={(event) => {
            event.stopPropagation();
            onDrag(event);
          }}
          aria-expanded={!collapsed}
          tabIndex={-1}
        >
          {dateLabel}
        </button>
        {collapsed && previewLabel ? <span className="floating-card-preview">{previewLabel}</span> : null}
        <button type="button" onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={onClose} aria-label="Close pinned card">×</button>
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
          onShiftEnter={(editor) => {
            onBlur(editor.getHTML(), editor.getText());
            editor.commands.blur();
            return true;
          }}
          onMoveBlock={() => false}
          onMediaResizeStart={onMediaResizeStart}
          onImageAnnotate={(request) => onImageAnnotate({ ...request, target: { kind: 'card', blockId: block.id } })}
        />
      </div> : null}
    </main>
  );
}
