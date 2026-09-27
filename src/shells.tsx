import { DeskGuide } from './DeskGuide';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  type UIEvent
} from 'react';
import { ChevronDown, ChevronRight, Download, FileUp, Grid3X3, History, ListTree, MoreHorizontal, NotebookTabs, PanelRight, Pin, Plus, Search, SlidersHorizontal, Trash2, Upload } from 'lucide-react';
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

import { usePaperShell, GardenAppearance, PaperSettings, PaperCard, PaperLeaves, PaperSprite, PaperBackdrop, PaperBrand, PaperSidebarNote, PaperEditableText } from './paper-shell';

const appLogoUrl = '/app-assets/notebook-logo.jpg';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const readCssPx = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const textInkRect = (element: HTMLElement) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode && !textNode.textContent?.trim()) textNode = walker.nextNode();
  if (!textNode) return element.getBoundingClientRect();

  const range = document.createRange();
  range.selectNodeContents(textNode);
  const rect = range.getBoundingClientRect();
  return rect.width || rect.height ? rect : element.getBoundingClientRect();
};

const alignBlockFoldToDate = (root: HTMLElement) => {
  const date = root.querySelector<HTMLElement>('.block-created-at:not(.is-pinned), .block-created-at');
  const foldButton = root.querySelector<HTMLElement>('.block-rail .fold-button');
  if (!date || !foldButton) return;

  const dateRect = textInkRect(date);
  const foldRect = foldButton.getBoundingClientRect();
  if (!dateRect.height || !foldRect.height) return;

  const dateCenter = dateRect.top + dateRect.height / 2;
  const foldCenter = foldRect.top + foldRect.height / 2;
  const currentOffset = readCssPx(getComputedStyle(root).getPropertyValue('--block-fold-offset-y'));
  const nextOffset = clamp(Math.round((currentOffset - (foldCenter - dateCenter)) * 2) / 2, -5, 5);
  if (Math.abs(nextOffset - currentOffset) > 0.1) {
    root.style.setProperty('--block-fold-offset-y', `${nextOffset}px`);
  }
};

const useBlockFoldAlignment = (shell: ShellId, contentTheme: ContentThemeId) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    root.style.setProperty('--block-fold-offset-y', '0px');
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => alignBlockFoldToDate(root));
    };

    schedule();
    const workspace = root.querySelector('.typora-workspace') ?? root;
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(workspace, { childList: true, subtree: true, characterData: true });

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(root);

    document.fonts?.ready.then(schedule).catch(() => undefined);

    return () => {
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [shell, contentTheme]);

  return rootRef;
};

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
  addPage: (notebookId: string) => void;
  selectNotebook: (notebook: Notebook) => void;
  renameNotebook: (notebookId: string, name: string) => void;
  duplicateNotebook: (notebookId: string) => void;
  deleteNotebook: (notebookId: string) => void;
  openNotebookEmojiMenu: (notebookId: string, x: number, y: number) => void;
};

type ToolControlsProps = {
  outlineShowLists: boolean;
  onOutlineShowListsChange: (show: boolean) => void;
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
  outlineShowLists,
  onOutlineShowListsChange,
  compact = false,
  showToolbar,
  showPageMetadata,
  newestFirst,
  markdownInputRef,
  markdownFolderInputRef,
  outlineOpen,
  sidebarCollapsed,
  onShowToolbarChange,
  onShowPageMetadataChange,
  onNewestFirstChange,
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
      <div className={compact ? 'desk-settings-section' : 'tool-controls-group'}>
      {compact ? <div className="desk-section-title">视图</div> : null}
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
          <label className="view-toggle"><input type="checkbox" checked={outlineOpen} onChange={onOutlineToggle} /> Contents</label>
          <label className="view-toggle"><input type="checkbox" checked={outlineShowLists} onChange={event => onOutlineShowListsChange(event.target.checked)} /> Contents 显示列表项</label>
          <label className="view-toggle"><input type="checkbox" checked={!sidebarCollapsed} onChange={onSidebarToggle} /> Sidebar</label>
        </>
      )}
      </div>
      <div className={compact ? 'desk-settings-section desk-file-actions' : 'tool-controls-group'}>
      {compact ? <div className="desk-section-title">导入与备份</div> : null}
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
            <PanelRight size={15} /> Contents
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
      </div>
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

function DeskThemes({ controls }: { controls: ShellControlsProps }) {
  return <section className="desk-settings-section">
    <div className="desk-section-title">主题</div>
          <label className="desk-field-label">外壳主题</label>
          <select className="theme-select shell-theme-select" aria-label="Shell theme" value={controls.shell} onChange={event => controls.onShellChange(event.target.value as ShellId)}>{controls.shellThemes.map(theme => <option key={theme.id} value={theme.id}>{theme.label}</option>)}</select>
          {controls.shell.startsWith('typora-') && <><label className="desk-field-label">正文主题</label><select className="theme-select content-theme-select" aria-label="Content theme" value={controls.contentTheme} onChange={event => controls.onContentThemeChange(event.target.value as ContentThemeId)}>{contentThemes.map(theme => <option key={theme.id} value={theme.id}>{theme.label}</option>)}</select></>}
  </section>;
}

function FishDesk({ fishIconUrl, controls, appearance }: { fishIconUrl: string; controls: ShellControlsProps; appearance?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 24, y: 70 });
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  return (
    <aside className="fish-desk" aria-label="Desk controls">
      <div className="fish-desk-menu">
      <button className="fish-desk-trigger" type="button" aria-label="Open Desk controls"><img src={fishIconUrl} alt="" aria-hidden="true" /></button>
      <div className="fish-desk-panel">
        <div className="fish-desk-title">Desk</div>
        <DeskGuide />
        <div className="typora-tool-controls">
          <button className="secondary-button" type="button" onClick={event => { event.currentTarget.blur(); setOpen(true); }}><SlidersHorizontal size={15} aria-hidden="true" />外观调整</button>
        </div>
        <ToolControls compact {...controls} />
      </div>
      </div>
      {open && <section className="fish-desk-panel appearance-panel" role="dialog" aria-label="外观调整" style={{ left: position.x, top: position.y }} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
        <header onPointerDown={event => {
          if ((event.target as HTMLElement).closest('button')) return;
          drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={event => {
          if (!drag.current) return;
          setPosition({ x: Math.max(0, Math.min((window.innerWidth - (event.currentTarget.parentElement?.offsetWidth ?? 290)), drag.current.left + event.clientX - drag.current.x)), y: Math.max(0, Math.min((window.innerHeight - (event.currentTarget.parentElement?.offsetHeight ?? 70)), drag.current.top + event.clientY - drag.current.y)) });
        }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <strong>外观调整</strong><span>拖动面板，实时预览</span><button type="button" aria-label="关闭外观调整" onClick={() => setOpen(false)}>×</button>
        </header>
        <div className="appearance-fields typora-tool-controls">
          <DeskThemes controls={controls} />
          {appearance}
        </div>
      </section>}
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
  selectedNotebookId,
  canDeleteNotebook,
  variant,
  actions,
  pageTrees,
  onRootPageDrop
}: {
  notebooks: Notebook[];
  selectedNotebookId: string | null;
  canDeleteNotebook: boolean;
  variant: 'native' | 'typora';
  actions: NotebookActions;
  pageTrees: Map<string, ReactNode>;
  onRootPageDrop: (pageId: string) => void;
}) {
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [expandedNotebookIds, setExpandedNotebookIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const expand = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === 'string') setExpandedNotebookIds(current => new Set([...current, id]));
    };
    window.addEventListener('folia:expand-notebook', expand);
    return () => window.removeEventListener('folia:expand-notebook', expand);
  }, []);
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

  const toggleNotebookExpanded = (notebookId: string) => {
    setExpandedNotebookIds((current) => {
      const next = new Set(current);
      if (next.has(notebookId)) next.delete(notebookId);
      else next.add(notebookId);
      return next;
    });
  };

  const renderNotebookLabel = (notebook: Notebook) => {
    const isEditing = editingNotebookId === notebook.id;
    const isSelected = notebook.id === selectedNotebookId;
    const emoji = notebook.metadata.emoji;
    const hasPages = notebook.pageIds.length > 0;
    const expanded = expandedNotebookIds.has(notebook.id);
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
    const notebookIcon = (
      <span className={`notebook-icon-wrap ${hasPages ? '' : 'is-empty'}`}>
        <span className="notebook-icon-glyph" aria-hidden="true">{leadingIcon}</span>
        {hasPages ? (
          <span
            className="notebook-disclosure"
            role="button"
            tabIndex={0}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} notebook ${notebook.name}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              toggleNotebookExpanded(notebook.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              toggleNotebookExpanded(notebook.id);
            }}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        ) : null}
      </span>
    );

    if (variant === 'typora') {
      return isEditing ? (
        <div className={`file-node-content notebook-node notebook-editing ${emoji ? 'has-node-icon' : ''} ${isSelected ? 'is-selected' : ''}`}>
          {notebookIcon}
          <input {...sharedInputProps} />
        </div>
      ) : (
        <button
          className={`file-node-content notebook-node ${emoji ? 'has-node-icon' : ''} ${isSelected ? 'is-selected' : ''}`}
          type="button"
          data-generic-name={/^(notebooks?)$/i.test(notebook.name.trim()) || undefined}
          aria-label={notebook.name}
          title={notebook.name}
          data-notebook-id={notebook.id}
          onMouseDown={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            if (event.detail >= 2) {
              event.preventDefault();
              beginRename(notebook);
            }
          }}
          onKeyDown={(event) => {
            if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && (event.key === 'Backspace' || event.key === 'Delete')) {
              event.preventDefault();
              actions.deleteNotebook(notebook.id);
            }
          }}
          onClick={() => actions.selectNotebook(notebook)}
          onDoubleClick={() => beginRename(notebook)}
          onContextMenu={(event) => {
            event.preventDefault();
            actions.selectNotebook(notebook);
            actions.openNotebookEmojiMenu(notebook.id, event.clientX, event.clientY);
          }}
        >
          {notebookIcon}
          <span className="file-node-title file-name notebook-label">{notebook.name}</span>
        </button>
      );
    }

    return isEditing ? (
      <div className={`notebook-button notebook-editing ${emoji ? 'has-node-icon' : ''} ${isSelected ? 'active' : ''}`}>
        {notebookIcon}
        <input {...sharedInputProps} />
      </div>
    ) : (
      <button
        className={`notebook-button ${emoji ? 'has-node-icon' : ''} ${isSelected ? 'active' : ''}`}
        type="button"
        data-notebook-id={notebook.id}
        onMouseDown={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          if (event.detail >= 2) {
            event.preventDefault();
            beginRename(notebook);
          }
        }}
        onKeyDown={(event) => {
          if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && (event.key === 'Backspace' || event.key === 'Delete')) {
            event.preventDefault();
            actions.deleteNotebook(notebook.id);
          }
        }}
        onClick={() => actions.selectNotebook(notebook)}
        onDoubleClick={() => beginRename(notebook)}
        onContextMenu={(event) => {
          event.preventDefault();
          actions.selectNotebook(notebook);
          actions.openNotebookEmojiMenu(notebook.id, event.clientX, event.clientY);
        }}
      >
        {notebookIcon}
        <span className="notebook-label">{notebook.name}</span>
      </button>
    );
  };

  const renderNotebookActions = (notebook: Notebook, className: string) => (
    <div className={className}>
      <button
        className="mini-button row-action add-page-button"
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          actions.addPage(notebook.id);
        }}
        aria-label={`New page in ${notebook.name}`}
      ><Plus size={13} /></button>
      <button
        className="mini-button row-action notebook-menu-button"
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          actions.openNotebookEmojiMenu(notebook.id, rect.left, rect.bottom + 4);
        }}
        aria-label={`More actions for ${notebook.name}`}
      ><MoreHorizontal size={13} /></button>
    </div>
  );

  const rootDropProps = {
    onDragOver: (event: DragEvent<HTMLElement>) => event.preventDefault(),
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      if (target?.closest('.page-row-shell, .file-node-row-shell')) return;
      const draggedId = event.dataTransfer.getData('application/page-id');
      if (draggedId) onRootPageDrop(draggedId);
    }
  };

  if (variant === 'typora') {
    return (
      <div className="file-library" {...rootDropProps}>
        {notebooks.map((notebook) => (
          <div className="file-library-node" data-is-directory="true" key={notebook.id}>
            <span className="file-node-background" aria-hidden="true" />
            <div className={`file-node-row-shell ${notebook.id === selectedNotebookId ? 'selected' : ''}`} data-notebook-id={notebook.id}>
              {renderNotebookLabel(notebook)}
              {renderNotebookActions(notebook, 'row-actions file-node-actions')}
            </div>
            {expandedNotebookIds.has(notebook.id) && pageTrees.get(notebook.id) ? <div className="file-node-children notebook-page-children">{pageTrees.get(notebook.id)}</div> : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="notebook-list" {...rootDropProps}>
      {notebooks.map((notebook) => (
        <div key={notebook.id} className="notebook-tree-node">
          <div className={`notebook-row-shell ${notebook.id === selectedNotebookId ? 'selected' : ''}`} data-notebook-id={notebook.id}>
            {renderNotebookLabel(notebook)}
            {renderNotebookActions(notebook, 'row-actions notebook-row-actions')}
          </div>
          {expandedNotebookIds.has(notebook.id) && pageTrees.get(notebook.id) ? <div className="notebook-page-children">{pageTrees.get(notebook.id)}</div> : null}
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
  return <CollapsibleOutline entries={entries} onJump={onJump} variant="native" />;
}

export function TyporaOutline({
  entries,
  onJump
}: {
  entries: OutlineEntry[];
  onJump: (entry: OutlineEntry) => void;
}) {
  return <CollapsibleOutline entries={entries} onJump={onJump} variant="typora" />;
}

function CollapsibleOutline({
  entries,
  onJump,
  variant
}: {
  entries: OutlineEntry[];
  onJump: (entry: OutlineEntry) => void;
  variant: 'native' | 'typora';
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleEntry = (entryId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  let hiddenBelowLevel: number | null = null;
  const rows = entries.map((entry, index) => {
    if (hiddenBelowLevel !== null && entry.level > hiddenBelowLevel) return null;
    if (hiddenBelowLevel !== null && entry.level <= hiddenBelowLevel) hiddenBelowLevel = null;
    const hasChildren = (entries[index + 1]?.level ?? 0) > entry.level;
    const isCollapsed = hasChildren && collapsed.has(entry.id);
    if (isCollapsed) hiddenBelowLevel = entry.level;
    const className = variant === 'typora'
      ? `outline-item md-toc-item outline-kind-${entry.kind} ${entry.blockId === null ? 'outline-item-active active' : ''} ${hasChildren ? 'is-collapsible' : ''} ${isCollapsed ? 'is-collapsed' : ''}`
      : `outline-entry md-toc-item outline-kind-${entry.kind} ${hasChildren ? 'is-collapsible' : ''} ${isCollapsed ? 'is-collapsed' : ''}`;
    const marker = entry.kind === 'page' ? 'P' : entry.kind === 'block' ? 'B' : entry.kind === 'heading' ? `H${Math.max(1, entry.level - 1)}` : '•';
    return (
      <button
        className={className}
        key={entry.id}
        onClick={() => onJump(entry)}
        style={{ '--level': entry.level } as CSSProperties}
        type="button"
      >
        <span
          className="outline-expander"
          aria-label={hasChildren ? (isCollapsed ? 'Expand contents entry' : 'Collapse contents entry') : undefined}
          aria-hidden={hasChildren ? undefined : 'true'}
          role={hasChildren ? 'button' : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          onClick={(event) => {
            if (!hasChildren) return;
            event.preventDefault();
            event.stopPropagation();
            toggleEntry(entry.id);
          }}
          onKeyDown={(event) => {
            if (!hasChildren || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            event.stopPropagation();
            toggleEntry(entry.id);
          }}
        >
          {hasChildren ? (isCollapsed ? '▸' : '▾') : marker}
        </span>
        <span className="outline-label">{entry.text}</span>
      </button>
    );
  });

  const wrapperProps = variant === 'typora'
    ? { id: 'outline-content', className: 'outline-content typora-toc md-toc md-toc-content' }
    : { className: 'outline-list typora-toc md-toc md-toc-content' };

  return <div {...wrapperProps}>{rows}</div>;
}

export function OutlineDrawer({
  open,
  content,
  extraContent,
  decoration,
  heading = 'Contents',
  showClose = true,
  headerContent,
  onClose
}: {
  open: boolean;
  content: ReactNode;
  extraContent?: ReactNode;
  decoration?: ReactNode;
  heading?: string;
  showClose?: boolean;
  headerContent?: ReactNode;
  onClose: () => void;
}) {
  return (
    <aside className={`outline-drawer ${open ? 'is-open' : ''} ${headerContent ? 'has-header-note' : ''}`} aria-hidden={!open}>
      {decoration}
      {headerContent}
      <header className="outline-drawer-head">
        <div className="panel-title"><PanelRight size={16} /> {heading}</div>
        {showClose ? <button className="mini-button" type="button" onClick={onClose} aria-label="Close contents">×</button> : null}
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
      <div
        className="floating-card-head"
        onMouseDown={(event) => {
          if (event.detail >= 2) {
            event.preventDefault();
          }
        }}
        onDoubleClick={() => setCollapsed((value) => !value)}
      >
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
  selectedNotebookId: string | null;
  notebooks: Notebook[];
  notebookActions: NotebookActions;
  query: string;
  onQueryChange: (query: string) => void;
  searchResults: PageSearchResult[];
  searchLoading: boolean;
  onSearchResultSelect: (pageId: string) => void;
  pageTrees: Map<string, ReactNode>;
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
  onAddNotebook,
  onChange
}: {
  brand: NativeBrandSettings;
  sidebarView: 'files' | 'thumbnails';
  onSidebarViewChange: (view: 'files' | 'thumbnails') => void;
  onAddNotebook: () => void;
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
        <button
          className="native-sidebar-tab native-sidebar-add"
          type="button"
          title="New notebook"
          aria-label="New notebook"
          onClick={onAddNotebook}
        >
          <Plus size={14} aria-hidden="true" />
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
  outlineOpen,
  sidebarView,
  selectedNotebookId,
  notebooks,
  notebookActions,
  query,
  onQueryChange,
  searchResults,
  searchLoading,
  onSearchResultSelect,
  pageTrees,
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
  const gardenAppearance = usePaperShell(shell);
  return (
    <div style={gardenAppearance.gardenStyle} className={`app-shell garden-background typora-theme ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${outlineOpen ? 'outline-open' : 'outline-collapsed'}`} data-content-theme={contentTheme} data-shell={shell}>
      <aside className="sidebar">
        <NativeBrandBlock brand={nativeBrand} sidebarView={sidebarView} onSidebarViewChange={onSidebarViewChange} onAddNotebook={notebookActions.addNotebook} onChange={onNativeBrandChange} />

        {sidebarView === 'files' ? (
          <>
            <section className="sidebar-section">
              <NotebookList notebooks={notebooks} selectedNotebookId={selectedNotebookId} canDeleteNotebook={notebooks.length > 1} variant="native" actions={notebookActions} pageTrees={pageTrees} onRootPageDrop={onRootPageDrop} />
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
          <div className="panel-title"><PanelRight size={16} /> Contents</div>
          <NativeOutline entries={outlineEntries} onJump={onJumpToOutlineEntry} />
        </section>
      </aside>

      <FishDesk fishIconUrl={fishIconUrl} controls={controls} appearance={<GardenAppearance settings={gardenAppearance.settings} update={gardenAppearance.update} />} />

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
  selectedNotebookId,
  notebooks,
  notebookActions,
  query,
  onQueryChange,
  searchResults,
  searchLoading,
  onSearchResultSelect,
  pageTrees,
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
  const isPaperTypora = shell === 'typora-tilted' || shell === 'typora-collage';
  const paper = usePaperShell(shell);
  const showSidebarSearch = shell === 'typora-tilted' || shell === 'typora-base';
  const shellRef = useBlockFoldAlignment(shell, contentTheme);

  return (
    <div ref={shellRef} style={isPaperTypora ? paper.style : isGardenTypora ? paper.gardenStyle : undefined} className={`typora-app-shell typora-theme ${isPaperTypora ? 'paper-shell' : isGardenTypora ? 'garden-background' : ''} ${outlineOpen ? 'outline-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} data-content-theme={contentTheme} data-shell={shell}>
      {isPaperTypora ? <PaperBackdrop collage={shell === 'typora-collage'} custom={Boolean(paper.settings.image.trim())} /> : null}
      <aside id="typora-sidebar" className="typora-sidebar active-tab-files">
        {shell === 'typora-collage' ? <PaperBrand value={paper.settings.brandText} onChange={brandText => paper.update({ brandText })} /> : null}
        <div className="typora-sidebar-tools">
        {shell === 'typora-collage' ? typoraOutlineSearch(query, onQueryChange, searchResults, searchLoading, onSearchResultSelect) : null}
        <div className="sidebar-tabs" role="tablist" aria-label="Sidebar view">
          {isGardenTypora ? <GardenSidebarNote value={gardenSidebarNote} onChange={onGardenSidebarNoteChange} /> : null}
          {shell === 'typora-tilted' ? <PaperSidebarNote value={paper.settings.rightText} onChange={rightText => paper.update({ rightText })} /> : null}
          <button
            className={`sidebar-tab ${sidebarView === 'files' ? 'active sidebar-tab-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={sidebarView === 'files'}
            title="Files"
            aria-label="Files"
            onClick={() => onSidebarViewChange('files')}
          >
            {isGardenTypora || isPaperTypora ? <ListTree size={14} aria-hidden="true" /> : 'Files'}
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
            {isGardenTypora || isPaperTypora ? <Grid3X3 size={14} aria-hidden="true" /> : 'Thumbnails'}
          </button>
          <button
            className="sidebar-tab sidebar-add-notebook"
            type="button"
            title="New notebook"
            aria-label="New notebook"
            onClick={notebookActions.addNotebook}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        </div>
        {isGardenTypora ? <div className="garden-sidebar-search">{typoraOutlineSearch(query, onQueryChange, searchResults, searchLoading, onSearchResultSelect)}</div> : null}
        <div id="sidebar-content" className="sidebar-content">
          <section className={`typora-sidebar-pane ${sidebarView === 'files' ? 'is-active' : ''}`}>
            {showSidebarSearch ? typoraOutlineSearch(query, onQueryChange, searchResults, searchLoading, onSearchResultSelect) : null}
            <NotebookList notebooks={notebooks} selectedNotebookId={selectedNotebookId} canDeleteNotebook={notebooks.length > 1} variant="typora" actions={notebookActions} pageTrees={pageTrees} onRootPageDrop={onRootPageDrop} />

            <SidebarPins pinnedBlocks={pinnedBlocks} onOpenPinnedWindow={onOpenPinnedWindow} onOpenPinnedPage={onOpenPinnedPage} onUnpinBlock={onUnpinBlock} />
          </section>
          <section className={`typora-sidebar-pane is-thumbnail-pane ${sidebarView === 'thumbnails' ? 'is-active' : ''}`}>
            <div className="typora-sidebar-section-header">
              <span>Thumbnails</span>
            </div>
            <PageThumbnails pages={pageThumbnails} hasMorePages={hasMorePageThumbnails} onSelectPage={onSelectPage} onLoadMore={onLoadMorePageThumbnails} />
          </section>
        </div>
        {isPaperTypora ? (
          <>
            <PaperCard settings={paper.settings} footerLayout={{ x: paper.settings.footerX, y: paper.settings.footerY, rotation: paper.settings.footerRotation, scale: paper.settings.footerScale }} onFooterLayoutChange={layout => paper.update({ footerX: layout.x, footerY: layout.y, footerRotation: layout.rotation, footerScale: layout.scale ?? 1 })} onFooterChange={footerText => paper.update({ footerText })} />
          </>
        ) : null}
      </aside>

      <div className="typora-workspace-frame"><main className="typora-workspace">
        {workspaceContent}
      </main></div>

      {shell === 'typora-tilted' && outlineOpen ? <div className="paper-desk-note"><p><PaperEditableText key={shell} layout={{ x: paper.settings.captionX, y: paper.settings.captionY, rotation: paper.settings.captionRotation, scale: paper.settings.captionScale }} onLayoutChange={layout => paper.update({ captionX: layout.x, captionY: layout.y, captionRotation: layout.rotation, captionScale: layout.scale ?? 1 })} value={paper.settings.cardText} onChange={cardText => paper.update({ cardText })} label="背景题字" /></p></div> : null}
      {shell === 'typora-collage' && outlineOpen ? <><PaperCard settings={paper.settings} pinned /><p className="paper-collage-caption"><PaperEditableText layout={{ x: paper.settings.captionX, y: paper.settings.captionY, rotation: paper.settings.captionRotation, scale: paper.settings.captionScale }} onLayoutChange={layout => paper.update({ captionX: layout.x, captionY: layout.y, captionRotation: layout.rotation, captionScale: layout.scale ?? 1 })} value={paper.settings.cardText} onChange={cardText => paper.update({ cardText })} label="右栏下方题字" /></p></> : null}
      {shell === 'typora-collage' && paper.settings.leaves && outlineOpen ? <PaperLeaves /> : null}
      <OutlineDrawer
        heading="Contents"
        showClose={false}
        decoration={shell === 'typora-collage' ? <><span className="paper-outline-scraps" aria-hidden="true"><i /><i /></span><img src="/app-assets/paper/thing1.png" className="paper-real-tape" alt="" aria-hidden="true" /></> : undefined}
        open={outlineOpen}
        content={<TyporaOutline entries={outlineEntries} onJump={onJumpToOutlineEntry} />}
        onClose={controls.onOutlineToggle}
      />

      <FishDesk fishIconUrl={fishIconUrl} controls={controls} appearance={isPaperTypora ? <PaperSettings key={shell} shell={shell} settings={paper.settings} update={paper.update} /> : isGardenTypora ? <GardenAppearance settings={paper.settings} update={paper.update} /> : undefined} />

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
  autoFocus,
  editorRef,
  onFocus,
  onSelectionUpdate,
  onUpdate,
  onBlur,
  useIdeographicSpace,
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
  autoFocus?: boolean;
  editorRef: (editor: Editor | null) => void;
  onFocus: (editor: Editor) => void;
  onSelectionUpdate: (editor: Editor) => void;
  onUpdate: (html: string, plainText: string) => void;
  onBlur: (html: string, plainText: string) => void;
  useIdeographicSpace: boolean;
  onMediaResizeStart: (request: MediaResizeRequest) => void;
  onImageAnnotate: (request: ImageAnnotationRequest) => void;
  onClose: () => void;
  onDrag: (event: MouseEvent<HTMLElement>) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pendingUpdateRef = useRef<{ html: string; plainText: string } | null>(null);
  const updateTimerRef = useRef<number | null>(null);
  const preview = block.content.plainText.replace(/\s+/g, ' ').trim();
  const dateLabel = blockTimestampLabel(block.createdAt);
  const previewLabel = preview ? `${preview.slice(0, 96)}${preview.length > 96 ? '...' : ''}` : '';
  const clearPendingUpdate = () => {
    if (updateTimerRef.current) {
      window.clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    pendingUpdateRef.current = null;
  };
  const scheduleUpdate = (html: string, plainText: string) => {
    pendingUpdateRef.current = { html, plainText };
    if (updateTimerRef.current) window.clearTimeout(updateTimerRef.current);
    updateTimerRef.current = window.setTimeout(() => {
      updateTimerRef.current = null;
      const pending = pendingUpdateRef.current;
      if (!pending) return;
      pendingUpdateRef.current = null;
      onUpdate(pending.html, pending.plainText);
    }, 550);
  };

  useEffect(() => () => {
    if (updateTimerRef.current) window.clearTimeout(updateTimerRef.current);
    const pending = pendingUpdateRef.current;
    if (pending) onUpdate(pending.html, pending.plainText);
  }, []);

  return (
    <main className={`card-window-page typora-theme ${roundPinnedCards ? 'is-rounded' : 'is-square'} ${glowPinnedCards ? 'has-glow' : ''} ${collapsed ? 'is-collapsed' : ''}`} data-content-theme={contentTheme} data-shell={shell}>
      <header className="card-window-grip" aria-label="Pinned card controls" onDoubleClick={() => setCollapsed((value) => !value)} onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (event.detail >= 2) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
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
          autoFocus={autoFocus}
          useIdeographicSpace={useIdeographicSpace}
          onFocus={onFocus}
          onSelectionUpdate={onSelectionUpdate}
          onUpdate={scheduleUpdate}
          onBlur={(html, plainText) => {
            clearPendingUpdate();
            onBlur(html, plainText);
          }}
          onShiftEnter={(editor) => {
            const html = editor.getHTML();
            const plainText = editor.getText();
            clearPendingUpdate();
            onBlur(html, plainText);
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
