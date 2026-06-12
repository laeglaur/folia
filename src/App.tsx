import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Braces,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  MapPin,
  MoonStar,
  PanelRight,
  Plus,
  Search,
  Sparkles,
  Type,
  Upload
} from 'lucide-react';
import type { AppState, Block, ThemeId } from './types';
import {
  appendOperation,
  createBlock,
  createPage,
  downloadTextFile,
  htmlToMarkdown,
  loadState,
  saveState
} from './state';

const themes: Array<{ id: ThemeId; label: string }> = [
  { id: 'paper', label: 'Paper' },
  { id: 'atelier', label: 'Atelier' },
  { id: 'garden', label: 'Garden' }
];

const toolbarActions = [
  { command: 'bold', icon: Bold, label: 'Bold' },
  { command: 'italic', icon: Italic, label: 'Italic' },
  { command: 'backColor', value: '#fff1a8', icon: Highlighter, label: 'Highlight' },
  { command: 'formatBlock', value: 'h2', icon: Type, label: 'Heading' },
  { command: 'insertUnorderedList', icon: List, label: 'Bullet list' },
  { command: 'insertOrderedList', icon: ListOrdered, label: 'Numbered list' },
  { command: 'formatBlock', value: 'pre', icon: Braces, label: 'Code block' }
];

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    saveState(state);
  }, [state]);

  const activeNotebook = state.notebooks.find((notebook) => notebook.id === state.activeNotebookId);
  const activePage = state.pages.find((page) => page.id === state.activePageId) ?? state.pages[0];
  const pageBlocks = useMemo(
    () => activePage.blockIds.map((blockId) => state.blocks.find((block) => block.id === blockId)).filter(Boolean) as Block[],
    [activePage.blockIds, state.blocks]
  );
  const pinnedBlocks = state.blocks.filter((block) => block.pinned);
  const visibleBlocks = query.trim()
    ? pageBlocks.filter((block) => block.content.plainText.toLowerCase().includes(query.trim().toLowerCase()))
    : pageBlocks;

  const commitDraft = () => {
    const html = editorRef.current?.innerHTML.trim() ?? '';
    const plainText = editorRef.current?.innerText.trim() ?? '';
    if (!plainText && !html.replace(/<br\s*\/?>/g, '').trim()) {
      return;
    }

    const block = createBlock(activePage.id, html, plainText);
    setState((current) => ({
      ...current,
      blocks: [...current.blocks, block],
      pages: current.pages.map((page) =>
        page.id === activePage.id
          ? { ...page, blockIds: [...page.blockIds, block.id], updatedAt: new Date().toISOString() }
          : page
      ),
      operations: appendOperation(current, {
        entity: 'block',
        entityId: block.id,
        kind: 'block.create',
        payload: block
      })
    }));
    setDraft('');
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
      editorRef.current.focus();
    }
  };

  const updateBlock = (blockId: string, html: string, plainText: string) => {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId
          ? { ...block, content: { html, plainText }, updatedAt: new Date().toISOString() }
          : block
      ),
      operations: appendOperation(current, {
        entity: 'block',
        entityId: blockId,
        kind: 'block.update_content',
        payload: { html, plainText }
      })
    }));
  };

  const toggleBlock = (blockId: string, key: 'collapsed' | 'pinned') => {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? { ...block, [key]: !block[key], updatedAt: new Date().toISOString() } : block
      ),
      operations: appendOperation(current, {
        entity: 'block',
        entityId: blockId,
        kind: `block.toggle_${key}`,
        payload: { key }
      })
    }));
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    const currentIndex = activePage.blockIds.indexOf(blockId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= activePage.blockIds.length) {
      return;
    }

    const nextIds = [...activePage.blockIds];
    [nextIds[currentIndex], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[currentIndex]];

    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === activePage.id ? { ...page, blockIds: nextIds } : page)),
      operations: appendOperation(current, {
        entity: 'page',
        entityId: activePage.id,
        kind: 'page.reorder_blocks',
        payload: { blockIds: nextIds }
      })
    }));
  };

  const addPage = () => {
    const page = createPage(state.activeNotebookId, 'Untitled page');
    setState((current) => ({
      ...current,
      pages: [...current.pages, page],
      notebooks: current.notebooks.map((notebook) =>
        notebook.id === current.activeNotebookId ? { ...notebook, pageIds: [...notebook.pageIds, page.id] } : notebook
      ),
      activePageId: page.id,
      operations: appendOperation(current, {
        entity: 'page',
        entityId: page.id,
        kind: 'page.create',
        payload: page
      })
    }));
  };

  const renamePage = (title: string) => {
    setState((current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === activePage.id ? { ...page, title } : page)),
      operations: appendOperation(current, {
        entity: 'page',
        entityId: activePage.id,
        kind: 'page.rename',
        payload: { title }
      })
    }));
  };

  const runCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const exportMarkdown = () => {
    const markdown = [`# ${activePage.title}`, '', ...pageBlocks.map((block) => htmlToMarkdown(block.content.html))].join('\n\n');
    downloadTextFile(`${activePage.title || 'page'}.md`, markdown, 'text/markdown;charset=utf-8');
  };

  const exportJson = () => {
    downloadTextFile('notebook-backup.json', JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div>
            <div className="brand-title">Notebook</div>
            <div className="brand-subtitle">block-first</div>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="section-label">Notebook</div>
          <button className="notebook-button active">{activeNotebook?.name ?? 'Notebook'}</button>
        </section>

        <section className="sidebar-section pages-section">
          <div className="section-row">
            <div className="section-label">Pages</div>
            <button className="icon-button" type="button" onClick={addPage} aria-label="New page">
              <FilePlus size={16} />
            </button>
          </div>
          {state.pages
            .filter((page) => page.notebookId === state.activeNotebookId)
            .map((page) => (
              <button
                className={`page-button ${page.id === activePage.id ? 'active' : ''}`}
                key={page.id}
                onClick={() => setState((current) => ({ ...current, activePageId: page.id }))}
              >
                {page.title}
              </button>
            ))}
        </section>

        <section className="sidebar-section theme-section">
          <div className="section-label">Themes</div>
          <div className="theme-list">
            {themes.map((theme) => (
              <button
                key={theme.id}
                className={`theme-chip ${state.theme === theme.id ? 'active' : ''}`}
                onClick={() => setState((current) => ({ ...current, theme: theme.id }))}
                type="button"
              >
                <span className={`swatch swatch-${theme.id}`} />
                {theme.label}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this page" />
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={exportMarkdown}>
              <Download size={15} /> Markdown
            </button>
            <button className="secondary-button" type="button" onClick={exportJson}>
              <Upload size={15} /> Backup
            </button>
          </div>
        </header>

        <section className="page-surface">
          <input
            className="page-title"
            value={activePage.title}
            onChange={(event) => renamePage(event.target.value)}
            aria-label="Page title"
          />

          <div className="block-list">
            {visibleBlocks.map((block, index) => (
              <article className={`block ${block.collapsed ? 'is-collapsed' : ''}`} key={block.id} id={block.id}>
                <div className="block-rail">
                  <button className="icon-button ghost" onClick={() => toggleBlock(block.id, 'collapsed')} aria-label="Collapse block">
                    {block.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  </button>
                  <button className="drag-handle" onClick={() => moveBlock(block.id, -1)} disabled={index === 0} aria-label="Move block up">
                    ↑
                  </button>
                  <button
                    className="drag-handle"
                    onClick={() => moveBlock(block.id, 1)}
                    disabled={index === pageBlocks.length - 1}
                    aria-label="Move block down"
                  >
                    ↓
                  </button>
                </div>
                <div className="block-body">
                  {!block.collapsed ? (
                    <div
                      className="block-content editable"
                      contentEditable
                      suppressContentEditableWarning
                      dangerouslySetInnerHTML={{ __html: block.content.html }}
                      onBlur={(event) => updateBlock(block.id, event.currentTarget.innerHTML, event.currentTarget.innerText)}
                    />
                  ) : (
                    <div className="block-content preview">{block.content.plainText.slice(0, 120)}</div>
                  )}
                </div>
                <div className="block-actions">
                  <button
                    className={`icon-button ghost ${block.pinned ? 'active' : ''}`}
                    onClick={() => toggleBlock(block.id, 'pinned')}
                    aria-label="Pin to desktop card"
                  >
                    <MapPin size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="composer-card">
            <div className="format-toolbar" aria-label="Formatting toolbar">
              {toolbarActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={`${action.command}-${action.label}`}
                    className="icon-button"
                    type="button"
                    onClick={() => runCommand(action.command, action.value)}
                    title={action.label}
                  >
                    <Icon size={16} />
                  </button>
                );
              })}
              <button className="icon-button" type="button" onClick={() => runCommand('insertHTML', '<input type="checkbox" /> ')} title="Todo">
                <CheckSquare size={16} />
              </button>
            </div>
            <div
              ref={editorRef}
              className="composer"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Write a block. Press Command Enter to commit."
              onInput={(event) => setDraft(event.currentTarget.innerHTML)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                }
              }}
            />
            <div className="composer-footer">
              <span>{draft ? 'Ready to become a block' : 'Waiting for a thought'}</span>
              <button className="primary-button" type="button" onClick={commitDraft}>
                <Plus size={16} /> Add block
              </button>
            </div>
          </div>
        </section>
      </main>

      <aside className="right-panel">
        <section className="panel-card">
          <div className="panel-title"><PanelRight size={16} /> Outline</div>
          <div className="outline-list">
            {pageBlocks.map((block, index) => (
              <a href={`#${block.id}`} key={block.id}>
                <span>{index + 1}</span>
                {block.content.plainText || 'Untitled block'}
              </a>
            ))}
          </div>
        </section>

        <section className="panel-card desktop-preview">
          <div className="panel-title"><MoonStar size={16} /> Desktop cards</div>
          {pinnedBlocks.length ? (
            pinnedBlocks.map((block) => (
              <div className="desktop-card" key={block.id}>
                <div dangerouslySetInnerHTML={{ __html: block.content.html }} />
              </div>
            ))
          ) : (
            <p className="muted">Pin blocks to preview desktop cards here.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
