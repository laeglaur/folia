import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus
} from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { AppState, Block, ContentThemeId, Notebook, Page, ShellId } from './types';
import {
  appendOperation,
  createBlock,
  createId,
  createNotebookFromMarkdownDocuments,
  createNotebook,
  createPageFromMarkdown,
  createPage,
  downloadTextFile,
  htmlToMarkdown,
  loadPersistentState,
  loadState,
  saveState
} from './state';
import {
  escapeHtml,
  importAttachmentFile,
  inferAttachmentKind,
  RichEditor,
  runListIndentCommand,
  Toolbar,
  type MathEditorState,
  type MediaNodeType,
  type MediaResizeRequest,
  type TableControlsState,
  type ToolbarCommand
} from './editor';
import {
  blockTimestampLabel,
  calendarDaysForMonth,
  displayMathLatex,
  embedImportedAssetMarkdown,
  extractOutlineEntries,
  fileRelativePath,
  firstLines,
  findBlockMathPositionNear,
  htmlWithOutlineAnchors,
  isResizableMediaNode,
  localDateKey,
  markdownImportFileRegex,
  mediaImportFileRegex,
  monthKey,
  monthLabel,
  splitImportRoot,
  stripOutlineAnchors,
  type CalendarEntry,
  type ImportNotice,
  type OutlineEntry,
  type WorkspaceView
} from './app-utils';
import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import 'katex/dist/katex.min.css';
import { CardWindowPage, NativeShell, TyporaShell } from './shells';

const themesWithoutNativeDivider = new Set<ContentThemeId>([
  'notebook',
  'typora-base',
  'typora-proof',
  'typora-bonne-nouvelle',
  'typora-eloquent',
  'typora-everforest-light',
  'typora-law'
]);

type EditorTarget = { kind: 'composer' } | { kind: 'block'; blockId: string };

const shellThemes: Array<{ id: ShellId; label: string }> = [
  { id: 'native-garden', label: 'Native Garden' },
  { id: 'native-ledger', label: 'Native Ledger' },
  { id: 'typora-base', label: 'Typora Base' }
];

const starIconUrl = '/app-assets/star.png';
const fishIconUrl = '/app-assets/blue_red_fish.png';

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [activeEditor, setActiveEditor] = useState<EditorTarget>({ kind: 'composer' });
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [tableControls, setTableControls] = useState<TableControlsState>({ visible: false, top: 0, left: 0 });
  const [mathEditor, setMathEditor] = useState<MathEditorState | null>(null);
  const [showComposerFooter, setShowComposerFooter] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copiedPageId, setCopiedPageId] = useState<string | null>(null);
  const [outlineDrawerOpen, setOutlineDrawerOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('write');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [importNotice, setImportNotice] = useState<ImportNotice>({ kind: 'idle', message: '' });
  const composerEditorRef = useRef<Editor | null>(null);
  const blockEditorRefs = useRef<Record<string, Editor | null>>({});
  const persistenceReadyRef = useRef(!isTauri());
  const markdownInputRef = useRef<HTMLInputElement | null>(null);
  const markdownFolderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) return;
    loadPersistentState().then((loadedState) => {
      if (cancelled) return;
      persistenceReadyRef.current = true;
      setState(loadedState);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nativeTheme = state.shell === 'native-ledger' ? 'ledger' : 'garden';
    document.documentElement.dataset.theme = nativeTheme;
    document.documentElement.dataset.shell = state.shell;
    document.documentElement.dataset.contentTheme = state.contentTheme;
    if (persistenceReadyRef.current) void saveState(state);
  }, [state]);

  const activeNotebook = state.notebooks.find((notebook) => notebook.id === state.activeNotebookId) ?? state.notebooks[0];
  const activePage = state.pages.find((page) => page.id === state.activePageId) ?? state.pages[0];
  const pageBlocks = useMemo(
    () => activePage.blockIds.map((blockId) => state.blocks.find((block) => block.id === blockId)).filter(Boolean) as Block[],
    [activePage.blockIds, state.blocks]
  );
  const pageBlockOrder = activePage.blockOrder === 'desc' ? 'desc' : 'asc';
  const orderedPageBlocks = useMemo(
    () => pageBlockOrder === 'desc' ? [...pageBlocks].reverse() : pageBlocks,
    [pageBlockOrder, pageBlocks]
  );
  const outlineEntries = useMemo(() => extractOutlineEntries(activePage, orderedPageBlocks), [activePage, orderedPageBlocks]);
  const calendarEntriesByDate = useMemo(() => {
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
  }, [activeNotebook.id, state.blocks, state.pages]);
  const calendarDays = useMemo(() => calendarDaysForMonth(calendarMonth), [calendarMonth]);
  const pinnedBlocks = state.blocks.filter((block) => block.pinned);
  const openCardBlock = isTauri() ? null : state.blocks.find((block) => block.id === state.openCardWindowBlockId) ?? null;
  const cardModeBlockId = new URLSearchParams(window.location.search).get('card');
  const cardModeBlock = state.blocks.find((block) => block.id === cardModeBlockId) ?? null;
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
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === activePage.id ? { ...page, blockIds: nextIds } : page)),
      operations: appendOperation(current, { entity: 'page', entityId: activePage.id, kind: 'page.keyboard_move_block', payload: { blockIds: nextIds } })
    }));
  };

  const commitDraft = () => {
    const editor = composerEditorRef.current;
    const html = editor?.getHTML().trim() ?? '';
    const plainText = editor?.getText().trim() ?? '';
    if (!plainText && !html.replace(/<br\s*\/?>/g, '').trim()) return;

    const block = createBlock(activePage.id, html, plainText);
    setState((current) => ({
      ...current,
      blocks: [...current.blocks, block],
      pages: current.pages.map((page) =>
        page.id === activePage.id
          ? {
            ...page,
            blockIds: (page.blockOrder === 'desc' ? [block.id, ...page.blockIds] : [...page.blockIds, block.id]),
            updatedAt: new Date().toISOString()
          }
          : page
      ),
      operations: appendOperation(current, { entity: 'block', entityId: block.id, kind: 'block.create', payload: block })
    }));
    setDraft('');
    editor?.commands.clearContent();
    editor?.commands.focus();
  };

  const updateBlock = (blockId: string, html: string, plainText: string) => {
    const cleanHtml = stripOutlineAnchors(html);
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? { ...block, content: { html: cleanHtml, plainText }, updatedAt: new Date().toISOString() } : block
      ),
      operations: appendOperation(current, {
        entity: 'block',
        entityId: blockId,
        kind: 'block.update_content',
        payload: { html: cleanHtml, plainText }
      })
    }));
  };

  const toggleBlock = (blockId: string, key: 'collapsed' | 'pinned') => {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? { ...block, [key]: !block[key], updatedAt: new Date().toISOString() } : block
      ),
      operations: appendOperation(current, { entity: 'block', entityId: blockId, kind: `block.toggle_${key}`, payload: { key } })
    }));
  };

  const setPageBlockOrder = (blockOrder: 'asc' | 'desc') => {
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === activePage.id ? { ...page, blockOrder, updatedAt: new Date().toISOString() } : page
      ),
      operations: appendOperation(current, {
        entity: 'page',
        entityId: activePage.id,
        kind: 'page.set_block_order',
        payload: { blockOrder }
      })
    }));
  };

  const reorderBlock = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const sourceIndex = activePage.blockIds.indexOf(sourceId);
    const targetIndex = activePage.blockIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextIds = [...activePage.blockIds];
    nextIds.splice(sourceIndex, 1);
    nextIds.splice(targetIndex, 0, sourceId);
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === activePage.id ? { ...page, blockIds: nextIds } : page)),
      operations: appendOperation(current, { entity: 'page', entityId: activePage.id, kind: 'page.reorder_blocks', payload: { blockIds: nextIds } })
    }));
  };

  const addNotebook = () => {
    const notebook = createNotebook(`Notebook ${state.notebooks.length + 1}`);
    const page = createPage(notebook.id, 'Inbox');
    setState((current) => ({
      ...current,
      notebooks: [...current.notebooks, { ...notebook, pageIds: [page.id] }],
      pages: [...current.pages, page],
      activeNotebookId: notebook.id,
      activePageId: page.id,
      operations: appendOperation(current, { entity: 'notebook', entityId: notebook.id, kind: 'notebook.create', payload: notebook })
    }));
  };

  const addPage = (parentId: string | null = null) => {
    const page = createPage(state.activeNotebookId, parentId ? 'Nested page' : 'Untitled page', parentId);
    setState((current) => ({
      ...current,
      pages: [...current.pages, page],
      notebooks: current.notebooks.map((notebook) =>
        notebook.id === current.activeNotebookId ? { ...notebook, pageIds: [...notebook.pageIds, page.id] } : notebook
      ),
      activePageId: page.id,
      operations: appendOperation(current, { entity: 'page', entityId: page.id, kind: 'page.create', payload: page })
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
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === pageId ? { ...page, parentId, updatedAt: new Date().toISOString() } : page)),
      expandedPageIds: parentId && !current.expandedPageIds.includes(parentId) ? [...current.expandedPageIds, parentId] : current.expandedPageIds,
      operations: appendOperation(current, { entity: 'page', entityId: pageId, kind: 'page.move', payload: { parentId } })
    }));
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

  const duplicatePageTree = (pageId: string) => {
    setState((current) => {
      const rootPage = current.pages.find((page) => page.id === pageId);
      if (!rootPage) return current;
      const sourcePages = [rootPage, ...descendantsOfPage(pageId, current.pages)];
      const pageIdMap = new Map(sourcePages.map((page) => [page.id, createId('page')]));
      const blockIdMap = new Map<string, string>();
      sourcePages.forEach((page) => {
        page.blockIds.forEach((blockId) => blockIdMap.set(blockId, createId('block')));
      });

      const duplicatedPages = sourcePages.map((page, index) => ({
        ...page,
        id: pageIdMap.get(page.id) ?? createId('page'),
        parentId: page.parentId && pageIdMap.has(page.parentId) ? pageIdMap.get(page.parentId) ?? null : page.parentId,
        title: index === 0 ? `${page.title} copy` : page.title,
        blockIds: page.blockIds.map((blockId) => blockIdMap.get(blockId)).filter(Boolean) as string[],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));
      const duplicatedBlocks = current.blocks
        .filter((block) => blockIdMap.has(block.id))
        .map((block) => ({
          ...block,
          id: blockIdMap.get(block.id) ?? createId('block'),
          pageId: pageIdMap.get(block.pageId) ?? block.pageId,
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }));
      const duplicatedRootId = duplicatedPages[0]?.id ?? current.activePageId;

      return {
        ...current,
        pages: [...current.pages, ...duplicatedPages],
        blocks: [...current.blocks, ...duplicatedBlocks],
        notebooks: current.notebooks.map((notebook) =>
          notebook.id === rootPage.notebookId
            ? { ...notebook, pageIds: [...notebook.pageIds, ...duplicatedPages.map((page) => page.id)] }
            : notebook
        ),
        activeNotebookId: rootPage.notebookId,
        activePageId: duplicatedRootId,
        expandedPageIds: [...new Set([...current.expandedPageIds, ...duplicatedPages.map((page) => page.id)])],
        operations: appendOperation(current, {
          entity: 'page',
          entityId: duplicatedRootId,
          kind: 'page.duplicate_tree',
          payload: { sourcePageId: pageId, pageCount: duplicatedPages.length, blockCount: duplicatedBlocks.length }
        })
      };
    });
  };

  const deletePageTree = (pageId: string) => {
    const page = state.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    if (!window.confirm(`Delete "${page.title}" and its nested pages?`)) return;
    setState((current) => {
      const rootPage = current.pages.find((candidate) => candidate.id === pageId);
      if (!rootPage) return current;
      const deletedPages = [rootPage, ...descendantsOfPage(pageId, current.pages)];
      const deletedPageIds = new Set(deletedPages.map((deletedPage) => deletedPage.id));
      const deletedBlockIds = new Set(deletedPages.flatMap((deletedPage) => deletedPage.blockIds));
      const fallbackPage = current.pages.some((candidate) => candidate.notebookId === rootPage.notebookId && !deletedPageIds.has(candidate.id))
        ? null
        : createPage(rootPage.notebookId, 'Inbox');
      const remainingPages = [
        ...current.pages.filter((candidate) => !deletedPageIds.has(candidate.id)),
        ...(fallbackPage ? [fallbackPage] : [])
      ];
      const remainingNotebooks = current.notebooks.map((notebook) => ({
        ...notebook,
        pageIds: [
          ...notebook.pageIds.filter((id) => !deletedPageIds.has(id)),
          ...(fallbackPage && notebook.id === rootPage.notebookId ? [fallbackPage.id] : [])
        ]
      }));
      let activeNotebookId = current.activeNotebookId;
      let activePageId = current.activePageId;
      if (deletedPageIds.has(current.activePageId)) {
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
        blocks: current.blocks.filter((block) => !deletedBlockIds.has(block.id)),
        activeNotebookId,
        activePageId,
        expandedPageIds: current.expandedPageIds.filter((id) => !deletedPageIds.has(id)),
        operations: appendOperation(current, {
          entity: 'page',
          entityId: pageId,
          kind: 'page.delete_tree',
          payload: { pageCount: deletedPages.length, blockCount: deletedBlockIds.size }
        })
      };
    });
  };

  const duplicateNotebook = (notebookId: string) => {
    setState((current) => {
      const sourceNotebook = current.notebooks.find((notebook) => notebook.id === notebookId);
      if (!sourceNotebook) return current;
      const sourcePages = current.pages.filter((page) => page.notebookId === notebookId);
      const pageIdMap = new Map(sourcePages.map((page) => [page.id, createId('page')]));
      const blockIdMap = new Map<string, string>();
      sourcePages.forEach((page) => {
        page.blockIds.forEach((blockId) => blockIdMap.set(blockId, createId('block')));
      });
      const notebook = { ...createNotebook(`${sourceNotebook.name} copy`), pageIds: sourceNotebook.pageIds.map((id) => pageIdMap.get(id)).filter(Boolean) as string[] };
      const duplicatedPages = sourcePages.map((page) => ({
        ...page,
        id: pageIdMap.get(page.id) ?? createId('page'),
        notebookId: notebook.id,
        parentId: page.parentId ? pageIdMap.get(page.parentId) ?? null : null,
        blockIds: page.blockIds.map((blockId) => blockIdMap.get(blockId)).filter(Boolean) as string[],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));
      const duplicatedBlocks = current.blocks
        .filter((block) => blockIdMap.has(block.id))
        .map((block) => ({
          ...block,
          id: blockIdMap.get(block.id) ?? createId('block'),
          pageId: pageIdMap.get(block.pageId) ?? block.pageId,
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }));

      return {
        ...current,
        notebooks: [...current.notebooks, notebook],
        pages: [...current.pages, ...duplicatedPages],
        blocks: [...current.blocks, ...duplicatedBlocks],
        activeNotebookId: notebook.id,
        activePageId: notebook.pageIds[0] ?? current.activePageId,
        expandedPageIds: [...new Set([...current.expandedPageIds, ...duplicatedPages.map((page) => page.id)])],
        operations: appendOperation(current, {
          entity: 'notebook',
          entityId: notebook.id,
          kind: 'notebook.duplicate',
          payload: { sourceNotebookId: notebookId, pageCount: duplicatedPages.length, blockCount: duplicatedBlocks.length }
        })
      };
    });
  };

  const deleteNotebook = (notebookId: string) => {
    const notebook = state.notebooks.find((candidate) => candidate.id === notebookId);
    if (!notebook || state.notebooks.length <= 1) return;
    if (!window.confirm(`Delete notebook "${notebook.name}"?`)) return;
    setState((current) => {
      const deletedPages = current.pages.filter((page) => page.notebookId === notebookId);
      const deletedPageIds = new Set(deletedPages.map((page) => page.id));
      const deletedBlockIds = new Set(deletedPages.flatMap((page) => page.blockIds));
      const notebooks = current.notebooks.filter((candidate) => candidate.id !== notebookId);
      const activeNotebook = current.activeNotebookId === notebookId ? notebooks[0] : current.notebooks.find((candidate) => candidate.id === current.activeNotebookId);
      const activePageId = activeNotebook?.pageIds.find((id) => !deletedPageIds.has(id)) ?? current.activePageId;

      return {
        ...current,
        notebooks,
        pages: current.pages.filter((page) => !deletedPageIds.has(page.id)),
        blocks: current.blocks.filter((block) => !deletedBlockIds.has(block.id)),
        activeNotebookId: activeNotebook?.id ?? notebooks[0]?.id ?? current.activeNotebookId,
        activePageId,
        expandedPageIds: current.expandedPageIds.filter((id) => !deletedPageIds.has(id)),
        operations: appendOperation(current, {
          entity: 'notebook',
          entityId: notebookId,
          kind: 'notebook.delete',
          payload: { pageCount: deletedPages.length, blockCount: deletedBlockIds.size }
        })
      };
    });
  };

  const handlePageKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, page: Page) => {
    const key = event.key.toLowerCase();
    const commandKey = event.metaKey || event.ctrlKey;
    if (commandKey && key === 'c') {
      event.preventDefault();
      setCopiedPageId(page.id);
      return true;
    }
    if (commandKey && key === 'v') {
      event.preventDefault();
      duplicatePageTree(copiedPageId ?? page.id);
      return true;
    }
    if (!commandKey && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      deletePageTree(page.id);
      return true;
    }
    return false;
  };

  const renamePage = (title: string) => {
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === activePage.id ? { ...page, title } : page)),
      operations: appendOperation(current, { entity: 'page', entityId: activePage.id, kind: 'page.rename', payload: { title } })
    }));
  };

  const exportMarkdown = () => {
    const markdown = [`# ${activePage.title}`, '', ...pageBlocks.map((block) => htmlToMarkdown(block.content.html))].join('\n\n');
    downloadTextFile(`${activePage.title || 'page'}.md`, markdown, 'text/markdown;charset=utf-8');
  };

  const exportJson = () => {
    downloadTextFile('notebook-backup.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
  };

  const importMarkdownFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((file) => /\.(md|markdown|txt)$/i.test(file.name));
    if (!files.length) return;
    setImportNotice({ kind: 'loading', message: `Importing ${files.length} Markdown file${files.length > 1 ? 's' : ''}...` });

    try {
      const documents = await Promise.all(files.map(async (file) => ({ filename: file.name, markdown: await file.text() })));
      const imported = await Promise.all(documents.map((document) => createPageFromMarkdown(state.activeNotebookId, document.filename, document.markdown)));
      const warnings = imported.flatMap(({ warnings }) => warnings);
      const warningDetails = warnings.slice(0, 4).map((warning) => `${warning.filename}: ${warning.sourcePath} (${warning.message})`);

      setState((current) => {
        const importedPageIds = imported.map(({ page }) => page.id);
        const importedBlocks = imported.flatMap(({ blocks }) => blocks);
        const activePageId = importedPageIds[importedPageIds.length - 1] ?? current.activePageId;
        const operationsState = { ...current };
        let operations = current.operations;
        imported.forEach(({ page, blocks, warnings }) => {
          operations = appendOperation({ ...operationsState, operations }, {
            entity: 'page',
            entityId: page.id,
            kind: 'page.import_markdown',
            payload: { page, blockCount: blocks.length, warningCount: warnings.length }
          });
        });

        return {
          ...current,
          pages: [...current.pages, ...imported.map(({ page }) => page)],
          blocks: [...current.blocks, ...importedBlocks],
          notebooks: current.notebooks.map((notebook) =>
            notebook.id === current.activeNotebookId
              ? { ...notebook, pageIds: [...notebook.pageIds, ...importedPageIds] }
              : notebook
          ),
          activePageId,
          expandedPageIds: [...new Set([...current.expandedPageIds, ...importedPageIds])],
          operations
        };
      });

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
    const assetFiles = new Map(
      files
        .filter((file) => mediaImportFileRegex.test(file.name))
        .map((file) => [stripRoot(fileRelativePath(file)), file] as const)
    );

    setImportNotice({ kind: 'loading', message: `Importing folder "${rootName}"...` });

    try {
      const documents = await Promise.all(markdownFiles.map(async (file) => {
        const relativePath = stripRoot(fileRelativePath(file));
        const markdown = await embedImportedAssetMarkdown(await file.text(), relativePath, assetFiles);
        return { relativePath, markdown };
      }));
      const imported = await createNotebookFromMarkdownDocuments(rootName, documents);
      const warningDetails = imported.warnings.slice(0, 4).map((warning) => `${warning.filename}: ${warning.sourcePath} (${warning.message})`);
      const activePageId = imported.pages.find((page) => page.blockIds.length)?.id ?? imported.pages[0]?.id ?? state.activePageId;

      setState((current) => ({
        ...current,
        notebooks: [...current.notebooks, imported.notebook],
        pages: [...current.pages, ...imported.pages],
        blocks: [...current.blocks, ...imported.blocks],
        activeNotebookId: imported.notebook.id,
        activePageId,
        expandedPageIds: [...new Set([...current.expandedPageIds, ...imported.expandedPageIds])],
        operations: appendOperation(current, {
          entity: 'notebook',
          entityId: imported.notebook.id,
          kind: 'notebook.import_markdown_folder',
          payload: {
            notebook: imported.notebook,
            pageCount: imported.pages.length,
            blockCount: imported.blocks.length,
            warningCount: imported.warnings.length
          }
        })
      }));

      setImportNotice({
        kind: imported.warnings.length ? 'warning' : 'success',
        message: imported.warnings.length
          ? `Imported folder "${rootName}" with ${imported.pages.length} page${imported.pages.length > 1 ? 's' : ''}, but ${imported.warnings.length} local asset${imported.warnings.length > 1 ? 's' : ''} could not be copied.`
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
      return (
        <div className="page-tree-row" key={page.id} style={{ '--depth': depth } as React.CSSProperties}>
          <div className={`page-row-shell ${page.id === activePage.id ? 'active' : ''}`}>
            <button
              className={`page-button ${page.id === activePage.id ? 'active' : ''}`}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('application/page-id', page.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData('application/page-id');
                if (draggedId) movePageUnder(draggedId, page.id);
              }}
              onKeyDown={(event) => {
                if (handlePageKeyboard(event, page)) return;
                if (event.key !== 'Tab') return;
                event.preventDefault();
                setWorkspaceView('write');
                setState((current) => ({ ...current, activePageId: page.id }));
                if (event.shiftKey) {
                  const parent = state.pages.find((candidate) => candidate.id === page.parentId);
                  movePageUnder(page.id, parent?.parentId ?? null);
                } else {
                  const siblings = state.pages.filter((candidate) => candidate.notebookId === page.notebookId && (candidate.parentId ?? null) === (page.parentId ?? null));
                  const index = siblings.findIndex((candidate) => candidate.id === page.id);
                  const previousSibling = siblings[index - 1];
                  if (previousSibling) movePageUnder(page.id, previousSibling.id);
                }
              }}
              onClick={() => {
                setWorkspaceView('write');
                setState((current) => ({ ...current, activePageId: page.id }));
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
              <span>{page.title}</span>
            </button>
          </div>
          {hasChildren && expanded && <div className="page-tree-children">{renderPageTree(page.id, depth + 1)}</div>}
        </div>
      );
    });

  const renderTyporaFileTree = (parentId: string | null = null, depth = 0): React.ReactNode =>
    (childPages.get(parentId) ?? []).map((page) => {
      const hasChildren = Boolean(childPages.get(page.id)?.length);
      const expanded = state.expandedPageIds.includes(page.id);
      return (
        <div
          className="file-library-node"
          data-is-directory={hasChildren ? 'true' : 'false'}
          key={page.id}
          style={{ '--depth': depth } as React.CSSProperties}
        >
          <span className="file-node-background" aria-hidden="true" />
          <div className={`file-node-row-shell ${page.id === activePage.id ? 'active' : ''}`}>
            <button
              className={`file-node-content ${page.id === activePage.id ? 'active' : ''}`}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('application/page-id', page.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData('application/page-id');
                if (draggedId) movePageUnder(draggedId, page.id);
              }}
              onKeyDown={(event) => {
                if (handlePageKeyboard(event, page)) return;
                if (event.key !== 'Tab') return;
                event.preventDefault();
                setWorkspaceView('write');
                setState((current) => ({ ...current, activePageId: page.id }));
                if (event.shiftKey) {
                  const parent = state.pages.find((candidate) => candidate.id === page.parentId);
                  movePageUnder(page.id, parent?.parentId ?? null);
                } else {
                  const siblings = state.pages.filter((candidate) => candidate.notebookId === page.notebookId && (candidate.parentId ?? null) === (page.parentId ?? null));
                  const index = siblings.findIndex((candidate) => candidate.id === page.id);
                  const previousSibling = siblings[index - 1];
                  if (previousSibling) movePageUnder(page.id, previousSibling.id);
                }
              }}
              onClick={() => {
                setWorkspaceView('write');
                setState((current) => ({ ...current, activePageId: page.id }));
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
              <span className="file-node-title file-name">{page.title}</span>
            </button>
          </div>
          {hasChildren && expanded && <div className="file-node-children">{renderTyporaFileTree(page.id, depth + 1)}</div>}
        </div>
      );
    });

  const renderComposerCard = () => (
    <div className="composer-card">
      {showToolbar && activeEditor.kind === 'composer' && (
        <Toolbar runCommand={runEditorCommand} insertTodo={insertTodo} applyHighlight={applyHighlight} applyInlineCode={applyInlineCode} />
      )}
      <RichEditor
        editorRef={(editor) => { composerEditorRef.current = editor; }}
        className="composer"
        placeholder="写点什么。按 Shift Enter 变成 block，Tab 缩进。"
        onFocus={(editor) => {
          activateEditor({ kind: 'composer' });
          syncFloatingControls(editor);
        }}
        onSelectionUpdate={syncFloatingControls}
        tableControls={activeEditor.kind === 'composer' ? tableControls : undefined}
        runTableCommand={runEditorCommand}
        onMediaResizeStart={startMediaResize}
        mathEditor={activeEditor.kind === 'composer' ? mathEditor : null}
        onMathChange={updateMathEditorLatex}
        onMathClose={() => setMathEditor(null)}
        onUpdate={(html) => {
          setDraft(html);
        }}
        onShiftEnter={() => {
          commitDraft();
          return true;
        }}
      />
      {showComposerFooter && (
        <div className="composer-footer">
          <span>{draft ? 'Ready to become a block' : 'Waiting for a thought'}</span>
          <button className="primary-button" type="button" onClick={commitDraft}><Plus size={16} /> Add block</button>
        </div>
      )}
    </div>
  );

  const renderBlockDivider = (key?: string) => showBlockDividers ? (
    <hr
      key={key}
      className={`block-divider md-hr md-end-block ${themesWithoutNativeDivider.has(state.contentTheme) ? 'uses-default-divider' : 'uses-theme-divider'}`}
      aria-hidden="true"
    />
  ) : null;

  const renderWriteSurface = () => (
    <section className="page-surface typora-content-surface typora-write" id="write">
      <input className="page-title" value={activePage.title} onChange={(event) => renamePage(event.target.value)} aria-label="Page title" />
      {metadataChips.length ? (
        <div className="page-metadata" aria-label="Page metadata">
          {metadataChips.map((chip, index) => <span key={`${chip}-${index}`}>{chip}</span>)}
        </div>
      ) : null}

      {pageBlockOrder === 'desc' ? (
        <>
          {renderComposerCard()}
          {visibleBlocks.length ? renderBlockDivider('composer-to-first-block') : null}
        </>
      ) : null}

      <div className="block-list">
        {visibleBlocks.map((block, index) => (
          <Fragment key={block.id}>
            <article
              className={`block ${block.collapsed ? 'is-collapsed' : ''} ${draggingBlockId === block.id ? 'is-dragging' : ''}`}
              id={block.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                reorderBlock(event.dataTransfer.getData('text/plain'), block.id);
                setDraggingBlockId(null);
              }}
            >
              <div
                className="block-rail"
                draggable
                onDragStart={(event) => {
                  setDraggingBlockId(block.id);
                  event.dataTransfer.setData('text/plain', block.id);
                }}
                onDragEnd={() => setDraggingBlockId(null)}
              >
                <button className="fold-button" onClick={() => toggleBlock(block.id, 'collapsed')} aria-label="Collapse block" type="button">
                  <ChevronRight size={15} />
                </button>
              </div>
              <div className="block-body">
                <time className="block-created-at" dateTime={block.createdAt}>{blockTimestampLabel(block.createdAt)}</time>
                {showToolbar && activeEditor.kind === 'block' && activeEditor.blockId === block.id && (
                  <Toolbar runCommand={runEditorCommand} insertTodo={insertTodo} applyHighlight={applyHighlight} applyInlineCode={applyInlineCode} />
                )}
                {!block.collapsed ? (
                  <RichEditor
                    editorRef={(editor) => { blockEditorRefs.current[block.id] = editor; }}
                    className="block-content editable"
                    html={htmlWithOutlineAnchors(block.content.html, block.id)}
                    onFocus={(editor) => {
                      activateEditor({ kind: 'block', blockId: block.id });
                      syncFloatingControls(editor);
                    }}
                    onSelectionUpdate={syncFloatingControls}
                    tableControls={activeEditor.kind === 'block' && activeEditor.blockId === block.id ? tableControls : undefined}
                    runTableCommand={runEditorCommand}
                    onMediaResizeStart={startMediaResize}
                    mathEditor={activeEditor.kind === 'block' && activeEditor.blockId === block.id ? mathEditor : null}
                    onMathChange={updateMathEditorLatex}
                    onMathClose={() => setMathEditor(null)}
                    onMoveBlock={(direction) => {
                      moveBlockByKeyboard(block.id, direction);
                      return true;
                    }}
                    onBlur={(html, plainText) => updateBlock(block.id, html, plainText)}
                  />
                ) : (
                  <div className="block-content preview">{firstLines(block.content.plainText)}</div>
                )}
              </div>
              <div className="block-actions">
                <button className={`icon-button ghost star-pin-button ${block.pinned ? 'active' : ''}`} onClick={() => toggleBlock(block.id, 'pinned')} aria-label="Pin block" type="button">
                  <img src={starIconUrl} alt="" aria-hidden="true" />
                </button>
              </div>
            </article>
            {index < visibleBlocks.length - 1 ? renderBlockDivider(`${block.id}:divider`) : null}
          </Fragment>
        ))}
      </div>

      {pageBlockOrder === 'asc' ? (
        <>
          {visibleBlocks.length ? renderBlockDivider('last-block-to-composer') : null}
          {renderComposerCard()}
        </>
      ) : null}
    </section>
  );

  const renderImportNotice = () => importNotice.kind !== 'idle' ? (
    <div className={`import-notice ${importNotice.kind}`} role="status" aria-live="polite">
      <span>{importNotice.message}</span>
      {importNotice.details?.length ? (
        <ul>
          {importNotice.details.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
      ) : null}
    </div>
  ) : null;

  const renderCalendarView = () => {
    const currentMonthKey = monthKey(calendarMonth);
    const todayKey = localDateKey(new Date());
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return (
      <div className="calendar-view" aria-label="Block calendar">
        <div className="calendar-header">
          <button className="mini-button" type="button" onClick={() => moveCalendarMonth(-1)} aria-label="Previous month"><ChevronRight className="flip-x" size={14} /></button>
          <div className="calendar-title">{monthLabel(calendarMonth)}</div>
          <button className="mini-button" type="button" onClick={() => moveCalendarMonth(1)} aria-label="Next month"><ChevronRight size={14} /></button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="calendar-grid">
          {calendarDays.map((day) => {
            const key = localDateKey(day);
            const entries = calendarEntriesByDate.get(key) ?? [];
            return (
              <div
                className={`calendar-day ${monthKey(day) !== currentMonthKey ? 'is-muted' : ''} ${key === todayKey ? 'is-today' : ''}`}
                key={key}
                data-date={key}
              >
                <div className="calendar-day-number">{day.getDate()}</div>
                <div className="calendar-day-entries">
                  {entries.slice(0, 2).map(({ block, page }) => (
                    <button
                      className="calendar-entry"
                      key={block.id}
                      type="button"
                      onClick={() => jumpToBlock(page.id, block.id)}
                      title={`${page.title}: ${block.content.plainText}`}
                    >
                      <span>{page.title}</span>
                      <span>{firstLines(block.content.plainText, 44)}</span>
                    </button>
                  ))}
                  {entries.length > 2 ? <div className="calendar-more">+{entries.length - 2}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCalendarWorkspace = () => (
    <section className="calendar-workspace typora-content-surface typora-write" aria-label="Calendar workspace">
      <div className="calendar-workspace-header">
        <div>
          <p className="section-label">Calendar</p>
          <h2>Blocks by day</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => setWorkspaceView('write')}>Write</button>
      </div>
      {renderCalendarView()}
    </section>
  );

  const renderWorkspaceContent = () => (
    <>
      {renderImportNotice()}
      {workspaceView === 'calendar' ? renderCalendarWorkspace() : renderWriteSurface()}
    </>
  );

  const selectNotebook = (notebook: Notebook) => {
    setWorkspaceView('write');
    setState((current) => ({
      ...current,
      activeNotebookId: notebook.id,
      activePageId: notebook.pageIds[0] ?? current.activePageId
    }));
  };

  const notebookActions = {
    addNotebook,
    selectNotebook,
    duplicateNotebook,
    deleteNotebook
  };

  const shellControls = {
    showToolbar,
    showComposerFooter,
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
    pageTree: renderPageTree(null),
    typoraFileTree: renderTyporaFileTree(null),
    workspaceContent: renderWorkspaceContent(),
    pinnedBlocks,
    openCardBlock,
    onOpenPinnedWindow: (blockId: string) => void openPinnedWindow(blockId),
    onCloseFloatingCard: () => setState((current) => ({ ...current, openCardWindowBlockId: null })),
    onRootPageDrop: (pageId: string) => movePageUnder(pageId, null),
    onAddPage: () => addPage(null),
    controls: shellControls,
    outlineEntries,
    onJumpToOutlineEntry: jumpToOutlineEntry,
    fishIconUrl
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
        editorRef={(editor) => { blockEditorRefs.current[cardModeBlock.id] = editor; }}
        onFocus={(editor) => {
          activateEditor({ kind: 'block', blockId: cardModeBlock.id });
          syncFloatingControls(editor);
        }}
        onSelectionUpdate={syncFloatingControls}
        onUpdate={(html, plainText) => updateBlock(cardModeBlock.id, html, plainText)}
        onBlur={(html, plainText) => updateBlock(cardModeBlock.id, html, plainText)}
        onMediaResizeStart={startMediaResize}
        onClose={closeCardWindow}
        onDrag={dragCardWindow}
      />
    );
  }

  return state.shell === 'typora-base' ? <TyporaShell {...sharedShellProps} /> : <NativeShell {...sharedShellProps} />;
}
