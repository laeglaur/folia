import type { Block, Page } from './types';
import { escapeHtml } from './html-utils';

export type ImportNotice = {
  kind: 'idle' | 'loading' | 'success' | 'warning' | 'error';
  message: string;
  details?: string[];
};

export type OutlineEntry = {
  id: string;
  kind: 'page' | 'block' | 'heading' | 'list';
  blockId: string | null;
  level: number;
  text: string;
  index: number;
};

export type CalendarEntry = {
  block: Block;
  page: Page;
};

export type WorkspaceView = 'write' | 'calendar';

export const localDateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const monthKey = (date: Date) => `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;

export const monthLabel = (date: Date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export const calendarDaysForMonth = (date: Date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
};

export const blockTextPreview = (text: string, max = 56) => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact || 'Untitled block';
};

export const firstLines = (text: string, lines = 2) => {
  const parts = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return blockTextPreview(parts.slice(0, lines).join(' / '), 76);
};

const outlineText = (value: string, max = 72) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
};

const listItemLabel = (listItem: Element) => {
  const clone = listItem.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('ul, ol').forEach((node) => node.remove());
  return outlineText(clone.textContent ?? '');
};

export const extractOutlineEntries = (page: Page, blocks: Block[]): OutlineEntry[] => {
  const entries: OutlineEntry[] = [{
    id: `${page.id}:title`,
    kind: 'page',
    blockId: null,
    level: 1,
    text: page.title || 'Untitled page',
    index: 0
  }];

  blocks.forEach((block, blockIndex) => {
    const blockLabel = firstLines(block.content.plainText);
    if (block.content.plainText.trim()) {
      entries.push({
        id: `${block.id}:block`,
        kind: 'block',
        blockId: block.id,
        level: 1,
        text: blockLabel,
        index: blockIndex
      });
    }

    const doc = new DOMParser().parseFromString(block.content.html, 'text/html');
    doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading, index) => {
      const text = outlineText(heading.textContent ?? '');
      if (!text) return;
      entries.push({
        id: `${block.id}:heading:${index}`,
        kind: 'heading',
        blockId: block.id,
        level: Number(heading.tagName.slice(1)) + 1,
        text,
        index
      });
    });

    doc.querySelectorAll('li').forEach((listItem, index) => {
      if (!listItem.querySelector(':scope > ul, :scope > ol, :scope > div > ul, :scope > div > ol')) return;
      const text = listItemLabel(listItem);
      if (!text) return;
      entries.push({
        id: `${block.id}:list:${index}`,
        kind: 'list',
        blockId: block.id,
        level: 3,
        text,
        index
      });
    });
  });

  return entries;
};

export const htmlWithOutlineAnchors = (html: string, blockId: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading, index) => {
    heading.setAttribute('data-outline-id', `${blockId}:heading:${index}`);
  });
  container.querySelectorAll('li').forEach((listItem, index) => {
    if (!listItem.querySelector(':scope > ul, :scope > ol, :scope > div > ul, :scope > div > ol')) return;
    listItem.setAttribute('data-outline-id', `${blockId}:list:${index}`);
  });
  return container.innerHTML;
};

export const stripOutlineAnchors = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('[data-outline-id]').forEach((element) => element.removeAttribute('data-outline-id'));
  return container.innerHTML;
};

export const blockTimestampLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
};

export const displayMathLatex = (latex: string) => latex === '\\;' ? '' : latex;

export const findBlockMathPositionNear = (editor: { state: { doc: { content: { size: number }; nodeAt: (pos: number) => { type: { name: string }; attrs: { latex?: string } } | null; nodesBetween: (from: number, to: number, fn: (node: { type: { name: string } }, pos: number) => boolean | void) => void; descendants: (fn: (node: { type: { name: string } }, pos: number) => boolean | void) => void } } }, around: number) => {
  let found: number | null = null;
  const from = Math.max(0, around - 4);
  const to = Math.min(editor.state.doc.content.size, around + 8);
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'blockMath') {
      found = pos;
      return false;
    }
    return true;
  });
  if (found !== null) return found;
  editor.state.doc.descendants((node, pos) => {
    if (found === null && node.type.name === 'blockMath') {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
};

export const isResizableMediaNode = (nodeType: string): nodeType is 'image' | 'video' | 'audio' =>
  nodeType === 'image' || nodeType === 'video' || nodeType === 'audio';

export const markdownImportFileRegex = /\.(md|markdown|txt)$/i;
export const mediaImportFileRegex = /\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac)$/i;

export const fileRelativePath = (file: File) => ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '');

const normalizeImportPath = (path: string) =>
  path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .reduce<string[]>((parts, part) => {
      if (part === '..') parts.pop();
      else parts.push(part);
      return parts;
    }, [])
    .join('/');

const dirnameFromImportPath = (path: string) => {
  const parts = normalizeImportPath(path).split('/');
  parts.pop();
  return parts.join('/');
};

export const splitImportRoot = (paths: string[]) => {
  const normalizedPaths = paths.map(normalizeImportPath).filter(Boolean);
  const firstSegments = normalizedPaths.map((path) => path.split('/')[0]).filter(Boolean);
  const commonRoot = firstSegments[0] && firstSegments.every((segment) => segment === firstSegments[0])
    ? firstSegments[0]
    : '';
  const hasNestedRoot = commonRoot && normalizedPaths.some((path) => path.includes('/'));
  return {
    rootName: hasNestedRoot ? commonRoot : 'Imported notebook',
    stripRoot: (path: string) => {
      const normalized = normalizeImportPath(path);
      return hasNestedRoot && normalized.startsWith(`${commonRoot}/`)
        ? normalized.slice(commonRoot.length + 1)
        : normalized;
    }
  };
};

const videoImportFileRegex = /\.(mp4|mov|webm|m4v)$/i;
const audioImportFileRegex = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

const resolveImportedAssetPath = (rawPath: string, markdownPath: string, assetPaths: Set<string>) => {
  const trimmed = rawPath.trim().replace(/^<|>$/g, '');
  if (!trimmed || /^(?:[a-z]+:|#|data:)/i.test(trimmed)) return null;
  const cleanPath = trimmed.split(/[?#]/)[0] ?? trimmed;
  const decoded = (() => {
    try {
      return decodeURIComponent(cleanPath);
    } catch {
      return cleanPath;
    }
  })();
  const fromMarkdownDir = normalizeImportPath(`${dirnameFromImportPath(markdownPath)}/${decoded}`);
  if (assetPaths.has(fromMarkdownDir)) return fromMarkdownDir;
  const normalized = normalizeImportPath(decoded);
  return assetPaths.has(normalized) ? normalized : null;
};

export type ImportedAssetRewrite = {
  src: string;
  assetId?: string;
};

export type ImportedAssetResolver = (assetPath: string, file: File) => Promise<ImportedAssetRewrite | null>;

const assetAttributes = (asset: ImportedAssetRewrite, originalPath: string) =>
  `src="${escapeHtml(asset.src)}"${asset.assetId ? ` data-asset-id="${escapeHtml(asset.assetId)}"` : ''} data-original-src="${escapeHtml(originalPath)}"`;

export const embedImportedAssetMarkdown = async (
  markdown: string,
  markdownPath: string,
  assets: Map<string, File>,
  resolveAsset?: ImportedAssetResolver
) => {
  if (!resolveAsset) return markdown;

  const assetPaths = new Set(assets.keys());
  const assetCache = new Map<string, ImportedAssetRewrite | null>();
  const assetForPath = async (path: string) => {
    if (assetCache.has(path)) return assetCache.get(path) ?? null;
    const file = assets.get(path);
    if (!file) return null;
    const resolved = await resolveAsset(path, file);
    assetCache.set(path, resolved);
    return resolved;
  };

  const htmlForImage = (alt: string, assetPath: string, asset: ImportedAssetRewrite) =>
    `<img ${assetAttributes(asset, assetPath)} alt="${escapeHtml(alt)}">`;

  const htmlForMedia = (tagName: 'video' | 'audio', assetPath: string, asset: ImportedAssetRewrite, label = '') => {
    const title = label.trim() ? ` title="${escapeHtml(label)}"` : '';
    return `<${tagName} controls ${assetAttributes(asset, assetPath)}${title}></${tagName}>`;
  };

  const imageMatches = Array.from(markdown.matchAll(/!\[([^\]]*)\]\(([^)\n]+)\)/g));
  let rewritten = markdown;
  for (const match of imageMatches) {
    const assetPath = resolveImportedAssetPath(match[2], markdownPath, assetPaths);
    if (!assetPath) continue;
    const asset = await assetForPath(assetPath);
    if (!asset) continue;
    rewritten = rewritten.replace(match[0], htmlForImage(match[1], assetPath, asset));
  }

  const linkMatches = Array.from(rewritten.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\n]+)\)/g));
  for (const match of linkMatches) {
    const assetPath = resolveImportedAssetPath(match[2], markdownPath, assetPaths);
    if (!assetPath || (!videoImportFileRegex.test(assetPath) && !audioImportFileRegex.test(assetPath))) continue;
    const asset = await assetForPath(assetPath);
    if (!asset) continue;
    const tagName = videoImportFileRegex.test(assetPath) ? 'video' : 'audio';
    rewritten = rewritten.replace(match[0], htmlForMedia(tagName, assetPath, asset, match[1]));
  }

  const bareMediaMatches = Array.from(rewritten.matchAll(/^[^\S\r\n]*([^\s<>()]+?\.(?:mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac))[^\S\r\n]*$/gim));
  for (const match of bareMediaMatches) {
    const assetPath = resolveImportedAssetPath(match[1], markdownPath, assetPaths);
    if (!assetPath) continue;
    const asset = await assetForPath(assetPath);
    if (!asset) continue;
    const tagName = videoImportFileRegex.test(assetPath) ? 'video' : 'audio';
    rewritten = rewritten.replace(match[0], htmlForMedia(tagName, assetPath, asset));
  }

  return rewritten;
};
