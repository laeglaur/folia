import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Trash2
} from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { AppState, Block, ContentThemeId, MetadataFieldType, Notebook, NotebookCalendarDateSource, NotebookCalendarViewConfig, OperationLogEntry, Page, PageMetadataField, ShellId } from './types';
import {
  createBlock,
  createId,
  createInitialState,
  createBlocksForMarkdownFolderDocument,
  createMarkdownFolderImportPlan,
  createNotebookFromMarkdownDocuments,
  createNotebook,
  createPageFromMarkdown,
  createPage,
  deleteBlock as persistBlockDelete,
  downloadTextFile,
  emptyTrash,
  htmlToMarkdown,
  loadDatabaseBootstrap,
  loadBlockDocument,
  loadFullBackupState,
  listPageRevisions,
  listCalendarBlocks,
  listTrashItems,
  loadPageDocument,
  loadPageDocuments,
  listPinnedBlocks,
  loadState,
  loadWorkspacePreferences,
  persistEntityRename,
  persistNotebookCreate,
  persistPageCreate,
  persistPageDocument,
  persistPageMetadata,
  persistNotebookMetadata,
  persistPageTreeDelete,
  persistNotebookDelete,
  persistPageMove,
  persistImportBatch,
  restorePageRevision,
  restoreTrashItem,
  saveState,
  saveWorkspacePreferences,
  searchPages,
  stringifyFrontmatter,
  type NotebookTreePayload,
  type PageDocumentPayload,
  type PinnedBlockPayload,
  type CalendarBlockPayload,
  type PageSearchResult,
  type TrashItemPayload
} from './state';
import {
  escapeHtml,
  importAttachmentFile,
  inferAttachmentKind,
  runListIndentCommand,
  type MathEditorState,
  type ImageAnnotationRequest,
  type MediaNodeType,
  type MediaResizeRequest,
  type TableControlsState,
  type ToolbarCommand
} from './editor';
import {
  calendarDaysForMonth,
  displayMathLatex,
  embedImportedAssetMarkdown,
  extractOutlineEntries,
  fileRelativePath,
  findBlockMathPositionNear,
  isResizableMediaNode,
  markdownImportFileRegex,
  mediaImportFileRegex,
  monthKey,
  pageTimestampLabel,
  splitImportRoot,
  stripOutlineAnchors,
  type CalendarEntry,
  type ImportNotice,
  type OutlineEntry,
  type WorkspaceView
} from './app-utils';
import {
  ancestorsOfPage,
  applyActiveNotebookToViewState,
  applyActivePageToViewState,
  applyBlockDeleteToViewState,
  applyContentThemeToViewState,
  applyNotebookDeleteToViewState,
  applyNotebookDuplicateToViewState,
  applyNotebookCreateToViewState,
  applyNotebookEmojiToViewState,
  applyNotebookRenameToViewState,
  applyPageDocumentToViewState,
  applyPageCreateToViewState,
  applyPageExpandedToggleToViewState,
  applyPageEmojiToViewState,
  applyMarkdownFilesImportToViewState,
  applyMarkdownFolderImportToViewState,
  applyMarkdownFolderPageDocumentToViewState,
  applyPageMoveToViewState,
  applyPageNavigationToViewState,
  applyPageRenameToViewState,
  applyPageTreeDuplicateToViewState,
  applyPageTreeDeleteToViewState,
  applyOpenCardBlockToViewState,
  applyRestoredPageDocumentToViewState,
  applyShellToViewState,
  applyShowPageMetadataToViewState,
  blocksForCurrentPage,
  blocksForPage,
  calendarEntriesFromPayloads,
  descendantsOfPage,
  legacyCalendarEntriesFromState,
  legacyCardModeBlockFromState,
  legacyOpenCardBlockFromState,
  legacyPinnedBlocksFromState,
  mergeNotebookTree,
  mergePageDocument
} from './workspace-view-model';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import 'katex/dist/katex.min.css';
import { CardWindowPage, NativeShell, TyporaShell, type PageThumbnailItem } from './shells';
import { WorkspaceContent, type EditorTarget } from './workspace';
import {
  buildPageCalendarEntries,
  calendarDateCandidatesForPages,
  defaultCalendarConfigForPages,
  visibleCalendarFieldsForPages
} from './page-calendar';
import { ImageAnnotationEditor, serializeImageAnnotations, type ImageAnnotationDocument } from './image-annotations';
import { EmojiPicker, type EmojiPickerRequest } from './emoji-picker';
import { EmojiImage } from './emoji-image';
import { inferNotebookMetadataFieldsForPages, metadataFieldTypeFor, metadataSelectOptionsForPages, shouldHideMetadataField } from './metadata-fields';

const shellThemes: Array<{ id: ShellId; label: string }> = [
  { id: 'native-garden', label: 'Native Garden' },
  { id: 'native-ledger', label: 'Native Ledger' },
  { id: 'typora-base', label: 'Typora Base' },
  { id: 'typora-garden', label: 'Garden Typora' }
];

const fishIconUrl = '/app-assets/blue_red_fish.png';
const fullExpansionImportPageLimit = 80;
const searchParams = new URLSearchParams(window.location.search);
const cardModeBlockId = searchParams.get('card');
if (cardModeBlockId) {
  document.documentElement.dataset.cardWindow = 'true';
} else {
  delete document.documentElement.dataset.cardWindow;
}
const cardModeRoundPinnedCards = searchParams.get('roundPinnedCards') !== '0';
const cardModeGlowPinnedCards = searchParams.get('glowPinnedCards') !== '0';
const importStressMode = searchParams.has('importStress');
const disableBrowserPersistence = searchParams.get('persistence') === 'off';
const folderImportConcurrency = 4;

type ImportedAsset = {
  id: string;
  storedPath: string;
};

type OpenedMarkdownFilePayload = {
  path: string;
  filename: string;
  markdown: string;
};

type TemporaryMarkdownPage = {
  id: string;
  sourcePath: string;
  filename: string;
};

type DeletedBlockSnapshot = {
  block: Block;
  pageId: string;
  index: number;
  nextSelectedBlockId: string | null;
};

type EmojiContextMenuState = {
  x: number;
  y: number;
  target: EmojiPickerRequest['target'];
};

type CalendarDateOption = {
  key: NotebookCalendarDateSource;
  label: string;
  count: number;
};

type PageContextMenuState = {
  x: number;
  y: number;
  pageId: string;
};

type PageFindMatch = {
  blockId: string;
  occurrenceIndex: number;
  preview: string;
};

const pageFindHighlightName = 'notebook-page-find';
const initialPageThumbnailLimit = 40;
const pageThumbnailLimitStep = 30;

const clearPageFindTextHighlight = () => {
  CSS.highlights?.delete(pageFindHighlightName);
};

const findTextRangeInElement = (element: HTMLElement, query: string, occurrenceIndex = 0) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  let seen = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, textarea, input')) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent?.toLowerCase().includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  let textNode = walker.nextNode();
  while (textNode) {
    const text = textNode.textContent ?? '';
    const lowerText = text.toLowerCase();
    let index = lowerText.indexOf(needle);
    while (index >= 0) {
      if (seen === occurrenceIndex) {
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + needle.length);
        return range;
      }
      seen += 1;
      index = lowerText.indexOf(needle, index + needle.length);
    }
    textNode = walker.nextNode();
  }
  return null;
};

const highlightTextRange = (range: Range | null) => {
  if (!range || !CSS.highlights || typeof Highlight === 'undefined') return;
  CSS.highlights.set(pageFindHighlightName, new Highlight(range));
};

const isEditorContentEmpty = (html: string, plainText = '') => {
  if (plainText.trim()) return false;
  const container = document.createElement('div');
  container.innerHTML = html;
  if (container.textContent?.trim()) return false;
  return !container.querySelector('img, video, audio, iframe, table, pre, [data-type="block-math"], [data-type="inline-math"]');
};

const mapWithConcurrency = async <Item, Result>(
  items: Item[],
  limit: number,
  worker: (item: Item, index: number) => Promise<Result>
) => {
  const results: Result[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

export function App() {
  const [state, setState] = useState<AppState>(() => (cardModeBlockId && isTauri() ? createInitialState() : loadState()));
  const [draftsByPageId, setDraftsByPageId] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [pageFindOpen, setPageFindOpen] = useState(false);
  const [pageFindQuery, setPageFindQuery] = useState('');
  const [pageFindIndex, setPageFindIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<PageSearchResult[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItemPayload[]>([]);
  const [pinnedBlockPayloads, setPinnedBlockPayloads] = useState<PinnedBlockPayload[]>([]);
  const [calendarBlockPayloads, setCalendarBlockPayloads] = useState<CalendarBlockPayload[]>([]);
  const [cardDocument, setCardDocument] = useState<PageDocumentPayload | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeEditor, setActiveEditor] = useState<EditorTarget>({ kind: 'composer' });
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [tableControls, setTableControls] = useState<TableControlsState>({ visible: false, top: 0, left: 0 });
  const [mathEditor, setMathEditor] = useState<MathEditorState | null>(null);
  const [imageAnnotationRequest, setImageAnnotationRequest] = useState<ImageAnnotationRequest | null>(null);
  const [emojiPickerRequest, setEmojiPickerRequest] = useState<EmojiPickerRequest | null>(null);
  const [emojiContextMenu, setEmojiContextMenu] = useState<EmojiContextMenuState | null>(null);
  const [pageContextMenu, setPageContextMenu] = useState<PageContextMenuState | null>(null);
  const [typoraSidebarView, setTyporaSidebarView] = useState<'files' | 'thumbnails'>('files');
  const [pageMoveQuery, setPageMoveQuery] = useState('');
  const [pageMoveIndex, setPageMoveIndex] = useState(0);
  const [showComposerFooter, setShowComposerFooter] = useState(false);
  const [showBlockBorders, setShowBlockBorders] = useState(true);
  const [roundPinnedCards, setRoundPinnedCards] = useState(cardModeBlockId ? cardModeRoundPinnedCards : true);
  const [glowPinnedCards, setGlowPinnedCards] = useState(cardModeBlockId ? cardModeGlowPinnedCards : true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copiedPageId, setCopiedPageId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [trashBusy, setTrashBusy] = useState(false);
  const [temporaryMarkdownPages, setTemporaryMarkdownPages] = useState<TemporaryMarkdownPage[]>([]);
  const [deletedBlockSnapshot, setDeletedBlockSnapshot] = useState<DeletedBlockSnapshot | null>(null);
  const [pageDraftName, setPageDraftName] = useState('');
  const [outlineDrawerOpen, setOutlineDrawerOpen] = useState(true);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('write');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [importNotice, setImportNotice] = useState<ImportNotice>({ kind: 'idle', message: '' });
  const composerEditorRef = useRef<Editor | null>(null);
  const blockEditorRefs = useRef<Record<string, Editor | null>>({});
  const pageNameInputRef = useRef<HTMLInputElement | null>(null);
  const cancelPageBlurCommitRef = useRef(false);
  const draftsByPageIdRef = useRef(draftsByPageId);
  const persistenceReadyRef = useRef(!isTauri());
  const metadataSchemaSeededNotebookIdsRef = useRef(new Set<string>());
  const markdownInputRef = useRef<HTMLInputElement | null>(null);
  const markdownFolderInputRef = useRef<HTMLInputElement | null>(null);
  const pageFindInputRef = useRef<HTMLInputElement | null>(null);
  const pageFindPopoverRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(state);
  const activePageBlocksRef = useRef<Block[]>([]);
  const activePageDocumentRequestRef = useRef(0);
  const cardDocumentRequestRef = useRef(0);
  const pageDocumentSaveTimersRef = useRef<Record<string, number>>({});
  const workspacePreferencesSaveTimerRef = useRef<number | null>(null);
  const lastSavedWorkspacePreferencesRef = useRef('');
  const deletedBlockSnapshotRef = useRef<DeletedBlockSnapshot | null>(null);
  const temporaryMarkdownPagesRef = useRef<TemporaryMarkdownPage[]>([]);

  const closeEmojiContextMenu = () => setEmojiContextMenu(null);
  const closePageContextMenu = () => setPageContextMenu(null);

  useEffect(() => {
    if (!emojiContextMenu) return;
    const close = () => closeEmojiContextMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [emojiContextMenu]);

  useEffect(() => {
    if (!pageContextMenu) return;
    const close = () => closePageContextMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pageContextMenu]);

  useEffect(() => {
    if (cardModeBlockId) return;
    const handlePageFindShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && key === 'f') {
        event.preventDefault();
        event.stopPropagation();
        setPageFindOpen(true);
      }
      if (pageFindOpen && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setPageFindOpen(false);
      }
    };
    window.addEventListener('keydown', handlePageFindShortcut, true);
    return () => window.removeEventListener('keydown', handlePageFindShortcut, true);
  }, [pageFindOpen]);

  useEffect(() => {
    const handleSidebarShortcuts = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key !== '[' && event.key !== ']') return;
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.closest('input, textarea, select')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === '[') setSidebarCollapsed((collapsed) => !collapsed);
      if (event.key === ']') setOutlineDrawerOpen((open) => !open);
    };
    window.addEventListener('keydown', handleSidebarShortcuts, true);
    return () => window.removeEventListener('keydown', handleSidebarShortcuts, true);
  }, []);

  const workspacePreferences = useMemo(() => ({
    activeNotebookId: state.activeNotebookId,
    activePageId: state.activePageId,
    shell: state.shell,
    theme: state.theme,
    contentTheme: state.contentTheme,
    openCardWindowBlockId: state.openCardWindowBlockId,
    expandedPageIds: state.expandedPageIds,
    showPageMetadata: state.showPageMetadata
  }), [
    state.activeNotebookId,
    state.activePageId,
    state.shell,
    state.theme,
    state.contentTheme,
    state.openCardWindowBlockId,
    state.expandedPageIds,
    state.showPageMetadata
  ]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    draftsByPageIdRef.current = draftsByPageId;
  }, [draftsByPageId]);

  useEffect(() => {
    deletedBlockSnapshotRef.current = deletedBlockSnapshot;
  }, [deletedBlockSnapshot]);

  useEffect(() => {
    temporaryMarkdownPagesRef.current = temporaryMarkdownPages;
  }, [temporaryMarkdownPages]);

  useEffect(() => {
    if (!editingPageId) return;
    const input = pageNameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editingPageId]);

  useEffect(() => () => {
    Object.values(pageDocumentSaveTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    pageDocumentSaveTimersRef.current = {};
    if (workspacePreferencesSaveTimerRef.current) window.clearTimeout(workspacePreferencesSaveTimerRef.current);
    workspacePreferencesSaveTimerRef.current = null;
  }, []);

  const schedulePageDocumentSave = (page: Page, blocks: Block[], operation: OperationLogEntry | null, delay = 0) => {
    if (!isTauri() || !persistenceReadyRef.current) return;
    if (temporaryMarkdownPagesRef.current.some((item) => item.id === page.id)) return;
    const existingTimer = pageDocumentSaveTimersRef.current[page.id];
    if (existingTimer) window.clearTimeout(existingTimer);
    const pageSnapshot = { ...page };
    const blockSnapshot = blocksForPage(pageSnapshot, blocks);

    pageDocumentSaveTimersRef.current[page.id] = window.setTimeout(() => {
      delete pageDocumentSaveTimersRef.current[page.id];
      void persistPageDocument({ page: pageSnapshot, blocks: blockSnapshot, operation }).catch((error) => {
        console.warn('Could not persist page document.', error);
      });
    }, delay);
  };

  const persistPageDocumentSnapshot = (page: Page, blocks: Block[], operation: OperationLogEntry | null) => {
    if (!isTauri() || !persistenceReadyRef.current) return;
    if (temporaryMarkdownPagesRef.current.some((item) => item.id === page.id)) return;
    const existingTimer = pageDocumentSaveTimersRef.current[page.id];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      delete pageDocumentSaveTimersRef.current[page.id];
    }
    void persistPageDocument({ page, blocks: blocksForPage(page, blocks), operation }).catch((error) => {
      console.warn('Could not persist page document.', error);
    });
  };

  const flushPageDocumentSave = async (page: Page, blocks: Block[]) => {
    if (!isTauri() || !persistenceReadyRef.current) return;
    if (temporaryMarkdownPagesRef.current.some((item) => item.id === page.id)) return;
    const existingTimer = pageDocumentSaveTimersRef.current[page.id];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      delete pageDocumentSaveTimersRef.current[page.id];
    }
    await persistPageDocument({ page, blocks: blocksForPage(page, blocks), operation: null });
  };

  const persistPageMetadataUpdate = (page: Page) => {
    if (!isTauri() || !persistenceReadyRef.current) return;
    if (temporaryMarkdownPagesRef.current.some((item) => item.id === page.id)) return;
    void persistPageMetadata({ pageId: page.id, metadata: page.metadata, operation: null })
      .then((tree) => {
        if (tree) setState((current) => mergeNotebookTree(current, tree));
      })
      .catch((error) => {
        console.warn('Could not persist page metadata.', error);
      });
  };

  const persistNotebookMetadataUpdate = (notebook: Notebook) => {
    if (!isTauri() || !persistenceReadyRef.current) return;
    void persistNotebookMetadata({ notebookId: notebook.id, metadata: notebook.metadata, operation: null })
      .then((tree) => {
        if (tree) setState((current) => mergeNotebookTree(current, tree));
      })
      .catch((error) => {
        console.warn('Could not persist notebook metadata.', error);
      });
  };

  const cancelPageDocumentSaves = (pageIds: Iterable<string>) => {
    Array.from(pageIds).forEach((pageId) => {
      const existingTimer = pageDocumentSaveTimersRef.current[pageId];
      if (!existingTimer) return;
      window.clearTimeout(existingTimer);
      delete pageDocumentSaveTimersRef.current[pageId];
    });
  };

  const setComposerDraftForPage = (pageId: string, html: string, plainText = '') => {
    setDraftsByPageId((current) => {
      const next = { ...current };
      if (isEditorContentEmpty(html, plainText)) {
        delete next[pageId];
      } else {
        next[pageId] = html;
      }
      return next;
    });
  };

  const saveCurrentComposerDraft = () => {
    const pageId = stateRef.current.activePageId;
    const editor = composerEditorRef.current;
    if (!pageId || !editor) return;
    setComposerDraftForPage(pageId, editor.getHTML(), editor.getText());
  };

  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) return;
    (async () => {
      if (cardModeBlockId) {
        const fallbackState = createInitialState();
        try {
          const preferences = await loadWorkspacePreferences();
          if (cancelled) return;
          setState({
            ...fallbackState,
            shell: preferences?.shell ?? fallbackState.shell,
            theme: preferences?.theme ?? fallbackState.theme,
            contentTheme: preferences?.contentTheme ?? fallbackState.contentTheme,
            showPageMetadata: preferences?.showPageMetadata ?? fallbackState.showPageMetadata
          });
        } catch (error) {
          console.warn('Could not load pinned card preferences from SQLite.', error);
          if (!cancelled) setState(fallbackState);
        } finally {
          if (!cancelled) persistenceReadyRef.current = true;
        }
        return;
      }

      const fallbackState = loadState();
      if (cancelled) return;
      let bootstrap = null;
      let preferences = null;
      let pinned: PinnedBlockPayload[] = [];
      try {
        [bootstrap, preferences, pinned] = await Promise.all([
          loadDatabaseBootstrap(),
          loadWorkspacePreferences(),
          listPinnedBlocks()
        ]);
      } catch (error) {
        console.warn('Could not load desktop workspace from SQLite.', error);
        if (!cancelled) {
          setState(fallbackState);
          persistenceReadyRef.current = true;
        }
        return;
      }
      if (cancelled) return;
      setPinnedBlockPayloads(pinned);
      if (!bootstrap) {
        setState(fallbackState);
        persistenceReadyRef.current = true;
        return;
      }

      const initialState: AppState = {
        ...fallbackState,
        notebooks: bootstrap.notebooks.length ? bootstrap.notebooks : fallbackState.notebooks,
        pages: bootstrap.pages.length ? bootstrap.pages : fallbackState.pages,
        activeNotebookId: preferences?.activeNotebookId || bootstrap.activeNotebookId || fallbackState.activeNotebookId,
        activePageId: preferences?.activePageId || bootstrap.activePageId || fallbackState.activePageId,
        shell: preferences?.shell ?? fallbackState.shell,
        theme: preferences?.theme ?? fallbackState.theme,
        contentTheme: preferences?.contentTheme ?? fallbackState.contentTheme,
        openCardWindowBlockId: preferences?.openCardWindowBlockId ?? fallbackState.openCardWindowBlockId,
        expandedPageIds: [...new Set([...(preferences?.expandedPageIds ?? fallbackState.expandedPageIds), preferences?.activePageId ?? bootstrap.activePageId].filter(Boolean))],
        showPageMetadata: preferences?.showPageMetadata ?? fallbackState.showPageMetadata
      };
      let activeDocument: PageDocumentPayload | null = null;
      try {
        activeDocument = initialState.activePageId ? await loadPageDocument(initialState.activePageId) : null;
      } catch (error) {
        console.warn('Could not load active page document from SQLite.', error);
      }
      if (cancelled) return;
      setState(activeDocument ? mergePageDocument(initialState, activeDocument, isTauri()) : initialState);
      persistenceReadyRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nativeTheme = state.shell === 'native-ledger' ? 'ledger' : 'garden';
    document.documentElement.dataset.theme = nativeTheme;
    document.documentElement.dataset.shell = state.shell;
    document.documentElement.dataset.contentTheme = state.contentTheme;
    document.body.dataset.theme = nativeTheme;
    document.body.dataset.shell = state.shell;
    document.body.dataset.contentTheme = state.contentTheme;

    if (cardModeBlockId) {
      document.body.style.background = '';
      document.documentElement.style.background = '';
      return;
    }

    if (state.contentTheme.startsWith('typora-')) {
      const themeRoot = document.querySelector<HTMLElement>(`.typora-theme[data-content-theme="${state.contentTheme}"]`);
      const resolvedBackground = themeRoot
        ? getComputedStyle(themeRoot).getPropertyValue('--typora-shell-bg').trim() || getComputedStyle(themeRoot).getPropertyValue('--theme-body-background').trim()
        : '';
      if (resolvedBackground) {
        document.body.style.background = resolvedBackground;
        document.documentElement.style.background = resolvedBackground;
      }
    } else {
      document.body.style.background = '';
      document.documentElement.style.background = '';
    }
  }, [state.shell, state.contentTheme]);

  useEffect(() => {
    if (!isTauri() || cardModeBlockId || !persistenceReadyRef.current) return;
    const serialized = JSON.stringify(workspacePreferences);
    if (serialized === lastSavedWorkspacePreferencesRef.current) return;
    if (workspacePreferencesSaveTimerRef.current) window.clearTimeout(workspacePreferencesSaveTimerRef.current);
    workspacePreferencesSaveTimerRef.current = window.setTimeout(() => {
      workspacePreferencesSaveTimerRef.current = null;
      lastSavedWorkspacePreferencesRef.current = serialized;
      void saveWorkspacePreferences(workspacePreferences).catch((error) => {
        if (lastSavedWorkspacePreferencesRef.current === serialized) lastSavedWorkspacePreferencesRef.current = '';
        console.warn('Could not persist workspace preferences.', error);
      });
    }, 200);
  }, [workspacePreferences]);

  useEffect(() => {
    if (isTauri() || !persistenceReadyRef.current) return;
    if (disableBrowserPersistence) return;
    void saveState(state);
  }, [state]);

  useEffect(() => {
    if (!persistenceReadyRef.current || cardModeBlockId) return;
    state.notebooks.forEach((notebook) => {
      if (metadataSchemaSeededNotebookIdsRef.current.has(notebook.id)) return;
      const pages = state.pages.filter((page) => page.notebookId === notebook.id);
      const nextFields = inferNotebookMetadataFieldsForPages(pages, notebook.metadata.metadataFields);
      if (!Object.keys(nextFields).length) {
        metadataSchemaSeededNotebookIdsRef.current.add(notebook.id);
        return;
      }
      if (JSON.stringify(nextFields) === JSON.stringify(notebook.metadata.metadataFields ?? {})) {
        metadataSchemaSeededNotebookIdsRef.current.add(notebook.id);
        return;
      }
      metadataSchemaSeededNotebookIdsRef.current.add(notebook.id);
      const updatedNotebook = {
        ...notebook,
        metadata: {
          ...notebook.metadata,
          metadataFields: nextFields
        }
      };
      setState((current) => ({
        ...current,
        notebooks: current.notebooks.map((candidate) => candidate.id === notebook.id ? updatedNotebook : candidate)
      }));
      if (isTauri()) persistNotebookMetadataUpdate(updatedNotebook);
    });
  }, [state.notebooks, state.pages]);

  const activeNotebook = state.notebooks.find((notebook) => notebook.id === state.activeNotebookId) ?? state.notebooks[0];
  const activePage = state.pages.find((page) => page.id === state.activePageId) ?? state.pages[0];
  const activeDraft = draftsByPageId[activePage.id] ?? '';
  const activePageBlocks = useMemo(
    () => activePage.blockIds.map((blockId) => state.blocks.find((block) => block.id === blockId)).filter(Boolean) as Block[],
    [activePage.blockIds, state.blocks]
  );
  const pageBlockOrder = activePage.blockOrder === 'desc' ? 'desc' : 'asc';
  useEffect(() => {
    activePageBlocksRef.current = activePageBlocks;
  }, [activePageBlocks]);

  const orderedPageBlocks = useMemo(
    () => pageBlockOrder === 'desc' ? [...activePageBlocks].reverse() : activePageBlocks,
    [pageBlockOrder, activePageBlocks]
  );
  const pageFindMatches = useMemo<PageFindMatch[]>(() => {
    const needle = pageFindQuery.trim().toLowerCase();
    if (!needle) return [];
    return orderedPageBlocks.flatMap((block) => {
      const text = block.content.plainText.replace(/\s+/g, ' ').trim();
      const lowerText = text.toLowerCase();
      const matches: PageFindMatch[] = [];
      let index = lowerText.indexOf(needle);
      while (index >= 0) {
        const previewStart = Math.max(0, index - 48);
        const previewEnd = Math.min(text.length, index + needle.length + 72);
        matches.push({
          blockId: block.id,
          occurrenceIndex: matches.length,
          preview: `${previewStart > 0 ? '...' : ''}${text.slice(previewStart, previewEnd)}${previewEnd < text.length ? '...' : ''}`
        });
        index = lowerText.indexOf(needle, index + needle.length);
      }
      return matches;
    });
  }, [orderedPageBlocks, pageFindQuery]);

  const movePageFind = (direction: 1 | -1) => {
    setPageFindIndex((current) => {
      const total = pageFindMatches.length;
      if (!total) return 0;
      return (current + direction + total) % total;
    });
  };

  useEffect(() => {
    if (!pageFindOpen) return;
    window.setTimeout(() => {
      pageFindInputRef.current?.focus();
      pageFindInputRef.current?.select();
    }, 0);
  }, [pageFindOpen]);

  useEffect(() => {
    if (!pageFindOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && pageFindPopoverRef.current?.contains(target)) return;
      setPageFindOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, [pageFindOpen]);

  useEffect(() => {
    setPageFindIndex(0);
  }, [pageFindQuery, activePage.id]);

  useEffect(() => {
    setPageFindIndex((current) => Math.min(current, Math.max(pageFindMatches.length - 1, 0)));
  }, [pageFindMatches.length]);

  useEffect(() => {
    document.querySelectorAll('.is-page-find-match').forEach((element) => element.classList.remove('is-page-find-match'));
    clearPageFindTextHighlight();
    if (!pageFindOpen || !pageFindMatches.length) return;
    const match = pageFindMatches[pageFindIndex];
    const blockElement = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(match.blockId)}"]`);
    if (!blockElement) return;
    blockElement.classList.add('is-page-find-match');
    const matchRange = findTextRangeInElement(blockElement, pageFindQuery, match.occurrenceIndex) ?? null;
    highlightTextRange(matchRange);
    scrollWorkspaceTargetIntoView(matchRange ?? blockElement, 'center');
    return () => {
      blockElement.classList.remove('is-page-find-match');
      clearPageFindTextHighlight();
    };
  }, [pageFindOpen, pageFindMatches, pageFindIndex, pageFindQuery]);

  useEffect(() => {
    let cancelled = false;
    if (!isTauri() || cardModeBlockId || !activePage?.id || !persistenceReadyRef.current) return;
    if (temporaryMarkdownPagesRef.current.some((item) => item.id === activePage.id)) return;
    const requestId = activePageDocumentRequestRef.current + 1;
    activePageDocumentRequestRef.current = requestId;
    loadPageDocument(activePage.id).then((document) => {
      if (cancelled || activePageDocumentRequestRef.current !== requestId || !document) return;
      if (document.content.blocks.some((block) => /\bsrc=["'](?:blob:|data:)/i.test(block.content.html))) {
        void persistPageDocument({ page: document.page, blocks: document.content.blocks, operation: null }).catch((error) => {
          console.warn('Could not localize loaded page media.', error);
        });
      }
      setState((current) => current.activePageId === document.page.id ? mergePageDocument(current, document, isTauri()) : current);
    }).catch((error) => {
      console.warn('Could not load active page document.', error);
    });
    return () => {
      cancelled = true;
    };
  }, [activePage?.id]);

  const outlineEntries = useMemo(() => extractOutlineEntries(activePage, orderedPageBlocks), [activePage, orderedPageBlocks]);
  const pageMoveTargets = useMemo(() => {
    if (!pageContextMenu) return [];
    const needle = pageMoveQuery.trim().toLowerCase();
    const notebookById = new Map(state.notebooks.map((notebook) => [notebook.id, notebook]));
    const excludedPageIds = new Set([
      pageContextMenu.pageId,
      ...descendantsOfPage(pageContextMenu.pageId, state.pages).map((page) => page.id)
    ]);
    const buildPagePath = (page: Page) => {
      const ancestors = ancestorsOfPage(page.id, state.pages);
      const pieces = [
        notebookById.get(page.notebookId)?.name ?? 'Notebook',
        ...ancestors.map((ancestor) => ancestor.title),
        page.title
      ];
      return pieces.join(' / ');
    };
    const matches = state.pages
      .map((page) => {
        if (excludedPageIds.has(page.id)) return null;
        const notebook = notebookById.get(page.notebookId);
        if (!notebook) return null;
        const ancestors = ancestorsOfPage(page.id, state.pages);
        const path = buildPagePath(page);
        const haystack = [page.title, notebook.name, ...ancestors.map((ancestor) => ancestor.title), path].join(' ').toLowerCase();
        if (needle && !haystack.includes(needle)) return null;
        return {
          notebookId: page.notebookId,
          parentId: page.id,
          label: path,
          depth: ancestors.length
        };
      })
      .filter((value): value is { notebookId: string; parentId: string; label: string; depth: number } => Boolean(value));
    return matches.sort((left, right) => {
      if (left.depth !== right.depth) return left.depth - right.depth;
      const leftNotebook = notebookById.get(left.notebookId)?.name ?? '';
      const rightNotebook = notebookById.get(right.notebookId)?.name ?? '';
      if (leftNotebook !== rightNotebook) return leftNotebook.localeCompare(rightNotebook);
      return left.label.localeCompare(right.label);
    }).slice(0, 12);
  }, [pageContextMenu, pageMoveQuery, state.notebooks, state.pages]);
  useEffect(() => {
    setPageMoveIndex(0);
  }, [pageMoveQuery, pageContextMenu?.pageId]);
  const calendarMonthKey = monthKey(calendarMonth);
  const notebookPages = useMemo(
    () => state.pages.filter((page) => page.notebookId === activeNotebook.id),
    [activeNotebook.id, state.pages]
  );
  const activeNotebookCalendarConfig = activeNotebook.metadata.calendarView?.enabled
    ? activeNotebook.metadata.calendarView
    : null;
  const pageCalendarEntries = useMemo(
    () => activeNotebookCalendarConfig ? buildPageCalendarEntries(notebookPages, activeNotebookCalendarConfig, activeNotebook) : [],
    [activeNotebook, activeNotebookCalendarConfig, notebookPages]
  );
  const pageCalendarDateOptions = useMemo(() => {
    const options = calendarDateCandidatesForPages(notebookPages);
    if (!options.some((option) => option.key === 'createdAt')) {
      options.unshift({ key: 'createdAt', label: 'Created at', count: notebookPages.length });
    }
    if (activeNotebookCalendarConfig?.dateSource && !options.some((option) => option.key === activeNotebookCalendarConfig.dateSource)) {
      options.push({
        key: activeNotebookCalendarConfig.dateSource,
        label: activeNotebookCalendarConfig.dateSource,
        count: 0
      });
    }
    activeNotebookCalendarConfig?.dateSources?.forEach((source) => {
      if (!options.some((option) => option.key === source)) {
        options.push({ key: source, label: source, count: 0 });
      }
    });
    return options;
  }, [activeNotebookCalendarConfig?.dateSource, activeNotebookCalendarConfig?.dateSources, notebookPages]);
  const pageCalendarFieldOptions = useMemo(() => {
    const inferred = visibleCalendarFieldsForPages(notebookPages, 16);
    const configured = activeNotebookCalendarConfig?.visibleFields ?? [];
    return [...inferred, ...configured].filter((field, index, list) => list.indexOf(field) === index);
  }, [activeNotebookCalendarConfig?.visibleFields, notebookPages]);
  const calendarEntriesByDate = useMemo(() => {
    if (workspaceView !== 'calendar') return new Map<string, CalendarEntry[]>();
    if (activeNotebookCalendarConfig) return new Map<string, CalendarEntry[]>();
    return isTauri()
      ? calendarEntriesFromPayloads(calendarBlockPayloads)
      : legacyCalendarEntriesFromState(state, activeNotebook.id);
  }, [activeNotebook.id, activeNotebookCalendarConfig, calendarBlockPayloads, state.blocks, state.pages, workspaceView]);
  const calendarDays = useMemo(() => calendarDaysForMonth(calendarMonth), [calendarMonth]);
  const pinnedBlocks = useMemo(
    () => isTauri() ? pinnedBlockPayloads.map(({ block }) => block) : legacyPinnedBlocksFromState(state),
    [pinnedBlockPayloads, state.blocks]
  );
  const openCardBlock = isTauri() ? null : legacyOpenCardBlockFromState(state);
  const cardModeBlock = cardDocument?.content.blocks.find((block) => block.id === cardModeBlockId)
    ?? (isTauri() ? null : legacyCardModeBlockFromState(state, cardModeBlockId))
    ?? null;
  const visibleBlocks = query.trim()
    ? orderedPageBlocks.filter((block) => block.content.plainText.toLowerCase().includes(query.trim().toLowerCase()))
    : orderedPageBlocks;
  const showBlockDividers = state.shell.startsWith('typora-');
  const metadataFields = useMemo<PageMetadataField[]>(() => {
    if (!state.showPageMetadata) return [];
    const fields: PageMetadataField[] = [];
    const addField = (field: Omit<PageMetadataField, 'type'>) => {
      if (shouldHideMetadataField(field.key)) return;
      fields.push({
        ...field,
        type: metadataFieldTypeFor(activeNotebook, field.key, field.value, field.valueKind)
      });
    };
    if (activePage.metadata.date) addField({ key: 'date', value: activePage.metadata.date, source: 'date', valueKind: 'text' });
    if (activePage.metadata.status) addField({ key: 'status', value: activePage.metadata.status, source: 'status', valueKind: 'text' });
    if (activePage.metadata.tags.length) addField({ key: 'tags', value: activePage.metadata.tags.join(', '), source: 'tags', valueKind: 'list' });
    if (activePage.metadata.aliases.length) addField({ key: 'aliases', value: activePage.metadata.aliases.join(', '), source: 'aliases', valueKind: 'list' });
    Object.entries(activePage.metadata.frontmatter ?? {}).forEach(([key, value]) => {
      if (['date', 'status', 'tags', 'aliases', 'alias', 'title'].includes(key.toLowerCase())) return;
      const text = Array.isArray(value) ? value.join(', ') : value;
      addField({ key, value: text, source: 'frontmatter', valueKind: Array.isArray(value) ? 'list' : 'text' });
    });
    return fields;
  }, [activeNotebook, activePage.metadata, state.showPageMetadata]);
  const metadataFieldOptions = useMemo(() => {
    const pages = state.pages.filter((page) => page.notebookId === activeNotebook.id);
    return Object.fromEntries(metadataFields
      .filter((field) => field.type === 'select' || field.type === 'multiSelect')
      .map((field) => [field.key, metadataSelectOptionsForPages(pages, field.key)]));
  }, [activeNotebook.id, metadataFields, state.pages]);

  useEffect(() => {
    let cancelled = false;
    if (!isTauri() || workspaceView !== 'calendar' || activeNotebookCalendarConfig || !activeNotebook?.id) {
      if (!isTauri()) setCalendarBlockPayloads([]);
      return;
    }
    listCalendarBlocks(activeNotebook.id, calendarMonthKey).then((entries) => {
      if (!cancelled) setCalendarBlockPayloads(entries);
    }).catch((error) => {
      console.warn('Could not load calendar blocks.', error);
      if (!cancelled) setCalendarBlockPayloads([]);
    });
    return () => {
      cancelled = true;
    };
  }, [activeNotebook?.id, activeNotebookCalendarConfig, calendarMonthKey, workspaceView]);

  useEffect(() => {
    if (!activePage?.id) return;
    if (selectedPageId !== activePage.id) setSelectedPageId(activePage.id);
  }, [activePage?.id, selectedPageId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!isTauri() || !trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      searchPages(trimmed, 30)
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch((error) => {
          console.warn('Could not search notebook pages.', error);
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const refreshTrashItems = async () => {
    if (!isTauri()) return;
    try {
      setTrashItems(await listTrashItems(50));
    } catch (error) {
      console.warn('Could not load trash items.', error);
      setTrashItems([]);
    }
  };

  useEffect(() => {
    refreshTrashItems();
  }, []);

  const setShell = (shell: ShellId) => {
    setState((current) => applyShellToViewState(current, shell));
  };

  const setContentTheme = (contentTheme: ContentThemeId) => {
    setState((current) => applyContentThemeToViewState(current, contentTheme));
  };

  useEffect(() => {
    if (!cardModeBlockId || !isTauri()) return;
    const cardWindow = getCurrentWindow();
    void Promise.allSettled([
      cardWindow.setAlwaysOnTop(true),
      cardWindow.setVisibleOnAllWorkspaces(true),
      cardWindow.setSkipTaskbar(true),
      cardWindow.setDecorations(false),
      cardWindow.setShadow(false),
      cardWindow.setFocus()
    ]);
  }, [cardModeBlockId]);

  useEffect(() => {
    let cancelled = false;
    if (!cardModeBlockId || !isTauri()) return;
    const requestId = cardDocumentRequestRef.current + 1;
    cardDocumentRequestRef.current = requestId;
    loadBlockDocument(cardModeBlockId).then((document) => {
      if (cancelled || cardDocumentRequestRef.current !== requestId || !document) return;
      setCardDocument(document);
    }).catch((error) => {
      console.warn('Could not load pinned card block document.', error);
    });
    return () => {
      cancelled = true;
    };
  }, [cardModeBlockId]);

  const configurePinnedCardWindow = async (cardWindow: WebviewWindow) => {
    await Promise.allSettled([
      cardWindow.setAlwaysOnTop(true),
      cardWindow.setVisibleOnAllWorkspaces(true),
      cardWindow.setSkipTaskbar(true),
      cardWindow.setDecorations(false),
      cardWindow.setShadow(false),
      cardWindow.setFocus()
    ]);
  };

  const childPages = useMemo(() => {
    const map = new Map<string | null, Page[]>();
    notebookPages.forEach((page) => {
      const key = page.parentId ?? null;
      map.set(key, [...(map.get(key) ?? []), page]);
    });
    return map;
  }, [notebookPages]);
  type PageThumbnailPreview = {
    excerpt: string;
    imageSrcs: string[];
    updatedAt: string;
  };
  const [pageThumbnailLimitState, setPageThumbnailLimitState] = useState({
    notebookId: activeNotebook.id,
    limit: initialPageThumbnailLimit
  });
  const pageThumbnailLimit = pageThumbnailLimitState.notebookId === activeNotebook.id
    ? pageThumbnailLimitState.limit
    : initialPageThumbnailLimit;
  const [pageThumbnailCache, setPageThumbnailCache] = useState<Record<string, PageThumbnailPreview>>({});
  const pageThumbnailCacheRef = useRef(pageThumbnailCache);
  useEffect(() => {
    pageThumbnailCacheRef.current = pageThumbnailCache;
  }, [pageThumbnailCache]);
  const visibleNotebookPages = useMemo(
    () => notebookPages.slice(0, pageThumbnailLimit),
    [notebookPages, pageThumbnailLimit]
  );
  const hasMorePageThumbnails = visibleNotebookPages.length < notebookPages.length;
  const loadMorePageThumbnails = useCallback(() => {
    setPageThumbnailLimitState((current) => {
      const currentLimit = current.notebookId === activeNotebook.id ? current.limit : initialPageThumbnailLimit;
      const nextLimit = Math.min(currentLimit + pageThumbnailLimitStep, notebookPages.length);
      return { notebookId: activeNotebook.id, limit: nextLimit };
    });
  }, [activeNotebook.id, notebookPages.length]);
  useEffect(() => {
    if (typoraSidebarView !== 'thumbnails' || !isTauri() || !visibleNotebookPages.length) return;
    let cancelled = false;
    const pagesNeedingPreview = visibleNotebookPages.filter((page) => {
      const cached = pageThumbnailCacheRef.current[page.id];
      return !cached || cached.updatedAt !== page.updatedAt;
    });
    if (!pagesNeedingPreview.length) return;
    const loadThumbnailBatch = async () => {
      for (let index = 0; index < pagesNeedingPreview.length && !cancelled; index += 4) {
        const batchPages = pagesNeedingPreview.slice(index, index + 4);
        try {
          const documents = await mapWithConcurrency(batchPages, 1, async (page) => loadPageDocument(page.id));
          if (cancelled) return;
          setPageThumbnailCache((current) => {
            const next = { ...current };
            documents.forEach((document) => {
              if (!document) return;
              const blocks = document.content.blocks;
              const excerpt = blocks
                .map((block) => block.content.plainText.trim())
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 220);
              const imageSrcs = blocks
                .flatMap((block) => Array.from(block.content.html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi), (match) => match[1]?.trim() ?? ''))
                .filter((src, index, sources) => {
                  if (!src || sources.indexOf(src) !== index) return false;
                  if (/^https?:\/\/www\.notion\.so\/images\/page-cover\//i.test(src)) return false;
                  if (/\/(notion|images)\/page-cover\//i.test(src)) return false;
                  return true;
                })
                .slice(0, 4);
              next[document.page.id] = { excerpt, imageSrcs, updatedAt: document.page.updatedAt };
            });
            return next;
          });
          await new Promise((resolve) => window.setTimeout(resolve, 48));
        } catch (error) {
          console.warn('Could not load page thumbnails.', error);
        }
      }
    };
    void loadThumbnailBatch();
    return () => {
      cancelled = true;
    };
  }, [typoraSidebarView, visibleNotebookPages]);

  const pageThumbnails = useMemo<PageThumbnailItem[]>(() => {
    return visibleNotebookPages.map((page) => {
      const preview = pageThumbnailCache[page.id];
      const isPreviewFresh = preview?.updatedAt === page.updatedAt;
      return {
        pageId: page.id,
        title: page.title || 'Untitled',
        emoji: page.metadata.emoji,
        excerpt: isPreviewFresh ? preview.excerpt : '',
        imageSrcs: isPreviewFresh ? preview.imageSrcs : [],
        updatedAt: pageTimestampLabel(page.updatedAt),
        active: page.id === activePage.id
      };
    });
  }, [activePage.id, visibleNotebookPages, pageThumbnailCache]);

  const getActiveTiptapEditor = () => {
    if (activeEditor.kind === 'composer') return composerEditorRef.current;
    return blockEditorRefs.current[activeEditor.blockId] ?? null;
  };

  const syncTableControls = (editor: Editor | null) => {
    if (!editor?.isActive('table')) {
      setTableControls((current) => current.visible ? { visible: false, top: 0, left: 0 } : current);
      return;
    }
    const { from } = editor.state.selection;
    const domAtPos = editor.view.domAtPos(from).node;
    const element = domAtPos instanceof HTMLElement ? domAtPos : domAtPos.parentElement;
    const table = element?.closest('table');
    const editorRoot = editor.view.dom instanceof HTMLElement ? editor.view.dom : null;
    if (!table || !editorRoot) {
      setTableControls({ visible: true, top: 0, left: 0 });
      return;
    }
    const tableRect = table.getBoundingClientRect();
    const editorRect = editorRoot.getBoundingClientRect();
    setTableControls({
      visible: true,
      top: Math.max(0, tableRect.bottom - editorRect.top + 6),
      left: Math.max(0, tableRect.left - editorRect.left)
    });
  };

  const syncFloatingControls = (editor: Editor | null) => {
    syncTableControls(editor);
  };

  const openMathEditor = (editor: Editor, requestedPos: number) => {
    const pos = findBlockMathPositionNear(editor, requestedPos);
    if (pos === null) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'blockMath') return;
    const dom = editor.view.nodeDOM(pos);
    const element = dom instanceof HTMLElement ? dom : null;
    const editorRoot = editor.view.dom instanceof HTMLElement ? editor.view.dom : null;
    if (!element || !editorRoot) return;
    const mathRect = element.getBoundingClientRect();
    const editorRect = editorRoot.getBoundingClientRect();
    setMathEditor({
      editor,
      pos,
      latex: displayMathLatex(node.attrs.latex ?? ''),
      top: Math.max(0, mathRect.top - editorRect.top + 8),
      left: Math.max(0, mathRect.left - editorRect.left + 8),
      width: Math.max(220, Math.min(mathRect.width - 16, 520))
    });
  };

  const updateMathEditorLatex = (latex: string) => {
    setMathEditor((current) => {
      if (!current) return current;
      current.editor.commands.updateBlockMath({ pos: current.pos, latex: latex.trim() ? latex : '\\;' });
      return { ...current, latex };
    });
  };

  const commitMediaWidth = (editor: Editor, pos: number, width: number) => {
    const node = editor.state.doc.nodeAt(pos);
    if (!node || !isResizableMediaNode(node.type.name)) return;
    const nextWidth = `${Math.max(20, Math.min(100, Math.round(width)))}%`;
    const transaction = editor.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      width: nextWidth
    });
    editor.view.dispatch(transaction);
    editor.view.focus();
  };

  const startMediaResize = (request: MediaResizeRequest) => {
    const { editor, pos, startClientX, startWidth, containerWidth, element } = request;
    const safeContainerWidth = Math.max(1, containerWidth);
    const startPercent = Math.max(20, Math.min(100, (startWidth / safeContainerWidth) * 100));
    let latestPercent = startPercent;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'nwse-resize';
    element.classList.add('is-media-resizing');

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaPercent = ((moveEvent.clientX - startClientX) / safeContainerWidth) * 100;
      latestPercent = Math.max(20, Math.min(100, startPercent + deltaPercent));
      element.style.width = `${latestPercent}%`;
      element.setAttribute('data-width', `${Math.round(latestPercent)}%`);
    };

    const stopDragging = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      element.classList.remove('is-media-resizing');
      commitMediaWidth(editor, pos, latestPercent);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging, { once: true });
    window.addEventListener('pointercancel', stopDragging, { once: true });
  };

  const syncAnnotatedEditorContent = (editor: Editor) => {
    const html = editor.getHTML();
    const plainText = editor.getText();
    if (cardModeBlockId && cardModeBlock && editor === blockEditorRefs.current[cardModeBlock.id]) {
      updateCardBlock(cardModeBlock.id, html, plainText);
      return;
    }
    if (editor === composerEditorRef.current) {
      setComposerDraftForPage(stateRef.current.activePageId, html, plainText);
      return;
    }
    const blockEntry = Object.entries(blockEditorRefs.current).find(([, candidate]) => candidate === editor);
    if (blockEntry) {
      updateBlock(blockEntry[0], html, plainText);
      return;
    }
    if (activeEditor.kind === 'block') updateBlock(activeEditor.blockId, html, plainText);
  };

  const setPageEmoji = (pageId: string, emoji: string | null) => {
    const nextPage = stateRef.current.pages.find((page) => page.id === pageId);
    if (!nextPage) return;
    const metadata = { ...nextPage.metadata };
    if (emoji) metadata.emoji = emoji;
    else delete metadata.emoji;
    const updatedPage = { ...nextPage, metadata };
    setState((current) => applyPageEmojiToViewState(current, pageId, emoji));
    if (isTauri()) persistPageMetadataUpdate(updatedPage);
  };

  const updatePageMetadata = (pageId: string, updater: (metadata: Page['metadata']) => Page['metadata']) => {
    const nextPage = stateRef.current.pages.find((page) => page.id === pageId);
    if (!nextPage) return;
    const metadata = updater({
      ...nextPage.metadata,
      tags: [...nextPage.metadata.tags],
      aliases: [...nextPage.metadata.aliases],
      frontmatter: { ...nextPage.metadata.frontmatter }
    });
    metadata.frontmatterRaw = stringifyFrontmatter(metadata.frontmatter);
    const updatedPage = { ...nextPage, metadata };
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id === pageId ? updatedPage : page)
    }));
    if (isTauri()) persistPageMetadataUpdate(updatedPage);
  };

  const updateActivePageMetadataField = (field: PageMetadataField, value: string) => {
    updatePageMetadata(activePage.id, (metadata) => {
      const next = { ...metadata, frontmatter: { ...metadata.frontmatter } };
      const normalizedList = value.split(',').map((item) => item.trim()).filter(Boolean);
      if (field.source === 'date') {
        if (value.trim()) next.date = value.trim();
        else delete next.date;
      } else if (field.source === 'status') {
        if (value.trim()) next.status = value.trim();
        else delete next.status;
      } else if (field.source === 'tags') {
        next.tags = normalizedList;
      } else if (field.source === 'aliases') {
        next.aliases = normalizedList;
      } else if (value.trim()) {
        next.frontmatter[field.key] = field.valueKind === 'list' ? normalizedList : value.trim();
      } else {
        delete next.frontmatter[field.key];
      }
      return next;
    });
  };

  const setNotebookMetadataFieldType = (notebookId: string, key: string, type: MetadataFieldType) => {
    const nextNotebook = stateRef.current.notebooks.find((notebook) => notebook.id === notebookId);
    if (!nextNotebook) return;
    const metadata = {
      ...nextNotebook.metadata,
      metadataFields: {
        ...(nextNotebook.metadata.metadataFields ?? {}),
        [key]: { type }
      }
    };
    const updatedNotebook = { ...nextNotebook, metadata };
    setState((current) => ({
      ...current,
      notebooks: current.notebooks.map((notebook) => notebook.id === notebookId ? updatedNotebook : notebook)
    }));
    if (isTauri()) persistNotebookMetadataUpdate(updatedNotebook);
  };

  const updateActivePageMetadataFieldType = (field: PageMetadataField, type: MetadataFieldType) => {
    setNotebookMetadataFieldType(activeNotebook.id, field.key, type);
  };

  const addActivePageMetadataField = () => {
    const key = window.prompt('Metadata field name');
    if (!key?.trim()) return;
    const fieldKey = key.trim();
    if (metadataFields.some((field) => field.key.toLowerCase() === fieldKey.toLowerCase())) return;
    const typeInput = window.prompt('Field type: text, long text, date, date range, select, multi-select', 'text')?.trim().toLowerCase() ?? 'text';
    const typeMap: Record<string, MetadataFieldType> = {
      text: 'text',
      文本: 'text',
      'long text': 'longText',
      longtext: 'longText',
      长文本: 'longText',
      总结: 'longText',
      date: 'date',
      日期: 'date',
      'date range': 'dateRange',
      daterange: 'dateRange',
      range: 'dateRange',
      日期范围: 'dateRange',
      时间范围: 'dateRange',
      select: 'select',
      choice: 'select',
      选择: 'select',
      单选: 'select',
      'multi-select': 'multiSelect',
      multiselect: 'multiSelect',
      multi: 'multiSelect',
      多选: 'multiSelect'
    };
    const type = typeMap[typeInput] ?? 'text';
    const initialValue = type === 'multiSelect' ? [] : '';
    setNotebookMetadataFieldType(activeNotebook.id, fieldKey, type);
    updatePageMetadata(activePage.id, (metadata) => ({
      ...metadata,
      frontmatter: {
        ...metadata.frontmatter,
        [fieldKey]: initialValue
      }
    }));
  };

  const setNotebookEmoji = (notebookId: string, emoji: string | null) => {
    const nextNotebook = stateRef.current.notebooks.find((notebook) => notebook.id === notebookId);
    if (!nextNotebook) return;
    const metadata = { ...nextNotebook.metadata };
    if (emoji) metadata.emoji = emoji;
    else delete metadata.emoji;
    const updatedNotebook = { ...nextNotebook, metadata };
    setState((current) => applyNotebookEmojiToViewState(current, notebookId, emoji));
    if (isTauri()) persistNotebookMetadataUpdate(updatedNotebook);
  };

  const updateNotebookCalendarView = (notebookId: string, updater: (config: NotebookCalendarViewConfig | undefined, pages: Page[]) => NotebookCalendarViewConfig | undefined) => {
    const nextNotebook = stateRef.current.notebooks.find((notebook) => notebook.id === notebookId);
    if (!nextNotebook) return;
    const pages = stateRef.current.pages.filter((page) => page.notebookId === notebookId);
    const nextCalendarView = updater(nextNotebook.metadata.calendarView, pages);
    const metadata = { ...nextNotebook.metadata };
    if (nextCalendarView) metadata.calendarView = nextCalendarView;
    else delete metadata.calendarView;
    const updatedNotebook = { ...nextNotebook, metadata };
    setState((current) => ({
      ...current,
      notebooks: current.notebooks.map((notebook) => notebook.id === notebookId ? updatedNotebook : notebook)
    }));
    if (isTauri()) persistNotebookMetadataUpdate(updatedNotebook);
  };

  const openEmojiContextMenu = (target: EmojiPickerRequest['target'], x: number, y: number) => {
    const width = 188;
    const height = 100;
    const left = Math.max(12, Math.min(x, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(y, window.innerHeight - height - 12));
    setEmojiContextMenu({ target, x: left, y: top });
  };

  const openPageContextMenu = (pageId: string, anchorRect: DOMRect) => {
    const width = 300;
    const height = 200;
    const left = Math.max(12, Math.min(anchorRect.left + 24, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(anchorRect.bottom + 4, window.innerHeight - height - 12));
    setPageMoveQuery('');
    setPageMoveIndex(0);
    setPageContextMenu({ pageId, x: left, y: top });
  };

  const saveImageAnnotations = (request: ImageAnnotationRequest, annotations: ImageAnnotationDocument) => {
    const node = request.editor.state.doc.nodeAt(request.pos);
    if (!node || node.type.name !== 'image') {
      setImageAnnotationRequest(null);
      return;
    }
    const serialized = serializeImageAnnotations(annotations);
    request.editor.view.dispatch(request.editor.state.tr.setNodeMarkup(request.pos, undefined, {
      ...node.attrs,
      annotations: serialized || null
    }));
    request.editor.view.focus();
    const html = request.editor.getHTML();
    const plainText = request.editor.getText();
    if (request.target?.kind === 'composer') {
      setComposerDraftForPage(request.target.pageId, html, plainText);
    } else if (request.target?.kind === 'card') {
      updateCardBlock(request.target.blockId, html, plainText);
    } else if (request.target?.kind === 'block') {
      updateBlock(request.target.blockId, html, plainText);
    } else {
      syncAnnotatedEditorContent(request.editor);
    }
    setImageAnnotationRequest(null);
  };

  const activateEditor = (target: EditorTarget) => {
    setActiveEditor((current) => {
      if (current.kind !== target.kind) return target;
      if (current.kind === 'composer') return current;
      if (target.kind === 'composer') return target;
      return current.blockId === target.blockId ? current : target;
    });
  };

  const insertLocalMedia = (kind: 'image' | 'video' | 'audio' | 'attachment') => {
    const editor = getActiveTiptapEditor();
    if (!editor) return;
    const selection = {
      from: editor.state.selection.from,
      to: editor.state.selection.to
    };
    const insertAtSavedSelection = (content: string) => {
      const maxPosition = editor.state.doc.content.size;
      const from = Math.min(selection.from, maxPosition);
      const to = Math.min(selection.to, maxPosition);
      const chain = editor.chain().focus().setTextSelection({ from, to });
      chain.insertContent(content).run();
    };
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : 'image/*,video/*,audio/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const { src, assetId } = await importAttachmentFile(file);
        const resolvedKind = kind === 'attachment' ? inferAttachmentKind(file) : kind;
        const assetAttribute = assetId ? ` data-asset-id="${escapeHtml(assetId)}"` : '';
        if (resolvedKind === 'image') {
          insertAtSavedSelection(`<img src="${escapeHtml(src)}" alt="${escapeHtml(file.name)}" title="${escapeHtml(assetId ?? file.name)}"${assetAttribute}>`);
          return;
        }
        if (resolvedKind === 'file') {
          insertAtSavedSelection(`<a href="${src}" download="${escapeHtml(file.name)}">${escapeHtml(file.name)}</a>`);
          return;
        }
        const html = resolvedKind === 'video'
          ? `<video controls src="${escapeHtml(src)}"${assetAttribute}></video>`
          : `<audio controls src="${escapeHtml(src)}"${assetAttribute}></audio>`;
        insertAtSavedSelection(html);
      } catch (error) {
        setImportNotice({
          kind: 'error',
          message: `Attachment import failed for "${file.name}".`,
          details: [error instanceof Error ? error.message : String(error)]
        });
      }
    };
    input.click();
  };

  useEffect(() => {
    const handleAttachmentShortcut = () => insertLocalMedia('attachment');
    window.addEventListener('notebook:attachment-shortcut', handleAttachmentShortcut);
    return () => window.removeEventListener('notebook:attachment-shortcut', handleAttachmentShortcut);
  }, [activeEditor]);

  useEffect(() => {
    const handleMathEdit = (event: Event) => {
      const detail = (event as CustomEvent<{ editor?: Editor; pos?: number }>).detail;
      if (!detail?.editor || typeof detail.pos !== 'number') return;
      openMathEditor(detail.editor, detail.pos);
    };
    window.addEventListener('notebook:edit-block-math', handleMathEdit);
    return () => window.removeEventListener('notebook:edit-block-math', handleMathEdit);
  });

  const insertFootnote = () => {
    const editor = getActiveTiptapEditor();
    if (!editor) return;
    const label = window.prompt('Footnote label', '1')?.trim();
    if (!label) return;
    const content = window.prompt('Footnote text', '')?.trim();
    const id = label.replace(/[^\w-]+/g, '-') || `fn-${Date.now().toString(36)}`;
    editor.chain().focus().insertContent(
      `<sup class="md-footnote" data-footnote-id="${id}"><a href="#fn-${id}" id="fnref-${id}" contenteditable="false">[${escapeHtml(label)}]</a></sup>` +
      `<section class="footnotes" data-type="footnotes"><div class="md-def-footnote" data-type="footnote-item" data-footnote-id="${id}" id="fn-${id}"><p>${escapeHtml(content ?? '')}</p></div></section>`
    ).run();
  };

  const runEditorCommand = (command: ToolbarCommand) => {
    const editor = getActiveTiptapEditor();
    if (!editor) return;
    const chain = editor.chain().focus();
    if (command === 'bold') chain.toggleBold().run();
    if (command === 'italic') chain.toggleItalic().run();
    if (command === 'underline') chain.toggleUnderline().run();
    if (command === 'strike') chain.toggleStrike().run();
    if (command === 'h1') chain.toggleHeading({ level: 1 }).run();
    if (command === 'h2') chain.toggleHeading({ level: 2 }).run();
    if (command === 'h3') chain.toggleHeading({ level: 3 }).run();
    if (command === 'inlineCode') chain.toggleCode().run();
    if (command === 'codeBlock') chain.toggleCodeBlock().run();
    if (command === 'blockquote') chain.toggleBlockquote().run();
    if (command === 'kbd') chain.toggleMark('keyboardKey').run();
    if (command === 'table') {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    }
    if (command === 'tableRowAfter') editor.chain().focus().addRowAfter().run();
    if (command === 'tableColumnAfter') editor.chain().focus().addColumnAfter().run();
    if (command === 'tableDeleteRow') editor.chain().focus().deleteRow().run();
    if (command === 'tableDeleteColumn') editor.chain().focus().deleteColumn().run();
    if (command === 'tableDelete') editor.chain().focus().deleteTable().run();
    if (command === 'inlineMath') {
      const latex = window.prompt('Inline math', 'E = mc^2');
      if (latex?.trim()) editor.chain().focus().insertInlineMath({ latex: latex.trim() }).run();
    }
    if (command === 'blockMath') {
      const latex = window.prompt('Block math', '\\int_0^1 x^2 dx');
      if (latex?.trim()) editor.chain().focus().insertBlockMath({ latex: latex.trim() }).run();
    }
    if (command === 'footnote') insertFootnote();
    if (command === 'attachment') insertLocalMedia('attachment');
    if (command === 'bulletList') chain.toggleBulletList().run();
    if (command === 'orderedList') chain.toggleOrderedList().run();
    if (command === 'indent') {
      editor.commands.focus();
      runListIndentCommand(editor, 'in');
    }
    if (command === 'outdent') {
      editor.commands.focus();
      runListIndentCommand(editor, 'out');
    }
  };

  const insertTodo = () => {
    getActiveTiptapEditor()?.chain().focus().toggleTaskList().run();
  };

  const applyHighlight = () => {
    getActiveTiptapEditor()?.chain().focus().toggleHighlight().run();
  };

  const applyInlineCode = () => {
    getActiveTiptapEditor()?.chain().focus().toggleCode().run();
  };

  const blockIndex = (blockId: string) => activePage.blockIds.indexOf(blockId);

  const applyPageDocumentToView = (page: Page, blocks: Block[], operation: OperationLogEntry | null) => {
    setState((current) => applyPageDocumentToViewState(current, page, blocks, operation, isTauri()));
  };

  const scrollWorkspaceTargetIntoView = (target: Element | Range, block: ScrollLogicalPosition = 'center') => {
    const anchorElement = target instanceof Range
      ? target.commonAncestorContainer.parentElement
      : target;
    const workspace = anchorElement?.closest('.typora-workspace') ?? null;
    if (!(workspace instanceof HTMLElement)) {
      if (target instanceof Range) {
        const selectionMarker = target.getBoundingClientRect();
        if (selectionMarker.height || selectionMarker.width) {
          const nextTop = window.scrollY + selectionMarker.top - (window.innerHeight * 0.38);
          window.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
          return;
        }
      } else {
        target.scrollIntoView({ behavior: 'smooth', block });
      }
      return;
    }
    const targetRect = target.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    const offset = block === 'start' ? 56 : workspaceRect.height * 0.38;
    const nextTop = workspace.scrollTop + (targetRect.top - workspaceRect.top) - offset;
    workspace.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
  };

  const findOutlineTargetElement = (blockElement: HTMLElement, entry: OutlineEntry) => {
    const anchored = blockElement.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(entry.id)}"]`);
    if (anchored) return anchored;
    if (entry.kind === 'heading') {
      const headings = Array.from(blockElement.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
      return headings[entry.index] ?? blockElement;
    }
    if (entry.kind === 'list') {
      const listItems = Array.from(blockElement.querySelectorAll<HTMLElement>('li'));
      return listItems[entry.index] ?? blockElement;
    }
    return blockElement;
  };

  const jumpToOutlineEntry = (entry: OutlineEntry) => {
    setWorkspaceView('write');
    if (!entry.blockId) {
      document.querySelector<HTMLInputElement>('.page-title')?.focus();
      document.querySelector('.page-surface')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    window.requestAnimationFrame(() => {
      const tryScroll = (attempt = 0) => {
        if (attempt === 0) {
          document.querySelector<HTMLInputElement>('.page-title')?.blur();
          document.querySelector<HTMLElement>('.typora-workspace')?.focus?.();
        }
        const blockElement = document.getElementById(entry.blockId ?? '');
        if (!blockElement) {
          if (attempt < 2) window.requestAnimationFrame(() => tryScroll(attempt + 1));
          return;
        }
        const target = findOutlineTargetElement(blockElement, entry);
        scrollWorkspaceTargetIntoView(target, 'start');
      };
      tryScroll();
    });
  };

  const jumpToBlock = (pageId: string, blockId: string) => {
    saveCurrentComposerDraft();
    setWorkspaceView('write');
    setState((current) => applyActivePageToViewState(current, pageId));
    window.requestAnimationFrame(() => {
      const blockElement = document.getElementById(blockId);
      blockElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const moveCalendarMonth = (delta: number) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const moveBlockByKeyboard = (blockId: string, direction: -1 | 1) => {
    const visualIds = pageBlockOrder === 'desc' ? [...activePage.blockIds].reverse() : activePage.blockIds;
    const visualIndex = visualIds.indexOf(blockId);
    const targetVisualIndex = visualIndex + direction;
    if (visualIndex < 0 || targetVisualIndex < 0 || targetVisualIndex >= visualIds.length) return false;
    const targetBlockId = visualIds[targetVisualIndex];
    const index = activePage.blockIds.indexOf(blockId);
    const targetIndex = activePage.blockIds.indexOf(targetBlockId);
    if (index < 0 || targetIndex < 0) return false;
    const nextIds = [...activePage.blockIds];
    [nextIds[index], nextIds[targetIndex]] = [nextIds[targetIndex], nextIds[index]];
    const updatedAt = new Date().toISOString();
    const nextPage = { ...activePage, blockIds: nextIds, updatedAt };
    const operation = createOperation({ entity: 'page', entityId: activePage.id, kind: 'page.keyboard_move_block', payload: { blockIds: nextIds } });
    applyPageDocumentToView(nextPage, activePageBlocks, operation);
    persistPageDocumentSnapshot(nextPage, activePageBlocks, operation);
    window.requestAnimationFrame(() => {
      blockEditorRefs.current[blockId]?.commands.focus();
      document.getElementById(blockId)?.scrollIntoView({ block: 'nearest' });
    });
    return true;
  };

  const deleteBlockWithTrash = async (blockId: string) => {
    const targetBlock = activePageBlocks.find((block) => block.id === blockId);
    const targetPage = state.pages.find((page) => page.id === targetBlock?.pageId);
    if (!targetBlock || !targetPage) return false;
    const index = targetPage.blockIds.indexOf(blockId);
    if (index < 0) return false;

    const nextIds = targetPage.blockIds.filter((id) => id !== blockId);
    const updatedAt = new Date().toISOString();
    const nextPage = { ...targetPage, blockIds: nextIds, updatedAt };
    const nextBlocks = activePageBlocks.filter((block) => block.id !== blockId);
    const nextSelectedBlockId = nextIds[Math.min(index, nextIds.length - 1)] ?? null;
    const snapshot = { block: targetBlock, pageId: targetPage.id, index, nextSelectedBlockId };
    const operation = createOperation({
      entity: 'block',
      entityId: blockId,
      kind: 'block.delete',
      payload: { pageId: targetPage.id, index, block: targetBlock }
    });

    cancelPageDocumentSaves([targetPage.id]);
    try {
      const persisted = isTauri()
        ? await persistBlockDelete({ pageId: targetPage.id, blockId, operation })
        : null;
      setDeletedBlockSnapshot(snapshot);
      setActiveEditor(nextSelectedBlockId ? { kind: 'block', blockId: nextSelectedBlockId } : { kind: 'composer' });
      if (nextSelectedBlockId) {
        window.setTimeout(() => blockEditorRefs.current[nextSelectedBlockId]?.commands.focus('start'), 0);
      }
      delete blockEditorRefs.current[blockId];
      setPinnedBlockPayloads((current) => current.filter((payload) => payload.block.id !== blockId));
      setState((current) => applyBlockDeleteToViewState(current, nextPage, nextBlocks, blockId, operation, isTauri()));
      if (persisted) {
        setState((current) => current.activePageId === persisted.page.id ? mergePageDocument(current, persisted, isTauri()) : current);
      } else {
        persistPageDocumentSnapshot(nextPage, nextBlocks, operation);
      }
      void refreshTrashItems();
    } catch (error) {
      console.warn('Could not persist block delete to SQLite.', error);
      if (isTauri()) {
        setImportNotice({
          kind: 'error',
          message: 'Block delete failed.',
          details: [error instanceof Error ? error.message : String(error)]
        });
        return false;
      }
      setState((current) => applyBlockDeleteToViewState(current, nextPage, nextBlocks, blockId, operation, isTauri()));
      persistPageDocumentSnapshot(nextPage, nextBlocks, operation);
      void refreshTrashItems();
    }
    return true;
  };

  const undoDeletedBlock = () => {
    const snapshot = deletedBlockSnapshotRef.current;
    if (!snapshot) return false;
    const targetPage = stateRef.current.pages.find((page) => page.id === snapshot.pageId);
    const targetBlocks = targetPage ? blocksForCurrentPage(targetPage, stateRef.current, activePageBlocksRef.current) : [];
    if (!targetPage || targetBlocks.some((block) => block.id === snapshot.block.id)) {
      setDeletedBlockSnapshot(null);
      return false;
    }

    const restoredIds = [...targetPage.blockIds];
    restoredIds.splice(Math.min(snapshot.index, restoredIds.length), 0, snapshot.block.id);
    const updatedAt = new Date().toISOString();
    const restoredBlock = { ...snapshot.block, updatedAt };
    const nextPage = { ...targetPage, blockIds: restoredIds, updatedAt };
    const nextBlocks = [...targetBlocks, restoredBlock];
    const operation = createOperation({
      entity: 'block',
      entityId: restoredBlock.id,
      kind: 'block.restore_delete',
      payload: { pageId: snapshot.pageId, index: snapshot.index }
    });

    cancelPageDocumentSaves([targetPage.id]);
    setDeletedBlockSnapshot(null);
    setActiveEditor({ kind: 'block', blockId: restoredBlock.id });
    if (restoredBlock.pinned) {
      setPinnedBlockPayloads((current) => [...current.filter((payload) => payload.block.id !== restoredBlock.id), { page: nextPage, block: restoredBlock }]);
    }
    applyPageDocumentToView(nextPage, nextBlocks, operation);
    persistPageDocumentSnapshot(nextPage, nextBlocks, operation);
    window.setTimeout(() => {
      blockEditorRefs.current[restoredBlock.id]?.commands.focus('start');
    }, 0);
    return true;
  };

  const restoreLatestDeletedBlockFromTrash = async () => {
    const snapshot = deletedBlockSnapshotRef.current;
    const items = await listTrashItems(50);
    const trashItem = items.find((item) => item.itemType === 'block' && item.sourceId === snapshot?.block.id)
      ?? items.find((item) => item.itemType === 'block');
    if (!trashItem) return false;
    const operation = createOperation({
      entity: 'block',
      entityId: trashItem.sourceId,
      kind: 'block.restore_delete',
      payload: { trashId: trashItem.id }
    });
    const tree = await restoreTrashItem({ trashId: trashItem.id, operation });
    if (tree) reconcileNotebookTree(tree);
    const targetPageId = trashItem.parentId ?? snapshot?.pageId ?? stateRef.current.activePageId;
    const document = targetPageId ? await loadPageDocument(targetPageId) : null;
    if (document) {
      setState((current) => mergePageDocument(current, document, isTauri()));
      setActiveEditor({ kind: 'block', blockId: trashItem.sourceId });
      window.setTimeout(() => blockEditorRefs.current[trashItem.sourceId]?.commands.focus('start'), 0);
    }
    setDeletedBlockSnapshot(null);
    setPinnedBlockPayloads(await listPinnedBlocks());
    return true;
  };

  const commitDraft = () => {
    const currentState = stateRef.current;
    const currentPage = currentState.pages.find((page) => page.id === currentState.activePageId) ?? activePage;
    const currentPageBlocks = currentPage
      ? blocksForCurrentPage(currentPage, currentState, activePageBlocksRef.current)
      : activePageBlocksRef.current;
    const editor = composerEditorRef.current;
    const html = (editor?.getHTML() ?? activeDraft).trim();
    const plainText = (editor?.getText() ?? '').trim();
    if (isEditorContentEmpty(html, plainText)) return;

    const block = createBlock(currentPage.id, html, plainText);
    const updatedAt = new Date().toISOString();
    const nextPage = {
      ...currentPage,
      blockIds: [...currentPage.blockIds, block.id],
      updatedAt
    };
    const nextBlocks = [...currentPageBlocks, block];
    const operation = createOperation({ entity: 'block', entityId: block.id, kind: 'block.create', payload: block });
    applyPageDocumentToView(nextPage, nextBlocks, operation);
    persistPageDocumentSnapshot(nextPage, nextBlocks, operation);
    setDraftsByPageId((current) => {
      const next = { ...current };
      delete next[currentPage.id];
      return next;
    });
    editor?.commands.clearContent();
    editor?.commands.focus();
  };

  const updateBlock = (blockId: string, html: string, plainText: string) => {
    const cleanHtml = stripOutlineAnchors(html);
    const updatedAt = new Date().toISOString();
    const targetBlock = activePageBlocks.find((block) => block.id === blockId);
    const targetPage = state.pages.find((page) => page.id === targetBlock?.pageId);
    const nextPage = targetPage ? { ...targetPage, updatedAt } : null;
    const nextBlocks = activePageBlocks.map((block) =>
      block.id === blockId ? { ...block, content: { html: cleanHtml, plainText }, updatedAt } : block
    );
    const operation = createOperation({
      entity: 'block',
      entityId: blockId,
      kind: 'block.update_content',
      payload: { html: cleanHtml, plainText }
    });
    if (nextPage) applyPageDocumentToView(nextPage, nextBlocks, operation);
    if (targetBlock?.pinned) {
      setPinnedBlockPayloads((current) => current.map((payload) =>
        payload.block.id === blockId
          ? { ...payload, block: { ...payload.block, content: { html: cleanHtml, plainText }, updatedAt } }
          : payload
      ));
    }
    if (nextPage) schedulePageDocumentSave(nextPage, nextBlocks, operation, 350);
  };

  const updateCardBlock = (blockId: string, html: string, plainText: string) => {
    const cleanHtml = stripOutlineAnchors(html);
    const updatedAt = new Date().toISOString();
    const document = cardDocument;
    if (!document) {
      updateBlock(blockId, cleanHtml, plainText);
      return;
    }
    const nextBlocks = document.content.blocks.map((block) =>
      block.id === blockId ? { ...block, content: { html: cleanHtml, plainText }, updatedAt } : block
    );
    const nextPage = { ...document.page, blockIds: nextBlocks.map((block) => block.id), updatedAt };
    const nextDocument = { ...document, page: nextPage, content: { ...document.content, blocks: nextBlocks } };
    const operation = createOperation({
      entity: 'block',
      entityId: blockId,
      kind: 'block.update_content',
      payload: { html: cleanHtml, plainText }
    });
    setCardDocument(nextDocument);
    setPinnedBlockPayloads((current) => current.map((payload) =>
      payload.block.id === blockId
        ? { ...payload, page: nextPage, block: nextBlocks.find((block) => block.id === blockId) ?? payload.block }
        : payload
    ));
    schedulePageDocumentSave(nextPage, nextBlocks, operation, 350);
  };

  const toggleBlock = (blockId: string, key: 'collapsed' | 'pinned') => {
    const updatedAt = new Date().toISOString();
    const targetBlock = activePageBlocks.find((block) => block.id === blockId);
    const targetPage = state.pages.find((page) => page.id === targetBlock?.pageId);
    const nextBlocks = activePageBlocks.map((block) =>
      block.id === blockId ? { ...block, [key]: !block[key], updatedAt } : block
    );
    const nextBlock = nextBlocks.find((block) => block.id === blockId) ?? null;
    const nextPage = targetPage ? { ...targetPage, updatedAt } : null;
    const operation = createOperation({ entity: 'block', entityId: blockId, kind: `block.toggle_${key}`, payload: { key } });
    if (nextPage) applyPageDocumentToView(nextPage, nextBlocks, operation);
    if (key === 'pinned') {
      setPinnedBlockPayloads((current) => {
        if (!nextBlock || !nextPage) return current.filter((payload) => payload.block.id !== blockId);
        if (!nextBlock.pinned) return current.filter((payload) => payload.block.id !== blockId);
        const nextPayload = { page: nextPage, block: nextBlock };
        return current.some((payload) => payload.block.id === blockId)
          ? current.map((payload) => (payload.block.id === blockId ? nextPayload : payload))
          : [...current, nextPayload];
      });
    }
    if (nextPage) persistPageDocumentSnapshot(nextPage, nextBlocks, operation);
  };

  const setPageBlockOrder = (blockOrder: 'asc' | 'desc') => {
    const updatedAt = new Date().toISOString();
    const nextPage = { ...activePage, blockOrder, updatedAt };
    const operation = createOperation({
      entity: 'page',
      entityId: activePage.id,
      kind: 'page.set_block_order',
      payload: { blockOrder }
    });
    applyPageDocumentToView(nextPage, activePageBlocks, operation);
    persistPageDocumentSnapshot(nextPage, activePageBlocks, operation);
  };

  const reorderBlock = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const sourceIndex = activePage.blockIds.indexOf(sourceId);
    const targetIndex = activePage.blockIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextIds = [...activePage.blockIds];
    nextIds.splice(sourceIndex, 1);
    nextIds.splice(targetIndex, 0, sourceId);
    const updatedAt = new Date().toISOString();
    const nextPage = { ...activePage, blockIds: nextIds, updatedAt };
    const operation = createOperation({ entity: 'page', entityId: activePage.id, kind: 'page.reorder_blocks', payload: { blockIds: nextIds } });
    applyPageDocumentToView(nextPage, activePageBlocks, operation);
    persistPageDocumentSnapshot(nextPage, activePageBlocks, operation);
  };

  const createOperation = (entry: Omit<OperationLogEntry, 'id' | 'timestamp'>): OperationLogEntry => ({
    id: createId('op'),
    timestamp: new Date().toISOString(),
    ...entry
  });

  const reconcileNotebookTree = (tree: NotebookTreePayload | null) => {
    if (!tree) return;
    setState((current) => mergeNotebookTree(current, tree));
  };

  const addNotebook = () => {
    saveCurrentComposerDraft();
    const notebook = createNotebook(`Notebook ${state.notebooks.length + 1}`);
    const page = createPage(notebook.id, 'Inbox');
    const notebookWithPage = { ...notebook, pageIds: [page.id] };
    const operation = createOperation({ entity: 'notebook', entityId: notebook.id, kind: 'notebook.create', payload: notebookWithPage });
    void persistNotebookCreate({ notebook: notebookWithPage, initialPage: page, operation })
      .then(reconcileNotebookTree)
      .catch((error) => {
        console.warn('Could not persist notebook create.', error);
      });
    setState((current) => applyNotebookCreateToViewState(current, notebookWithPage, page, operation));
  };

  const persistRename = (entity: 'notebook' | 'page', entityId: string, name: string, operation: OperationLogEntry | null) => {
    if (!isTauri()) return;
    void persistEntityRename({ entity, entityId, name, operation })
      .then(reconcileNotebookTree)
      .catch((error) => {
        console.warn(`Could not persist ${entity} rename.`, error);
      });
  };

  const renameNotebook = (notebookId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) return;
    const notebook = state.notebooks.find((candidate) => candidate.id === notebookId);
    if (!notebook || notebook.name === nextName) return;
    const operation = createOperation({
      entity: 'notebook',
      entityId: notebookId,
      kind: 'notebook.rename',
      payload: { name: nextName }
    });
    persistRename('notebook', notebookId, nextName, operation);
    setState((current) => applyNotebookRenameToViewState(current, notebookId, nextName, operation));
  };

  const persistPageTitle = (pageId: string, title: string) => {
    if (!title.trim()) return null;
    if (temporaryMarkdownPagesRef.current.some((item) => item.id === pageId)) {
      return createOperation({
        entity: 'page',
        entityId: pageId,
        kind: 'page.rename_temporary',
        payload: { title }
      });
    }
    const operation = createOperation({
      entity: 'page',
      entityId: pageId,
      kind: 'page.rename',
      payload: { title }
    });
    persistRename('page', pageId, title, operation);
    return operation;
  };

  const addPage = (parentId: string | null = null, metadataPatch: Partial<Page['metadata']> = {}) => {
    saveCurrentComposerDraft();
    const page = createPage(state.activeNotebookId, parentId ? 'Nested page' : 'Untitled page', parentId);
    page.metadata = {
      ...page.metadata,
      ...metadataPatch,
      tags: metadataPatch.tags ?? page.metadata.tags,
      aliases: metadataPatch.aliases ?? page.metadata.aliases,
      frontmatter: metadataPatch.frontmatter ?? page.metadata.frontmatter
    };
    const operation = createOperation({ entity: 'page', entityId: page.id, kind: 'page.create', payload: page });
    void persistPageCreate({ page, operation })
      .then(reconcileNotebookTree)
      .catch((error) => {
        console.warn('Could not persist page create.', error);
      });
    setSelectedPageId(page.id);
    setState((current) => applyPageCreateToViewState(current, page, current.activeNotebookId, operation));
  };

  const addCalendarPage = (date: string) => {
    if (!activeNotebookCalendarConfig) return;
    const metadataPatch: Partial<Page['metadata']> = { date };
    addPage(null, metadataPatch);
    if (activeNotebookCalendarConfig.dateSource === 'createdAt') {
      updateNotebookCalendarView(activeNotebook.id, (config, pages) => ({
        ...(config ?? defaultCalendarConfigForPages(pages)),
        enabled: true,
        dateSource: 'metadata.date',
        dateSources: ['metadata.date'],
        visibleFields: config?.visibleFields?.length ? config.visibleFields : visibleCalendarFieldsForPages(pages)
      }));
    }
  };

  const setPageCalendarDateSources = (dateSources: NotebookCalendarDateSource[]) => {
    if (!activeNotebookCalendarConfig) return;
    updateNotebookCalendarView(activeNotebook.id, (config, pages) => ({
      ...(config ?? defaultCalendarConfigForPages(pages)),
      enabled: true,
      dateSource: dateSources[0] ?? 'createdAt',
      dateSources
    }));
  };

  const setPageCalendarVisibleFields = (visibleFields: string[]) => {
    if (!activeNotebookCalendarConfig) return;
    updateNotebookCalendarView(activeNotebook.id, (config, pages) => {
      const base = config ?? defaultCalendarConfigForPages(pages);
      return {
        ...base,
        enabled: true,
        visibleFields
      };
    });
  };

  const setPageCalendarColorField = (colorField: string) => {
    if (!activeNotebookCalendarConfig) return;
    updateNotebookCalendarView(activeNotebook.id, (config, pages) => ({
      ...(config ?? defaultCalendarConfigForPages(pages)),
      enabled: true,
      colorField
    }));
  };

  const togglePageExpanded = (pageId: string) => {
    setState((current) => applyPageExpandedToggleToViewState(current, pageId));
  };

  const movePageToPath = (pageId: string, notebookId: string, parentId: string | null) => {
    if (pageId === parentId) return;
    const targetNotebook = state.notebooks.find((notebook) => notebook.id === notebookId);
    if (!targetNotebook) return;
    const page = state.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    if (parentId) {
      const parent = state.pages.find((candidate) => candidate.id === parentId);
      if (!parent || parent.notebookId !== notebookId) return;
    }
    let cursor = parentId;
    while (cursor) {
      const parent = state.pages.find((page) => page.id === cursor);
      if (!parent) break;
      if (parent.parentId === pageId) return;
      cursor = parent.parentId;
    }
    const operation = createOperation({
      entity: 'page',
      entityId: pageId,
      kind: 'page.move',
      payload: { notebookId, parentId }
    });
    void persistPageMove({ pageId, notebookId, parentId, operation })
      .then(reconcileNotebookTree)
      .catch((error) => {
        console.warn('Could not persist page move.', error);
      });
    setState((current) => applyPageMoveToViewState(current, pageId, notebookId, parentId, operation));
  };

  const movePageUnder = (pageId: string, parentId: string | null) => {
    const page = state.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    const notebookId = parentId
      ? state.pages.find((candidate) => candidate.id === parentId)?.notebookId ?? page.notebookId
      : page.notebookId;
    movePageToPath(pageId, notebookId, parentId);
  };

  const selectPage = (pageId: string) => {
    saveCurrentComposerDraft();
    setSelectedPageId(pageId);
    setWorkspaceView('write');
    setState((current) => applyActivePageToViewState(current, pageId));
  };

  const movePageByKeyboard = (pageId: string, outdent: boolean) => {
    const page = state.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    if (outdent) {
      const parent = state.pages.find((candidate) => candidate.id === page.parentId);
      movePageUnder(page.id, parent?.parentId ?? null);
      return;
    }
    const siblings = state.pages.filter((candidate) => candidate.notebookId === page.notebookId && (candidate.parentId ?? null) === (page.parentId ?? null));
    const index = siblings.findIndex((candidate) => candidate.id === page.id);
    const previousSibling = siblings[index - 1];
    if (previousSibling) movePageUnder(page.id, previousSibling.id);
  };

  useEffect(() => {
    const handlePageLink = (event: Event) => {
      const detail = (event as CustomEvent<{ pageId?: string }>).detail;
      const pageId = detail?.pageId;
      if (!pageId) return;
      const targetPage = stateRef.current.pages.find((page) => page.id === pageId);
      if (!targetPage) return;
      saveCurrentComposerDraft();
      setQuery('');
      setSelectedPageId(pageId);
      setWorkspaceView('write');
      setState((current) => applyPageNavigationToViewState(current, pageId));
    };
    window.addEventListener('notebook:open-page-link', handlePageLink);
    return () => window.removeEventListener('notebook:open-page-link', handlePageLink);
  }, []);

  const loadSourceBlocksForPages = async (sourcePages: Page[]) => {
    if (!isTauri()) {
      return new Map(sourcePages.map((page) => [page.id, blocksForCurrentPage(page, stateRef.current, activePageBlocksRef.current)] as const));
    }

    const documents = await loadPageDocuments(sourcePages.map((page) => page.id));
    const documentsByPageId = new Map(documents.map((document) => [document.page.id, document]));
    return new Map(sourcePages.map((page) => [
      page.id,
      documentsByPageId.get(page.id)?.content.blocks ?? blocksForCurrentPage(page, stateRef.current, activePageBlocksRef.current)
    ] as const));
  };

  const duplicatePageTree = async (pageId: string) => {
    const rootPage = state.pages.find((page) => page.id === pageId);
    const notebook = rootPage ? state.notebooks.find((candidate) => candidate.id === rootPage.notebookId) : null;
    if (!rootPage || !notebook) return;
    const sourcePages = [rootPage, ...descendantsOfPage(pageId, state.pages)];
    if (isTauri() && sourcePages.some((page) => page.id === activePage.id)) {
      try {
        await flushPageDocumentSave(activePage, activePageBlocksRef.current);
      } catch (error) {
        console.warn('Could not flush active page before duplicate.', error);
        return;
      }
    }
    const sourceBlocksByPageId = await loadSourceBlocksForPages(sourcePages);
    const pageIdMap = new Map(sourcePages.map((page) => [page.id, createId('page')]));
    const blockIdMap = new Map<string, string>();
    sourcePages.forEach((page) => {
      (sourceBlocksByPageId.get(page.id) ?? []).forEach((block) => blockIdMap.set(block.id, createId('block')));
    });

    const now = new Date().toISOString();
    const duplicatedPages = sourcePages.map((page, index) => ({
      ...page,
      id: pageIdMap.get(page.id) ?? createId('page'),
      parentId: page.parentId && pageIdMap.has(page.parentId) ? pageIdMap.get(page.parentId) ?? null : page.parentId,
      title: index === 0 ? `${page.title} copy` : page.title,
      blockIds: (sourceBlocksByPageId.get(page.id) ?? []).map((block) => blockIdMap.get(block.id)).filter(Boolean) as string[],
      createdAt: now,
      updatedAt: now
    }));
    const duplicatedBlocks = sourcePages
      .flatMap((page) => sourceBlocksByPageId.get(page.id) ?? [])
      .map((block) => ({
        ...block,
        id: blockIdMap.get(block.id) ?? createId('block'),
        pageId: pageIdMap.get(block.pageId) ?? block.pageId,
        pinned: false,
        createdAt: now,
        updatedAt: now
      }));
    const duplicatedRootId = duplicatedPages[0]?.id ?? state.activePageId;
    const updatedNotebook = { ...notebook, pageIds: [...notebook.pageIds, ...duplicatedPages.map((page) => page.id)] };
    const operation = createOperation({
      entity: 'page',
      entityId: duplicatedRootId,
      kind: 'page.duplicate_tree',
      payload: { sourcePageId: pageId, pageCount: duplicatedPages.length, blockCount: duplicatedBlocks.length }
    });
    let persistedTree: NotebookTreePayload | null = null;
    if (isTauri()) {
      try {
        persistedTree = await persistImportBatch({ notebook: updatedNotebook, pages: duplicatedPages, blocks: duplicatedBlocks, operation });
      } catch (error) {
        console.warn('Could not persist page duplicate.', error);
        return;
      }
    } else {
      void persistImportBatch({ notebook: updatedNotebook, pages: duplicatedPages, blocks: duplicatedBlocks, operation }).catch((error) => {
        console.warn('Could not persist page duplicate.', error);
      });
    }

    setState((current) => applyPageTreeDuplicateToViewState(
      current,
      rootPage.notebookId,
      updatedNotebook.pageIds,
      duplicatedPages,
      duplicatedBlocks,
      duplicatedRootId,
      operation,
      isTauri()
    ));
    reconcileNotebookTree(persistedTree);
  };

  const deletePageTree = (pageId: string) => {
    const page = state.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    const deletedPages = [page, ...descendantsOfPage(pageId, state.pages)];
    const deletedPageIds = new Set(deletedPages.map((deletedPage) => deletedPage.id));
    const deletedBlockIds = new Set(deletedPages.flatMap((deletedPage) => deletedPage.blockIds));
    cancelPageDocumentSaves(deletedPageIds);
    const fallbackPage = state.pages.some((candidate) => candidate.notebookId === page.notebookId && !deletedPageIds.has(candidate.id))
      ? null
      : createPage(page.notebookId, 'Inbox');
    const operation = createOperation({
      entity: 'page',
      entityId: pageId,
      kind: 'page.delete_tree',
      payload: { pageCount: deletedPages.length, blockCount: deletedBlockIds.size }
    });
    void persistPageTreeDelete({ pageId, fallbackPage, operation })
      .then((tree) => {
        reconcileNotebookTree(tree);
        void refreshTrashItems();
      })
      .catch((error) => {
        console.warn('Could not persist page tree delete.', error);
      });
    setPinnedBlockPayloads((current) => current.filter((payload) => !deletedPageIds.has(payload.page.id)));

    setState((current) => applyPageTreeDeleteToViewState(current, pageId, fallbackPage, operation));
  };

  const duplicateNotebook = async (notebookId: string) => {
    const sourceNotebook = state.notebooks.find((notebook) => notebook.id === notebookId);
    if (!sourceNotebook) return;
    const sourcePages = state.pages.filter((page) => page.notebookId === notebookId);
    if (isTauri() && sourcePages.some((page) => page.id === activePage.id)) {
      try {
        await flushPageDocumentSave(activePage, activePageBlocksRef.current);
      } catch (error) {
        console.warn('Could not flush active page before notebook duplicate.', error);
        return;
      }
    }
    const sourceBlocksByPageId = await loadSourceBlocksForPages(sourcePages);
    const pageIdMap = new Map(sourcePages.map((page) => [page.id, createId('page')]));
    const blockIdMap = new Map<string, string>();
    sourcePages.forEach((page) => {
      (sourceBlocksByPageId.get(page.id) ?? []).forEach((block) => blockIdMap.set(block.id, createId('block')));
    });
    const notebook = { ...createNotebook(`${sourceNotebook.name} copy`), pageIds: sourceNotebook.pageIds.map((id) => pageIdMap.get(id)).filter(Boolean) as string[] };
    const now = new Date().toISOString();
    const duplicatedPages = sourcePages.map((page) => ({
      ...page,
      id: pageIdMap.get(page.id) ?? createId('page'),
      notebookId: notebook.id,
      parentId: page.parentId ? pageIdMap.get(page.parentId) ?? null : null,
      blockIds: (sourceBlocksByPageId.get(page.id) ?? []).map((block) => blockIdMap.get(block.id)).filter(Boolean) as string[],
      createdAt: now,
      updatedAt: now
    }));
    const duplicatedBlocks = sourcePages
      .flatMap((page) => sourceBlocksByPageId.get(page.id) ?? [])
      .map((block) => ({
        ...block,
        id: blockIdMap.get(block.id) ?? createId('block'),
        pageId: pageIdMap.get(block.pageId) ?? block.pageId,
        pinned: false,
        createdAt: now,
        updatedAt: now
      }));
    const operation = createOperation({
      entity: 'notebook',
      entityId: notebook.id,
      kind: 'notebook.duplicate',
      payload: { sourceNotebookId: notebookId, pageCount: duplicatedPages.length, blockCount: duplicatedBlocks.length }
    });
    let persistedTree: NotebookTreePayload | null = null;
    if (isTauri()) {
      try {
        persistedTree = await persistImportBatch({ notebook, pages: duplicatedPages, blocks: duplicatedBlocks, operation });
      } catch (error) {
        console.warn('Could not persist notebook duplicate.', error);
        return;
      }
    } else {
      void persistImportBatch({ notebook, pages: duplicatedPages, blocks: duplicatedBlocks, operation }).catch((error) => {
        console.warn('Could not persist notebook duplicate.', error);
      });
    }

    setState((current) => applyNotebookDuplicateToViewState(
      current,
      notebook,
      notebook.pageIds[0] ?? null,
      duplicatedPages,
      duplicatedBlocks,
      operation,
      isTauri()
    ));
    reconcileNotebookTree(persistedTree);
  };

  const deleteNotebook = (notebookId: string) => {
    const notebook = state.notebooks.find((candidate) => candidate.id === notebookId);
    if (!notebook || state.notebooks.length <= 1) return;
    const deletedPages = state.pages.filter((page) => page.notebookId === notebookId);
    const deletedPageIds = new Set(deletedPages.map((page) => page.id));
    const deletedBlockIds = new Set(deletedPages.flatMap((page) => page.blockIds));
    cancelPageDocumentSaves(deletedPageIds);
    const operation = createOperation({
      entity: 'notebook',
      entityId: notebookId,
      kind: 'notebook.delete',
      payload: { pageCount: deletedPages.length, blockCount: deletedBlockIds.size }
    });
    void persistNotebookDelete({ notebookId, operation })
      .then((tree) => {
        reconcileNotebookTree(tree);
        void refreshTrashItems();
      })
      .catch((error) => {
        console.warn('Could not persist notebook delete.', error);
      });
    setPinnedBlockPayloads((current) => current.filter((payload) => payload.page.notebookId !== notebookId));

    setState((current) => applyNotebookDeleteToViewState(current, notebookId, operation));
  };

  const handlePageKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, page: Page) => {
    const key = event.key.toLowerCase();
    const commandKey = event.metaKey || event.ctrlKey;
    const pageId = page.id;
    if (commandKey && key === 'c') {
      event.preventDefault();
      setSelectedPageId(pageId);
      setCopiedPageId(pageId);
      return true;
    }
    if (commandKey && key === 'v') {
      event.preventDefault();
      void duplicatePageTree(copiedPageId ?? pageId);
      return true;
    }
    if (!commandKey && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      deletePageTree(pageId);
      return true;
    }
    if (!commandKey && event.key === 'Tab') {
      event.preventDefault();
      selectPage(pageId);
      movePageByKeyboard(pageId, event.shiftKey);
      return true;
    }
    return false;
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const commandKey = event.metaKey || event.ctrlKey;
      if (!event.defaultPrevented && commandKey && !event.shiftKey && key === 'z' && deletedBlockSnapshotRef.current) {
        event.preventDefault();
        event.stopPropagation();
        void restoreLatestDeletedBlockFromTrash()
          .then((restored) => {
            if (!restored) undoDeletedBlock();
          })
          .catch((error) => {
            console.warn('Could not restore deleted block from trash.', error);
            undoDeletedBlock();
          });
        return;
      }

      if (event.defaultPrevented || !selectedPageId) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .ProseMirror')) return;
      const targetPageRow = target?.closest<HTMLElement>('.page-row-shell[data-page-id], .file-node-row-shell[data-page-id]');
      if (target?.closest('button, a') && !targetPageRow) return;
      const pageId = targetPageRow?.dataset.pageId ?? selectedPageId;
      if (commandKey && key === 'c') {
        event.preventDefault();
        event.stopPropagation();
        setSelectedPageId(pageId);
        setCopiedPageId(pageId);
        return;
      }
      if (commandKey && key === 'v') {
        event.preventDefault();
        event.stopPropagation();
        void duplicatePageTree(copiedPageId ?? pageId);
        return;
      }
      if (!commandKey && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedPageId(pageId);
        deletePageTree(pageId);
        return;
      }
      if (!commandKey && event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        selectPage(pageId);
        movePageByKeyboard(pageId, event.shiftKey);
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => window.removeEventListener('keydown', handleWindowKeyDown, true);
  }, [copiedPageId, selectedPageId, state.pages]);

  const renamePage = (title: string) => {
    if (activePage.title === title) return;
    const operation = persistPageTitle(activePage.id, title);
    if (operation) setState((current) => applyPageRenameToViewState(current, activePage.id, title, operation));
  };

  const beginPageRename = (page: Page) => {
    selectPage(page.id);
    setPageDraftName(page.title);
    cancelPageBlurCommitRef.current = false;
    setEditingPageId(page.id);
  };

  const commitPageRename = () => {
    const page = state.pages.find((candidate) => candidate.id === editingPageId);
    if (!page) {
      setEditingPageId(null);
      setPageDraftName('');
      return;
    }
    const title = pageDraftName.trim() || page.title;
    if (title !== page.title) {
      const operation = persistPageTitle(page.id, title);
      if (operation) setState((current) => applyPageRenameToViewState(current, page.id, title, operation));
    }
    setEditingPageId(null);
    setPageDraftName('');
  };

  const cancelPageRename = () => {
    cancelPageBlurCommitRef.current = true;
    setEditingPageId(null);
    setPageDraftName('');
  };

  const pageRenameInputProps = (page: Page) => ({
    ref: pageNameInputRef,
    className: 'notebook-name-input page-name-input',
    'aria-label': `Rename page ${page.title}`,
    value: pageDraftName,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setPageDraftName(event.target.value),
    onBlur: () => {
      if (cancelPageBlurCommitRef.current) {
        cancelPageBlurCommitRef.current = false;
        return;
      }
      commitPageRename();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelPageRename();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        commitPageRename();
      }
    }
  } as const);

  const exportMarkdown = () => {
    const markdown = [`# ${activePage.title}`, '', ...activePageBlocks.map((block) => htmlToMarkdown(block.content.html))].join('\n\n');
    downloadTextFile(`${activePage.title || 'page'}.md`, markdown, 'text/markdown;charset=utf-8');
  };

  const exportJson = async () => {
    try {
      if (isTauri()) await flushPageDocumentSave(activePage, activePageBlocksRef.current);
      const backupState = isTauri() ? await loadFullBackupState() : state;
      downloadTextFile('notebook-backup.json', JSON.stringify(backupState, null, 2), 'application/json;charset=utf-8');
    } catch (error) {
      setImportNotice({
        kind: 'error',
        message: 'Backup export failed.',
        details: [error instanceof Error ? error.message : String(error)]
      });
    }
  };

  const restorePreviousPageVersion = async () => {
    if (!isTauri() || !activePage?.id) return;
    try {
      await flushPageDocumentSave(activePage, activePageBlocksRef.current);
      const revisions = await listPageRevisions(activePage.id, 1);
      const latestRevision = revisions[0];
      if (!latestRevision) {
        setImportNotice({ kind: 'warning', message: 'No saved previous version for this page yet.' });
        return;
      }
      const confirmed = window.confirm(`Restore the previous saved version of "${activePage.title}"? Your current saved version will be kept as a revision.`);
      if (!confirmed) return;
      cancelPageDocumentSaves([activePage.id]);
      const operation = createOperation({
        entity: 'page',
        entityId: activePage.id,
        kind: 'page.restore_revision',
        payload: { revisionId: latestRevision.id }
      });
      const restored = await restorePageRevision({ pageId: activePage.id, revisionId: latestRevision.id, operation });
      if (!restored) return;
      setState((current) => applyRestoredPageDocumentToViewState(current, restored, operation, isTauri()));
      setPinnedBlockPayloads(await listPinnedBlocks());
      setImportNotice({ kind: 'success', message: `Restored previous version of "${restored.page.title}".` });
    } catch (error) {
      setImportNotice({
        kind: 'error',
        message: 'Page version restore failed.',
        details: [error instanceof Error ? error.message : String(error)]
      });
    }
  };

  const restoreTrashItemById = async (trashId: number) => {
    try {
      const item = trashItems.find((candidate) => candidate.id === trashId);
      const operation = createOperation({
        entity: item?.itemType === 'notebook' ? 'notebook' : item?.itemType === 'block' ? 'block' : 'page',
        entityId: item?.sourceId ?? String(trashId),
        kind: `${item?.itemType ?? 'trash'}.restore_trash`,
        payload: { trashId }
      });
      const tree = await restoreTrashItem({ trashId, operation });
      if (tree) reconcileNotebookTree(tree);
      const pageId = item?.itemType === 'block'
        ? item.parentId
        : item?.itemType === 'page'
          ? item.sourceId
          : stateRef.current.activePageId;
      const document = pageId ? await loadPageDocument(pageId) : null;
      if (document) setState((current) => mergePageDocument(current, document, isTauri()));
      setPinnedBlockPayloads(await listPinnedBlocks());
      void refreshTrashItems();
    } catch (error) {
      setImportNotice({
        kind: 'error',
        message: 'Trash restore failed.',
        details: [error instanceof Error ? error.message : String(error)]
      });
    }
  };

  const emptyTrashItems = async () => {
    try {
      setTrashBusy(true);
      await emptyTrash();
      setTrashItems([]);
      await refreshTrashItems();
      setImportNotice({ kind: 'success', message: 'Trash emptied.' });
    } catch (error) {
      setImportNotice({
        kind: 'error',
        message: 'Could not empty trash.',
        details: [error instanceof Error ? error.message : String(error)]
      });
    } finally {
      setTrashBusy(false);
    }
  };

  const importMarkdownFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((file) => /\.(md|markdown|txt)$/i.test(file.name));
    if (!files.length) return;
    const targetNotebook = state.notebooks.find((notebook) => notebook.id === state.activeNotebookId);
    if (!targetNotebook) return;
    setImportNotice({ kind: 'loading', message: `Importing ${files.length} Markdown file${files.length > 1 ? 's' : ''}...` });

    try {
      const documents = await Promise.all(files.map(async (file) => ({ filename: file.name, markdown: await file.text() })));
      const imported = await Promise.all(documents.map((document) => createPageFromMarkdown(state.activeNotebookId, document.filename, document.markdown)));
      const warnings = imported.flatMap(({ warnings }) => warnings);
      const warningDetails = warnings.slice(0, 4).map((warning) => `${warning.filename}: ${warning.sourcePath} (${warning.message})`);
      const importedPageIds = imported.map(({ page }) => page.id);
      const importedBlocks = imported.flatMap(({ blocks }) => blocks);
      const importedNotebook = { ...targetNotebook, pageIds: [...targetNotebook.pageIds, ...importedPageIds] };
      const operation = createOperation({
        entity: 'notebook',
        entityId: importedNotebook.id,
        kind: 'notebook.import_markdown_files',
        payload: {
          notebookId: importedNotebook.id,
          pageCount: imported.length,
          blockCount: importedBlocks.length,
          warningCount: warnings.length
        }
      });
      let persistedTree: NotebookTreePayload | null = null;
      if (isTauri()) {
        persistedTree = await persistImportBatch({
          notebook: importedNotebook,
          pages: imported.map(({ page }) => page),
          blocks: importedBlocks,
          operation
        });
      } else {
        void persistImportBatch({
          notebook: importedNotebook,
          pages: imported.map(({ page }) => page),
          blocks: importedBlocks,
          operation
        }).catch((error) => {
          console.warn('Could not persist Markdown file import.', error);
        });
      }

      setState((current) => applyMarkdownFilesImportToViewState(
        current,
        targetNotebook.id,
        imported.map(({ page }) => page),
        importedBlocks,
        operation,
        isTauri()
      ));
      reconcileNotebookTree(persistedTree);

      const importedBlockCount = imported.reduce((sum, item) => sum + item.blocks.length, 0);
      setImportNotice({
        kind: warnings.length ? 'warning' : 'success',
        message: warnings.length
          ? `Imported ${imported.length} page${imported.length > 1 ? 's' : ''}, but ${warnings.length} local asset${warnings.length > 1 ? 's' : ''} could not be copied.`
          : `Imported ${imported.length} page${imported.length > 1 ? 's' : ''} with ${importedBlockCount} block${importedBlockCount > 1 ? 's' : ''}.`,
        details: warningDetails
      });
    } catch (error) {
      setImportNotice({
        kind: 'error',
        message: 'Markdown import failed.',
        details: [error instanceof Error ? error.message : String(error)]
      });
    }
  };

  const openTemporaryMarkdownFile = async (source: OpenedMarkdownFilePayload) => {
    const targetNotebook = stateRef.current.notebooks.find((notebook) => notebook.id === stateRef.current.activeNotebookId) ?? stateRef.current.notebooks[0];
    if (!targetNotebook) return;
    const duplicate = temporaryMarkdownPagesRef.current.find((item) => item.sourcePath === source.path);
    if (duplicate && stateRef.current.pages.some((page) => page.id === duplicate.id)) {
      setWorkspaceView('write');
      setState((current) => applyPageNavigationToViewState(current, duplicate.id));
      setImportNotice({ kind: 'success', message: `Opened temporary Markdown file "${duplicate.filename}".` });
      return;
    }
    setImportNotice({ kind: 'loading', message: `Opening "${source.filename}"...` });

    try {
      const imported = await createPageFromMarkdown(targetNotebook.id, source.filename, source.markdown);
      const page = {
        ...imported.page,
        metadata: {
          ...imported.page.metadata,
          sourceFilename: source.path
        }
      };
      const operation = createOperation({
        entity: 'page',
        entityId: page.id,
        kind: 'page.open_temporary_markdown',
        payload: {
          sourcePath: source.path,
          filename: source.filename,
          blockCount: imported.blocks.length,
          warningCount: imported.warnings.length
        }
      });
      setTemporaryMarkdownPages((current) => [
        ...current.filter((item) => item.sourcePath !== source.path && item.id !== page.id),
        { id: page.id, sourcePath: source.path, filename: source.filename }
      ]);
      setWorkspaceView('write');
      setState((current) => applyMarkdownFilesImportToViewState(current, targetNotebook.id, [page], imported.blocks, operation, false));
      const warningDetails = imported.warnings.slice(0, 4).map((warning) => `${warning.filename}: ${warning.sourcePath} (${warning.message})`);
      setImportNotice({
        kind: imported.warnings.length ? 'warning' : 'success',
        message: imported.warnings.length
          ? `Opened "${source.filename}" temporarily, but ${imported.warnings.length} local asset${imported.warnings.length > 1 ? 's' : ''} could not be copied.`
          : `Opened "${source.filename}" temporarily.`,
        details: warningDetails
      });
    } catch (error) {
      setImportNotice({
        kind: 'error',
        message: `Could not open "${source.filename}".`,
        details: [error instanceof Error ? error.message : String(error)]
      });
    }
  };

  const saveTemporaryMarkdownPage = async (pageId: string) => {
    const source = temporaryMarkdownPagesRef.current.find((item) => item.id === pageId);
    const page = stateRef.current.pages.find((candidate) => candidate.id === pageId);
    const notebook = page ? stateRef.current.notebooks.find((candidate) => candidate.id === page.notebookId) : null;
    if (!source || !page || !notebook) return;
    const blocks = blocksForPage(page, stateRef.current.blocks);
    const operation = createOperation({
      entity: 'notebook',
      entityId: notebook.id,
      kind: 'notebook.save_temporary_markdown',
      payload: {
        pageId,
        notebookId: notebook.id,
        sourcePath: source.sourcePath,
        blockCount: blocks.length
      }
    });
    setImportNotice({ kind: 'loading', message: `Saving "${page.title}" to ${notebook.name}...` });

    try {
      const persistedTree = await persistImportBatch({
        notebook,
        pages: [page],
        blocks,
        operation
      });
      setTemporaryMarkdownPages((current) => current.filter((item) => item.id !== pageId));
      setState((current) => ({
        ...current,
        operations: [...current.operations, operation]
      }));
      reconcileNotebookTree(persistedTree);
      setState((current) => applyPageDocumentToViewState(current, page, blocks, null, isTauri()));
      setImportNotice({ kind: 'success', message: `Saved "${page.title}" to "${notebook.name}".` });
    } catch (error) {
      setImportNotice({
        kind: 'error',
        message: `Could not save "${page.title}".`,
        details: [error instanceof Error ? error.message : String(error)]
      });
    }
  };

  useEffect(() => {
    if (!isTauri() || cardModeBlockId) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const openedPaths = new Set<string>();
    const openPath = async (path: string) => {
      if (!path || openedPaths.has(path)) return;
      openedPaths.add(path);
      try {
        const payload = await invoke<OpenedMarkdownFilePayload>('read_markdown_file', { path });
        await openTemporaryMarkdownFile(payload);
      } catch (error) {
        openedPaths.delete(path);
        setImportNotice({
          kind: 'error',
          message: 'Markdown file open failed.',
          details: [error instanceof Error ? error.message : String(error)]
        });
      } finally {
        void invoke('acknowledge_markdown_open', { path }).catch((error) => {
          console.warn('Could not acknowledge Markdown open.', error);
        });
      }
    };
    void invoke<string[]>('drain_pending_markdown_opens')
      .then((paths) => {
        paths.forEach((path) => {
          void openPath(path);
        });
      })
      .catch((error) => {
        console.warn('Could not read pending Markdown opens.', error);
      });
    void listen<string>('notebook://open-markdown-file', async (event) => {
      await openPath(event.payload);
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const importMarkdownFolder = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    const markdownFiles = files.filter((file) => markdownImportFileRegex.test(file.name));
    if (!markdownFiles.length) return;

    const allRelativePaths = files.map(fileRelativePath);
    const { rootName, stripRoot } = splitImportRoot(allRelativePaths);
    const markdownBytes = markdownFiles.reduce((sum, file) => sum + file.size, 0);
    if (!isTauri() && !importStressMode && markdownBytes > 4 * 1024 * 1024) {
      setImportNotice({
        kind: 'error',
        message: `Folder "${rootName}" is too large for browser storage.`,
        details: [
          `Markdown text is ${(markdownBytes / 1024 / 1024).toFixed(1)} MB before conversion. Use the desktop app so the import can persist to SQLite instead of browser localStorage.`
        ]
      });
      return;
    }
    const assetFiles = isTauri()
      ? new Map(
          files
            .filter((file) => mediaImportFileRegex.test(file.name))
            .map((file) => [stripRoot(fileRelativePath(file)), file] as const)
        )
      : new Map<string, File>();

    setImportNotice({ kind: 'loading', message: `Scanning folder "${rootName}"...` });

    try {
      const assetWarnings: string[] = [];
      const importedAssetCache = new Map<string, Promise<{ src: string; assetId?: string } | null>>();
      const resolveImportedFolderAsset = isTauri()
        ? async (assetPath: string, file: File) => {
            const cached = importedAssetCache.get(assetPath);
            if (cached) return cached;
            const promise = (async () => {
              try {
                const localPath = (file as File & { path?: string }).path;
                const imported = localPath
                  ? await invoke<ImportedAsset>('import_local_asset', { sourcePath: localPath })
                  : await invoke<ImportedAsset>('import_asset_bytes', {
                      filename: file.name,
                      mimeType: file.type || 'application/octet-stream',
                      bytes: Array.from(new Uint8Array(await file.arrayBuffer()))
                    });
                return { src: convertFileSrc(imported.storedPath), assetId: imported.id };
              } catch (error) {
                assetWarnings.push(`${assetPath}: ${error instanceof Error ? error.message : String(error)}`);
                return null;
              }
            })();
            importedAssetCache.set(assetPath, promise);
            return promise;
          }
        : undefined;
      let readDocuments = 0;
      const documents = await mapWithConcurrency(markdownFiles, folderImportConcurrency, async (file) => {
        const relativePath = stripRoot(fileRelativePath(file));
        const markdown = await file.text();
        readDocuments += 1;
        if (readDocuments === markdownFiles.length || readDocuments % 50 === 0) {
          setImportNotice({
            kind: 'loading',
            message: `Scanning folder "${rootName}"... ${readDocuments}/${markdownFiles.length} Markdown files`
          });
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        return { relativePath, markdown };
      });
      if (!isTauri()) {
        const imported = await createNotebookFromMarkdownDocuments(rootName, await mapWithConcurrency(documents, folderImportConcurrency, async (document) => ({
          ...document,
          markdown: await embedImportedAssetMarkdown(document.markdown, document.relativePath, assetFiles, resolveImportedFolderAsset)
        })));
        const warningDetails = [
          ...assetWarnings,
          ...imported.warnings.map((warning) => `${warning.filename}: ${warning.sourcePath} (${warning.message})`)
        ].slice(0, 4);
        const warningCount = assetWarnings.length + imported.warnings.length;
        const activePageId = imported.pages.find((page) => page.blockIds.length)?.id ?? imported.pages[0]?.id ?? state.activePageId;
        const importedExpandedPageIds = imported.pages.length <= fullExpansionImportPageLimit
          ? imported.expandedPageIds
          : ancestorsOfPage(activePageId, imported.pages).map((page) => page.id);
        const operation = createOperation({
          entity: 'notebook',
          entityId: imported.notebook.id,
          kind: 'notebook.import_markdown_folder',
          payload: {
            notebook: imported.notebook,
            pageCount: imported.pages.length,
            blockCount: imported.blocks.length,
            warningCount
          }
        });
        setState((current) => applyMarkdownFolderImportToViewState(
          current,
          imported.notebook,
          imported.pages,
          imported.blocks,
          activePageId,
          importedExpandedPageIds,
          operation,
          false
        ));
        setImportNotice({
          kind: warningCount ? 'warning' : 'success',
          message: warningCount
            ? `Imported folder "${rootName}" with ${imported.pages.length} page${imported.pages.length > 1 ? 's' : ''}, but ${warningCount} local asset${warningCount > 1 ? 's' : ''} could not be copied.`
            : `Imported folder "${rootName}" with ${imported.pages.length} page${imported.pages.length > 1 ? 's' : ''} and ${imported.blocks.length} block${imported.blocks.length > 1 ? 's' : ''}.`,
          details: warningDetails
        });
        return;
      }

      const plan = createMarkdownFolderImportPlan(rootName, documents);
      const activePageId = plan.parsedDocuments[0]?.pageId ?? plan.pages[0]?.id ?? state.activePageId;
      const importedExpandedPageIds = plan.pages.length <= fullExpansionImportPageLimit
        ? plan.expandedPageIds
        : ancestorsOfPage(activePageId, plan.pages).map((page) => page.id);
      setImportNotice({
        kind: 'loading',
        message: `Creating folder "${rootName}"... ${plan.pages.length} pages`
      });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const importOperation = createOperation({
        entity: 'notebook',
        entityId: plan.notebook.id,
        kind: 'notebook.import_markdown_folder',
        payload: {
          notebook: plan.notebook,
          pageCount: plan.pages.length,
          blockCount: 0,
          warningCount: 0
        }
      });
      const persistedTree = await persistImportBatch({
        notebook: plan.notebook,
        pages: plan.pages,
        blocks: [],
        operation: importOperation
      });
      setState((current) => applyMarkdownFolderImportToViewState(
        current,
        plan.notebook,
        plan.pages,
        [],
        activePageId,
        importedExpandedPageIds,
        importOperation,
        true
      ));
      reconcileNotebookTree(persistedTree);

      const blockCountRef = { current: 0 };
      const documentWarnings: string[] = [];
      let processedDocuments = 0;
      await mapWithConcurrency(plan.parsedDocuments, folderImportConcurrency, async (document) => {
        const embeddedBody = await embedImportedAssetMarkdown(document.body, document.relativePath, assetFiles, resolveImportedFolderAsset);
        const pageBlocks = await createBlocksForMarkdownFolderDocument({ ...document, body: embeddedBody }, plan.pageLinks);
        documentWarnings.push(...pageBlocks.warnings.map((warning) => `${warning.filename}: ${warning.sourcePath} (${warning.message})`));
        const page = plan.pages.find((candidate) => candidate.id === document.pageId);
        if (!page) return;
        const nextPage = {
          ...page,
          blockIds: pageBlocks.blocks.map((block) => block.id),
          updatedAt: new Date().toISOString()
        };
        page.blockIds = nextPage.blockIds;
        page.updatedAt = nextPage.updatedAt;
        blockCountRef.current += pageBlocks.blocks.length;
        await persistPageDocument({ page: nextPage, blocks: pageBlocks.blocks, operation: null });
        setState((current) => applyMarkdownFolderPageDocumentToViewState(current, nextPage, pageBlocks.blocks, isTauri()));
        processedDocuments += 1;
        if (processedDocuments === plan.parsedDocuments.length || processedDocuments % 10 === 0) {
          setImportNotice({
            kind: 'loading',
            message: `Importing folder "${rootName}"... ${processedDocuments}/${plan.parsedDocuments.length} pages, ${blockCountRef.current} blocks`
          });
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      });
      const warningDetails = [...assetWarnings, ...documentWarnings].slice(0, 4);
      const warningCount = assetWarnings.length + documentWarnings.length;
      setImportNotice({
        kind: warningCount ? 'warning' : 'success',
        message: warningCount
          ? `Imported folder "${rootName}" with ${plan.pages.length} page${plan.pages.length > 1 ? 's' : ''}, but ${warningCount} local asset${warningCount > 1 ? 's' : ''} could not be copied.`
          : `Imported folder "${rootName}" with ${plan.pages.length} page${plan.pages.length > 1 ? 's' : ''} and ${blockCountRef.current} block${blockCountRef.current > 1 ? 's' : ''}.`,
        details: warningDetails
      });
    } catch (error) {
      setImportNotice({
        kind: 'error',
        message: 'Markdown folder import failed.',
        details: [error instanceof Error ? error.message : String(error)]
      });
    }
  };

  const openPinnedWindow = async (blockId: string) => {
    if (!isTauri()) {
      setState((current) => applyOpenCardBlockToViewState(current, blockId));
      return;
    }

    const label = `card_${blockId.replace(/[^a-zA-Z0-9_:-]/g, '_')}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await configurePinnedCardWindow(existing);
      return;
    }
    const cardParams = new URLSearchParams({ card: blockId });
    if (!roundPinnedCards) cardParams.set('roundPinnedCards', '0');
    cardParams.set('glowPinnedCards', glowPinnedCards ? '1' : '0');
    const cardWindow = new WebviewWindow(label, {
      url: `${window.location.pathname}?${cardParams.toString()}`,
      title: 'Notebook card',
      width: 340,
      height: 220,
      minWidth: 240,
      minHeight: 140,
      decorations: false,
      transparent: true,
      shadow: false,
      alwaysOnTop: true,
      visibleOnAllWorkspaces: true,
      skipTaskbar: true,
      resizable: true,
      visible: true,
      focus: true,
      center: false
    });
    void cardWindow.once('tauri://created', () => {
      void configurePinnedCardWindow(cardWindow);
    });
    void cardWindow.once('tauri://error', (event) => {
      console.warn('Could not create pinned card window.', event.payload);
    });
    window.setTimeout(() => {
      void configurePinnedCardWindow(cardWindow);
    }, 250);
  };

  const renderPageTree = (parentId: string | null = null, depth = 0): React.ReactNode =>
    (childPages.get(parentId) ?? []).map((page) => {
      const hasChildren = Boolean(childPages.get(page.id)?.length);
      const expanded = state.expandedPageIds.includes(page.id);
      const selected = selectedPageId === page.id;
      const active = page.id === activePage.id;
      const editing = editingPageId === page.id;
      const pageEmoji = page.metadata.emoji;
      return (
        <div className="page-tree-row" key={page.id} style={{ '--depth': depth } as React.CSSProperties}>
          <div
            className={`page-row-shell ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
            data-page-id={page.id}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const draggedId = event.dataTransfer.getData('application/page-id');
              if (draggedId && draggedId !== page.id) movePageUnder(draggedId, page.id);
            }}
          >
            {editing ? (
              <div className={`page-button page-editing ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}>
                <span
                  className="page-disclosure"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (hasChildren) togglePageExpanded(page.id);
                  }}
                >
                  {hasChildren ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}
                </span>
                <input {...pageRenameInputProps(page)} />
              </div>
            ) : (
              <button
                className={`page-button ${pageEmoji ? 'has-node-icon' : ''} ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
                draggable
                onDragStart={(event) => {
                  setSelectedPageId(page.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/page-id', page.id);
                }}
                onKeyDown={(event) => {
                  if (handlePageKeyboard(event, page)) return;
                }}
                onFocus={() => setSelectedPageId(page.id)}
                onClick={() => selectPage(page.id)}
                onDoubleClick={() => beginPageRename(page)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  selectPage(page.id);
                  const row = event.currentTarget.closest<HTMLElement>('.page-row-shell[data-page-id]');
                  openPageContextMenu(page.id, (row ?? event.currentTarget).getBoundingClientRect());
                }}
                type="button"
              >
                <span
                  className="page-disclosure"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (hasChildren) togglePageExpanded(page.id);
                  }}
                >
                  {hasChildren ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}
                </span>
                {pageEmoji ? <EmojiImage emoji={pageEmoji} className="node-emoji" decorative /> : null}
                <span>{page.title}</span>
              </button>
            )}
            <div className="row-actions page-row-actions">
              <button className="mini-button row-action duplicate-page-button" type="button" draggable={false} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedPageId(page.id); void duplicatePageTree(page.id); }} aria-label={`Duplicate page ${page.title}`}><Copy size={13} /></button>
              <button className="mini-button row-action delete-page-button" type="button" draggable={false} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedPageId(page.id); deletePageTree(page.id); }} aria-label={`Delete page ${page.title}`}><Trash2 size={13} /></button>
            </div>
          </div>
          {hasChildren && expanded && <div className="page-tree-children">{renderPageTree(page.id, depth + 1)}</div>}
        </div>
      );
    });

  const renderTyporaFileTree = (parentId: string | null = null, depth = 0): React.ReactNode =>
    (childPages.get(parentId) ?? []).map((page) => {
      const hasChildren = Boolean(childPages.get(page.id)?.length);
      const expanded = state.expandedPageIds.includes(page.id);
      const selected = selectedPageId === page.id;
      const active = page.id === activePage.id;
      const editing = editingPageId === page.id;
      const pageEmoji = page.metadata.emoji;
      return (
        <div
          className="file-library-node"
          data-is-directory={hasChildren ? 'true' : 'false'}
          key={page.id}
          style={{ '--depth': depth } as React.CSSProperties}
        >
          <span className="file-node-background" aria-hidden="true" />
          <div
            className={`file-node-row-shell ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
            data-page-id={page.id}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const draggedId = event.dataTransfer.getData('application/page-id');
              if (draggedId && draggedId !== page.id) movePageUnder(draggedId, page.id);
            }}
          >
            {editing ? (
              <div className={`file-node-content page-editing ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}>
                <span
                  className="file-node-open-state"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (hasChildren) togglePageExpanded(page.id);
                  }}
                >
                  {hasChildren ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}
                </span>
                <input {...pageRenameInputProps(page)} />
              </div>
            ) : (
              <button
                className={`file-node-content ${pageEmoji ? 'has-node-icon' : ''} ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
                draggable
                onDragStart={(event) => {
                  setSelectedPageId(page.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/page-id', page.id);
                }}
                onKeyDown={(event) => {
                  if (handlePageKeyboard(event, page)) return;
                }}
                onFocus={() => setSelectedPageId(page.id)}
                onClick={() => selectPage(page.id)}
                onDoubleClick={() => beginPageRename(page)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  selectPage(page.id);
                  const row = event.currentTarget.closest<HTMLElement>('.file-node-row-shell[data-page-id]');
                  openPageContextMenu(page.id, (row ?? event.currentTarget).getBoundingClientRect());
                }}
                type="button"
              >
                <span
                  className="file-node-open-state"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (hasChildren) togglePageExpanded(page.id);
                  }}
                >
                  {hasChildren ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}
                </span>
                {pageEmoji ? <EmojiImage emoji={pageEmoji} className="node-emoji" decorative /> : null}
                <span className="file-node-title file-name">{page.title}</span>
              </button>
            )}
            <div className="row-actions file-node-actions">
              <button className="mini-button row-action duplicate-page-button" type="button" draggable={false} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedPageId(page.id); void duplicatePageTree(page.id); }} aria-label={`Duplicate page ${page.title}`}><Copy size={13} /></button>
              <button className="mini-button row-action delete-page-button" type="button" draggable={false} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedPageId(page.id); deletePageTree(page.id); }} aria-label={`Delete page ${page.title}`}><Trash2 size={13} /></button>
            </div>
          </div>
          {hasChildren && expanded && <div className="file-node-children">{renderTyporaFileTree(page.id, depth + 1)}</div>}
        </div>
      );
    });

  const renderWorkspaceContent = () => (
    <WorkspaceContent
      importNotice={importNotice}
      workspaceView={workspaceView}
      writeSurface={{
        activePage,
        temporaryMarkdownPage: temporaryMarkdownPages.find((item) => item.id === activePage.id) ?? null,
        metadataFields,
        metadataFieldOptions,
        showMetadata: state.showPageMetadata,
        blockOrder: pageBlockOrder,
        blocks: visibleBlocks,
        draggingBlockId,
        contentTheme: state.contentTheme,
        showBlockDividers,
        showBlockBorders,
        composer: {
          activeEditor,
          draftKey: activePage.id,
          draft: activeDraft,
          showToolbar,
          showFooter: showComposerFooter,
          tableControls,
          mathEditor,
          toolbarActions: {
            runCommand: runEditorCommand,
            insertTodo,
            applyHighlight,
            applyInlineCode
          },
          onEditorRef: (editor) => { composerEditorRef.current = editor; },
          onFocus: (editor) => {
            activateEditor({ kind: 'composer' });
            syncFloatingControls(editor);
          },
          onSelectionUpdate: syncFloatingControls,
          onRunTableCommand: runEditorCommand,
          onMediaResizeStart: startMediaResize,
          onImageAnnotate: setImageAnnotationRequest,
          onMathChange: updateMathEditorLatex,
          onMathClose: () => setMathEditor(null),
          onDraftChange: (html) => setComposerDraftForPage(activePage.id, html),
          onCommitDraft: commitDraft
        },
        activeEditor,
        showToolbar,
        tableControls,
        mathEditor,
        toolbarActions: {
          runCommand: runEditorCommand,
          insertTodo,
          applyHighlight,
          applyInlineCode
        },
        onSaveTemporaryMarkdownPage: saveTemporaryMarkdownPage,
        onRenamePage: renamePage,
        onUpdateMetadataField: updateActivePageMetadataField,
        onUpdateMetadataFieldType: updateActivePageMetadataFieldType,
        onAddMetadataField: addActivePageMetadataField,
        onDraggingBlockIdChange: setDraggingBlockId,
        onReorderBlock: reorderBlock,
        onToggleBlock: toggleBlock,
        onBlockEditorRef: (blockId, editor) => { blockEditorRefs.current[blockId] = editor; },
        onBlockFocus: (blockId, editor) => {
          activateEditor({ kind: 'block', blockId });
          syncFloatingControls(editor);
        },
        onSelectionUpdate: syncFloatingControls,
        onRunTableCommand: runEditorCommand,
        onMediaResizeStart: startMediaResize,
        onImageAnnotate: setImageAnnotationRequest,
        onMathChange: updateMathEditorLatex,
        onMathClose: () => setMathEditor(null),
        onMoveBlock: (blockId, direction) => {
          return moveBlockByKeyboard(blockId, direction);
        },
        onDeleteBlock: (blockId) => {
          void deleteBlockWithTrash(blockId);
          return true;
        },
        onUpdateBlock: updateBlock
      }}
      calendar={{
        calendarMonth,
        calendarDays,
        entriesByDate: calendarEntriesByDate,
        pageEntries: pageCalendarEntries,
        pageConfig: activeNotebookCalendarConfig,
        pageDateOptions: pageCalendarDateOptions,
        pageFieldOptions: pageCalendarFieldOptions,
        title: activeNotebookCalendarConfig ? activeNotebook.name : 'Blocks by day',
        mode: activeNotebookCalendarConfig ? 'pages' : 'blocks',
        onMoveMonth: moveCalendarMonth,
        onJumpToBlock: jumpToBlock,
        onOpenPage: selectPage,
        onCreatePageForDate: addCalendarPage,
        onPageDateSourcesChange: setPageCalendarDateSources,
        onPageVisibleFieldsChange: setPageCalendarVisibleFields,
        onPageColorFieldChange: setPageCalendarColorField,
        onShowWrite: () => setWorkspaceView('write')
      }}
    />
  );

  const selectNotebook = (notebook: Notebook) => {
    saveCurrentComposerDraft();
    setWorkspaceView(notebook.metadata.calendarView?.enabled ? 'calendar' : 'write');
    setState((current) => applyActiveNotebookToViewState(current, notebook.id, notebook.pageIds[0] ?? null));
  };

  const selectSearchResult = (pageId: string) => {
    const page = state.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    saveCurrentComposerDraft();
    setQuery('');
    setSelectedPageId(pageId);
    setWorkspaceView('write');
    setState((current) => applyPageNavigationToViewState(current, pageId));
  };

  const notebookActions = {
    addNotebook,
    selectNotebook,
    renameNotebook,
    duplicateNotebook,
    deleteNotebook,
    openNotebookEmojiMenu: (notebookId: string, x: number, y: number) => openEmojiContextMenu({ kind: 'notebook', notebookId }, x, y)
  };

  if (cardModeBlock) {
    const closeCardWindow = () => {
      if (isTauri()) {
        void getCurrentWindow().close();
        return;
      }
      setState((current) => applyOpenCardBlockToViewState(current, null));
    };
    const dragCardWindow = (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select, audio, video, .floating-card-body')) return;
      if (isTauri()) void getCurrentWindow().startDragging();
    };
    return (
      <>
      <CardWindowPage
        block={cardModeBlock}
        shell={state.shell}
        contentTheme={state.contentTheme}
        roundPinnedCards={roundPinnedCards}
        glowPinnedCards={glowPinnedCards}
        editorRef={(editor) => { blockEditorRefs.current[cardModeBlock.id] = editor; }}
        onFocus={(editor) => {
          activateEditor({ kind: 'block', blockId: cardModeBlock.id });
          syncFloatingControls(editor);
        }}
        onSelectionUpdate={syncFloatingControls}
        onUpdate={(html, plainText) => updateCardBlock(cardModeBlock.id, html, plainText)}
        onBlur={(html, plainText) => updateCardBlock(cardModeBlock.id, html, plainText)}
        onMediaResizeStart={startMediaResize}
        onImageAnnotate={setImageAnnotationRequest}
        onClose={closeCardWindow}
        onDrag={dragCardWindow}
      />
      <ImageAnnotationEditor request={imageAnnotationRequest} onSave={saveImageAnnotations} onClose={() => setImageAnnotationRequest(null)} />
      </>
    );
  }

  if (cardModeBlockId) {
    return (
      <main className={`card-window-page typora-theme ${roundPinnedCards ? 'is-rounded' : 'is-square'}`} data-content-theme={state.contentTheme} data-shell={state.shell}>
        <div className="floating-card-body card-mode" />
      </main>
    );
  }

  const shellControls = {
    showToolbar,
    showComposerFooter,
    showBlockBorders,
    showPageMetadata: state.showPageMetadata,
    roundPinnedCards,
    glowPinnedCards,
    newestFirst: pageBlockOrder === 'desc',
    shell: state.shell,
    contentTheme: state.contentTheme,
    shellThemes,
    markdownInputRef,
    markdownFolderInputRef,
    outlineOpen: outlineDrawerOpen,
    sidebarCollapsed,
    onShowToolbarChange: setShowToolbar,
    onShowComposerFooterChange: setShowComposerFooter,
    onShowBlockBordersChange: setShowBlockBorders,
    onShowPageMetadataChange: (show: boolean) => setState((current) => applyShowPageMetadataToViewState(current, show)),
    onRoundPinnedCardsChange: setRoundPinnedCards,
    onGlowPinnedCardsChange: setGlowPinnedCards,
    onNewestFirstChange: (newestFirst: boolean) => setPageBlockOrder(newestFirst ? 'desc' : 'asc'),
    onShellChange: setShell,
    onContentThemeChange: setContentTheme,
    onOutlineToggle: () => setOutlineDrawerOpen((open) => !open),
    onSidebarToggle: () => setSidebarCollapsed((collapsed) => !collapsed),
    onMarkdownFilesChange: (files: FileList | null) => void importMarkdownFiles(files),
    onMarkdownFolderChange: (files: FileList | null) => void importMarkdownFolder(files),
    onExportMarkdown: exportMarkdown,
    onExportJson: exportJson,
    onRestorePageVersion: () => void restorePreviousPageVersion(),
    trashItems,
    onRestoreTrashItem: (trashId: number) => void restoreTrashItemById(trashId),
    onEmptyTrash: () => void emptyTrashItems(),
    trashBusy
  };

  const isTyporaShell = state.shell.startsWith('typora-');
  const pageTree = isTyporaShell ? null : renderPageTree(null);
  const typoraFileTree = isTyporaShell ? renderTyporaFileTree(null) : null;
  const workspaceContent = renderWorkspaceContent();

  const sharedShellProps = {
    shell: state.shell,
    contentTheme: state.contentTheme,
    sidebarCollapsed,
    outlineOpen: outlineDrawerOpen,
    sidebarView: typoraSidebarView,
    activeNotebook,
    notebooks: state.notebooks,
    notebookActions,
    query,
    onQueryChange: setQuery,
    searchResults,
    searchLoading,
    onSearchResultSelect: selectSearchResult,
    pageTree,
    typoraFileTree,
    pageThumbnails,
    hasMorePageThumbnails,
    workspaceContent,
    pinnedBlocks,
    openCardBlock,
    roundPinnedCards,
    glowPinnedCards,
    onOpenPinnedWindow: (blockId: string) => void openPinnedWindow(blockId),
    onCloseFloatingCard: () => setState((current) => applyOpenCardBlockToViewState(current, null)),
    onSelectPage: (pageId: string) => selectPage(pageId),
    onSidebarViewChange: setTyporaSidebarView,
    onLoadMorePageThumbnails: loadMorePageThumbnails,
    onRootPageDrop: (pageId: string) => {
      setSelectedPageId(pageId);
      movePageUnder(pageId, null);
    },
    onAddPage: () => addPage(null),
    controls: shellControls,
    outlineEntries,
    onJumpToOutlineEntry: jumpToOutlineEntry,
    fishIconUrl
  };

  let emojiContextMenuHasEmoji = false;
  let notebookCalendarMenu: {
    notebook: Notebook;
    config: NotebookCalendarViewConfig | undefined;
    dateOptions: CalendarDateOption[];
    visibleFieldOptions: string[];
  } | null = null;
  if (emojiContextMenu) {
    const target = emojiContextMenu.target;
    emojiContextMenuHasEmoji = Boolean(target.kind === 'notebook'
      ? state.notebooks.find((notebook) => notebook.id === target.notebookId)?.metadata.emoji
      : state.pages.find((page) => page.id === target.pageId)?.metadata.emoji);
    if (target.kind === 'notebook') {
      const notebook = state.notebooks.find((candidate) => candidate.id === target.notebookId);
      if (notebook) {
        const pages = state.pages.filter((page) => page.notebookId === notebook.id);
        const configuredSource = notebook.metadata.calendarView?.dateSource;
        const dateOptions = calendarDateCandidatesForPages(pages);
        if (!dateOptions.some((option) => option.key === 'createdAt')) {
          dateOptions.unshift({ key: 'createdAt', label: 'Created at', count: pages.length });
        }
        if (configuredSource && !dateOptions.some((option) => option.key === configuredSource)) {
          dateOptions.push({ key: configuredSource, label: configuredSource, count: 0 });
        }
        notebookCalendarMenu = {
          notebook,
          config: notebook.metadata.calendarView,
          dateOptions,
          visibleFieldOptions: visibleCalendarFieldsForPages(pages, 12)
        };
      }
    }
  }

  return (
    <>
      {isTyporaShell ? <TyporaShell {...sharedShellProps} /> : <NativeShell {...sharedShellProps} />}
      {pageFindOpen ? (
        <div ref={pageFindPopoverRef} className="page-find-popover" role="search" aria-label="Search current page">
          <input
            ref={pageFindInputRef}
            value={pageFindQuery}
            onChange={(event) => setPageFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'ArrowDown') {
                event.preventDefault();
                movePageFind(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                movePageFind(-1);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setPageFindOpen(false);
              }
            }}
            placeholder="Search this page"
          />
          <span className="page-find-count">
            {pageFindQuery.trim() ? `${pageFindMatches.length ? pageFindIndex + 1 : 0}/${pageFindMatches.length}` : '0/0'}
          </span>
          <div className="page-find-preview">{pageFindQuery.trim() ? pageFindMatches[pageFindIndex]?.preview ?? '' : ''}</div>
        </div>
      ) : null}
      {emojiContextMenu ? (
        <div
          className="emoji-context-menu"
          style={{ left: emojiContextMenu.x, top: emojiContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setEmojiPickerRequest({ target: emojiContextMenu.target });
              closeEmojiContextMenu();
            }}
          >
            Set emoji
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!emojiContextMenuHasEmoji}
            onClick={() => {
              const target = emojiContextMenu.target;
              if (target.kind === 'notebook') setNotebookEmoji(target.notebookId, null);
              else setPageEmoji(target.pageId, null);
              closeEmojiContextMenu();
            }}
          >
            Clear emoji
          </button>
          {notebookCalendarMenu ? (
            <>
              <div className="context-menu-divider" role="separator" />
              <div className="context-menu-section-label">Calendar</div>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={Boolean(notebookCalendarMenu.config?.enabled)}
                onClick={() => {
                  const { notebook } = notebookCalendarMenu;
                  updateNotebookCalendarView(notebook.id, (config, pages) => (
                    config?.enabled
                      ? undefined
                      : defaultCalendarConfigForPages(pages)
                  ));
                  closeEmojiContextMenu();
                  if (!notebookCalendarMenu.config?.enabled && activeNotebook.id === notebook.id) {
                    setWorkspaceView('calendar');
                  }
                }}
              >
                {notebookCalendarMenu.config?.enabled ? '✓ Calendar view' : 'Calendar view'}
              </button>
              {notebookCalendarMenu.config?.enabled ? (
                <>
                  <div className="context-menu-section-label">Date field</div>
                  {notebookCalendarMenu.dateOptions.map((option) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={notebookCalendarMenu.config?.dateSource === option.key}
                      key={option.key}
                      onClick={() => {
                        const { notebook } = notebookCalendarMenu;
                        updateNotebookCalendarView(notebook.id, (config, pages) => ({
                          ...(config ?? defaultCalendarConfigForPages(pages)),
                          enabled: true,
                          dateSource: option.key,
                          dateSources: [option.key]
                        }));
                        closeEmojiContextMenu();
                        if (activeNotebook.id === notebook.id) setWorkspaceView('calendar');
                      }}
                    >
                      {notebookCalendarMenu.config?.dateSource === option.key ? '✓ ' : ''}{option.label}
                      {option.count ? ` (${option.count})` : ''}
                    </button>
                  ))}
                  {notebookCalendarMenu.visibleFieldOptions.length ? (
                    <>
                      <div className="context-menu-section-label">Show fields</div>
                      {notebookCalendarMenu.visibleFieldOptions.map((field) => {
                        const visible = notebookCalendarMenu.config?.visibleFields.includes(field) ?? false;
                        return (
                          <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={visible}
                            key={field}
                            onClick={() => {
                              const { notebook } = notebookCalendarMenu;
                              updateNotebookCalendarView(notebook.id, (config, pages) => {
                                const base = config ?? defaultCalendarConfigForPages(pages);
                                const nextFields = visible
                                  ? base.visibleFields.filter((candidate) => candidate !== field)
                                  : [...base.visibleFields, field];
                                return {
                                  ...base,
                                  enabled: true,
                                  visibleFields: nextFields,
                                  colorField: base.colorField && nextFields.includes(base.colorField)
                                    ? base.colorField
                                    : nextFields[0]
                                };
                              });
                            }}
                          >
                            {visible ? '✓ ' : ''}{field}
                          </button>
                        );
                      })}
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {pageContextMenu ? (() => {
        const page = state.pages.find((candidate) => candidate.id === pageContextMenu.pageId) ?? null;
        const notebookTargets: Array<{ notebookId: string; parentId: string | null; label: string }> = state.notebooks.map((notebook) => ({
          notebookId: notebook.id,
          parentId: null,
          label: `${notebook.name} / Root`
        }));
        const targets = [...notebookTargets, ...pageMoveTargets].filter((target, index, list) =>
          list.findIndex((candidate) => candidate.notebookId === target.notebookId && candidate.parentId === target.parentId) === index
        );
        const focusMoveTarget = (index: number) => {
          const nextIndex = Math.max(0, Math.min(index, Math.max(targets.length - 1, 0)));
          setPageMoveIndex(nextIndex);
          window.setTimeout(() => {
            const element = document.querySelector<HTMLButtonElement>(`.page-move-item[data-move-index="${nextIndex}"]`);
            element?.focus();
            element?.scrollIntoView({ block: 'nearest' });
          }, 0);
        };
        return (
          <div
            className="emoji-context-menu page-context-menu"
            style={{ left: pageContextMenu.x, top: pageContextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            role="menu"
          >
            <div className="page-move-header">
              <button
                type="button"
                className="page-move-emoji-button"
                title="Set emoji"
                aria-label="Set emoji"
                onClick={() => {
                  setEmojiPickerRequest({ target: { kind: 'page', pageId: pageContextMenu.pageId } });
                  closePageContextMenu();
                }}
              >
                <EmojiImage emoji={page?.metadata.emoji ?? '🙂'} className="page-move-emoji" decorative />
              </button>
              <div className="page-move-header-copy">
                <strong>Move page</strong>
                <span>{page?.title ?? 'Page'}</span>
              </div>
            </div>
            <input
              className="page-move-search"
              value={pageMoveQuery}
              onChange={(event) => setPageMoveQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  if (targets.length) focusMoveTarget(pageMoveIndex + 1);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (targets.length) focusMoveTarget(pageMoveIndex - 1);
                }
              }}
              placeholder="Search page or notebook"
              autoFocus
            />
            <div className="page-move-menu">
              {targets.length ? targets.map((target, index) => (
                <button
                  key={`${target.notebookId}:${target.parentId ?? 'root'}`}
                  type="button"
                  data-move-index={index}
                  className={`page-move-item ${index === pageMoveIndex ? 'is-selected' : ''}`}
                  onMouseEnter={() => setPageMoveIndex(index)}
                  onFocus={() => setPageMoveIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      focusMoveTarget(index + 1);
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      focusMoveTarget(index - 1);
                    }
                  }}
                  onClick={() => {
                    movePageToPath(pageContextMenu.pageId, target.notebookId, target.parentId);
                    closePageContextMenu();
                  }}
                >
                  <span className="page-move-label">{target.label}</span>
                </button>
              )) : <div className="page-move-empty">No match</div>}
            </div>
          </div>
        );
      })() : null}
      <ImageAnnotationEditor request={imageAnnotationRequest} onSave={saveImageAnnotations} onClose={() => setImageAnnotationRequest(null)} />
      <EmojiPicker
        request={emojiPickerRequest}
        notebooks={state.notebooks}
        pages={state.pages}
        onClose={() => setEmojiPickerRequest(null)}
        onChoose={(target, emoji) => {
          if (target.kind === 'notebook') setNotebookEmoji(target.notebookId, emoji);
          else setPageEmoji(target.pageId, emoji);
        }}
        onClear={(target) => {
          if (target.kind === 'notebook') setNotebookEmoji(target.notebookId, null);
          else setPageEmoji(target.pageId, null);
        }}
      />
    </>
  );
}
