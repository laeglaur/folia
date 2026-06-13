import type { AppState, Block, Notebook, OperationLogEntry, Page, ThemeId } from './types';
import { invoke, isTauri } from '@tauri-apps/api/core';

const STORAGE_KEY = 'block-first-notebook.state.v1';

const now = () => new Date().toISOString();

export const createId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

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
  theme: 'garden',
  openCardWindowBlockId: null,
  expandedPageIds: [starterPageId],
  operations: []
});

const normalizeTheme = (theme?: string): ThemeId => {
  if (theme === 'archive') return 'ledger';
  if (theme === 'garden' || theme === 'ledger') return theme;
  return 'garden';
};

const normalizeState = (state: AppState): AppState => ({
  ...state,
  notebooks: state.notebooks.map((notebook) => ({
    ...notebook,
    pageIds: notebook.pageIds ?? state.pages.filter((page) => page.notebookId === notebook.id).map((page) => page.id)
  })),
  pages: state.pages.map((page) => ({
    ...page,
    parentId: page.parentId ?? null
  })),
  theme: normalizeTheme(state.theme),
  openCardWindowBlockId: state.openCardWindowBlockId ?? null,
  expandedPageIds: state.expandedPageIds ?? state.pages.map((page) => page.id),
  operations: state.operations ?? []
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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!isTauri()) return;

  try {
    await invoke('save_state_snapshot', { stateJson: JSON.stringify(state) });
  } catch (error) {
    console.warn('Could not persist notebook state to SQLite.', error);
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

const markdownInlineToHtml = (value: string) => {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  return html;
};

const htmlToPlainText = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const blockFromHtml = (pageId: string, html: string) => createBlock(pageId, html, htmlToPlainText(html));

const listItemsToHtml = (lines: string[]) => {
  const taskItems = lines
    .map((line) => line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/))
    .filter(Boolean) as RegExpMatchArray[];
  if (taskItems.length === lines.length) {
    const items = taskItems.map((match) => {
      const checked = match[1].toLowerCase() === 'x';
      return `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}" data-todo-style="plain"><label><input type="checkbox" ${checked ? 'checked="checked"' : ''}><span></span></label><div><p>${markdownInlineToHtml(match[2])}</p></div></li>`;
    });
    return `<ul data-type="taskList">${items.join('')}</ul>`;
  }

  const ordered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
  const items = lines.map((line) => {
    const text = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
    return `<li>${markdownInlineToHtml(text)}</li>`;
  });
  return ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`;
};

export const markdownToBlocks = (pageId: string, markdown: string): Block[] => {
  const blocks: Block[] = [];
  const paragraph: string[] = [];
  const list: string[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ').trim();
    if (text) blocks.push(blockFromHtml(pageId, `<p>${markdownInlineToHtml(text)}</p>`));
    paragraph.length = 0;
  };

  const flushList = () => {
    if (!list.length) return;
    blocks.push(blockFromHtml(pageId, listItemsToHtml(list)));
    list.length = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push(blockFromHtml(pageId, `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`));
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(blockFromHtml(pageId, `<h${heading[1].length}>${markdownInlineToHtml(heading[2])}</h${heading[1].length}>`));
      continue;
    }

    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      flushParagraph();
      list.push(line);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks.length ? blocks : [blockFromHtml(pageId, '<p></p>')];
};

export const createPageFromMarkdown = (notebookId: string, filename: string, markdown: string) => {
  const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fallbackTitle = filename.replace(/\.(md|markdown|txt)$/i, '').trim() || 'Imported page';
  const page = createPage(notebookId, firstHeading || fallbackTitle);
  const body = firstHeading ? markdown.replace(/^#\s+.+$/m, '').trim() : markdown;
  const blocks = markdownToBlocks(page.id, body);
  return {
    page: {
      ...page,
      blockIds: blocks.map((block) => block.id)
    },
    blocks
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

  container.querySelectorAll('strong, b').forEach((node) => {
    node.replaceWith(`**${node.textContent ?? ''}**`);
  });
  container.querySelectorAll('em, i').forEach((node) => {
    node.replaceWith(`*${node.textContent ?? ''}*`);
  });
  container.querySelectorAll('code').forEach((node) => {
    node.replaceWith(`\`${node.textContent ?? ''}\``);
  });
  container.querySelectorAll('li').forEach((node) => {
    node.replaceWith(`- ${node.textContent ?? ''}\n`);
  });
  container.querySelectorAll('p, div').forEach((node) => {
    node.append('\n');
  });

  return (container.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
};
