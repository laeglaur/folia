import type { AppState, Block, ContentThemeId, Notebook, NotebookIconPack, OperationLogEntry, Page, ShellId } from './types';
import { localDateKey, type CalendarEntry } from './app-utils';
import type { CalendarBlockPayload, NotebookTreePayload, PageDocumentPayload } from './state';

export const mergePageDocument = (state: AppState, document: PageDocumentPayload, desktop: boolean): AppState => {
  const pageIndex = state.pages.findIndex((page) => page.id === document.page.id);
  const nextPageIds = document.content.blocks.map((block) => block.id);
  if (desktop) {
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

export const mergeNotebookTree = (state: AppState, tree: NotebookTreePayload): AppState => {
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

export const applyShellToViewState = (current: AppState, shell: ShellId): AppState => ({
  ...current,
  shell,
  theme: shell === 'native-ledger' ? 'ledger' : shell === 'native-garden' ? 'garden' : current.theme
});

export const applyContentThemeToViewState = (current: AppState, contentTheme: ContentThemeId): AppState => ({
  ...current,
  contentTheme,
  shell: contentTheme.startsWith('typora-') ? 'typora-base' : current.shell
});

export const applyActiveNotebookToViewState = (
  current: AppState,
  notebookId: string,
  fallbackPageId: string | null
): AppState => ({
  ...current,
  activeNotebookId: notebookId,
  activePageId: fallbackPageId ?? current.activePageId
});

export const applyActivePageToViewState = (
  current: AppState,
  pageId: string
): AppState => ({
  ...current,
  activePageId: pageId
});

export const applyPageExpandedToggleToViewState = (
  current: AppState,
  pageId: string
): AppState => ({
  ...current,
  expandedPageIds: current.expandedPageIds.includes(pageId)
    ? current.expandedPageIds.filter((id) => id !== pageId)
    : [...current.expandedPageIds, pageId]
});

export const applyPageNavigationToViewState = (
  current: AppState,
  pageId: string
): AppState => {
  const page = current.pages.find((candidate) => candidate.id === pageId);
  if (!page) return current;
  return {
    ...current,
    activeNotebookId: page.notebookId,
    activePageId: pageId,
    expandedPageIds: [
      ...new Set([
        ...current.expandedPageIds,
        ...ancestorsOfPage(pageId, current.pages).map((ancestor) => ancestor.id)
      ])
    ]
  };
};

export const applyOpenCardBlockToViewState = (
  current: AppState,
  blockId: string | null
): AppState => ({
  ...current,
  openCardWindowBlockId: blockId
});

export const applyShowPageMetadataToViewState = (
  current: AppState,
  showPageMetadata: boolean
): AppState => ({
  ...current,
  showPageMetadata
});

export const applyNotebookIconPackToViewState = (
  current: AppState,
  notebookId: string,
  iconPack: NotebookIconPack
): AppState => ({
  ...current,
  notebooks: current.notebooks.map((notebook) =>
    notebook.id === notebookId
      ? { ...notebook, metadata: { ...notebook.metadata, iconPack } }
      : notebook
  )
});

export const applyNotebookIconToViewState = (
  current: AppState,
  notebookId: string,
  iconId: string | null
): AppState => ({
  ...current,
  notebooks: current.notebooks.map((notebook) =>
    notebook.id === notebookId
      ? { ...notebook, metadata: { ...notebook.metadata, iconId: iconId ?? undefined } }
      : notebook
  )
});

export const applyPageIconToViewState = (
  current: AppState,
  pageId: string,
  iconId: string | null
): AppState => ({
  ...current,
  pages: current.pages.map((page) =>
    page.id === pageId
      ? { ...page, metadata: { ...page.metadata, iconId: iconId ?? undefined } }
      : page
  )
});

export const mergePageBlocksForView = (current: AppState, page: Page, blocks: Block[], desktop: boolean) =>
  desktop
    ? blocks
    : [...current.blocks.filter((block) => block.pageId !== page.id), ...blocks];

export const applyPageDocumentToViewState = (
  current: AppState,
  page: Page,
  blocks: Block[],
  operation: OperationLogEntry | null,
  desktop: boolean
) => ({
  ...current,
  pages: current.pages.map((candidate) => (candidate.id === page.id ? page : candidate)),
  blocks: mergePageBlocksForView(current, page, blocks, desktop),
  operations: operation ? [...current.operations, operation] : current.operations
});

export const applyBlockDeleteToViewState = (
  current: AppState,
  page: Page,
  blocks: Block[],
  deletedBlockId: string,
  operation: OperationLogEntry,
  desktop: boolean
): AppState => {
  const next = applyPageDocumentToViewState(current, page, blocks, operation, desktop);
  return {
    ...next,
    openCardWindowBlockId: current.openCardWindowBlockId === deletedBlockId ? null : current.openCardWindowBlockId
  };
};

export const blocksForPage = (page: Page, blocks: Block[]) => {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  return page.blockIds.map((blockId) => blocksById.get(blockId)).filter(Boolean) as Block[];
};

export const blocksForCurrentPage = (page: Page, state: AppState, activePageBlocks: Block[]) =>
  blocksForPage(page, page.id === state.activePageId ? activePageBlocks : state.blocks);

export const removeBlocksForPagesFromView = (current: AppState, pageIds: Set<string>) =>
  current.blocks.filter((block) => !pageIds.has(block.pageId));

export const descendantsOfPage = (pageId: string, pages: Page[]) => {
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

export const ancestorsOfPage = (pageId: string, pages: Page[]) => {
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

export const applyPageTreeDeleteToViewState = (
  current: AppState,
  pageId: string,
  fallbackPage: Page | null,
  operation: OperationLogEntry
) => {
  const rootPage = current.pages.find((candidate) => candidate.id === pageId);
  if (!rootPage) return current;
  const currentDeletedPages = [rootPage, ...descendantsOfPage(pageId, current.pages)];
  const currentDeletedPageIds = new Set(currentDeletedPages.map((deletedPage) => deletedPage.id));
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
    blocks: removeBlocksForPagesFromView(current, currentDeletedPageIds),
    activeNotebookId,
    activePageId,
    expandedPageIds: current.expandedPageIds.filter((id) => !currentDeletedPageIds.has(id)),
    operations: [...current.operations, operation]
  };
};

export const applyNotebookDeleteToViewState = (
  current: AppState,
  notebookId: string,
  operation: OperationLogEntry
) => {
  const currentDeletedPages = current.pages.filter((page) => page.notebookId === notebookId);
  const currentDeletedPageIds = new Set(currentDeletedPages.map((page) => page.id));
  const notebooks = current.notebooks.filter((candidate) => candidate.id !== notebookId);
  const activeNotebook = current.activeNotebookId === notebookId ? notebooks[0] : current.notebooks.find((candidate) => candidate.id === current.activeNotebookId);
  const activePageId = activeNotebook?.pageIds.find((id) => !currentDeletedPageIds.has(id)) ?? current.activePageId;

  return {
    ...current,
    notebooks,
    pages: current.pages.filter((page) => !currentDeletedPageIds.has(page.id)),
    blocks: removeBlocksForPagesFromView(current, currentDeletedPageIds),
    activeNotebookId: activeNotebook?.id ?? notebooks[0]?.id ?? current.activeNotebookId,
    activePageId,
    expandedPageIds: current.expandedPageIds.filter((id) => !currentDeletedPageIds.has(id)),
    operations: [...current.operations, operation]
  };
};

export const applyPageTreeDuplicateToViewState = (
  current: AppState,
  sourceNotebookId: string,
  updatedNotebookPageIds: string[],
  duplicatedPages: Page[],
  duplicatedBlocks: Block[],
  duplicatedRootId: string,
  operation: OperationLogEntry,
  desktop: boolean
) => ({
  ...current,
  pages: [...current.pages, ...duplicatedPages],
  blocks: [
    ...current.blocks.filter((block) => block.pageId !== duplicatedRootId),
    ...(desktop ? duplicatedBlocks.filter((block) => block.pageId === duplicatedRootId) : duplicatedBlocks)
  ],
  notebooks: current.notebooks.map((candidate) => (
    candidate.id === sourceNotebookId ? { ...candidate, pageIds: updatedNotebookPageIds } : candidate
  )),
  activeNotebookId: sourceNotebookId,
  activePageId: duplicatedRootId,
  expandedPageIds: [...new Set([...current.expandedPageIds, ...duplicatedPages.map((page) => page.id)])],
  operations: [...current.operations, operation]
});

export const applyNotebookDuplicateToViewState = (
  current: AppState,
  notebook: Notebook,
  firstPageId: string | null,
  duplicatedPages: Page[],
  duplicatedBlocks: Block[],
  operation: OperationLogEntry,
  desktop: boolean
) => ({
  ...current,
  notebooks: [...current.notebooks, notebook],
  pages: [...current.pages, ...duplicatedPages],
  blocks: [
    ...current.blocks.filter((block) => block.pageId !== (firstPageId ?? '')),
    ...(desktop ? duplicatedBlocks.filter((block) => block.pageId === (firstPageId ?? '')) : duplicatedBlocks)
  ],
  activeNotebookId: notebook.id,
  activePageId: firstPageId ?? current.activePageId,
  expandedPageIds: [...new Set([...current.expandedPageIds, ...duplicatedPages.map((page) => page.id)])],
  operations: [...current.operations, operation]
});

export const applyNotebookCreateToViewState = (
  current: AppState,
  notebook: Notebook,
  page: Page,
  operation: OperationLogEntry
) => ({
  ...current,
  notebooks: [...current.notebooks, notebook],
  pages: [...current.pages, page],
  activeNotebookId: notebook.id,
  activePageId: page.id,
  operations: [...current.operations, operation]
});

export const applyNotebookRenameToViewState = (
  current: AppState,
  notebookId: string,
  name: string,
  operation: OperationLogEntry
) => ({
  ...current,
  notebooks: current.notebooks.map((candidate) => (candidate.id === notebookId ? { ...candidate, name } : candidate)),
  operations: [...current.operations, operation]
});

export const applyPageCreateToViewState = (
  current: AppState,
  page: Page,
  parentNotebookId: string,
  operation: OperationLogEntry
) => ({
  ...current,
  pages: [...current.pages, page],
  notebooks: current.notebooks.map((notebook) =>
    notebook.id === parentNotebookId ? { ...notebook, pageIds: [...notebook.pageIds, page.id] } : notebook
  ),
  activePageId: page.id,
  operations: [...current.operations, operation]
});

export const applyPageRenameToViewState = (
  current: AppState,
  pageId: string,
  title: string,
  operation: OperationLogEntry
) => ({
  ...current,
  pages: current.pages.map((candidate) => (candidate.id === pageId ? { ...candidate, title } : candidate)),
  operations: [...current.operations, operation]
});

export const applyPageMoveToViewState = (
  current: AppState,
  pageId: string,
  parentId: string | null,
  operation: OperationLogEntry
) => ({
  ...current,
  pages: current.pages.map((page) => (page.id === pageId ? { ...page, parentId, updatedAt: new Date().toISOString() } : page)),
  expandedPageIds: parentId && !current.expandedPageIds.includes(parentId) ? [...current.expandedPageIds, parentId] : current.expandedPageIds,
  operations: [...current.operations, operation]
});

export const applyMarkdownFilesImportToViewState = (
  current: AppState,
  targetNotebookId: string,
  importedPages: Page[],
  importedBlocks: Block[],
  operation: OperationLogEntry,
  desktop: boolean
) => {
  const importedPageIds = importedPages.map((page) => page.id);
  const activePageId = importedPageIds[importedPageIds.length - 1] ?? current.activePageId;
  const activeImportedBlocks = importedBlocks.filter((block) => block.pageId === activePageId);

  return {
    ...current,
    pages: [...current.pages, ...importedPages],
    blocks: desktop ? activeImportedBlocks : [...current.blocks, ...importedBlocks],
    notebooks: current.notebooks.map((notebook) =>
      notebook.id === targetNotebookId
        ? { ...notebook, pageIds: [...notebook.pageIds, ...importedPageIds] }
        : notebook
    ),
    activePageId,
    expandedPageIds: [...new Set([...current.expandedPageIds, ...importedPageIds])],
    operations: [...current.operations, operation]
  };
};

export const applyMarkdownFolderImportToViewState = (
  current: AppState,
  notebook: Notebook,
  pages: Page[],
  blocks: Block[],
  activePageId: string,
  expandedPageIds: string[],
  operation: OperationLogEntry,
  desktop: boolean
) => ({
  ...current,
  notebooks: [...current.notebooks, notebook],
  pages: [...current.pages, ...pages],
  blocks: desktop ? current.blocks : [...current.blocks, ...blocks],
  activeNotebookId: notebook.id,
  activePageId,
  expandedPageIds: [...new Set([...current.expandedPageIds, ...expandedPageIds])],
  operations: [...current.operations, operation]
});

export const applyMarkdownFolderPageDocumentToViewState = (
  current: AppState,
  page: Page,
  blocks: Block[],
  desktop: boolean
) => current.activePageId === page.id
  ? mergePageDocument(current, { page, content: { contentType: 'page_document', version: 1, blocks } }, desktop)
  : {
      ...current,
      pages: current.pages.map((candidate) => (candidate.id === page.id ? page : candidate))
    };

export const applyRestoredPageDocumentToViewState = (
  current: AppState,
  document: PageDocumentPayload,
  operation: OperationLogEntry,
  desktop: boolean
): AppState => {
  const merged = mergePageDocument(current, document, desktop);
  return { ...merged, operations: [...current.operations, operation] };
};

export const calendarEntriesFromPayloads = (payloads: CalendarBlockPayload[]) => {
  const entries = new Map<string, CalendarEntry[]>();
  payloads.forEach((entry) => {
    const key = localDateKey(entry.block.createdAt);
    if (!key) return;
    entries.set(key, [...(entries.get(key) ?? []), entry]);
  });
  return entries;
};

export const legacyCalendarEntriesFromState = (state: AppState, notebookId: string) => {
  const pagesById = new Map(state.pages.filter((page) => page.notebookId === notebookId).map((page) => [page.id, page]));
  const entries = new Map<string, CalendarEntry[]>();
  state.blocks.forEach((block) => {
    const page = pagesById.get(block.pageId);
    if (!page) return;
    const key = localDateKey(block.createdAt);
    if (!key) return;
    entries.set(key, [...(entries.get(key) ?? []), { block, page }]);
  });
  return entries;
};

export const legacyPinnedBlocksFromState = (state: AppState) => state.blocks.filter((block) => block.pinned);

export const legacyOpenCardBlockFromState = (state: AppState) =>
  state.blocks.find((block) => block.id === state.openCardWindowBlockId) ?? null;

export const legacyCardModeBlockFromState = (state: AppState, blockId: string | null) =>
  blockId ? state.blocks.find((block) => block.id === blockId) ?? null : null;
