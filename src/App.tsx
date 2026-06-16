import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Trash2
} from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { AppState, Block, ContentThemeId, Notebook, OperationLogEntry, Page, ShellId } from './types';
import {
  appendOperation,
  createBlock,
  createId,
  createInitialState,
  createNotebookFromMarkdownDocuments,
  createNotebook,
  createPageFromMarkdown,
  createPage,
  downloadTextFile,
  htmlToMarkdown,
  loadDatabaseBootstrap,
  loadBlockDocument,
  loadFullBackupState,
  listCalendarBlocks,
  loadPageDocument,
  loadPageDocuments,
  listPinnedBlocks,
  loadState,
  loadWorkspacePreferences,
  persistEntityRename,
  persistNotebookCreate,
  persistPageCreate,
  persistPageDocument,
  persistPageTreeDelete,
  persistNotebookDelete,
  persistPageMove,
  persistImportBatch,
  saveState,
  saveWorkspacePreferences,
  searchPages,
  type NotebookTreePayload,
  type PageDocumentPayload,
  type PinnedBlockPayload,
  type CalendarBlockPayload,
  type PageSearchResult
} from './state';
import {
  escapeHtml,
  importAttachmentFile,
  inferAttachmentKind,
  runListIndentCommand,
  type MathEditorState,
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
  localDateKey,
  markdownImportFileRegex,
  mediaImportFileRegex,
  monthKey,
  splitImportRoot,
  stripOutlineAnchors,
  type CalendarEntry,
  type ImportNotice,
  type OutlineEntry,
  type WorkspaceView
} from './app-utils';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import 'katex/dist/katex.min.css';
import { CardWindowPage, NativeShell, TyporaShell } from './shells';
import { WorkspaceContent, type EditorTarget } from './workspace';

const shellThemes: Array<{ id: ShellId; label: string }> = [
  { id: 'native-garden', label: 'Native Garden' },
  { id: 'native-ledger', label: 'Native Ledger' },
  { id: 'typora-base', label: 'Typora Base' }
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
const importStressMode = searchParams.has('importStress');
const disableBrowserPersistence = searchParams.get('persistence') === 'off';

type ImportedAsset = {
  id: string;
  storedPath: string;
};

const mergePageDocument = (state: AppState, document: PageDocumentPayload): AppState => {
  const pageIndex = state.pages.findIndex((page) => page.id === document.page.id);
  const nextPageIds = document.content.blocks.map((block) => block.id);
  if (isTauri()) {
    const nextPage = {
      ...(pageIndex < 0 ? document.page : state.pages[pageIndex]),
      ...document.page,
      blockIds: nextPageIds,
      updatedAt: document.page.updatedAt ?? (pageIndex < 0 ? document.page.updatedAt : state.pages[pageIndex].updatedAt)
    };

    return {
      ...state,
      pages: pageIndex < 0
        ? [...state.pages, nextPage]
        : state.pages.map((page) => (page.id === document.page.id ? nextPage : page)),
      blocks: document.content.blocks
    };
  }

  const nextBlocksById = new Map(state.blocks.map((block) => [block.id, block]));
  document.content.blocks.forEach((block) => {
    nextBlocksById.set(block.id, block);
  });

  if (pageIndex < 0) {
    return {
      ...state,
      pages: [...state.pages, { ...document.page, blockIds: nextPageIds }],
      blocks: [...nextBlocksById.values()]
    };
  }

  const nextPage = {
    ...state.pages[pageIndex],
    ...document.page,
    blockIds: nextPageIds,
    updatedAt: document.page.updatedAt ?? state.pages[pageIndex].updatedAt
  };

  return {
    ...state,
    pages: state.pages.map((page) => (page.id === document.page.id ? nextPage : page)),
    blocks: [...nextBlocksById.values()]
  };
};

const blocksForPage = (page: Page, blocks: Block[]) => {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  return page.blockIds.map((blockId) => blocksById.get(blockId)).filter(Boolean) as Block[];
};

const isEditorContentEmpty = (html: string, plainText = '') => {
  if (plainText.trim()) return false;
  const container = document.createElement('div');
  container.innerHTML = html;
  if (container.textContent?.trim()) return false;
  return !container.querySelector('img, video, audio, iframe, table, pre, [data-type="block-math"], [data-type="inline-math"]');
};

const mergeNotebookTree = (state: AppState, tree: NotebookTreePayload): AppState => {
  const notebookIds = new Set(tree.notebooks.map((notebook) => notebook.id));
  const pageIds = new Set(tree.pages.map((page) => page.id));
  const activeNotebookId = notebookIds.has(state.activeNotebookId)
    ? state.activeNotebookId
    : tree.notebooks[0]?.id ?? state.activeNotebookId;
  const activePageId = pageIds.has(state.activePageId)
    ? state.activePageId
    : tree.pages.find((page) => page.notebookId === activeNotebookId)?.id ?? tree.pages[0]?.id ?? state.activePageId;

  return {
    ...state,
    notebooks: tree.notebooks,
    pages: tree.pages,
    activeNotebookId,
    activePageId,
    expandedPageIds: state.expandedPageIds.filter((id) => pageIds.has(id))
  };
};

export function App() {
  const [state, setState] = useState<AppState>(() => (cardModeBlockId && isTauri() ? createInitialState() : loadState()));
  const [draftsByPageId, setDraftsByPageId] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PageSearchResult[]>([]);
  const [pinnedBlockPayloads, setPinnedBlockPayloads] = useState<PinnedBlockPayload[]>([]);
  const [calendarBlockPayloads, setCalendarBlockPayloads] = useState<CalendarBlockPayload[]>([]);
  const [cardDocument, setCardDocument] = useState<PageDocumentPayload | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeEditor, setActiveEditor] = useState<EditorTarget>({ kind: 'composer' });
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [tableControls, setTableControls] = useState<TableControlsState>({ visible: false, top: 0, left: 0 });
  const [mathEditor, setMathEditor] = useState<MathEditorState | null>(null);
  const [showComposerFooter, setShowComposerFooter] = useState(true);
  const [showBlockBorders, setShowBlockBorders] = useState(false);
  const [roundPinnedCards, setRoundPinnedCards] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copiedPageId, setCopiedPageId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageDraftName, setPageDraftName] = useState('');
  const [outlineDrawerOpen, setOutlineDrawerOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('write');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [importNotice, setImportNotice] = useState<ImportNotice>({ kind: 'idle', message: '' });
  const composerEditorRef = useRef<Editor | null>(null);
  const blockEditorRefs = useRef<Record<string, Editor | null>>({});
  const pageNameInputRef = useRef<HTMLInputElement | null>(null);
  const cancelPageBlurCommitRef = useRef(false);
  const draftsByPageIdRef = useRef(draftsByPageId);
  const persistenceReadyRef = useRef(!isTauri());
  const markdownInputRef = useRef<HTMLInputElement | null>(null);
  const markdownFolderInputRef = useRef<HTMLInputElement | null>(null);
  const stateRef = useRef(state);
  const activePageDocumentRequestRef = useRef(0);
  const cardDocumentRequestRef = useRef(0);
  const pageDocumentSaveTimersRef = useRef<Record<string, number>>({});
  const workspacePreferencesSaveTimerRef = useRef<number | null>(null);
  const lastSavedWorkspacePreferencesRef = useRef('');

  const workspacePreferences = useMemo(() => ({
    activeNotebookId: state.activeNotebookId,
    activePageId: state.activePageId,
    shell: state.shell,
    theme: state.theme,
    contentTheme: state.contentTheme,
    openCardWindowBlockId: state.openCardWindowBlockId,
    expandedPageIds: state.expandedPageIds
  }), [
    state.activeNotebookId,
    state.activePageId,
    state.shell,
    state.theme,
    state.contentTheme,
    state.openCardWindowBlockId,
    state.expandedPageIds
  ]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    draftsByPageIdRef.current = draftsByPageId;
  }, [draftsByPageId]);

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
    const existingTimer = pageDocumentSaveTimersRef.current[page.id];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      delete pageDocumentSaveTimersRef.current[page.id];
    }
    await persistPageDocument({ page, blocks: blocksForPage(page, blocks), operation: null });
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
            contentTheme: preferences?.contentTheme ?? fallbackState.contentTheme
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
        expandedPageIds: [...new Set([...(preferences?.expandedPageIds ?? fallbackState.expandedPageIds), preferences?.activePageId ?? bootstrap.activePageId].filter(Boolean))]
      };
      let activeDocument: PageDocumentPayload | null = null;
      try {
        activeDocument = initialState.activePageId ? await loadPageDocument(initialState.activePageId) : null;
      } catch (error) {
        console.warn('Could not load active page document from SQLite.', error);
      }
      if (cancelled) return;
      setState(activeDocument ? mergePageDocument(initialState, activeDocument) : initialState);
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

  const activeNotebook = state.notebooks.find((notebook) => notebook.id === state.activeNotebookId) ?? state.notebooks[0];
  const activePage = state.pages.find((page) => page.id === state.activePageId) ?? state.pages[0];
  const activeDraft = draftsByPageId[activePage.id] ?? '';
  const pageBlocks = useMemo(
    () => activePage.blockIds.map((blockId) => state.blocks.find((block) => block.id === blockId)).filter(Boolean) as Block[],
    [activePage.blockIds, state.blocks]
  );
  const pageBlockOrder = activePage.blockOrder === 'desc' ? 'desc' : 'asc';
  const orderedPageBlocks = useMemo(
    () => pageBlockOrder === 'desc' ? [...pageBlocks].reverse() : pageBlocks,
    [pageBlockOrder, pageBlocks]
  );

  useEffect(() => {
    let cancelled = false;
    if (!isTauri() || cardModeBlockId || !activePage?.id || !persistenceReadyRef.current) return;
    const requestId = activePageDocumentRequestRef.current + 1;
    activePageDocumentRequestRef.current = requestId;
    loadPageDocument(activePage.id).then((document) => {
      if (cancelled || activePageDocumentRequestRef.current !== requestId || !document) return;
      setState((current) => current.activePageId === document.page.id ? mergePageDocument(current, document) : current);
    }).catch((error) => {
      console.warn('Could not load active page document.', error);
    });
    return () => {
      cancelled = true;
    };
  }, [activePage?.id]);

  const outlineEntries = useMemo(() => extractOutlineEntries(activePage, orderedPageBlocks), [activePage, orderedPageBlocks]);
  const calendarMonthKey = monthKey(calendarMonth);
  const calendarEntriesByDate = useMemo(() => {
    if (workspaceView !== 'calendar') return new Map<string, CalendarEntry[]>();
    if (isTauri()) {
      const entries = new Map<string, CalendarEntry[]>();
      calendarBlockPayloads.forEach((entry) => {
        const key = localDateKey(entry.block.createdAt);
        if (!key) return;
        entries.set(key, [...(entries.get(key) ?? []), entry]);
      });
      return entries;
    }
    const pagesById = new Map(state.pages.filter((page) => page.notebookId === activeNotebook.id).map((page) => [page.id, page]));
    const entries = new Map<string, CalendarEntry[]>();
    state.blocks.forEach((block) => {
      const page = pagesById.get(block.pageId);
      if (!page) return;
      const key = localDateKey(block.createdAt);
      if (!key) return;
      entries.set(key, [...(entries.get(key) ?? []), { block, page }]);
    });
    return entries;
  }, [activeNotebook.id, calendarBlockPayloads, state.blocks, state.pages, workspaceView]);
  const calendarDays = useMemo(() => calendarDaysForMonth(calendarMonth), [calendarMonth]);
  const pinnedBlocks = useMemo(
    () => isTauri() ? pinnedBlockPayloads.map(({ block }) => block) : state.blocks.filter((block) => block.pinned),
    [pinnedBlockPayloads, state.blocks]
  );
  const openCardBlock = isTauri() ? null : state.blocks.find((block) => block.id === state.openCardWindowBlockId) ?? null;
  const cardModeBlock = cardDocument?.content.blocks.find((block) => block.id === cardModeBlockId)
    ?? (isTauri() ? null : state.blocks.find((block) => block.id === cardModeBlockId))
    ?? null;
  const visibleBlocks = query.trim()
    ? orderedPageBlocks.filter((block) => block.content.plainText.toLowerCase().includes(query.trim().toLowerCase()))
    : orderedPageBlocks;
  const showBlockDividers = state.shell === 'typora-base';
  const metadataChips = [
    activePage.metadata?.date,
    activePage.metadata?.status,
    ...(activePage.metadata?.tags ?? []).map((tag) => `#${tag}`),
    ...(activePage.metadata?.aliases ?? [])
  ].filter(Boolean) as string[];

  useEffect(() => {
    let cancelled = false;
    if (!isTauri() || workspaceView !== 'calendar' || !activeNotebook?.id) {
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
  }, [activeNotebook?.id, calendarMonthKey, workspaceView]);

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

  const setShell = (shell: ShellId) => {
    setState((current) => ({
      ...current,
      shell,
      theme: shell === 'native-ledger' ? 'ledger' : shell === 'native-garden' ? 'garden' : current.theme
    }));
  };

  const setContentTheme = (contentTheme: ContentThemeId) => {
    setState((current) => ({
      ...current,
      contentTheme,
      shell: contentTheme.startsWith('typora-') ? 'typora-base' : current.shell
    }));
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
    state.pages
      .filter((page) => page.notebookId === activeNotebook.id)
      .forEach((page) => {
        const key = page.parentId ?? null;
        map.set(key, [...(map.get(key) ?? []), page]);
      });
    return map;
  }, [activeNotebook.id, state.pages]);

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

  const jumpToOutlineEntry = (entry: OutlineEntry) => {
    setWorkspaceView('write');
    setOutlineDrawerOpen(false);
    if (!entry.blockId) {
      document.querySelector<HTMLInputElement>('.page-title')?.focus();
      document.querySelector('.page-surface')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const blockElement = document.getElementById(entry.blockId);
    if (!blockElement) return;
    const target = blockElement.querySelector(`[data-outline-id="${entry.id}"]`) ?? blockElement;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const jumpToBlock = (pageId: string, blockId: string) => {
    saveCurrentComposerDraft();
    setWorkspaceView('write');
    setState((current) => ({ ...current, activePageId: pageId }));
    window.requestAnimationFrame(() => {
      const blockElement = document.getElementById(blockId);
      blockElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const moveCalendarMonth = (delta: number) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const moveBlockByKeyboard = (blockId: string, direction: -1 | 1) => {
    const index = blockIndex(blockId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= activePage.blockIds.length) return;
    const nextIds = [...activePage.blockIds];
    [nextIds[index], nextIds[targetIndex]] = [nextIds[targetIndex], nextIds[index]];
    const updatedAt = new Date().toISOString();
    const nextPage = { ...activePage, blockIds: nextIds, updatedAt };
    const operation = createOperation({ entity: 'page', entityId: activePage.id, kind: 'page.keyboard_move_block', payload: { blockIds: nextIds } });
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === activePage.id ? nextPage : page)),
      operations: [...current.operations, operation]
    }));
    persistPageDocumentSnapshot(nextPage, state.blocks, operation);
  };

  const commitDraft = () => {
    const editor = composerEditorRef.current;
    const html = (editor?.getHTML() ?? activeDraft).trim();
    const plainText = (editor?.getText() ?? '').trim();
    if (isEditorContentEmpty(html, plainText)) return;

    const block = createBlock(activePage.id, html, plainText);
    const updatedAt = new Date().toISOString();
    const nextPage = {
      ...activePage,
      blockIds: (activePage.blockOrder === 'desc' ? [block.id, ...activePage.blockIds] : [...activePage.blockIds, block.id]),
      updatedAt
    };
    const nextBlocks = [...state.blocks, block];
    const operation = createOperation({ entity: 'block', entityId: block.id, kind: 'block.create', payload: block });
    setState((current) => ({
      ...current,
      blocks: [...current.blocks, block],
      pages: current.pages.map((page) =>
        page.id === activePage.id
          ? { ...page, blockIds: nextPage.blockIds, updatedAt }
          : page
      ),
      operations: [...current.operations, operation]
    }));
    persistPageDocumentSnapshot(nextPage, nextBlocks, operation);
    setDraftsByPageId((current) => {
      const next = { ...current };
      delete next[activePage.id];
      return next;
    });
    editor?.commands.clearContent();
    editor?.commands.focus();
  };

  const updateBlock = (blockId: string, html: string, plainText: string) => {
    const cleanHtml = stripOutlineAnchors(html);
    const updatedAt = new Date().toISOString();
    const targetBlock = state.blocks.find((block) => block.id === blockId);
    const targetPage = state.pages.find((page) => page.id === targetBlock?.pageId);
    const nextPage = targetPage ? { ...targetPage, updatedAt } : null;
    const nextBlocks = state.blocks.map((block) =>
      block.id === blockId ? { ...block, content: { html: cleanHtml, plainText }, updatedAt } : block
    );
    const operation = createOperation({
      entity: 'block',
      entityId: blockId,
      kind: 'block.update_content',
      payload: { html: cleanHtml, plainText }
    });
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? { ...block, content: { html: cleanHtml, plainText }, updatedAt } : block
      ),
      pages: current.pages.map((page) => (page.blockIds.includes(blockId) ? { ...page, updatedAt } : page)),
      operations: [...current.operations, operation]
    }));
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
    const targetBlock = state.blocks.find((block) => block.id === blockId);
    const targetPage = state.pages.find((page) => page.id === targetBlock?.pageId);
    const nextBlocks = state.blocks.map((block) =>
      block.id === blockId ? { ...block, [key]: !block[key], updatedAt } : block
    );
    const nextBlock = nextBlocks.find((block) => block.id === blockId) ?? null;
    const nextPage = targetPage ? { ...targetPage, updatedAt } : null;
    const operation = createOperation({ entity: 'block', entityId: blockId, kind: `block.toggle_${key}`, payload: { key } });
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? { ...block, [key]: !block[key], updatedAt } : block
      ),
      pages: current.pages.map((page) => (page.blockIds.includes(blockId) ? { ...page, updatedAt } : page)),
      operations: [...current.operations, operation]
    }));
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
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === activePage.id ? { ...page, blockOrder, updatedAt } : page
      ),
      operations: [...current.operations, operation]
    }));
    persistPageDocumentSnapshot(nextPage, state.blocks, operation);
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
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === activePage.id ? nextPage : page)),
      operations: [...current.operations, operation]
    }));
    persistPageDocumentSnapshot(nextPage, state.blocks, operation);
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
    setState((current) => ({
      ...current,
      notebooks: [...current.notebooks, notebookWithPage],
      pages: [...current.pages, page],
      activeNotebookId: notebook.id,
      activePageId: page.id,
      operations: [...current.operations, operation]
    }));
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
    setState((current) => ({
      ...current,
      notebooks: current.notebooks.map((candidate) => (candidate.id === notebookId ? { ...candidate, name: nextName } : candidate)),
      operations: [...current.operations, operation]
    }));
  };

  const persistPageTitle = (pageId: string, title: string) => {
    if (!title.trim()) return null;
    const operation = createOperation({
      entity: 'page',
      entityId: pageId,
      kind: 'page.rename',
      payload: { title }
    });
    persistRename('page', pageId, title, operation);
    return operation;
  };

  const addPage = (parentId: string | null = null) => {
    saveCurrentComposerDraft();
    const page = createPage(state.activeNotebookId, parentId ? 'Nested page' : 'Untitled page', parentId);
    const operation = createOperation({ entity: 'page', entityId: page.id, kind: 'page.create', payload: page });
    void persistPageCreate({ page, operation })
      .then(reconcileNotebookTree)
      .catch((error) => {
        console.warn('Could not persist page create.', error);
      });
    setSelectedPageId(page.id);
    setState((current) => ({
      ...current,
      pages: [...current.pages, page],
      notebooks: current.notebooks.map((notebook) =>
        notebook.id === current.activeNotebookId ? { ...notebook, pageIds: [...notebook.pageIds, page.id] } : notebook
      ),
      activePageId: page.id,
      operations: [...current.operations, operation]
    }));
  };

  const togglePageExpanded = (pageId: string) => {
    setState((current) => ({
      ...current,
      expandedPageIds: current.expandedPageIds.includes(pageId)
        ? current.expandedPageIds.filter((id) => id !== pageId)
        : [...current.expandedPageIds, pageId]
    }));
  };

  const movePageUnder = (pageId: string, parentId: string | null) => {
    if (pageId === parentId) return;
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
      payload: { parentId }
    });
    void persistPageMove({ pageId, parentId, operation })
      .then(reconcileNotebookTree)
      .catch((error) => {
        console.warn('Could not persist page move.', error);
      });
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === pageId ? { ...page, parentId, updatedAt: new Date().toISOString() } : page)),
      expandedPageIds: parentId && !current.expandedPageIds.includes(parentId) ? [...current.expandedPageIds, parentId] : current.expandedPageIds,
      operations: [...current.operations, operation]
    }));
  };

  const selectPage = (pageId: string) => {
    saveCurrentComposerDraft();
    setSelectedPageId(pageId);
    setWorkspaceView('write');
    setState((current) => ({ ...current, activePageId: pageId }));
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

  const descendantsOfPage = (pageId: string, pages: Page[]) => {
    const childrenByParent = new Map<string | null, Page[]>();
    pages.forEach((page) => {
      const key = page.parentId ?? null;
      childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), page]);
    });
    const collected: Page[] = [];
    const visit = (id: string) => {
      (childrenByParent.get(id) ?? []).forEach((child) => {
        collected.push(child);
        visit(child.id);
      });
    };
    visit(pageId);
    return collected;
  };

  const ancestorsOfPage = (pageId: string, pages: Page[]) => {
    const pagesById = new Map(pages.map((page) => [page.id, page]));
    const ancestors: Page[] = [];
    let cursor = pagesById.get(pageId)?.parentId ?? null;
    while (cursor) {
      const parent = pagesById.get(cursor);
      if (!parent) break;
      ancestors.unshift(parent);
      cursor = parent.parentId;
    }
    return ancestors;
  };

  const loadSourceBlocksForPages = async (sourcePages: Page[]) => {
    if (!isTauri()) {
      return new Map(sourcePages.map((page) => [page.id, blocksForPage(page, state.blocks)] as const));
    }

    const documents = await loadPageDocuments(sourcePages.map((page) => page.id));
    const documentsByPageId = new Map(documents.map((document) => [document.page.id, document]));
    return new Map(sourcePages.map((page) => [
      page.id,
      documentsByPageId.get(page.id)?.content.blocks ?? blocksForPage(page, stateRef.current.blocks)
    ] as const));
  };

  const duplicatePageTree = async (pageId: string) => {
    const rootPage = state.pages.find((page) => page.id === pageId);
    const notebook = rootPage ? state.notebooks.find((candidate) => candidate.id === rootPage.notebookId) : null;
    if (!rootPage || !notebook) return;
    const sourcePages = [rootPage, ...descendantsOfPage(pageId, state.pages)];
    if (isTauri() && sourcePages.some((page) => page.id === activePage.id)) {
      try {
        await flushPageDocumentSave(activePage, state.blocks);
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

    setState((current) => ({
      ...current,
      pages: [...current.pages, ...duplicatedPages],
      blocks: [
        ...current.blocks.filter((block) => block.pageId !== duplicatedRootId),
        ...(isTauri() ? duplicatedBlocks.filter((block) => block.pageId === duplicatedRootId) : duplicatedBlocks)
      ],
      notebooks: current.notebooks.map((candidate) => (candidate.id === rootPage.notebookId ? updatedNotebook : candidate)),
      activeNotebookId: rootPage.notebookId,
      activePageId: duplicatedRootId,
      expandedPageIds: [...new Set([...current.expandedPageIds, ...duplicatedPages.map((page) => page.id)])],
      operations: [...current.operations, operation]
    }));
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
      .then(reconcileNotebookTree)
      .catch((error) => {
        console.warn('Could not persist page tree delete.', error);
      });
    setPinnedBlockPayloads((current) => current.filter((payload) => !deletedPageIds.has(payload.page.id)));

    setState((current) => {
      const rootPage = current.pages.find((candidate) => candidate.id === pageId);
      if (!rootPage) return current;
      const currentDeletedPages = [rootPage, ...descendantsOfPage(pageId, current.pages)];
      const currentDeletedPageIds = new Set(currentDeletedPages.map((deletedPage) => deletedPage.id));
      const currentDeletedBlockIds = new Set(currentDeletedPages.flatMap((deletedPage) => deletedPage.blockIds));
      const currentFallbackPage = current.pages.some((candidate) => candidate.notebookId === rootPage.notebookId && !currentDeletedPageIds.has(candidate.id))
        ? null
        : fallbackPage;
      const remainingPages = [
        ...current.pages.filter((candidate) => !currentDeletedPageIds.has(candidate.id)),
        ...(currentFallbackPage ? [currentFallbackPage] : [])
      ];
      const remainingNotebooks = current.notebooks.map((notebook) => ({
        ...notebook,
        pageIds: [
          ...notebook.pageIds.filter((id) => !currentDeletedPageIds.has(id)),
          ...(currentFallbackPage && notebook.id === rootPage.notebookId ? [currentFallbackPage.id] : [])
        ]
      }));
      let activeNotebookId = current.activeNotebookId;
      let activePageId = current.activePageId;
      if (currentDeletedPageIds.has(current.activePageId)) {
        const sameNotebook = remainingPages.find((candidate) => candidate.notebookId === rootPage.notebookId);
        const fallback = sameNotebook ?? remainingPages[0];
        if (fallback) {
          activeNotebookId = fallback.notebookId;
          activePageId = fallback.id;
        }
      }
      return {
        ...current,
        notebooks: remainingNotebooks,
        pages: remainingPages,
        blocks: current.blocks.filter((block) => !currentDeletedBlockIds.has(block.id)),
        activeNotebookId,
        activePageId,
        expandedPageIds: current.expandedPageIds.filter((id) => !currentDeletedPageIds.has(id)),
        operations: [...current.operations, operation]
      };
    });
  };

  const duplicateNotebook = async (notebookId: string) => {
    const sourceNotebook = state.notebooks.find((notebook) => notebook.id === notebookId);
    if (!sourceNotebook) return;
    const sourcePages = state.pages.filter((page) => page.notebookId === notebookId);
    if (isTauri() && sourcePages.some((page) => page.id === activePage.id)) {
      try {
        await flushPageDocumentSave(activePage, state.blocks);
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

    setState((current) => ({
      ...current,
      notebooks: [...current.notebooks, notebook],
      pages: [...current.pages, ...duplicatedPages],
      blocks: [
        ...current.blocks.filter((block) => block.pageId !== (notebook.pageIds[0] ?? '')),
        ...(isTauri() ? duplicatedBlocks.filter((block) => block.pageId === (notebook.pageIds[0] ?? '')) : duplicatedBlocks)
      ],
      activeNotebookId: notebook.id,
      activePageId: notebook.pageIds[0] ?? current.activePageId,
      expandedPageIds: [...new Set([...current.expandedPageIds, ...duplicatedPages.map((page) => page.id)])],
      operations: [...current.operations, operation]
    }));
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
      .then(reconcileNotebookTree)
      .catch((error) => {
        console.warn('Could not persist notebook delete.', error);
      });
    setPinnedBlockPayloads((current) => current.filter((payload) => payload.page.notebookId !== notebookId));

    setState((current) => {
      const currentDeletedPages = current.pages.filter((page) => page.notebookId === notebookId);
      const currentDeletedPageIds = new Set(currentDeletedPages.map((page) => page.id));
      const currentDeletedBlockIds = new Set(currentDeletedPages.flatMap((page) => page.blockIds));
      const notebooks = current.notebooks.filter((candidate) => candidate.id !== notebookId);
      const activeNotebook = current.activeNotebookId === notebookId ? notebooks[0] : current.notebooks.find((candidate) => candidate.id === current.activeNotebookId);
      const activePageId = activeNotebook?.pageIds.find((id) => !currentDeletedPageIds.has(id)) ?? current.activePageId;

      return {
        ...current,
        notebooks,
        pages: current.pages.filter((page) => !currentDeletedPageIds.has(page.id)),
        blocks: current.blocks.filter((block) => !currentDeletedBlockIds.has(block.id)),
        activeNotebookId: activeNotebook?.id ?? notebooks[0]?.id ?? current.activeNotebookId,
        activePageId,
        expandedPageIds: current.expandedPageIds.filter((id) => !currentDeletedPageIds.has(id)),
        operations: [...current.operations, operation]
      };
    });
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
      if (event.defaultPrevented || !selectedPageId) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .ProseMirror')) return;
      const targetPageRow = target?.closest<HTMLElement>('.page-row-shell[data-page-id], .file-node-row-shell[data-page-id]');
      if (target?.closest('button, a') && !targetPageRow) return;
      const pageId = targetPageRow?.dataset.pageId ?? selectedPageId;

      const key = event.key.toLowerCase();
      const commandKey = event.metaKey || event.ctrlKey;
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
    setState((current) => ({
      ...current,
      pages: current.pages.map((candidate) => (candidate.id === activePage.id ? { ...candidate, title } : candidate)),
      operations: operation ? [...current.operations, operation] : current.operations
    }));
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
      setState((current) => ({
        ...current,
        pages: current.pages.map((candidate) => (candidate.id === page.id ? { ...candidate, title } : candidate)),
        operations: operation ? [...current.operations, operation] : current.operations
      }));
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
    const markdown = [`# ${activePage.title}`, '', ...pageBlocks.map((block) => htmlToMarkdown(block.content.html))].join('\n\n');
    downloadTextFile(`${activePage.title || 'page'}.md`, markdown, 'text/markdown;charset=utf-8');
  };

  const exportJson = async () => {
    try {
      if (isTauri()) await flushPageDocumentSave(activePage, state.blocks);
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

      setState((current) => {
        const activePageId = importedPageIds[importedPageIds.length - 1] ?? current.activePageId;
        const activeImportedBlocks = importedBlocks.filter((block) => block.pageId === activePageId);

        return {
          ...current,
          pages: [...current.pages, ...imported.map(({ page }) => page)],
          blocks: isTauri() ? activeImportedBlocks : [...current.blocks, ...importedBlocks],
          notebooks: current.notebooks.map((notebook) =>
            notebook.id === current.activeNotebookId
              ? { ...notebook, pageIds: [...notebook.pageIds, ...importedPageIds] }
              : notebook
          ),
          activePageId,
          expandedPageIds: [...new Set([...current.expandedPageIds, ...importedPageIds])],
          operations: [...current.operations, operation]
        };
      });
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

    setImportNotice({ kind: 'loading', message: `Importing folder "${rootName}"...` });

    try {
      const assetWarnings: string[] = [];
      const resolveImportedFolderAsset = isTauri()
        ? async (assetPath: string, file: File) => {
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
          }
        : undefined;
      const documents = await Promise.all(markdownFiles.map(async (file) => {
        const relativePath = stripRoot(fileRelativePath(file));
        const markdown = await embedImportedAssetMarkdown(await file.text(), relativePath, assetFiles, resolveImportedFolderAsset);
        return { relativePath, markdown };
      }));
      const imported = await createNotebookFromMarkdownDocuments(rootName, documents);
      let persistedTree: NotebookTreePayload | null = null;
      if (isTauri()) {
        persistedTree = await persistImportBatch({
          notebook: imported.notebook,
          pages: imported.pages,
          blocks: imported.blocks,
          operation: {
            id: createId('op'),
            timestamp: new Date().toISOString(),
            entity: 'notebook',
            entityId: imported.notebook.id,
            kind: 'notebook.import_markdown_folder',
            payload: {
              notebook: imported.notebook,
              pageCount: imported.pages.length,
              blockCount: imported.blocks.length,
              warningCount: assetWarnings.length + imported.warnings.length
            }
          }
        });
      }
      const warningDetails = [
        ...assetWarnings,
        ...imported.warnings.map((warning) => `${warning.filename}: ${warning.sourcePath} (${warning.message})`)
      ].slice(0, 4);
      const warningCount = assetWarnings.length + imported.warnings.length;
      const activePageId = imported.pages.find((page) => page.blockIds.length)?.id ?? imported.pages[0]?.id ?? state.activePageId;
      const importedExpandedPageIds = imported.pages.length <= fullExpansionImportPageLimit
        ? imported.expandedPageIds
        : ancestorsOfPage(activePageId, imported.pages).map((page) => page.id);
      const activeImportedBlocks = imported.blocks.filter((block) => block.pageId === activePageId);

      setState((current) => ({
        ...current,
        notebooks: [...current.notebooks, imported.notebook],
        pages: [...current.pages, ...imported.pages],
        blocks: isTauri()
          ? activeImportedBlocks
          : [...current.blocks, ...imported.blocks],
        activeNotebookId: imported.notebook.id,
        activePageId,
        expandedPageIds: [...new Set([...current.expandedPageIds, ...importedExpandedPageIds])],
        operations: appendOperation(current, {
          entity: 'notebook',
          entityId: imported.notebook.id,
          kind: 'notebook.import_markdown_folder',
          payload: {
            notebook: imported.notebook,
            pageCount: imported.pages.length,
            blockCount: imported.blocks.length,
            warningCount
          }
        })
      }));
      reconcileNotebookTree(persistedTree);

      setImportNotice({
        kind: warningCount ? 'warning' : 'success',
        message: warningCount
          ? `Imported folder "${rootName}" with ${imported.pages.length} page${imported.pages.length > 1 ? 's' : ''}, but ${warningCount} local asset${warningCount > 1 ? 's' : ''} could not be copied.`
          : `Imported folder "${rootName}" with ${imported.pages.length} page${imported.pages.length > 1 ? 's' : ''} and ${imported.blocks.length} block${imported.blocks.length > 1 ? 's' : ''}.`,
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
      setState((current) => ({ ...current, openCardWindowBlockId: blockId }));
      return;
    }

    const label = `card_${blockId.replace(/[^a-zA-Z0-9_:-]/g, '_')}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await configurePinnedCardWindow(existing);
      return;
    }
    const cardWindow = new WebviewWindow(label, {
      url: `${window.location.pathname}?card=${encodeURIComponent(blockId)}`,
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
                className={`page-button ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
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
                onClick={() => beginPageRename(page)}
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
                className={`file-node-content ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
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
                onClick={() => beginPageRename(page)}
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
        metadataChips,
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
        onRenamePage: renamePage,
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
        onMathChange: updateMathEditorLatex,
        onMathClose: () => setMathEditor(null),
        onMoveBlock: (blockId, direction) => {
          moveBlockByKeyboard(blockId, direction);
          return true;
        },
        onUpdateBlock: updateBlock
      }}
      calendar={{
        calendarMonth,
        calendarDays,
        entriesByDate: calendarEntriesByDate,
        onMoveMonth: moveCalendarMonth,
        onJumpToBlock: jumpToBlock,
        onShowWrite: () => setWorkspaceView('write')
      }}
    />
  );

  const selectNotebook = (notebook: Notebook) => {
    saveCurrentComposerDraft();
    setWorkspaceView('write');
    setState((current) => ({
      ...current,
      activeNotebookId: notebook.id,
      activePageId: notebook.pageIds[0] ?? current.activePageId
    }));
  };

  const selectSearchResult = (pageId: string) => {
    const page = state.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    saveCurrentComposerDraft();
    setQuery('');
    setSelectedPageId(pageId);
    setWorkspaceView('write');
    setState((current) => ({
      ...current,
      activeNotebookId: page.notebookId,
      activePageId: pageId,
      expandedPageIds: [
        ...new Set([
          ...current.expandedPageIds,
          ...ancestorsOfPage(pageId, current.pages).map((ancestor) => ancestor.id)
        ])
      ]
    }));
  };

  const notebookActions = {
    addNotebook,
    selectNotebook,
    renameNotebook,
    duplicateNotebook,
    deleteNotebook
  };

  const shellControls = {
    showToolbar,
    showComposerFooter,
    showBlockBorders,
    roundPinnedCards,
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
    onRoundPinnedCardsChange: setRoundPinnedCards,
    onNewestFirstChange: (newestFirst: boolean) => setPageBlockOrder(newestFirst ? 'desc' : 'asc'),
    onShellChange: setShell,
    onContentThemeChange: setContentTheme,
    onOutlineToggle: () => setOutlineDrawerOpen((open) => !open),
    onSidebarToggle: () => setSidebarCollapsed((collapsed) => !collapsed),
    onMarkdownFilesChange: (files: FileList | null) => void importMarkdownFiles(files),
    onMarkdownFolderChange: (files: FileList | null) => void importMarkdownFolder(files),
    onExportMarkdown: exportMarkdown,
    onExportJson: exportJson
  };

  if (cardModeBlock) {
    const closeCardWindow = () => {
      if (isTauri()) {
        void getCurrentWindow().close();
        return;
      }
      setState((current) => ({ ...current, openCardWindowBlockId: null }));
    };
    const dragCardWindow = (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select, audio, video, .floating-card-body')) return;
      if (isTauri()) void getCurrentWindow().startDragging();
    };
    return (
      <CardWindowPage
        block={cardModeBlock}
        shell={state.shell}
        contentTheme={state.contentTheme}
        roundPinnedCards={roundPinnedCards}
        editorRef={(editor) => { blockEditorRefs.current[cardModeBlock.id] = editor; }}
        onFocus={(editor) => {
          activateEditor({ kind: 'block', blockId: cardModeBlock.id });
          syncFloatingControls(editor);
        }}
        onSelectionUpdate={syncFloatingControls}
        onUpdate={(html, plainText) => updateCardBlock(cardModeBlock.id, html, plainText)}
        onBlur={(html, plainText) => updateCardBlock(cardModeBlock.id, html, plainText)}
        onMediaResizeStart={startMediaResize}
        onClose={closeCardWindow}
        onDrag={dragCardWindow}
      />
    );
  }

  if (cardModeBlockId) {
    return (
      <main className={`card-window-page typora-theme ${roundPinnedCards ? 'is-rounded' : 'is-square'}`} data-content-theme={state.contentTheme} data-shell={state.shell}>
        <div className="floating-card-body card-mode" />
      </main>
    );
  }

  const isTyporaShell = state.shell === 'typora-base';
  const pageTree = isTyporaShell ? null : renderPageTree(null);
  const typoraFileTree = isTyporaShell ? renderTyporaFileTree(null) : null;
  const workspaceContent = renderWorkspaceContent();

  const sharedShellProps = {
    shell: state.shell,
    contentTheme: state.contentTheme,
    sidebarCollapsed,
    outlineOpen: outlineDrawerOpen,
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
    workspaceContent,
    pinnedBlocks,
    openCardBlock,
    roundPinnedCards,
    onOpenPinnedWindow: (blockId: string) => void openPinnedWindow(blockId),
    onCloseFloatingCard: () => setState((current) => ({ ...current, openCardWindowBlockId: null })),
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

  return isTyporaShell ? <TyporaShell {...sharedShellProps} /> : <NativeShell {...sharedShellProps} />;
}
