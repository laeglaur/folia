import type { AppState, Block, Notebook, OperationLogEntry, Page, ThemeId } from './types';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { marked } from 'marked';

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

const htmlToPlainText = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const blockFromHtml = (pageId: string, html: string) => createBlock(pageId, html, htmlToPlainText(html));

const markdownInlineToHtml = (value: string) => {
  const html = marked.parseInline(value.replace(/==([^=\n][\s\S]*?[^=\n])==/g, '<mark>$1</mark>'), {
    async: false,
    gfm: true
  });
  return typeof html === 'string' ? html : escapeHtml(value);
};

const normalizeMarkdownForMarked = (markdown: string) =>
  markdown
    .replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (_match, alt: string, src: string) => `<img src="${escapeHtml(src.trim())}" alt="${escapeHtml(alt)}">`)
    .replace(/==([^=\n][\s\S]*?[^=\n])==/g, '<mark>$1</mark>')
    .replace(/^\s*【】\s+(.+)$/gm, '- [ ] <mark>$1</mark>')
    .replace(/(?:^\s*[-*+]\s+\[[ xX]\]\s+.+(?:\n|$))+/gm, (block) => {
      const items = block
        .trimEnd()
        .split('\n')
        .map((line) => line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/))
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
