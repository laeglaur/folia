import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Braces,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  FileUp,
  Highlighter,
  Image as ImageIcon,
  Indent,
  Italic,
  Keyboard,
  Link as LinkIcon,
  List,
  ListOrdered,
  MapPin,
  NotebookTabs,
  Outdent,
  PanelRight,
  Plus,
  Quote,
  Search,
  Sigma,
  Sparkles,
  Strikethrough,
  Table2,
  Type,
  Underline as UnderlineIcon,
  Upload,
  Video,
  Volume2,
  PanelTop
} from 'lucide-react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { ListItem } from '@tiptap/extension-list';
import { Extension, InputRule, Mark, Node, mergeAttributes } from '@tiptap/core';
import type { AppState, Block, ContentThemeId, Page, ShellId } from './types';
import {
  appendOperation,
  createBlock,
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
import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { common, createLowlight } from 'lowlight';
import { marked } from 'marked';
import 'katex/dist/katex.min.css';
import { contentThemes } from './typora-theme-registry';

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
type ImportNotice = {
  kind: 'idle' | 'loading' | 'success' | 'warning' | 'error';
  message: string;
  details?: string[];
};
type OutlineEntry = {
  id: string;
  kind: 'page' | 'block' | 'heading' | 'list';
  blockId: string | null;
  level: number;
  text: string;
  index: number;
};
type ToolbarCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'inlineCode'
  | 'codeBlock'
  | 'blockquote'
  | 'link'
  | 'table'
  | 'tableRowAfter'
  | 'tableColumnAfter'
  | 'tableDeleteRow'
  | 'tableDeleteColumn'
  | 'inlineMath'
  | 'blockMath'
  | 'footnote'
  | 'horizontalRule'
  | 'image'
  | 'video'
  | 'audio'
  | 'embed'
  | 'kbd'
  | 'bulletList'
  | 'orderedList'
  | 'indent'
  | 'outdent';

type RichEditorProps = {
  className: string;
  html?: string;
  placeholder?: string;
  onFocus: (editor: Editor) => void;
  onUpdate?: (html: string, plainText: string) => void;
  onBlur?: (html: string, plainText: string) => void;
  onShiftEnter?: (editor: Editor) => boolean;
  onMoveBlock?: (direction: -1 | 1) => boolean;
  editorRef: (editor: Editor | null) => void;
};

const setListItemCollapsed = (editor: Editor, listItem: HTMLElement, collapsed: boolean) => {
  try {
    const pos = editor.view.posAtDOM(listItem, 0);
    const resolved = editor.state.doc.resolve(Math.max(0, pos));
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      const node = resolved.node(depth);
      if (node.type.name !== 'listItem' && node.type.name !== 'taskItem') continue;
      const nodePos = resolved.before(depth);
      const transaction = editor.state.tr.setNodeMarkup(nodePos, undefined, {
        ...node.attrs,
        listCollapsed: collapsed
      });
      editor.view.dispatch(transaction);
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

const toggleCollapsibleListItem = (event: React.MouseEvent<HTMLDivElement>, editor: Editor | null) => {
  if (!editor) return;
  const target = event.target as HTMLElement;
  const editorRoot = event.currentTarget;
  const listItem = target.closest('li');
  if (!listItem || !editorRoot.contains(listItem)) return;
  if (!listItem.querySelector(':scope > ul, :scope > ol, :scope > div > ul, :scope > div > ol')) return;
  const rect = listItem.getBoundingClientRect();
  if (event.clientX - rect.left > 28) return;
  event.preventDefault();
  const collapsed = listItem.getAttribute('data-list-collapsed') !== 'true';
  setListItemCollapsed(editor, listItem, collapsed);
};

const shellThemes: Array<{ id: ShellId; label: string }> = [
  { id: 'native-garden', label: 'Native Garden' },
  { id: 'native-ledger', label: 'Native Ledger' },
  { id: 'typora-base', label: 'Typora Base' }
];

const lowlight = createLowlight(common);

const blockTextPreview = (text: string, max = 56) => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact || 'Untitled block';
};

const firstLines = (text: string, lines = 2) => {
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

const extractOutlineEntries = (page: Page, blocks: Block[]): OutlineEntry[] => {
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

const htmlWithOutlineAnchors = (html: string, blockId: string) => {
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

const stripOutlineAnchors = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('[data-outline-id]').forEach((element) => element.removeAttribute('data-outline-id'));
  return container.innerHTML;
};

const todoInputRegex = /^\s*(\[\]|【】)\s$/;
const codeBlockInputRegex = /^\s*(```|\/code)\s$/;
const blockMathInputRegex = /^\s*(\$\$|\/math)\s$/;
const blockquoteInputRegex = /^\s*(>|\/quote)\s$/;
const ansiRegex = /\x1b\[[0-9;]*m/g;
const hasAnsi = (value: string) => {
  ansiRegex.lastIndex = 0;
  return ansiRegex.test(value);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const markdownishText = (value: string) =>
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s+|\d+\.\s+|>\s|\[[ xX]\]\s|【】\s)|```|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|==[^=]+==|\[[^\]]+\]\([^)]+\)/.test(value);

const markdownToRichHtml = (value: string) => {
  const withHighlights = value.replace(/==([^=\n][\s\S]*?[^=\n])==/g, '<mark>$1</mark>');
  return marked.parse(withHighlights, { async: false }) as string;
};

const plainTextToHtml = (value: string) => {
  const normalized = value.replace(/\r\n?/g, '\n');
  if (markdownishText(normalized)) return markdownToRichHtml(normalized);
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
};

const markdownImportFileRegex = /\.(md|markdown|txt)$/i;
const mediaImportFileRegex = /\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac)$/i;
const videoImportFileRegex = /\.(mp4|mov|webm|m4v)$/i;
const audioImportFileRegex = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

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

const fileRelativePath = (file: File) => normalizeImportPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);

const splitImportRoot = (paths: string[]) => {
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

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
  reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
  reader.readAsDataURL(file);
});

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

const embedImportedAssetMarkdown = async (markdown: string, markdownPath: string, assets: Map<string, File>) => {
  const assetPaths = new Set(assets.keys());
  const dataUrlCache = new Map<string, string>();
  const dataUrlForPath = async (path: string) => {
    const cached = dataUrlCache.get(path);
    if (cached) return cached;
    const file = assets.get(path);
    if (!file) return '';
    const dataUrl = await fileToDataUrl(file);
    dataUrlCache.set(path, dataUrl);
    return dataUrl;
  };

  const imageMatches = Array.from(markdown.matchAll(/!\[([^\]]*)\]\(([^)\n]+)\)/g));
  let rewritten = markdown;
  for (const match of imageMatches) {
    const assetPath = resolveImportedAssetPath(match[2], markdownPath, assetPaths);
    if (!assetPath) continue;
    const dataUrl = await dataUrlForPath(assetPath);
    if (!dataUrl) continue;
    rewritten = rewritten.replace(match[0], `![${match[1]}](${dataUrl})`);
  }

  const linkMatches = Array.from(rewritten.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\n]+)\)/g));
  for (const match of linkMatches) {
    const assetPath = resolveImportedAssetPath(match[2], markdownPath, assetPaths);
    if (!assetPath || (!videoImportFileRegex.test(assetPath) && !audioImportFileRegex.test(assetPath))) continue;
    const dataUrl = await dataUrlForPath(assetPath);
    if (!dataUrl) continue;
    const tagName = videoImportFileRegex.test(assetPath) ? 'video' : 'audio';
    const label = escapeHtml(match[1]);
    rewritten = rewritten.replace(match[0], `<${tagName} controls src="${escapeHtml(dataUrl)}" title="${label}"></${tagName}>`);
  }

  const bareMediaMatches = Array.from(rewritten.matchAll(/^[^\S\r\n]*([^\s<>()]+?\.(?:mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac))[^\S\r\n]*$/gim));
  for (const match of bareMediaMatches) {
    const assetPath = resolveImportedAssetPath(match[1], markdownPath, assetPaths);
    if (!assetPath) continue;
    const dataUrl = await dataUrlForPath(assetPath);
    if (!dataUrl) continue;
    const tagName = videoImportFileRegex.test(assetPath) ? 'video' : 'audio';
    rewritten = rewritten.replace(match[0], `<${tagName} controls src="${escapeHtml(dataUrl)}"></${tagName}>`);
  }

  return rewritten;
};

const isGreenishColor = (value: string | null) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  const rgb = normalized.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    const [, r, g, b] = rgb.map(Number);
    return g > 95 && g > r * 1.25 && g > b * 1.15;
  }
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!hex) return normalized.includes('green');
  const raw = hex[1].length === 3
    ? hex[1].split('').map((char) => char + char).join('')
    : hex[1];
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return g > 95 && g > r * 1.25 && g > b * 1.15;
};

const normalizePastedHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('span, font').forEach((element) => {
    const htmlElement = element as HTMLElement;
    const color = htmlElement.style.color || htmlElement.getAttribute('color');
    if (!isGreenishColor(color)) return;
    const mark = doc.createElement('mark');
    while (htmlElement.firstChild) mark.appendChild(htmlElement.firstChild);
    htmlElement.replaceWith(mark);
  });
  return doc.body.innerHTML || html;
};

const ansiToRichHtml = (value: string) => {
  let green = false;
  let cursor = 0;
  const chunks: string[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const escaped = escapeHtml(text).replace(/\n/g, '<br>');
    chunks.push(green ? `<mark>${escaped}</mark>` : escaped);
  };

  ansiRegex.lastIndex = 0;
  for (const match of value.matchAll(ansiRegex)) {
    pushText(value.slice(cursor, match.index));
    const codes = match[0].slice(2, -1).split(';').filter(Boolean).map(Number);
    if (codes.length === 0 || codes.includes(0) || codes.includes(39)) green = false;
    if (codes.includes(32) || codes.includes(92)) green = true;
    cursor = (match.index ?? 0) + match[0].length;
  }
  pushText(value.slice(cursor));
  return `<p>${chunks.join('')}</p>`;
};

const clipboardFilesToHtml = async (files: FileList) => {
  const fileReaders = [...files].map((file) => new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : '';
      if (!src) return resolve(null);
      if (file.type.startsWith('image/')) return resolve(`<img src="${src}" alt="${escapeHtml(file.name)}">`);
      if (file.type.startsWith('video/')) return resolve(`<video controls src="${src}"></video>`);
      if (file.type.startsWith('audio/')) return resolve(`<audio controls src="${src}"></audio>`);
      return resolve(null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  }));
  return (await Promise.all(fileReaders)).filter(Boolean).join('');
};

const handleRichPaste = (editor: Editor | null, event: ClipboardEvent) => {
  if (!editor) return false;
  const clipboard = event.clipboardData;
  if (!clipboard) return false;

  if (clipboard.files.length) {
    event.preventDefault();
    void clipboardFilesToHtml(clipboard.files).then((html) => {
      if (html) editor.chain().focus().insertContent(html).run();
    });
    return true;
  }

  const html = clipboard.getData('text/html');
  const markdown = clipboard.getData('text/markdown') || clipboard.getData('text/x-markdown');
  const text = clipboard.getData('text/plain');
  const nextHtml = html
    ? normalizePastedHtml(html)
    : markdown
      ? markdownToRichHtml(markdown)
      : hasAnsi(text)
        ? ansiToRichHtml(text)
        : markdownishText(text)
          ? markdownToRichHtml(text)
          : '';

  if (!nextHtml) return false;
  event.preventDefault();
  editor.chain().focus().insertContent(nextHtml).run();
  return true;
};

const handleRichCopy = (editor: Editor | null, event: ClipboardEvent) => {
  if (!editor) return false;
  const clipboard = event.clipboardData;
  const selection = window.getSelection();
  if (!clipboard || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  if (!editor.view.dom.contains(selection.anchorNode) || !editor.view.dom.contains(selection.focusNode)) return false;

  const container = document.createElement('div');
  container.appendChild(selection.getRangeAt(0).cloneContents());
  const html = container.innerHTML;
  if (!html.trim()) return false;
  clipboard.setData('text/html', html);
  clipboard.setData('text/markdown', htmlToMarkdown(html));
  clipboard.setData('text/plain', selection.toString());
  event.preventDefault();
  return true;
};

const syncDomSelectionToEditor = (editor: Editor) => {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !editor.view.dom.contains(selection.anchorNode)) return;

  try {
    const anchor = editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    const head = selection.focusNode
      ? editor.view.posAtDOM(selection.focusNode, selection.focusOffset)
      : anchor;
    const { from, to } = editor.state.selection;
    const nextFrom = Math.min(anchor, head);
    const nextTo = Math.max(anchor, head);
    if (from === nextFrom && to === nextTo) return;
    editor.commands.setTextSelection({ from: nextFrom, to: nextTo });
  } catch {
    // Browser selections can briefly point at non-editable chrome; keep the current editor state then.
  }
};

const runListIndentCommand = (editor: Editor, direction: 'in' | 'out') => {
  syncDomSelectionToEditor(editor);
  const command = direction === 'in' ? 'sinkListItem' : 'liftListItem';
  return editor.commands[command]('taskItem') || editor.commands[command]('listItem');
};

const typoraClass = (existing: unknown, ...aliases: string[]) => {
  const classes = [
    ...(typeof existing === 'string' ? existing.split(/\s+/) : []),
    ...aliases
  ].map((name) => name.trim()).filter(Boolean);
  return [...new Set(classes)].join(' ');
};

const TyporaAliases = Extension.create({
  name: 'typoraAliases',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-end-block') })
          }
        }
      },
      {
        types: ['heading'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-heading', 'md-end-block') })
          },
          typoraHeadingLevel: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-heading-level'),
            renderHTML: (attributes) => {
              const level = attributes.level ?? attributes.typoraHeadingLevel;
              return level ? { 'data-heading-level': String(level) } : {};
            }
          }
        }
      },
      {
        types: ['codeBlock'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-fences', 'md-end-block') })
          }
        }
      },
      {
        types: ['table'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-table') })
          }
        }
      },
      {
        types: ['bulletList', 'orderedList'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-list') })
          }
        }
      },
      {
        types: ['taskList'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'contains-task-list', 'task-list', 'md-list') })
          }
        }
      },
      {
        types: ['listItem'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-list-item', 'md-end-block') })
          }
        }
      },
      {
        types: ['taskItem'],
        attributes: {
          typoraTaskType: {
            default: 'taskItem',
            parseHTML: (element) => element.getAttribute('data-type') ?? 'taskItem',
            renderHTML: () => ({ 'data-type': 'taskItem' })
          },
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({
              class: typoraClass(
                attributes.class,
                'task-list-item',
                'md-task-list-item',
                attributes.checked ? 'task-list-done' : '',
                'md-end-block'
              )
            })
          }
        }
      },
      {
        types: ['image'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-image') })
          }
        }
      },
      {
        types: ['video', 'audio', 'mediaEmbed'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-media') })
          }
        }
      },
      {
        types: ['inlineMath'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-math-inline', 'mathjax-inline') })
          }
        }
      },
      {
        types: ['blockMath'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-math-block', 'mathjax-block', 'md-end-block') })
          }
        }
      },
      {
        types: ['blockquote', 'horizontalRule'],
        attributes: {
          class: {
            default: null,
            parseHTML: (element) => element.getAttribute('class'),
            renderHTML: (attributes) => ({ class: typoraClass(attributes.class, 'md-end-block') })
          }
        }
      }
    ];
  }
});

const KeyboardKey = Mark.create({
  name: 'keyboardKey',

  parseHTML() {
    return [{ tag: 'kbd' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['kbd', mergeAttributes(HTMLAttributes, { class: 'md-kbd' }), 0];
  }
});

const MdAlert = Node.create({
  name: 'mdAlert',
  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      alertType: {
        default: 'note',
        parseHTML: (element) => {
          const className = (element as HTMLElement).className;
          return className.match(/md-alert-(note|tip|important|warning|caution)/)?.[1] ?? 'note';
        },
        renderHTML: (attributes) => ({ 'data-alert-type': attributes.alertType ?? 'note' })
      }
    };
  },

  parseHTML() {
    return [{ tag: 'div.md-alert' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const alertType = node.attrs.alertType ?? 'note';
    return ['div', mergeAttributes(HTMLAttributes, {
      class: `md-alert md-alert-${alertType}`
    }), 0];
  }
});

const NotebookListItem = ListItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listCollapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-list-collapsed') === 'true',
        renderHTML: (attributes) => ({
          'data-list-collapsed': attributes.listCollapsed ? 'true' : 'false'
        })
      }
    };
  }
});

const NotebookTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listCollapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-list-collapsed') === 'true',
        renderHTML: (attributes) => ({
          'data-list-collapsed': attributes.listCollapsed ? 'true' : 'false'
        })
      },
      todoStyle: {
        default: 'plain',
        parseHTML: (element) => element.getAttribute('data-todo-style') ?? 'plain',
        renderHTML: (attributes) => ({
          'data-todo-style': attributes.todoStyle === 'bracket' ? 'bracket' : 'plain'
        })
      }
    };
  }
});

const NotebookVideo = Node.create({
  name: 'video',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true }
    };
  },

  parseHTML() {
    return [{ tag: 'video[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: '' })];
  }
});

const NotebookAudio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true }
    };
  },

  parseHTML() {
    return [{ tag: 'audio[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(HTMLAttributes, { controls: '' })];
  }
});

const NotebookEmbed = Node.create({
  name: 'mediaEmbed',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: 'Embedded media' }
    };
  },

  parseHTML() {
    return [{ tag: 'iframe.media-embed[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['iframe', mergeAttributes(HTMLAttributes, {
      class: 'media-embed',
      loading: 'lazy',
      allowfullscreen: 'true'
    })];
  }
});

const FootnoteReference = Node.create({
  name: 'footnoteReference',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      footnoteId: { default: '' },
      label: { default: '' }
    };
  },

  parseHTML() {
    return [{
      tag: 'sup.md-footnote[data-footnote-id]',
      getAttrs: (element) => {
        const footnote = element as HTMLElement;
        return {
          footnoteId: footnote.getAttribute('data-footnote-id') ?? '',
          label: footnote.textContent?.replace(/^\[|\]$/g, '') ?? ''
        };
      }
    }];
  },

  renderHTML({ node }) {
    const footnoteId = node.attrs.footnoteId || node.attrs.label;
    const label = node.attrs.label || footnoteId;
    return ['sup', mergeAttributes({
      class: 'md-footnote',
      'data-footnote-id': footnoteId
    }), ['a', {
      href: `#fn-${footnoteId}`,
      id: `fnref-${footnoteId}`,
      contenteditable: 'false'
    }, `[${label}]`]];
  }
});

const FootnoteItem = Node.create({
  name: 'footnoteItem',
  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      footnoteId: { default: '' }
    };
  },

  parseHTML() {
    return [{
      tag: '[data-type="footnote-item"][data-footnote-id]',
      getAttrs: (element) => ({
        footnoteId: (element as HTMLElement).getAttribute('data-footnote-id') ?? ''
      })
    }];
  },

  renderHTML({ node }) {
    const footnoteId = node.attrs.footnoteId;
    return ['div', mergeAttributes({
      class: 'md-def-footnote',
      'data-type': 'footnote-item',
      'data-footnote-id': footnoteId,
      id: `fn-${footnoteId}`
    }), 0];
  }
});

const FootnoteSection = Node.create({
  name: 'footnoteSection',
  group: 'block',
  content: 'footnoteItem+',

  parseHTML() {
    return [{ tag: 'section[data-type="footnotes"]' }];
  },

  renderHTML() {
    return ['section', {
      class: 'footnotes',
      'data-type': 'footnotes'
    }, 0];
  }
});

const BracketTodoInput = Extension.create({
  name: 'bracketTodoInput',

  addInputRules() {
    return [
      new InputRule({
        find: todoInputRegex,
        handler: ({ range, match, chain }) => {
          const todoStyle = match[1] === '【】' ? 'bracket' : 'plain';
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .updateAttributes('taskItem', { todoStyle })
            .run();
        }
      }),
      new InputRule({
        find: codeBlockInputRegex,
        handler: ({ range, commands }) => {
          commands.deleteRange(range);
          commands.setCodeBlock();
        }
      }),
      new InputRule({
        find: blockMathInputRegex,
        handler: ({ range, commands }) => {
          commands.deleteRange(range);
          commands.insertBlockMath({ latex: '\\;' });
        }
      }),
      new InputRule({
        find: blockquoteInputRegex,
        handler: ({ range, commands }) => {
          commands.deleteRange(range);
          commands.toggleBlockquote();
        }
      })
    ];
  }
});

const NotebookShortcuts = Extension.create<{
  onShiftEnter?: (editor: Editor) => boolean;
  onMoveBlock?: (direction: -1 | 1) => boolean;
}>({
  name: 'notebookShortcuts',

  addKeyboardShortcuts() {
    return {
      'Mod-h': () => this.editor.commands.toggleHighlight(),
      Enter: () => {
        syncDomSelectionToEditor(this.editor);
        const { state } = this.editor;
        const { $from } = state.selection;
        const text = $from.parent.textContent.trim();
        if ($from.parent.type.name !== 'paragraph' || !['```', '/code'].includes(text)) return false;
        return this.editor
          .chain()
          .deleteRange({ from: $from.start(), to: $from.end() })
          .setCodeBlock()
          .run();
      },
      'Shift-Enter': () => this.options.onShiftEnter?.(this.editor) ?? false,
      'Mod-ArrowUp': () => this.options.onMoveBlock?.(-1) ?? false,
      'Mod-ArrowDown': () => this.options.onMoveBlock?.(1) ?? false,
      Tab: () => runListIndentCommand(this.editor, 'in'),
      'Shift-Tab': () => runListIndentCommand(this.editor, 'out')
    };
  }
});

const createEditorExtensions = (
  placeholder?: string,
  onShiftEnter?: (editor: Editor) => boolean,
  onMoveBlock?: (direction: -1 | 1) => boolean
) => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    codeBlock: false,
    listItem: false,
    link: false,
    underline: false
  }),
  CodeBlockLowlight.configure({
    lowlight,
    defaultLanguage: null,
    HTMLAttributes: {
      class: 'md-fences md-end-block cm-s-inner'
    }
  }),
  TyporaAliases,
  Highlight,
  Underline,
  KeyboardKey,
  Link.configure({
    autolink: true,
    defaultProtocol: 'https',
    openOnClick: false
  }),
  Image.configure({
    allowBase64: true,
    inline: false
  }),
  Table.configure({
    resizable: true
  }),
  TableRow,
  TableHeader,
  TableCell,
  NotebookListItem,
  TaskList,
  NotebookTaskItem.configure({ nested: true }),
  NotebookVideo,
  NotebookAudio,
  NotebookEmbed,
  MdAlert,
  FootnoteReference,
  FootnoteItem,
  FootnoteSection,
  Mathematics.configure({
    katexOptions: {
      throwOnError: false
    }
  }),
  BracketTodoInput,
  NotebookShortcuts.configure({ onShiftEnter, onMoveBlock }),
  Placeholder.configure({ placeholder: placeholder ?? '' })
];

function RichEditor({
  className,
  html,
  placeholder,
  onFocus,
  onUpdate,
  onBlur,
  onShiftEnter,
  onMoveBlock,
  editorRef
}: RichEditorProps) {
  const externalHtmlRef = useRef(html ?? '');
  const editorHolderRef = useRef<Editor | null>(null);
  const editor = useEditor({
    extensions: createEditorExtensions(placeholder, onShiftEnter, onMoveBlock),
    content: html || '',
    editorProps: {
      attributes: {
        class: `${className} tiptap-editor typora-block-doc`
      },
      handlePaste: (_view, event) => handleRichPaste(editorHolderRef.current, event),
      handleDOMEvents: {
        copy: (_view, event) => handleRichCopy(editorHolderRef.current, event)
      }
    },
    onFocus: ({ editor }) => onFocus(editor),
    onUpdate: ({ editor }) => onUpdate?.(editor.getHTML(), editor.getText()),
    onBlur: ({ editor }) => onBlur?.(editor.getHTML(), editor.getText())
  });

  useEffect(() => {
    editorHolderRef.current = editor;
    editorRef(editor);
    return () => editorRef(null);
  }, [editor, editorRef]);

  useEffect(() => {
    if (!editor) return;
    const nextHtml = html ?? '';
    if (!editor.isFocused && nextHtml !== externalHtmlRef.current && nextHtml !== editor.getHTML()) {
      editor.commands.setContent(nextHtml, { emitUpdate: false });
    }
    externalHtmlRef.current = nextHtml;
  }, [editor, html]);

  return <div onMouseDown={(event) => toggleCollapsibleListItem(event, editor)}><EditorContent editor={editor} /></div>;
}

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [activeEditor, setActiveEditor] = useState<EditorTarget>({ kind: 'composer' });
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [showComposerFooter, setShowComposerFooter] = useState(true);
  const [typoraSidebarTab, setTyporaSidebarTab] = useState<'files' | 'outline' | 'desk'>('files');
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
  const outlineEntries = useMemo(() => extractOutlineEntries(activePage, pageBlocks), [activePage, pageBlocks]);
  const pinnedBlocks = state.blocks.filter((block) => block.pinned);
  const openCardBlock = state.blocks.find((block) => block.id === state.openCardWindowBlockId) ?? null;
  const cardModeBlockId = new URLSearchParams(window.location.search).get('card');
  const cardModeBlock = state.blocks.find((block) => block.id === cardModeBlockId) ?? null;
  const visibleBlocks = query.trim()
    ? pageBlocks.filter((block) => block.content.plainText.toLowerCase().includes(query.trim().toLowerCase()))
    : pageBlocks;
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

  const activateEditor = (target: EditorTarget) => {
    setActiveEditor((current) => {
      if (current.kind !== target.kind) return target;
      if (current.kind === 'composer') return current;
      if (target.kind === 'composer') return target;
      return current.blockId === target.blockId ? current : target;
    });
  };

  const insertLocalMedia = (kind: 'image' | 'video' | 'audio') => {
    const editor = getActiveTiptapEditor();
    if (!editor) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : 'audio/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const src = typeof reader.result === 'string' ? reader.result : '';
        if (!src) return;
        if (kind === 'image') {
          editor.chain().focus().setImage({ src, alt: file.name }).run();
          return;
        }
        const html = kind === 'video'
          ? `<video controls src="${src}"></video>`
          : `<audio controls src="${src}"></audio>`;
        editor.chain().focus().insertContent(html).run();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

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
    if (command === 'link') {
      const previousUrl = editor.getAttributes('link').href as string | undefined;
      const url = window.prompt('Link URL', previousUrl ?? 'https://');
      if (url === null) return;
      if (!url.trim()) {
        editor.chain().focus().unsetLink().run();
        return;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    }
    if (command === 'table') {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    }
    if (command === 'tableRowAfter') editor.chain().focus().addRowAfter().run();
    if (command === 'tableColumnAfter') editor.chain().focus().addColumnAfter().run();
    if (command === 'tableDeleteRow') editor.chain().focus().deleteRow().run();
    if (command === 'tableDeleteColumn') editor.chain().focus().deleteColumn().run();
    if (command === 'inlineMath') {
      const latex = window.prompt('Inline math', 'E = mc^2');
      if (latex?.trim()) editor.chain().focus().insertInlineMath({ latex: latex.trim() }).run();
    }
    if (command === 'blockMath') {
      const latex = window.prompt('Block math', '\\int_0^1 x^2 dx');
      if (latex?.trim()) editor.chain().focus().insertBlockMath({ latex: latex.trim() }).run();
    }
    if (command === 'footnote') insertFootnote();
    if (command === 'horizontalRule') editor.chain().focus().setHorizontalRule().run();
    if (command === 'image') {
      insertLocalMedia('image');
    }
    if (command === 'video' || command === 'audio') {
      insertLocalMedia(command);
    }
    if (command === 'embed') {
      const src = window.prompt(`${command[0].toUpperCase()}${command.slice(1)} URL`);
      if (!src?.trim()) return;
      const html = `<iframe class="media-embed md-media" src="${src.trim()}" title="Embedded media" loading="lazy" allowfullscreen="true"></iframe>`;
      editor.chain().focus().insertContent(html).run();
    }
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
        page.id === activePage.id ? { ...page, blockIds: [...page.blockIds, block.id], updatedAt: new Date().toISOString() } : page
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
    setState((current) => ({ ...current, openCardWindowBlockId: blockId }));
    if (!isTauri()) return;

    const label = `card_${blockId.replace(/[^a-zA-Z0-9_:-]/g, '_')}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }
    new WebviewWindow(label, {
      url: `${window.location.pathname}?card=${encodeURIComponent(blockId)}`,
      title: 'Notebook card',
      width: 360,
      height: 260,
      minWidth: 260,
      minHeight: 160,
      decorations: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: true
    });
  };

  const renderPageTree = (parentId: string | null = null, depth = 0): React.ReactNode =>
    (childPages.get(parentId) ?? []).map((page) => {
      const hasChildren = Boolean(childPages.get(page.id)?.length);
      const expanded = state.expandedPageIds.includes(page.id);
      return (
        <div className="page-tree-row" key={page.id} style={{ '--depth': depth } as React.CSSProperties}>
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
              if (event.key !== 'Tab') return;
              event.preventDefault();
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
            onClick={() => setState((current) => ({ ...current, activePageId: page.id }))}
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
              if (event.key !== 'Tab') return;
              event.preventDefault();
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
            onClick={() => setState((current) => ({ ...current, activePageId: page.id }))}
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
          {hasChildren && expanded && <div className="file-node-children">{renderTyporaFileTree(page.id, depth + 1)}</div>}
        </div>
      );
    });

  const renderWriteSurface = () => (
    <section className="page-surface typora-content-surface typora-write" id="write">
      <input className="page-title" value={activePage.title} onChange={(event) => renamePage(event.target.value)} aria-label="Page title" />
      {metadataChips.length ? (
        <div className="page-metadata" aria-label="Page metadata">
          {metadataChips.map((chip, index) => <span key={`${chip}-${index}`}>{chip}</span>)}
        </div>
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
                {showToolbar && activeEditor.kind === 'block' && activeEditor.blockId === block.id && (
                  <Toolbar runCommand={runEditorCommand} insertTodo={insertTodo} applyHighlight={applyHighlight} applyInlineCode={applyInlineCode} />
                )}
                {!block.collapsed ? (
                  <RichEditor
                    editorRef={(editor) => { blockEditorRefs.current[block.id] = editor; }}
                    className="block-content editable"
                    html={htmlWithOutlineAnchors(block.content.html, block.id)}
                    onFocus={() => activateEditor({ kind: 'block', blockId: block.id })}
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
                <button className={`icon-button ghost ${block.pinned ? 'active' : ''}`} onClick={() => toggleBlock(block.id, 'pinned')} aria-label="Pin block" type="button">
                  <MapPin size={15} />
                </button>
              </div>
            </article>
            {showBlockDividers && index < visibleBlocks.length - 1 && (
              <hr
                className={`block-divider md-hr md-end-block ${themesWithoutNativeDivider.has(state.contentTheme) ? 'uses-default-divider' : 'uses-theme-divider'}`}
                aria-hidden="true"
              />
            )}
          </Fragment>
        ))}
      </div>

      <div className="composer-card">
        {showToolbar && activeEditor.kind === 'composer' && (
          <Toolbar runCommand={runEditorCommand} insertTodo={insertTodo} applyHighlight={applyHighlight} applyInlineCode={applyInlineCode} />
        )}
        <RichEditor
          editorRef={(editor) => { composerEditorRef.current = editor; }}
          className="composer"
          placeholder="写点什么。按 Shift Enter 变成 block，Tab 缩进。"
          onFocus={() => activateEditor({ kind: 'composer' })}
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

  const renderNativeOutline = () => (
    <div className="outline-list typora-toc md-toc md-toc-content">
      {outlineEntries.map((entry) => (
        <button
          className={`outline-entry md-toc-item outline-kind-${entry.kind}`}
          key={entry.id}
          onClick={() => jumpToOutlineEntry(entry)}
          style={{ '--level': entry.level } as React.CSSProperties}
          type="button"
        >
          <span>{entry.kind === 'page' ? 'P' : entry.kind === 'block' ? 'B' : entry.kind === 'heading' ? `H${Math.max(1, entry.level - 1)}` : '•'}</span>
          <span>{entry.text}</span>
        </button>
      ))}
    </div>
  );

  const renderTyporaOutline = () => (
    <div id="outline-content" className="outline-content typora-toc md-toc md-toc-content">
      {outlineEntries.map((entry) => (
        <button
          className={`outline-item md-toc-item outline-kind-${entry.kind} ${entry.blockId === null ? 'outline-item-active active' : ''}`}
          key={entry.id}
          onClick={() => jumpToOutlineEntry(entry)}
          style={{ '--level': entry.level } as React.CSSProperties}
          type="button"
        >
          <span className="outline-expander" aria-hidden="true">{entry.kind === 'page' ? 'P' : entry.kind === 'block' ? 'B' : entry.kind === 'heading' ? `H${Math.max(1, entry.level - 1)}` : '•'}</span>
          <span className="outline-label">{entry.text}</span>
        </button>
      ))}
    </div>
  );

  const renderPinnedCards = (className = 'desktop-preview', cardClassName = 'desktop-card') => (
    <div className={className}>
      {pinnedBlocks.length ? pinnedBlocks.map((block) => (
        <button
          className={cardClassName}
          key={block.id}
          type="button"
          onClick={() => openPinnedWindow(block.id)}
        >
          <div dangerouslySetInnerHTML={{ __html: block.content.html }} />
        </button>
      )) : <p className="muted">Pin blocks to keep them close.</p>}
    </div>
  );

  const renderToolControls = (compact = false) => (
    <div className={compact ? 'typora-tool-controls' : 'topbar-actions'}>
      <label className="view-toggle"><input type="checkbox" checked={showToolbar} onChange={(event) => setShowToolbar(event.target.checked)} /> Toolbar</label>
      <label className="view-toggle"><input type="checkbox" checked={showComposerFooter} onChange={(event) => setShowComposerFooter(event.target.checked)} /> Add</label>
      <select
        className="theme-select shell-theme-select"
        value={state.shell}
        onChange={(event) => setShell(event.target.value as ShellId)}
        aria-label="Shell theme"
      >
        {shellThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
      </select>
      <select
        className="theme-select content-theme-select"
        value={state.contentTheme}
        onChange={(event) => setContentTheme(event.target.value as ContentThemeId)}
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
          void importMarkdownFiles(event.target.files);
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
          void importMarkdownFolder(event.target.files);
          event.currentTarget.value = '';
        }}
      />
      <button className="secondary-button" type="button" onClick={() => markdownInputRef.current?.click()}><FileUp size={15} /> Import MD</button>
      <button className="secondary-button" type="button" onClick={() => markdownFolderInputRef.current?.click()}><FileUp size={15} /> Import folder</button>
      <button className="secondary-button" type="button" onClick={exportMarkdown}><Download size={15} /> Markdown</button>
      <button className="secondary-button" type="button" onClick={exportJson}><Upload size={15} /> Backup</button>
    </div>
  );

  const renderNativeShell = () => (
    <div className="app-shell typora-theme" data-content-theme={state.contentTheme} data-shell={state.shell}>
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">{state.shell === 'native-ledger' ? 'ledger notes' : 'garden notes'}</p>
          <div className="brand-mark"><Sparkles size={20} /></div>
          <h1>Notebook</h1>
          <p className="profile-id">block-first</p>
        </div>

        <section className="sidebar-section">
          <div className="section-row">
            <div className="section-label">Notebooks</div>
            <button className="mini-button" type="button" onClick={addNotebook} aria-label="New notebook"><Plus size={14} /></button>
          </div>
          <div className="notebook-list">
            {state.notebooks.map((notebook) => (
              <button
                className={`notebook-button ${notebook.id === activeNotebook.id ? 'active' : ''}`}
                key={notebook.id}
                type="button"
                onClick={() => setState((current) => ({
                  ...current,
                  activeNotebookId: notebook.id,
                  activePageId: notebook.pageIds[0] ?? current.activePageId
                }))}
              >
                <NotebookTabs size={15} />
                {notebook.name}
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section pages-section">
          <div className="section-row">
            <div className="section-label">Pages</div>
            <button className="mini-button" type="button" onClick={() => addPage(null)} aria-label="New page"><FilePlus size={14} /></button>
          </div>
          <div
            className="page-tree"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const draggedId = event.dataTransfer.getData('application/page-id');
              if (draggedId && event.currentTarget === event.target) movePageUnder(draggedId, null);
            }}
          >
            {renderPageTree(null)}
          </div>
        </section>

        <section className="sidebar-note">
          <strong>今天也要</strong>
          <span>记录美好的一天哦~</span>
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="正文、block、todo" />
          </div>
          {renderToolControls(false)}
        </header>

        {renderImportNotice()}
        {renderWriteSurface()}
      </main>

      <aside className="right-panel">
        <section className="panel-card">
          <div className="panel-title"><PanelRight size={16} /> Outline</div>
          {renderNativeOutline()}
        </section>

        <section className="panel-card desktop-preview">
          <div className="panel-title"><MapPin size={16} /> Pinned</div>
          {renderPinnedCards()}
        </section>
      </aside>

      {openCardBlock && (
        <div className="floating-card-window">
          <div className="floating-card-head">
            <span>Desktop card</span>
            <button type="button" onClick={() => setState((current) => ({ ...current, openCardWindowBlockId: null }))}>×</button>
          </div>
          <div className="floating-card-body" dangerouslySetInnerHTML={{ __html: openCardBlock.content.html }} />
        </div>
      )}
    </div>
  );

  const renderTyporaShell = () => (
    <div className="typora-app-shell typora-theme" data-content-theme={state.contentTheme} data-shell={state.shell}>
      <aside id="typora-sidebar" className={`typora-sidebar active-tab-${typoraSidebarTab}`}>
        <div className="sidebar-tabs" role="tablist" aria-label="Sidebar tabs">
          <button className={`sidebar-tab ${typoraSidebarTab === 'files' ? 'active' : ''}`} type="button" onClick={() => setTyporaSidebarTab('files')}>Files</button>
          <button className={`sidebar-tab ${typoraSidebarTab === 'outline' ? 'active' : ''}`} type="button" onClick={() => setTyporaSidebarTab('outline')}>Outline</button>
          <button className={`sidebar-tab ${typoraSidebarTab === 'desk' ? 'active' : ''}`} type="button" onClick={() => setTyporaSidebarTab('desk')}>Desk</button>
        </div>

        <div id="sidebar-content" className="sidebar-content">
          <section className={`typora-sidebar-pane ${typoraSidebarTab === 'files' ? 'is-active' : ''}`} aria-hidden={typoraSidebarTab !== 'files'}>
            <div className="typora-sidebar-section-header">
              <span>Notebooks</span>
              <button className="mini-button" type="button" onClick={addNotebook} aria-label="New notebook"><Plus size={14} /></button>
            </div>
            <div className="file-library">
              {state.notebooks.map((notebook) => (
                <div className="file-library-node" data-is-directory="true" key={notebook.id}>
                  <span className="file-node-background" aria-hidden="true" />
                  <button
                    className="file-node-content notebook-node"
                    type="button"
                    onClick={() => setState((current) => ({
                      ...current,
                      activeNotebookId: notebook.id,
                      activePageId: notebook.pageIds[0] ?? current.activePageId
                    }))}
                  >
                    <span className="file-node-open-state"><NotebookTabs size={13} /></span>
                    <span className="file-node-title file-name">{notebook.name}</span>
                  </button>
                </div>
              ))}
            </div>

            <div className="typora-sidebar-section-header">
              <span>Pages</span>
              <button className="mini-button" type="button" onClick={() => addPage(null)} aria-label="New page"><FilePlus size={14} /></button>
            </div>
            <div
              className="file-library"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const draggedId = event.dataTransfer.getData('application/page-id');
                if (draggedId && event.currentTarget === event.target) movePageUnder(draggedId, null);
              }}
            >
              {renderTyporaFileTree(null)}
            </div>
          </section>

          <section className={`typora-sidebar-pane ${typoraSidebarTab === 'outline' ? 'is-active' : ''}`} aria-hidden={typoraSidebarTab !== 'outline'}>
            {renderTyporaOutline()}
          </section>

          <section className={`typora-sidebar-pane ${typoraSidebarTab === 'desk' ? 'is-active' : ''}`} aria-hidden={typoraSidebarTab !== 'desk'}>
            <div className="typora-desk-tab">
              <section className="typora-desk-search">
                <div className="search-box typora-search-box">
                  <Search size={16} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
                </div>
              </section>
              <section className="typora-tools">
                {renderToolControls(true)}
              </section>
              <section className="typora-pin-list">
                {renderPinnedCards('typora-pin-grid', 'typora-pin-card')}
              </section>
            </div>
          </section>
        </div>
      </aside>

      <main className="typora-workspace">
        {renderImportNotice()}
        {renderWriteSurface()}
      </main>

      {openCardBlock && (
        <div className="floating-card-window">
          <div className="floating-card-head">
            <span>Desktop card</span>
            <button type="button" onClick={() => setState((current) => ({ ...current, openCardWindowBlockId: null }))}>×</button>
          </div>
          <div className="floating-card-body" dangerouslySetInnerHTML={{ __html: openCardBlock.content.html }} />
        </div>
      )}
    </div>
  );

  if (cardModeBlock) {
    return (
      <main className="card-window-page typora-theme" data-content-theme={state.contentTheme} data-shell={state.shell}>
        <div className="floating-card-body card-mode" dangerouslySetInnerHTML={{ __html: cardModeBlock.content.html }} />
      </main>
    );
  }

  return state.shell === 'typora-base' ? renderTyporaShell() : renderNativeShell();
}

function Toolbar({
  runCommand,
  insertTodo,
  applyHighlight,
  applyInlineCode
}: {
  runCommand: (command: ToolbarCommand) => void;
  insertTodo: () => void;
  applyHighlight: () => void;
  applyInlineCode: () => void;
}) {
  return (
    <div className="format-toolbar" aria-label="Formatting toolbar">
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('bold')} title="Bold: Command B"><Bold size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('italic')} title="Italic: Command I"><Italic size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('underline')} title="Underline"><UnderlineIcon size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('strike')} title="Strikethrough"><Strikethrough size={16} /></button>
      <button className="tool-button highlight-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={applyHighlight} title="Highlight: Command H"><Highlighter size={16} /></button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('h1')} title="Heading 1">H1</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('h2')} title="Heading 2">H2</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('h3')} title="Heading 3">H3</button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={applyInlineCode} title="Inline code"><Type size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('kbd')} title="Keyboard key"><Keyboard size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('link')} title="Link"><LinkIcon size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('codeBlock')} title="Code block"><Braces size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('blockquote')} title="Quote"><Quote size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('table')} title="Table"><Table2 size={16} /></button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('tableRowAfter')} title="Add table row">+R</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('tableColumnAfter')} title="Add table column">+C</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('tableDeleteRow')} title="Delete table row">-R</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('tableDeleteColumn')} title="Delete table column">-C</button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('inlineMath')} title="Inline math"><Sigma size={16} /></button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('blockMath')} title="Block math">Σ</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('footnote')} title="Footnote">fn</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('horizontalRule')} title="Horizontal rule">HR</button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('image')} title="Image"><ImageIcon size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('video')} title="Video"><Video size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('audio')} title="Audio"><Volume2 size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('embed')} title="Embed"><PanelTop size={16} /></button>
      <span className="toolbar-divider" />
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('bulletList')} title="Bullet list"><List size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('orderedList')} title="Numbered list"><ListOrdered size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={insertTodo} title="Todo"><CheckSquare size={16} /></button>
      <span className="toolbar-divider" />
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('indent')} title="Indent: Tab"><Indent size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('outdent')} title="Outdent: Shift Tab"><Outdent size={16} /></button>
    </div>
  );
}
