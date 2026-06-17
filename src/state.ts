import type { AppState, Block, ContentThemeId, Notebook, NotebookMetadata, OperationLogEntry, Page, PageMetadata, ShellId, ThemeId } from './types';
import { contentThemeIds } from './typora-theme-registry';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { marked } from 'marked';

const STORAGE_KEY = 'block-first-notebook.state.v1';

const now = () => new Date().toISOString();

export const createId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

const createEmptyPageMetadata = (sourceFilename?: string): PageMetadata => ({
  sourceFilename,
  tags: [],
  aliases: [],
  frontmatter: {}
});

const createEmptyNotebookMetadata = (): NotebookMetadata => ({
  iconPack: null
});

const stringifyFrontmatter = (frontmatter: Record<string, string | string[]>) => {
  const lines: string[] = [];
  Object.entries(frontmatter).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      value.forEach((item) => lines.push(`  - ${item}`));
      return;
    }
    lines.push(`${key}: ${value}`);
  });
  return lines.join('\n');
};

const extractFrontmatterRaw = (markdown: string) => {
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return match ? match[1].trimEnd() : '';
};

const starterPageId = createId('page');
const starterBlockOne = createId('block');
const starterBlockTwo = createId('block');
const starterNotebookId = createId('notebook');

export const createInitialState = (): AppState => ({
  notebooks: [
    {
      id: starterNotebookId,
      name: 'Notebook',
      pageIds: [starterPageId],
      metadata: createEmptyNotebookMetadata()
    }
  ],
  pages: [
    {
      id: starterPageId,
      notebookId: starterNotebookId,
      parentId: null,
      title: 'Inbox',
      blockIds: [starterBlockOne, starterBlockTwo],
      metadata: createEmptyPageMetadata(),
      createdAt: now(),
      updatedAt: now()
    }
  ],
  blocks: [
    {
      id: starterBlockOne,
      pageId: starterPageId,
      content: {
        html: '<p>Write a thought, press <strong>⌘ Enter</strong>, and it becomes a block.</p>',
        plainText: 'Write a thought, press Command Enter, and it becomes a block.'
      },
      collapsed: false,
      pinned: true,
      createdAt: now(),
      updatedAt: now()
    },
    {
      id: starterBlockTwo,
      pageId: starterPageId,
      content: {
        html: '<ul><li>Every bullet should be collapsible by default.</li><li>Blocks can be pinned into desktop cards later.</li></ul>',
        plainText: 'Every bullet should be collapsible by default. Blocks can be pinned into desktop cards later.'
      },
      collapsed: false,
      pinned: false,
      createdAt: now(),
      updatedAt: now()
    }
  ],
  activeNotebookId: starterNotebookId,
  activePageId: starterPageId,
  shell: 'native-garden',
  theme: 'garden',
  contentTheme: 'notebook',
  openCardWindowBlockId: null,
  expandedPageIds: [starterPageId],
  operations: [],
  showPageMetadata: true
});

const normalizeTheme = (theme?: string): ThemeId => {
  if (theme === 'archive') return 'ledger';
  if (theme === 'garden' || theme === 'ledger') return theme;
  return 'garden';
};

const shellIds = new Set<ShellId>(['native-garden', 'native-ledger', 'typora-base']);

const shellFromLegacyState = (theme: ThemeId, contentTheme: ContentThemeId): ShellId => {
  if (contentTheme.startsWith('typora-') && contentTheme !== 'typora-base') return 'typora-base';
  return theme === 'ledger' ? 'native-ledger' : 'native-garden';
};

const normalizeShell = (shell: string | undefined, theme: ThemeId, contentTheme: ContentThemeId): ShellId => {
  if (shellIds.has(shell as ShellId)) return shell as ShellId;
  return shellFromLegacyState(theme, contentTheme);
};

const normalizeContentTheme = (contentTheme?: string): ContentThemeId => {
  if (contentThemeIds.has(contentTheme as ContentThemeId)) return contentTheme as ContentThemeId;
  return 'notebook';
};

const shouldConvertStoredMediaSrc = (src: string) => {
  if (!src) return false;
  if (src.startsWith('/app-assets/') || src.startsWith('data:')) return false;
  if (/^https?:\/\/asset\.localhost\//i.test(src)) return true;
  if (/^https?:\/\//i.test(src)) return false;
  return src.startsWith('asset://localhost/')
    || src.startsWith('file://')
    || src.startsWith('/Users/')
    || src.startsWith('/private/')
    || src.startsWith('/Volumes/')
    || src.startsWith('/var/');
};

const decodeRepeatedly = (value: string) => {
  let decoded = value;
  for (let index = 0; index < 8; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
};

const normalizeAbsolutePath = (value: string) => {
  const decoded = decodeRepeatedly(value);
  return decoded.replace(/^\/+(?=(Users|private|Volumes|var)\b)/, '/');
};

const pathFromStoredMediaSrc = (src: string) => {
  try {
    if (src.startsWith('asset://localhost/') || src.startsWith('file://')) {
      return normalizeAbsolutePath(new URL(src).pathname);
    }
    if (/^https?:\/\/asset\.localhost\//i.test(src)) {
      return normalizeAbsolutePath(new URL(src).pathname);
    }
  } catch {
    return null;
  }
  if (src.startsWith('/Users/') || src.startsWith('/private/') || src.startsWith('/Volumes/') || src.startsWith('/var/')) {
    return normalizeAbsolutePath(src);
  }
  return null;
};

const assetIdFromStoredMediaSrc = (src: string) => {
  const path = pathFromStoredMediaSrc(src);
  const filename = path?.split('/').pop() ?? '';
  const match = filename.match(/^([a-f0-9]{64})(?:\.[^.]+)?$/i);
  return match ? `asset_${match[1].toLowerCase()}` : null;
};

const convertStoredMediaSrc = (src: string) => {
  if (!isTauri() || !shouldConvertStoredMediaSrc(src)) return src;
  const path = pathFromStoredMediaSrc(src);
  return path ? convertFileSrc(path) : src;
};

const normalizeStoredMediaUrls = (html: string) => {
  if (!isTauri()) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>('img[src], video[src], audio[src]').forEach((element) => {
    const src = element.getAttribute('src');
    if (!src) return;
    if (!element.getAttribute('data-asset-id')) {
      const inferredAssetId = assetIdFromStoredMediaSrc(src);
      if (inferredAssetId) element.setAttribute('data-asset-id', inferredAssetId);
    }
    element.setAttribute('src', convertStoredMediaSrc(src));
  });
  return container.innerHTML;
};

const normalizeState = (state: AppState): AppState => {
  const theme = normalizeTheme(state.theme);
  const contentTheme = normalizeContentTheme(state.contentTheme);
  const shell = normalizeShell(state.shell, theme, contentTheme);
  const nativeTheme = shell === 'native-ledger' ? 'ledger' : 'garden';

  return {
    ...state,
    notebooks: state.notebooks.map((notebook) => ({
      ...notebook,
      pageIds: notebook.pageIds ?? state.pages.filter((page) => page.notebookId === notebook.id).map((page) => page.id),
      metadata: {
        ...createEmptyNotebookMetadata(),
        ...(notebook.metadata ?? {}),
        iconPack: notebook.metadata?.iconPack ?? null
      }
    })),
    pages: state.pages.map((page) => ({
      ...page,
      parentId: page.parentId ?? null,
      blockOrder: page.blockOrder === 'desc' ? 'desc' : 'asc',
      metadata: {
        ...createEmptyPageMetadata(),
        ...(page.metadata ?? {}),
        tags: page.metadata?.tags ?? [],
        aliases: page.metadata?.aliases ?? [],
        frontmatter: page.metadata?.frontmatter ?? {},
        frontmatterRaw: page.metadata?.frontmatterRaw ?? stringifyFrontmatter(page.metadata?.frontmatter ?? {})
      }
    })),
    blocks: state.blocks.map((block) => ({
      ...block,
      content: {
        ...block.content,
        html: normalizeStoredMediaUrls(block.content.html)
      }
    })),
    shell,
    theme: shell === 'typora-base' ? theme : nativeTheme,
    contentTheme,
    openCardWindowBlockId: state.openCardWindowBlockId ?? null,
    expandedPageIds: state.expandedPageIds ?? state.pages.map((page) => page.id),
    operations: state.operations ?? [],
    showPageMetadata: state.showPageMetadata ?? true
  };
};

const extensionForMime = (mimeType: string) => {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'video/webm':
      return 'webm';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/flac':
      return 'flac';
    default:
      return 'bin';
  }
};

const bytesFromDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { mimeType, bytes: Array.from(bytes) };
};

const localizeDataUrlMediaAssets = async (html: string, blockId: string) => {
  if (!isTauri() || !html.includes('data:')) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  const media = Array.from(container.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>('img[src^="data:"], video[src^="data:"], audio[src^="data:"]'));

  await Promise.all(media.map(async (element, index) => {
    const dataUrl = element.getAttribute('src') ?? '';
    const parsed = bytesFromDataUrl(dataUrl);
    if (!parsed) return;
    const filename = `${blockId}-attachment-${index + 1}.${extensionForMime(parsed.mimeType)}`;
    try {
      const imported = await invoke<ImportedAsset>('import_asset_bytes', {
        filename,
        mimeType: parsed.mimeType,
        bytes: parsed.bytes
      });
      element.setAttribute('src', convertFileSrc(imported.storedPath));
      element.setAttribute('data-asset-id', imported.id);
      element.removeAttribute('data-original-src');
    } catch (error) {
      console.warn('Could not import inline data asset.', filename, error);
      element.removeAttribute('src');
      element.setAttribute('data-asset-error', 'inline asset could not be stored');
    }
  }));

  return container.innerHTML;
};

const filenameFromMediaSrc = (src: string, fallback: string) => {
  try {
    const filename = decodeURIComponent(new URL(src).pathname.split('/').pop() || '');
    return filename || fallback;
  } catch {
    return fallback;
  }
};

const localPathFromMediaSrc = (src: string) => {
  if (src.startsWith('file://')) {
    try {
      return normalizeAbsolutePath(new URL(src).pathname);
    } catch {
      return null;
    }
  }
  if (src.startsWith('/Users/') || src.startsWith('/private/') || src.startsWith('/Volumes/') || src.startsWith('/var/')) return normalizeAbsolutePath(src);
  return null;
};

const localizePersistentMediaAssets = async (html: string, blockId: string) => {
  if (!isTauri()) return html;
  if (!/<(?:img|video|audio)\b/i.test(html)) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  const media = Array.from(container.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>('img[src], video[src], audio[src]'));
  if (!media.length) return html;

  await Promise.all(media.map(async (element, index) => {
    const src = element.getAttribute('src')?.trim() ?? '';
    if (!src || element.getAttribute('data-asset-id') || src.startsWith('/app-assets/')) return;
    if (src.startsWith('asset://localhost/') || /^https?:\/\/asset\.localhost\//i.test(src)) {
      const id = assetIdFromStoredMediaSrc(src);
      if (id) element.setAttribute('data-asset-id', id);
      element.setAttribute('src', convertStoredMediaSrc(src));
      return;
    }

    try {
      if (src.startsWith('data:')) {
        const parsed = bytesFromDataUrl(src);
        if (!parsed) return;
        const filename = `${blockId}-media-${index + 1}.${extensionForMime(parsed.mimeType)}`;
        const imported = await invoke<ImportedAsset>('import_asset_bytes', {
          filename,
          mimeType: parsed.mimeType,
          bytes: parsed.bytes
        });
        element.setAttribute('src', convertFileSrc(imported.storedPath));
        element.setAttribute('data-asset-id', imported.id);
        return;
      }

      if (src.startsWith('blob:')) {
        const response = await fetch(src);
        const blob = await response.blob();
        const mimeType = blob.type || 'application/octet-stream';
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        const imported = await invoke<ImportedAsset>('import_asset_bytes', {
          filename: `${blockId}-blob-${index + 1}.${extensionForMime(mimeType)}`,
          mimeType,
          bytes
        });
        element.setAttribute('src', convertFileSrc(imported.storedPath));
        element.setAttribute('data-asset-id', imported.id);
        return;
      }

      const localPath = localPathFromMediaSrc(src);
      if (localPath) {
        const imported = await invoke<ImportedAsset>('import_local_asset', { sourcePath: localPath });
        element.setAttribute('src', convertFileSrc(imported.storedPath));
        element.setAttribute('data-asset-id', imported.id);
        element.setAttribute('data-original-src', src);
        return;
      }

      if (/^https?:\/\//i.test(src)) {
        const imported = await invoke<ImportedAsset>('import_remote_asset', { url: src });
        element.setAttribute('src', convertFileSrc(imported.storedPath));
        element.setAttribute('data-asset-id', imported.id);
        element.setAttribute('data-original-src', src);
      }
    } catch (error) {
      console.warn('Could not localize persistent media asset.', filenameFromMediaSrc(src, `${blockId}-media-${index + 1}`), error);
    }
  }));

  return container.innerHTML;
};

const sanitizeLargePayloads = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `[data-url omitted: ${value.length} chars]`;
    if (value.length > 200_000) return `${value.slice(0, 200_000)}\n[truncated: ${value.length} chars]`;
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeLargePayloads);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeLargePayloads(entry)]));
  }
  return value;
};

const prepareStateForPersistence = async (state: AppState): Promise<AppState> => {
  const blocks = isTauri()
    ? await Promise.all(state.blocks.map(async (block) => {
      const html = await localizePersistentMediaAssets(await localizeDataUrlMediaAssets(block.content.html, block.id), block.id);
      return html === block.content.html ? block : { ...block, content: { ...block.content, html } };
    }))
    : state.blocks;

  return {
    ...state,
    blocks,
    operations: state.operations.slice(-500).map((entry) => ({
      ...entry,
      payload: sanitizeLargePayloads(entry.payload)
    })) as OperationLogEntry[]
  };
};

const extractReferencedAssetIds = (state: AppState) => {
  const ids = new Set<string>();
  state.blocks.forEach((block) => {
    const container = document.createElement('div');
    container.innerHTML = block.content.html;
    container.querySelectorAll<HTMLElement>('[data-asset-id]').forEach((element) => {
      const id = element.dataset.assetId?.trim();
      if (id) ids.add(id);
    });
    container.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>('img[src], video[src], audio[src]').forEach((element) => {
      const id = assetIdFromStoredMediaSrc(element.getAttribute('src') ?? '');
      if (id) ids.add(id);
    });
  });
  state.notebooks.forEach((notebook) => {
    notebook.metadata.iconPack?.icons.forEach((icon) => {
      if (icon.assetId) ids.add(icon.assetId);
    });
  });
  return [...ids];
};

const cleanupOrphanAttachments = async (state: AppState) => {
  if (!isTauri()) return;
  try {
    await invoke<AttachmentCleanupResult>('cleanup_orphan_attachments', {
      referencedAssetIds: extractReferencedAssetIds(state)
    });
  } catch (error) {
    console.warn('Could not clean orphan attachments.', error);
  }
};

type PersistenceBackend = {
  persistNativeSnapshot: (stateJson: string) => Promise<void>;
  cleanupNativeAttachments: (state: AppState) => Promise<void>;
  persistBrowserSnapshot: (stateJson: string) => void;
};

type PendingPersistenceRequest = {
  state: AppState;
  resolve: () => void;
};

export const createQueuedPersistenceSaver = (backend: PersistenceBackend) => {
  let draining = false;
  let pendingRequests: PendingPersistenceRequest[] = [];

  const drain = async () => {
    if (draining) return;
    draining = true;

    try {
      while (pendingRequests.length) {
        const batch = pendingRequests;
        pendingRequests = [];
        const latestRequest = batch[batch.length - 1];
        if (!latestRequest) {
          batch.forEach(({ resolve }) => resolve());
          continue;
        }

        const persistableState = await prepareStateForPersistence(latestRequest.state);
        const stateJson = JSON.stringify(persistableState);

        if (isTauri()) {
          try {
            await backend.persistNativeSnapshot(stateJson);
            if (!pendingRequests.length) {
              await backend.cleanupNativeAttachments(persistableState);
            }
          } catch (error) {
            console.warn('Could not persist notebook state to SQLite.', error);
          }
        } else {
          try {
            backend.persistBrowserSnapshot(stateJson);
          } catch (error) {
            console.warn('Could not persist notebook state to browser localStorage.', error);
          }
        }

        batch.forEach(({ resolve }) => resolve());
      }
    } finally {
      draining = false;
    }
  };

  return {
    saveState: (state: AppState) => new Promise<void>((resolve) => {
      pendingRequests.push({ state, resolve });
      void drain();
    })
  };
};

const persistenceSaver = createQueuedPersistenceSaver({
  persistNativeSnapshot: async (stateJson: string) => {
    await invoke('save_state_snapshot', { stateJson });
  },
  cleanupNativeAttachments: async () => {},
  persistBrowserSnapshot: (stateJson: string) => {
    window.localStorage.setItem(STORAGE_KEY, stateJson);
  }
});

export const loadState = (): AppState => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createInitialState();
  }

  try {
    return normalizeState(JSON.parse(raw) as AppState);
  } catch {
    return createInitialState();
  }
};

export const loadPersistentState = async (): Promise<AppState> => {
  const browserState = loadState();
  if (!isTauri()) return browserState;

  try {
    const raw = await invoke<string | null>('load_normalized_state');
    if (raw) return normalizeState(JSON.parse(raw) as AppState);
    const snapshotRaw = await invoke<string | null>('load_state_snapshot');
    if (snapshotRaw) return normalizeState(JSON.parse(snapshotRaw) as AppState);
    await saveState(browserState);
    return browserState;
  } catch (error) {
    console.warn('Falling back to browser notebook storage.', error);
    return browserState;
  }
};

export const loadFullBackupState = async (): Promise<AppState> => {
  if (!isTauri()) return loadState();
  const raw = await invoke<string | null>('load_normalized_state');
  if (!raw) return loadState();
  return normalizeState(JSON.parse(raw) as AppState);
};

export const saveState = async (state: AppState) => persistenceSaver.saveState(state);

export const listNotebookTree = async (): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('list_notebook_tree');
};

export const loadPageDocument = async (pageId: string): Promise<PageDocumentPayload | null> => {
  if (!isTauri()) return null;
  return invoke<PageDocumentPayload | null>('load_page_document', { pageId });
};

export const loadPageDocuments = async (pageIds: string[]): Promise<PageDocumentPayload[]> => {
  if (!isTauri() || !pageIds.length) return [];
  return invoke<PageDocumentPayload[]>('load_page_documents', { pageIds });
};

export const loadBlockDocument = async (blockId: string): Promise<PageDocumentPayload | null> => {
  if (!isTauri()) return null;
  return invoke<PageDocumentPayload | null>('load_block_document', { blockId });
};

export const listPinnedBlocks = async (): Promise<PinnedBlockPayload[]> => {
  if (!isTauri()) return [];
  return invoke<PinnedBlockPayload[]>('list_pinned_blocks');
};

export const listCalendarBlocks = async (notebookId: string, month: string): Promise<CalendarBlockPayload[]> => {
  if (!isTauri()) return [];
  return invoke<CalendarBlockPayload[]>('list_calendar_blocks', { notebookId, month });
};

export const searchPages = async (query: string, limit = 30): Promise<PageSearchResult[]> => {
  if (!isTauri()) return [];
  return invoke<PageSearchResult[]>('search_pages', { query, limit });
};

export const persistImportBatch = async (batch: ImportBatchPayload): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('persist_import_batch', { batch });
};

export const persistEntityRename = async (request: RenameEntityRequest): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('rename_entity', { request });
};

export const persistPageMove = async (request: MovePageRequest): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('move_page', { request });
};

export const persistNotebookCreate = async (request: CreateNotebookRequest): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('create_notebook', { request });
};

export const persistPageCreate = async (request: CreatePageRequest): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('create_page', { request });
};

export const persistPageDocument = async (request: SavePageDocumentRequest): Promise<PageDocumentPayload | null> => {
  if (!isTauri()) return null;
  const blocks = await Promise.all(request.blocks.map(async (block) => {
    const html = await localizePersistentMediaAssets(block.content.html, block.id);
    return html === block.content.html ? block : { ...block, content: { ...block.content, html } };
  }));
  return invoke<PageDocumentPayload>('save_page_document', { request: { ...request, blocks } });
};

export const persistPageMetadata = async (request: UpdatePageMetadataRequest): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('update_page_metadata', { request });
};

export const listPageRevisions = async (pageId: string, limit = 20): Promise<PageRevisionPayload[]> => {
  if (!isTauri()) return [];
  return invoke<PageRevisionPayload[]>('list_page_revisions', { pageId, limit });
};

export const restorePageRevision = async (request: RestorePageRevisionRequest): Promise<PageDocumentPayload | null> => {
  if (!isTauri()) return null;
  return invoke<PageDocumentPayload>('restore_page_revision', { request });
};

export type TrashItemPayload = {
  id: number;
  itemType: 'page' | 'notebook' | 'block' | string;
  title: string;
  sourceId: string;
  parentId: string | null;
  deletedAt: string;
  sizeBytes: number;
};

export type DeleteBlockRequest = {
  pageId: string;
  blockId: string;
  operation: OperationLogEntry | null;
};

export type RestoreTrashItemRequest = {
  trashId: number;
  operation: OperationLogEntry | null;
};

export const deleteBlock = async (request: DeleteBlockRequest): Promise<PageDocumentPayload | null> => {
  if (!isTauri()) return null;
  return invoke<PageDocumentPayload>('delete_block', { request });
};

export const listTrashItems = async (limit = 100): Promise<TrashItemPayload[]> => {
  if (!isTauri()) return [];
  return invoke<TrashItemPayload[]>('list_trash_items', { limit });
};

export const restoreTrashItem = async (request: RestoreTrashItemRequest): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('restore_trash_item', { request });
};

export type AttachmentCleanupResult = {
  removedCount: number;
  removedBytes: number;
};

export const emptyTrash = async (): Promise<AttachmentCleanupResult | null> => {
  if (!isTauri()) return null;
  return invoke<AttachmentCleanupResult>('empty_trash');
};

export const persistPageTreeDelete = async (request: DeletePageTreeRequest): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('delete_page_tree', { request });
};

export const persistNotebookDelete = async (request: DeleteNotebookRequest): Promise<NotebookTreePayload | null> => {
  if (!isTauri()) return null;
  return invoke<NotebookTreePayload>('delete_notebook', { request });
};

export const loadDatabaseBootstrap = async (): Promise<DatabaseBootstrapPayload | null> => {
  if (!isTauri()) return null;
  const tree = await invoke<NotebookTreePayload | null>('list_notebook_tree');
  if (!tree) return null;
  const notebook = tree.notebooks[0];
  const activeNotebookId = notebook?.id ?? '';
  const activePageId = notebook?.pageIds[0] ?? tree.pages[0]?.id ?? '';
  return {
    notebooks: tree.notebooks,
    pages: tree.pages,
    activeNotebookId,
    activePageId
  };
};

export const loadWorkspacePreferences = async (): Promise<WorkspacePreferencesPayload | null> => {
  if (!isTauri()) return null;
  const preferences = await invoke<WorkspacePreferencesPayload>('load_workspace_preferences');
  return {
    ...preferences,
    shell: preferences.shell === 'native-ledger' || preferences.shell === 'typora-base' ? preferences.shell : 'native-garden',
    theme: preferences.theme === 'ledger' ? 'ledger' : 'garden',
    contentTheme: contentThemeIds.has(preferences.contentTheme) ? preferences.contentTheme : 'notebook',
    openCardWindowBlockId: preferences.openCardWindowBlockId ?? null,
    expandedPageIds: preferences.expandedPageIds ?? [],
    showPageMetadata: preferences.showPageMetadata ?? true
  };
};

export const saveWorkspacePreferences = async (request: WorkspacePreferencesRequest): Promise<void> => {
  if (!isTauri()) return;
  await invoke('save_workspace_preferences', { request });
};

export const appendOperation = (
  state: AppState,
  entry: Omit<OperationLogEntry, 'id' | 'timestamp'>
): OperationLogEntry[] => [
  ...state.operations,
  {
    id: createId('op'),
    timestamp: now(),
    ...entry
  }
];

export const createNotebook = (name = 'New notebook'): Notebook => ({
  id: createId('notebook'),
  name,
  pageIds: [],
  metadata: createEmptyNotebookMetadata()
});

export const createPage = (notebookId: string, title = 'Untitled', parentId: string | null = null): Page => ({
  id: createId('page'),
  notebookId,
  parentId,
  title,
  blockIds: [],
  blockOrder: 'asc',
  metadata: createEmptyPageMetadata(),
  createdAt: now(),
  updatedAt: now()
});

export const createBlock = (pageId: string, html: string, plainText: string): Block => ({
  id: createId('block'),
  pageId,
  content: { html, plainText },
  collapsed: false,
  pinned: false,
  createdAt: now(),
  updatedAt: now()
});

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const htmlToPlainText = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const blockFromHtml = (pageId: string, html: string) => createBlock(pageId, html, htmlToPlainText(html));

type ImportedAsset = {
  id: string;
  originalPath: string;
  storedPath: string;
  assetUrl: string;
  mimeType: string;
  size: number;
  sha256: string;
};

export type PageDocumentContent = {
  contentType: 'page_document';
  version: number;
  blocks: Block[];
};

export type NotebookTreePayload = {
  notebooks: Notebook[];
  pages: Page[];
};

export type PageDocumentPayload = {
  page: Page;
  content: PageDocumentContent;
};

export type PinnedBlockPayload = {
  page: Page;
  block: Block;
};

export type CalendarBlockPayload = {
  page: Page;
  block: Block;
};

export type PageSearchResult = {
  pageId: string;
  notebookId: string;
  title: string;
  snippet: string;
};

export type ImportBatchPayload = {
  notebook: Notebook;
  pages: Page[];
  blocks: Block[];
  operation: OperationLogEntry | null;
};

export type RenameEntityRequest = {
  entity: 'notebook' | 'page';
  entityId: string;
  name: string;
  operation: OperationLogEntry | null;
};

export type MovePageRequest = {
  pageId: string;
  parentId: string | null;
  operation: OperationLogEntry | null;
};

export type CreateNotebookRequest = {
  notebook: Notebook;
  initialPage: Page;
  operation: OperationLogEntry | null;
};

export type CreatePageRequest = {
  page: Page;
  operation: OperationLogEntry | null;
};

export type SavePageDocumentRequest = {
  page: Page;
  blocks: Block[];
  operation: OperationLogEntry | null;
};

export type UpdatePageMetadataRequest = {
  pageId: string;
  metadata: PageMetadata;
  operation: OperationLogEntry | null;
};

export type PageRevisionPayload = {
  id: number;
  pageId: string;
  title: string;
  content: PageDocumentContent;
  createdAt: string;
  reason: string | null;
  sizeBytes: number;
};

export type RestorePageRevisionRequest = {
  pageId: string;
  revisionId: number;
  operation: OperationLogEntry | null;
};

export type DeletePageTreeRequest = {
  pageId: string;
  fallbackPage: Page | null;
  operation: OperationLogEntry | null;
};

export type DeleteNotebookRequest = {
  notebookId: string;
  operation: OperationLogEntry | null;
};

export type DatabaseBootstrapPayload = {
  notebooks: Notebook[];
  pages: Page[];
  activeNotebookId: string;
  activePageId: string;
};

export type WorkspacePreferencesPayload = {
  activeNotebookId: string;
  activePageId: string;
  shell: ShellId;
  theme: ThemeId;
  contentTheme: ContentThemeId;
  openCardWindowBlockId: string | null;
  expandedPageIds: string[];
  showPageMetadata: boolean;
};

export type WorkspacePreferencesRequest = WorkspacePreferencesPayload;

export type MarkdownImportWarning = {
  filename: string;
  sourcePath: string;
  message: string;
};

export type MarkdownFolderDocument = {
  relativePath: string;
  markdown: string;
};

export type MarkdownFolderImportResult = {
  notebook: Notebook;
  pages: Page[];
  blocks: Block[];
  warnings: MarkdownImportWarning[];
  expandedPageIds: string[];
};

export type MarkdownFolderParsedDocument = {
  relativePath: string;
  filename: string;
  pageId: string;
  body: string;
};

export type MarkdownFolderImportPlan = {
  notebook: Notebook;
  pages: Page[];
  expandedPageIds: string[];
  parsedDocuments: MarkdownFolderParsedDocument[];
  pageLinks: Map<string, string>;
};

type ParsedFrontmatter = {
  body: string;
  metadata: PageMetadata;
  title?: string;
};

const trimQuotes = (value: string) => value.trim().replace(/^['"]|['"]$/g, '');

const parseFrontmatterValue = (value: string): string | string[] => {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => trimQuotes(item))
      .filter(Boolean);
  }
  return trimQuotes(trimmed);
};

const normalizeStringList = (value: string | string[] | undefined) => {
  if (!value) return [];
  return Array.isArray(value) ? value.map(trimQuotes).filter(Boolean) : [trimQuotes(value)].filter(Boolean);
};

const frontmatterValue = (frontmatter: Record<string, string | string[]>, ...keys: string[]) => {
  const entries = Object.entries(frontmatter);
  for (const key of keys) {
    const exact = frontmatter[key];
    if (exact !== undefined) return exact;
    const found = entries.find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    if (found) return found[1];
  }
  return undefined;
};

const parseFrontmatter = (markdown: string, filename: string): ParsedFrontmatter => {
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return {
      body: markdown,
      metadata: createEmptyPageMetadata(filename)
    };
  }

  const frontmatter: Record<string, string | string[]> = {};
  let currentListKey: string | null = null;
  const lines = match[1].split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      const current = frontmatter[currentListKey];
      frontmatter[currentListKey] = [...normalizeStringList(current), trimQuotes(listMatch[1])];
      continue;
    }

    const keyValue = line.match(/^([^:\n][^:\n]*?):\s*(.*)$/);
    if (!keyValue) {
      currentListKey = null;
      continue;
    }
    const [, rawKey, rawValue] = keyValue;
    const key = rawKey.trim();
    if (!rawValue.trim()) {
      frontmatter[key] = [];
      currentListKey = key;
      continue;
    }
    if (rawValue.trim() === '|' || rawValue.trim() === '|-') {
      const blockLines: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        blockLines.push(lines[index].replace(/^\s{2}/, ''));
      }
      frontmatter[key] = blockLines.join('\n').trimEnd();
      currentListKey = null;
      continue;
    }
    frontmatter[key] = parseFrontmatterValue(rawValue);
    currentListKey = null;
  }

  return {
    body: normalized.slice(match[0].length),
    title: typeof frontmatterValue(frontmatter, 'title') === 'string' ? frontmatterValue(frontmatter, 'title') as string : undefined,
    metadata: {
      sourceFilename: filename,
      tags: normalizeStringList(frontmatterValue(frontmatter, 'tags')),
      date: typeof frontmatterValue(frontmatter, 'date', 'created') === 'string' ? frontmatterValue(frontmatter, 'date', 'created') as string : undefined,
      status: typeof frontmatterValue(frontmatter, 'status', 'score') === 'string' ? frontmatterValue(frontmatter, 'status', 'score') as string : undefined,
      aliases: normalizeStringList(frontmatterValue(frontmatter, 'aliases', 'alias')),
      frontmatter,
      frontmatterRaw: extractFrontmatterRaw(markdown) || stringifyFrontmatter(frontmatter)
    }
  };
};

const normalizeMarkdownWhitespace = (markdown: string) =>
  markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (/^[\t ]*```/.test(line) ? line.trimStart() : line))
    .join('\n');

const markdownInlineToHtml = (value: string) => {
  const html = marked.parseInline(value.replace(/==([^=\n][\s\S]*?[^=\n])==/g, '<mark>$1</mark>'), {
    async: false,
    gfm: true
  });
  return typeof html === 'string' ? html : escapeHtml(value);
};

const slugAttribute = (value: string) => escapeHtml(value.replace(/[^a-zA-Z0-9_-]/g, '-'));

const normalizeFootnotes = (markdown: string) => {
  const footnotes: Array<{ id: string; html: string }> = [];
  const withoutDefinitions = markdown
    .replace(/(?:^|\n)\[\^([^\]\n]+)\]:[^\S\r\n]*(.+(?:\n[ \t]{2,}.+)*)/g, (match, id: string, body: string) => {
      const content = body
        .split('\n')
        .map((line) => line.replace(/^[ \t]{2,}/, ''))
        .join('\n')
        .trim();
      footnotes.push({ id, html: markdownInlineToHtml(content) });
      return match.startsWith('\n') ? '\n' : '';
    });

  if (!footnotes.length) return withoutDefinitions;

  const referenced = withoutDefinitions.replace(/\[\^([^\]\n]+)\]/g, (_match, id: string) => {
    const safeId = slugAttribute(id);
    return `<sup class="md-footnote" data-footnote-id="${safeId}"><a href="#fn-${safeId}" id="fnref-${safeId}">[${escapeHtml(id)}]</a></sup>`;
  });
  const section = `<section class="footnotes" data-type="footnotes">${footnotes.map(({ id, html }) => {
    const safeId = slugAttribute(id);
    return `<div class="md-def-footnote" data-type="footnote-item" data-footnote-id="${safeId}" id="fn-${safeId}"><p><span class="footnote-label">[${escapeHtml(id)}]</span> ${html}</p></div>`;
  }).join('')}</section>`;

  return `${referenced.trimEnd()}\n\n${section}`;
};

const normalizeMath = (markdown: string) => {
  const withBlockMath = markdown.replace(/(^|\n)\$\$\n?([\s\S]*?)\n?\$\$(?=\n|$)/g, (_match, prefix: string, latex: string) => {
    const trimmed = latex.trim();
    if (!trimmed) return _match;
    return `${prefix}<div class="md-math-block" data-type="block-math" data-latex="${escapeHtml(trimmed)}"></div>`;
  });

  return withBlockMath.replace(/(?<!\\)\$(?!\$|\d)([^$\n]+?)(?<!\\)\$(?!\$|\d)/g, (_match, latex: string) => {
    const trimmed = latex.trim();
    if (!trimmed) return _match;
    return `<span class="md-math-inline" data-type="inline-math" data-latex="${escapeHtml(trimmed)}"></span>`;
  });
};

const alertTypeLabels: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};

const normalizeAlerts = (markdown: string) =>
  markdown.replace(/(?:^|\n)>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\n]*(?:\n>[ \t]?.*)*/gi, (match) => {
    const lines = match.replace(/^\n/, '').split('\n');
    const type = lines[0].match(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)?.[1].toLowerCase() ?? 'note';
    const body = lines
      .slice(1)
      .map((line) => line.replace(/^>[ \t]?/, ''))
      .join('\n')
      .trim();
    const title = alertTypeLabels[type] ?? 'Note';
    const bodyHtml = body ? markdownInlineToHtml(body) : '';
    return `\n<div class="md-alert md-alert-${type}" data-alert-type="${type}"><p class="md-alert-title md-alert-text">${title}</p>${bodyHtml ? `<p>${bodyHtml}</p>` : ''}</div>`;
  });

const urlWithoutQuery = (url: string) => url.split(/[?#]/)[0] ?? url;
const isVideoUrl = (url: string) => /\.(mp4|mov|webm|m4v)$/i.test(urlWithoutQuery(url));
const isAudioUrl = (url: string) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(urlWithoutQuery(url));

const embedUrlFor = (url: string) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return `https://www.youtube.com/embed/${escapeHtml(parsed.pathname.slice(1))}`;
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const videoId = parsed.searchParams.get('v');
      if (videoId) return `https://www.youtube.com/embed/${escapeHtml(videoId)}`;
      if (parsed.pathname.startsWith('/embed/')) return escapeHtml(parsed.href);
    }
    if (host === 'vimeo.com') {
      const videoId = parsed.pathname.split('/').filter(Boolean)[0];
      if (videoId) return `https://player.vimeo.com/video/${escapeHtml(videoId)}`;
    }
  } catch {
    return null;
  }
  return null;
};

const mediaHtmlForUrl = (url: string, label = '') => {
  const src = escapeHtml(url.trim());
  const title = escapeHtml(label.trim() || 'Embedded media');
  const embedUrl = embedUrlFor(url.trim());
  if (isVideoUrl(url)) return `<video controls src="${src}"></video>`;
  if (isAudioUrl(url)) return `<audio controls src="${src}"></audio>`;
  if (embedUrl) return `<iframe class="media-embed" src="${embedUrl}" title="${title}" loading="lazy" allowfullscreen></iframe>`;
  return null;
};

const normalizeMarkdownForMarked = (markdown: string) =>
  normalizeMath(normalizeFootnotes(normalizeAlerts(normalizeMarkdownWhitespace(markdown))))
    .replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (_match, alt: string, src: string) => `<img src="${escapeHtml(src.trim())}" alt="${escapeHtml(alt)}">`)
    .replace(/^[^\S\r\n]*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)[^\S\r\n]*$/gm, (match, label: string, url: string) => mediaHtmlForUrl(url, label) ?? match)
    .replace(/^[^\S\r\n]*(https?:\/\/\S+\.(?:mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac)(?:[?#]\S*)?)[^\S\r\n]*$/gim, (_match, url: string) => mediaHtmlForUrl(url) ?? _match)
    .replace(/^[^\S\r\n]*(https?:\/\/(?:www\.)?(?:youtu\.be|youtube\.com|m\.youtube\.com|vimeo\.com)\/\S+)[^\S\r\n]*$/gim, (_match, url: string) => mediaHtmlForUrl(url) ?? _match)
    .replace(/==([^=\n][\s\S]*?[^=\n])==/g, '<mark>$1</mark>')
    .replace(/^[^\S\r\n]*【】[^\S\r\n]+(.+)$/gm, '- [ ] <mark>$1</mark>')
    .replace(/(?:^[^\S\r\n]*[-*+][^\S\r\n]+\[[ xX]\][^\S\r\n]+.+(?:\n|$))+/gm, (block) => {
      const items = block
        .trimEnd()
        .split('\n')
        .map((line) => line.match(/^[^\S\r\n]*[-*+][^\S\r\n]+\[([ xX])\][^\S\r\n]+(.+)$/))
        .filter(Boolean) as RegExpMatchArray[];
      if (!items.length) return block;
      return `<ul data-type="taskList">${items.map((match) => {
        const checked = match[1].toLowerCase() === 'x';
        return `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}" data-todo-style="plain"><label><input type="checkbox" ${checked ? 'checked="checked"' : ''}><span></span></label><div><p>${markdownInlineToHtml(match[2])}</p></div></li>`;
      }).join('')}</ul>\n`;
    });

const markdownToHtml = (markdown: string) => {
  const html = marked.parse(normalizeMarkdownForMarked(markdown), {
    async: false,
    breaks: false,
    gfm: true
  });
  return typeof html === 'string' ? html.trim() : '';
};

const wikiLinkRegex = /(^|[^!])\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const wikiEmbedRegex = /!\[\[([^\]\n]+)\]\]/g;
const mediaLinkTargetRegex = /\.(?:png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac)$/i;
const normalizeLinkTarget = (target: string) =>
  target
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .reduce<string[]>((parts, part) => {
      if (!part || part === '.') return parts;
      if (part === '..') {
        parts.pop();
        return parts;
      }
      parts.push(part);
      return parts;
    }, [])
    .join('/');

const pageHrefFromKey = (key: string, pageLinks: Map<string, string>) => {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const normalized = normalizeLinkTarget(trimmed);
  return pageLinks.get(trimmed)
    ?? pageLinks.get(trimmed.replace(/\.(md|markdown|txt)$/i, ''))
    ?? pageLinks.get(normalized)
    ?? pageLinks.get(normalized.replace(/\.(md|markdown|txt)$/i, ''))
    ?? null;
};

const rewriteWikiLinks = (markdown: string, pageLinks: Map<string, string>) =>
  markdown.replace(wikiLinkRegex, (_match, prefix: string, target: string, heading: string, alias: string) => {
    const pageId = pageHrefFromKey(target, pageLinks);
    if (!pageId) return `${prefix}${alias ? alias : target}`;
    const label = (alias ?? target).trim() || target.trim();
    const suffix = heading ? `#${heading.trim().replace(/\s+/g, '-')}` : '';
    return `${prefix}[${label}](page:${pageId}${suffix})`;
  });

const rewriteWikiEmbeds = (markdown: string) =>
  markdown.replace(wikiEmbedRegex, (match, rawTarget: string) => {
    const [target = '', label = ''] = rawTarget.split('|').map((part) => part.trim());
    const path = target.split('#')[0] ?? target;
    if (!mediaLinkTargetRegex.test(path)) return match;
    const alt = label || path.split('/').pop() || '';
    return `![${alt}](${path})`;
  });

const linkPrefixForPage = 'page:';

const dirnameFromLinkTarget = (path: string) => {
  const normalized = normalizeLinkTarget(path);
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/');
};

const pageHrefFromMarkdownHref = (href: string, pageLinks?: Map<string, string>, currentPath?: string) => {
  if (!pageLinks) return null;
  if (!href || href.startsWith('#') || /^(?:https?:|mailto:|tel:|asset:|data:|file:)/i.test(href)) return null;
  const [rawPath, rawHash = ''] = href.split('#');
  const decodedPath = decodeRepeatedly(rawPath);
  const candidates = [
    decodedPath,
    currentPath ? `${dirnameFromLinkTarget(currentPath)}/${decodedPath}` : decodedPath
  ];
  const pageId = candidates.map((candidate) => pageHrefFromKey(candidate, pageLinks)).find(Boolean);
  if (!pageId) return null;
  const hash = rawHash ? `#${rawHash}` : '';
  return `${linkPrefixForPage}${pageId}${hash}`;
};

const rewritePageLinksInHtml = (html: string, pageLinks?: Map<string, string>, currentPath?: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    let href = anchor.getAttribute('href') ?? '';
    href = pageHrefFromMarkdownHref(href, pageLinks, currentPath) ?? href;
    if (!href.startsWith(linkPrefixForPage)) return;
    anchor.setAttribute('href', href);
    anchor.setAttribute('data-page-id', href.slice(linkPrefixForPage.length).split('#')[0] ?? '');
  });
  return container.innerHTML;
};

export const markdownToBlocks = (pageId: string, markdown: string, pageLinks?: Map<string, string>, currentPath?: string): Block[] => {
  const markdownWithEmbeds = rewriteWikiEmbeds(markdown);
  const linkedMarkdown = pageLinks ? rewriteWikiLinks(markdownWithEmbeds, pageLinks) : markdownWithEmbeds;
  const html = rewritePageLinksInHtml(markdownToHtml(linkedMarkdown), pageLinks, currentPath);
  return [blockFromHtml(pageId, html || '<p></p>')];
};

const localAssetPathFromSrc = (src: string) => {
  if (!src || src.startsWith('asset://') || src.startsWith('data:') || /^https?:\/\//i.test(src)) return null;
  if (src.startsWith('file://')) return decodeURIComponent(new URL(src).pathname);
  if (src.startsWith('/')) return src;
  return null;
};

const localizeMediaAssets = async (html: string, filename: string) => {
  const warnings: MarkdownImportWarning[] = [];
  if (!isTauri()) return { html, warnings };
  const container = document.createElement('div');
  container.innerHTML = html;
  const media = Array.from(container.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>('img[src], video[src], audio[src]'));

  await Promise.all(media.map(async (element) => {
    const src = element.getAttribute('src') ?? '';
    const sourcePath = localAssetPathFromSrc(src);
    if (!sourcePath) return;
    try {
      const imported = await invoke<ImportedAsset>('import_local_asset', { sourcePath });
      element.setAttribute('src', convertFileSrc(imported.storedPath));
      element.setAttribute('data-asset-id', imported.id);
      element.setAttribute('data-original-src', src);
    } catch (error) {
      warnings.push({
        filename,
        sourcePath,
        message: error instanceof Error ? error.message : String(error)
      });
      console.warn('Could not import local asset.', sourcePath, error);
    }
  }));

  return { html: container.innerHTML, warnings };
};

export const createPageFromMarkdown = async (notebookId: string, filename: string, markdown: string, pageLinks?: Map<string, string>) => {
  const parsed = parseFrontmatter(markdown, filename);
  const fallbackTitle = filename.replace(/\.(md|markdown|txt)$/i, '').trim() || 'Imported page';
  const page = {
    ...createPage(notebookId, fallbackTitle),
    metadata: parsed.metadata
  };
  const body = parsed.body.trim();
  const warnings: MarkdownImportWarning[] = [];
  const blocks = await Promise.all(markdownToBlocks(page.id, body, pageLinks, filename).map(async (block) => {
    const localized = await localizeMediaAssets(block.content.html, filename);
    warnings.push(...localized.warnings);
    return {
      ...block,
      content: {
        html: localized.html,
        plainText: block.content.plainText
      }
    };
  }));
  return {
    page: {
      ...page,
      blockIds: blocks.map((block) => block.id)
    },
    blocks,
    warnings
  };
};

const normalizeRelativePath = (path: string) =>
  path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');

const basenameFromPath = (path: string) => normalizeRelativePath(path).split('/').pop() ?? path;

const dirnameFromPath = (path: string) => {
  const normalized = normalizeRelativePath(path);
  const parts = normalized.split('/');
  parts.pop();
  return parts.join('/');
};

const titleFromFolderSegment = (segment: string) => segment.trim() || 'Folder';

export const createMarkdownFolderImportPlan = (
  rootName: string,
  documents: MarkdownFolderDocument[]
): MarkdownFolderImportPlan => {
  const normalizedDocuments = documents
    .map((document) => ({
      ...document,
      relativePath: normalizeRelativePath(document.relativePath)
    }))
    .filter((document) => /\.(md|markdown|txt)$/i.test(document.relativePath))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));

  const notebook = createNotebook(rootName.trim() || 'Imported notebook');
  const pages: Page[] = [];
  const blocks: Block[] = [];
  const warnings: MarkdownImportWarning[] = [];
  const expandedPageIds: string[] = [];
  const folderPageIds = new Map<string, string>();
  const pageLinks = new Map<string, string>();
  const parsedDocuments = normalizedDocuments.map((document) => {
    const filename = basenameFromPath(document.relativePath);
    const parsed = parseFrontmatter(document.markdown, filename);
    return {
      document,
      filename,
      parsed
    };
  });

  const ensureFolderPage = (folderPath: string): string | null => {
    const normalized = normalizeRelativePath(folderPath);
    if (!normalized) return null;
    const existingId = folderPageIds.get(normalized);
    if (existingId) return existingId;

    const parts = normalized.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    const parentId = ensureFolderPage(parentPath);
    const page = createPage(notebook.id, titleFromFolderSegment(parts[parts.length - 1]), parentId);
    pages.push(page);
    folderPageIds.set(normalized, page.id);
    expandedPageIds.push(page.id);
    return page.id;
  };

  for (const { document, filename, parsed } of parsedDocuments) {
    const parentId = ensureFolderPage(dirnameFromPath(document.relativePath));
    const fallbackTitle = filename.replace(/\.(md|markdown|txt)$/i, '').trim() || 'Imported page';
    const page = {
      ...createPage(notebook.id, fallbackTitle),
      parentId,
      metadata: {
        ...parsed.metadata,
        sourceFilename: document.relativePath,
        frontmatterRaw: parsed.metadata.frontmatterRaw ?? stringifyFrontmatter(parsed.metadata.frontmatter)
      }
    };
    pages.push(page);
    const pathKey = normalizeRelativePath(document.relativePath);
    pageLinks.set(pathKey, page.id);
    pageLinks.set(pathKey.replace(/\.(md|markdown|txt)$/i, ''), page.id);
    pageLinks.set(document.relativePath, page.id);
    pageLinks.set(page.title, page.id);
    pageLinks.set(`page:${page.id}`, page.id);
    pageLinks.set(filename, page.id);
    pageLinks.set(filename.replace(/\.(md|markdown|txt)$/i, ''), page.id);
  }

  return {
    notebook: {
      ...notebook,
      pageIds: pages.map((page) => page.id)
    },
    pages,
    expandedPageIds,
    parsedDocuments: parsedDocuments.map(({ document, filename, parsed }) => {
      const pageId = pageLinks.get(normalizeRelativePath(document.relativePath)) ?? '';
      return {
        relativePath: document.relativePath,
        filename,
        pageId,
        body: parsed.body.trim()
      };
    }).filter((document) => document.pageId),
    pageLinks
  };
};

export const createBlocksForMarkdownFolderDocument = async (
  document: MarkdownFolderParsedDocument,
  pageLinks: Map<string, string>
) => {
  const warnings: MarkdownImportWarning[] = [];
  const body = rewriteWikiLinks(document.body, pageLinks);
  const blocks = await Promise.all(markdownToBlocks(document.pageId, body, pageLinks, document.relativePath).map(async (block) => {
    const localized = await localizeMediaAssets(block.content.html, document.filename);
    warnings.push(...localized.warnings);
    return {
      ...block,
      content: {
        html: localized.html,
        plainText: block.content.plainText
      }
    };
  }));
  return { blocks, warnings };
};

export const createNotebookFromMarkdownDocuments = async (
  rootName: string,
  documents: MarkdownFolderDocument[]
): Promise<MarkdownFolderImportResult> => {
  const plan = createMarkdownFolderImportPlan(rootName, documents);
  const blocks: Block[] = [];
  const warnings: MarkdownImportWarning[] = [];

  for (const document of plan.parsedDocuments) {
    const page = plan.pages.find((candidate) => candidate.id === document.pageId);
    if (!page) continue;
    const pageBlocks = await createBlocksForMarkdownFolderDocument(document, plan.pageLinks);
    warnings.push(...pageBlocks.warnings);
    page.blockIds = pageBlocks.blocks.map((block) => block.id);
    blocks.push(...pageBlocks.blocks);
  }

  return {
    notebook: plan.notebook,
    pages: plan.pages,
    blocks,
    warnings,
    expandedPageIds: plan.expandedPageIds
  };
};

export const downloadTextFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const htmlToMarkdown = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;

  const escapeMarkdown = (value: string) => value.replace(/\u00a0/g, ' ');

  const textForChildren = (node: Node, depth = 0): string =>
    Array.from(node.childNodes).map((child) => nodeToMarkdown(child, depth)).join('');

  const listItemBody = (element: HTMLElement, depth: number) => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(':scope > ul, :scope > ol').forEach((list) => list.remove());
    clone.querySelectorAll(':scope > div > ul, :scope > div > ol').forEach((list) => list.remove());
    clone.querySelectorAll(':scope > label').forEach((label) => label.remove());
    const body = textForChildren(clone, depth).replace(/\n+/g, ' ').trim();
    return body || (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  };

  const nestedLists = (element: HTMLElement, depth: number) =>
    Array.from(element.querySelectorAll(':scope > ul, :scope > ol, :scope > div > ul, :scope > div > ol'))
      .map((list) => nodeToMarkdown(list, depth + 1))
      .join('');

  const listMarkerForItem = (item: HTMLElement, index: number, ordered: boolean) => {
    const checked = item.getAttribute('data-checked');
    if (checked === 'true') return '- [x]';
    if (checked === 'false') return '- [ ]';
    if (!ordered) return '-';
    const parent = item.parentElement;
    const start = Number.parseInt(parent?.getAttribute('start') ?? '1', 10) || 1;
    const value = Number.parseInt(item.getAttribute('value') ?? '', 10);
    return `${Number.isFinite(value) ? value : start + index}.`;
  };

  const fallbackListItemIndex = (item: HTMLElement) => {
    const siblings = Array.from(item.parentElement?.children ?? [])
      .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === 'li');
    const index = siblings.indexOf(item);
    return index >= 0 ? index : 0;
  };

  function nodeToMarkdown(node: Node, depth = 0): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(node.textContent ?? '');
    if (!(node instanceof HTMLElement)) return textForChildren(node, depth);

    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return `**${textForChildren(node, depth)}**`;
    if (tag === 'em' || tag === 'i') return `*${textForChildren(node, depth)}*`;
    if (tag === 'u') return `~${textForChildren(node, depth)}~`;
    if (tag === 's' || tag === 'del') return `~~${textForChildren(node, depth)}~~`;
    if (tag === 'mark') return `==${textForChildren(node, depth)}==`;
    if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${node.textContent ?? ''}\``;
    if (tag === 'pre') return `\n\`\`\`\n${node.textContent?.replace(/\n$/, '') ?? ''}\n\`\`\`\n`;
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag.slice(1)))} ${textForChildren(node, depth).trim()}\n\n`;
    if (tag === 'p') return `${textForChildren(node, depth).trim()}\n\n`;
    if (tag === 'blockquote') {
      const body = textForChildren(node, depth).trim().split('\n').map((line) => `> ${line}`).join('\n');
      return `${body}\n\n`;
    }
    if (tag === 'ul' || tag === 'ol') {
      const ordered = tag === 'ol';
      return Array.from(node.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === 'li')
        .map((item, index) => {
          const indent = '  '.repeat(depth);
          const marker = listMarkerForItem(item, index, ordered);
          return `${indent}${marker} ${listItemBody(item, depth)}\n${nestedLists(item, depth)}`;
        })
        .join('');
    }
    if (tag === 'li') {
      const parentTag = node.parentElement?.tagName.toLowerCase();
      const marker = listMarkerForItem(node, fallbackListItemIndex(node), parentTag === 'ol');
      return `${'  '.repeat(depth)}${marker} ${listItemBody(node, depth)}\n${nestedLists(node, depth)}`;
    }
    if (tag === 'table') {
      const rows = Array.from(node.querySelectorAll('tr')).map((row) =>
        Array.from(row.children).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
      );
      if (!rows.length) return '';
      const columnCount = Math.max(...rows.map((row) => row.length));
      const normalized = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''));
      const [header, ...body] = normalized;
      return [
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...body.map((row) => `| ${row.join(' | ')} |`)
      ].join('\n') + '\n\n';
    }
    if (tag === 'img') return `![${node.getAttribute('alt') ?? ''}](${node.getAttribute('src') ?? ''})`;
    if (tag === 'video' || tag === 'audio') return node.getAttribute('src') ? `${node.getAttribute('src')}\n\n` : '';
    if (tag === 'a') {
      const href = node.getAttribute('href') ?? '';
      return `[${textForChildren(node, depth) || href}](${href})`;
    }
    if (tag === 'div' || tag === 'section') return textForChildren(node, depth);
    return textForChildren(node, depth);
  }

  return textForChildren(container).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};
