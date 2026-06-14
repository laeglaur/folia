import type { AppState, Block, ContentThemeId, Notebook, OperationLogEntry, Page, PageMetadata, ShellId, ThemeId } from './types';
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

const starterPageId = createId('page');
const starterBlockOne = createId('block');
const starterBlockTwo = createId('block');
const starterNotebookId = createId('notebook');

export const createInitialState = (): AppState => ({
  notebooks: [
    {
      id: starterNotebookId,
      name: 'Notebook',
      pageIds: [starterPageId]
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
  operations: []
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
      pageIds: notebook.pageIds ?? state.pages.filter((page) => page.notebookId === notebook.id).map((page) => page.id)
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
        frontmatter: page.metadata?.frontmatter ?? {}
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
    operations: state.operations ?? []
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
      const html = await localizeDataUrlMediaAssets(block.content.html, block.id);
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
    const raw = await invoke<string | null>('load_state_snapshot');
    if (raw) return normalizeState(JSON.parse(raw) as AppState);
    await saveState(browserState);
    return browserState;
  } catch (error) {
    console.warn('Falling back to browser notebook storage.', error);
    return browserState;
  }
};

export const saveState = async (state: AppState) => {
  const persistableState = await prepareStateForPersistence(state);
  const stateJson = JSON.stringify(persistableState);

  if (isTauri()) {
    try {
      await invoke('save_state_snapshot', { stateJson });
      await cleanupOrphanAttachments(persistableState);
    } catch (error) {
      console.warn('Could not persist notebook state to SQLite.', error);
    }
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, stateJson);
  } catch (error) {
    console.warn('Could not persist notebook state to browser localStorage.', error);
  }
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
  pageIds: []
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

type AttachmentCleanupResult = {
  removedCount: number;
  removedBytes: number;
};

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
  match[1].split('\n').forEach((line) => {
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      const current = frontmatter[currentListKey];
      frontmatter[currentListKey] = [...normalizeStringList(current), trimQuotes(listMatch[1])];
      return;
    }

    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) {
      currentListKey = null;
      return;
    }
    const [, key, rawValue] = keyValue;
    if (!rawValue.trim()) {
      frontmatter[key] = [];
      currentListKey = key;
      return;
    }
    frontmatter[key] = parseFrontmatterValue(rawValue);
    currentListKey = null;
  });

  return {
    body: normalized.slice(match[0].length),
    title: typeof frontmatter.title === 'string' ? frontmatter.title : undefined,
    metadata: {
      sourceFilename: filename,
      tags: normalizeStringList(frontmatter.tags),
      date: typeof frontmatter.date === 'string' ? frontmatter.date : undefined,
      status: typeof frontmatter.status === 'string' ? frontmatter.status : undefined,
      aliases: normalizeStringList(frontmatter.aliases),
      frontmatter
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

export const markdownToBlocks = (pageId: string, markdown: string): Block[] => {
  const html = markdownToHtml(markdown);
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

export const createPageFromMarkdown = async (notebookId: string, filename: string, markdown: string) => {
  const parsed = parseFrontmatter(markdown, filename);
  const fallbackTitle = filename.replace(/\.(md|markdown|txt)$/i, '').trim() || 'Imported page';
  const page = {
    ...createPage(notebookId, fallbackTitle),
    metadata: parsed.metadata
  };
  const body = parsed.body.trim();
  const warnings: MarkdownImportWarning[] = [];
  const blocks = await Promise.all(markdownToBlocks(page.id, body).map(async (block) => {
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

export const createNotebookFromMarkdownDocuments = async (
  rootName: string,
  documents: MarkdownFolderDocument[]
): Promise<MarkdownFolderImportResult> => {
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

  for (const document of normalizedDocuments) {
    const parentId = ensureFolderPage(dirnameFromPath(document.relativePath));
    const imported = await createPageFromMarkdown(notebook.id, basenameFromPath(document.relativePath), document.markdown);
    const page = {
      ...imported.page,
      parentId,
      metadata: {
        ...imported.page.metadata,
        sourceFilename: document.relativePath
      }
    };
    pages.push(page);
    blocks.push(...imported.blocks);
    warnings.push(...imported.warnings);
  }

  return {
    notebook: {
      ...notebook,
      pageIds: pages.map((page) => page.id)
    },
    pages,
    blocks,
    warnings,
    expandedPageIds
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
      const start = Number.parseInt(node.getAttribute('start') ?? '1', 10) || 1;
      return Array.from(node.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === 'li')
        .map((item, index) => {
          const indent = '  '.repeat(depth);
          const checked = item.getAttribute('data-checked');
          const marker = checked === 'true' ? '- [x]' : checked === 'false' ? '- [ ]' : ordered ? `${start + index}.` : '-';
          return `${indent}${marker} ${listItemBody(item, depth)}\n${nestedLists(item, depth)}`;
        })
        .join('');
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
