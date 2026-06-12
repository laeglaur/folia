import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Braces,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  GripVertical,
  Highlighter,
  Indent,
  Italic,
  List,
  ListOrdered,
  MapPin,
  NotebookTabs,
  Outdent,
  PanelRight,
  Plus,
  Search,
  Sparkles,
  Type,
  Upload,
  PanelTop
} from 'lucide-react';
import type { AppState, Block, Page, ThemeId } from './types';
import {
  appendOperation,
  createBlock,
  createNotebook,
  createPage,
  downloadTextFile,
  htmlToMarkdown,
  loadState,
  saveState
} from './state';
import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

type EditorTarget = { kind: 'composer' } | { kind: 'block'; blockId: string };

const themes: Array<{ id: ThemeId; label: string }> = [
  { id: 'fish', label: 'Fish cosmos' },
  { id: 'paper', label: 'Soft paper' },
  { id: 'atelier', label: 'Atelier' }
];

const blockTextPreview = (text: string, max = 56) => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact || 'Untitled block';
};

const firstLines = (text: string, lines = 2) => {
  const parts = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return blockTextPreview(parts.slice(0, lines).join(' / '), 76);
};

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [activeEditor, setActiveEditor] = useState<EditorTarget>({ kind: 'composer' });
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const editorRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    saveState(state);
  }, [state]);

  const activeNotebook = state.notebooks.find((notebook) => notebook.id === state.activeNotebookId) ?? state.notebooks[0];
  const activePage = state.pages.find((page) => page.id === state.activePageId) ?? state.pages[0];
  const pageBlocks = useMemo(
    () => activePage.blockIds.map((blockId) => state.blocks.find((block) => block.id === blockId)).filter(Boolean) as Block[],
    [activePage.blockIds, state.blocks]
  );
  const pinnedBlocks = state.blocks.filter((block) => block.pinned);
  const openCardBlock = state.blocks.find((block) => block.id === state.openCardWindowBlockId) ?? null;
  const cardModeBlockId = new URLSearchParams(window.location.search).get('card');
  const cardModeBlock = state.blocks.find((block) => block.id === cardModeBlockId) ?? null;
  const visibleBlocks = query.trim()
    ? pageBlocks.filter((block) => block.content.plainText.toLowerCase().includes(query.trim().toLowerCase()))
    : pageBlocks;

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

  const getActiveElement = () => {
    if (activeEditor.kind === 'composer') return editorRef.current;
    return editorRefs.current[activeEditor.blockId] ?? null;
  };

  const applyCommand = (command: string, value?: string) => {
    const target = getActiveElement();
    target?.focus();
    document.execCommand(command, false, value);
  };

  const insertTodo = () => {
    applyCommand('insertHTML', '<label class="todo-item"><input type="checkbox"><span>&nbsp;</span></label>');
  };

  const applyHighlight = () => applyCommand('backColor', '#ffe88a');

  const applyInlineCode = () => {
    const selection = window.getSelection();
    const selected = selection?.toString() || 'code';
    const escaped = selected.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    applyCommand('insertHTML', `<code>${escaped}</code>`);
  };

  const blockIndex = (blockId: string) => activePage.blockIds.indexOf(blockId);

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

  const maybeAutoformat = (element: HTMLDivElement) => {
    const text = element.innerText;
    const trimmed = text.trim();
    if (trimmed === '[]') {
      element.innerHTML = '<label class="todo-item"><input type="checkbox"><span>&nbsp;</span></label>';
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(element);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    if (trimmed === '```' || trimmed === '/code') {
      element.innerHTML = '<pre><code><br></code></pre>';
      return;
    }
    if (/^\d+[.)]\s$/.test(text)) {
      element.innerHTML = '';
      applyCommand('insertOrderedList');
      return;
    }
    if (/^[-*]\s$/.test(text)) {
      element.innerHTML = '';
      applyCommand('insertUnorderedList');
      return;
    }
    const highlightMatch = text.match(/==([^=]+)==$/);
    if (highlightMatch) {
      element.innerHTML = element.innerHTML.replace(/==([^=]+)==$/, '<mark>$1</mark>');
    }
    if (/`[^`]+`$/.test(text)) {
      element.innerHTML = element.innerHTML.replace(/`([^`]+)`$/, '<code>$1</code>');
    }
  };

  const toggleListItemCollapse = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const listItem = target.closest('li');
    if (!listItem || !event.currentTarget.contains(listItem)) return;
    if (!listItem.querySelector('ul, ol')) return;
    listItem.classList.toggle('is-collapsed-list');
  };

  const handleEditorKeys = (event: React.KeyboardEvent<HTMLDivElement>, target: EditorTarget) => {
    setActiveEditor(target);

    if (event.key === 'Tab') {
      event.preventDefault();
      applyCommand(event.shiftKey ? 'outdent' : 'indent');
      return;
    }

    if (event.key === 'Enter') {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const anchorElement = anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
      if (anchorElement?.closest('.todo-item')) {
        event.preventDefault();
        applyCommand('insertHTML', '<br>');
        return;
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      applyCommand('bold');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      applyCommand('italic');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      applyHighlight();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === '7') {
      event.preventDefault();
      applyCommand('insertOrderedList');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === '8') {
      event.preventDefault();
      applyCommand('insertUnorderedList');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && target.kind === 'composer') {
      event.preventDefault();
      commitDraft();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && target.kind === 'block' && event.key === 'ArrowUp') {
      event.preventDefault();
      moveBlockByKeyboard(target.blockId, -1);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && target.kind === 'block' && event.key === 'ArrowDown') {
      event.preventDefault();
      moveBlockByKeyboard(target.blockId, 1);
    }
  };

  const commitDraft = () => {
    const html = editorRef.current?.innerHTML.trim() ?? '';
    const plainText = editorRef.current?.innerText.trim() ?? '';
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
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
      editorRef.current.focus();
    }
  };

  const updateBlock = (blockId: string, html: string, plainText: string) => {
    setState((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? { ...block, content: { html, plainText }, updatedAt: new Date().toISOString() } : block
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

  if (cardModeBlock) {
    return (
      <main className="card-window-page">
        <div className="floating-card-body card-mode" dangerouslySetInnerHTML={{ __html: cardModeBlock.content.html }} />
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">fish cosmos</p>
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
          <div className="topbar-actions">
            <select
              className="theme-select"
              value={state.theme}
              onChange={(event) => setState((current) => ({ ...current, theme: event.target.value as ThemeId }))}
            >
              {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
            </select>
            <button className="secondary-button" type="button" onClick={exportMarkdown}><Download size={15} /> Markdown</button>
            <button className="secondary-button" type="button" onClick={exportJson}><Upload size={15} /> Backup</button>
          </div>
        </header>

        <section className="page-surface">
          <input className="page-title" value={activePage.title} onChange={(event) => renamePage(event.target.value)} aria-label="Page title" />

          <div className="block-list">
            {visibleBlocks.map((block) => (
              <article
                className={`block ${block.collapsed ? 'is-collapsed' : ''} ${draggingBlockId === block.id ? 'is-dragging' : ''}`}
                key={block.id}
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
                    {block.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  </button>
                  <GripVertical className="drag-grip" size={15} />
                </div>
                <div className="block-body">
                  {activeEditor.kind === 'block' && activeEditor.blockId === block.id && (
                    <Toolbar applyCommand={applyCommand} insertTodo={insertTodo} applyHighlight={applyHighlight} applyInlineCode={applyInlineCode} />
                  )}
                  {!block.collapsed ? (
                    <div
                      ref={(node) => { editorRefs.current[block.id] = node; }}
                      className="block-content editable"
                      contentEditable
                      suppressContentEditableWarning
                      dangerouslySetInnerHTML={{ __html: block.content.html }}
                      onFocus={() => setActiveEditor({ kind: 'block', blockId: block.id })}
                      onInput={(event) => maybeAutoformat(event.currentTarget)}
                      onDoubleClick={toggleListItemCollapse}
                      onKeyDown={(event) => handleEditorKeys(event, { kind: 'block', blockId: block.id })}
                      onBlur={(event) => updateBlock(block.id, event.currentTarget.innerHTML, event.currentTarget.innerText)}
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
            ))}
          </div>

          <div className="composer-card">
            {activeEditor.kind === 'composer' && (
              <Toolbar applyCommand={applyCommand} insertTodo={insertTodo} applyHighlight={applyHighlight} applyInlineCode={applyInlineCode} />
            )}
            <div
              ref={editorRef}
              className="composer"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="写点什么。按 Command Enter 变成 block，Tab 缩进。"
              onFocus={() => setActiveEditor({ kind: 'composer' })}
              onInput={(event) => {
                setDraft(event.currentTarget.innerHTML);
                maybeAutoformat(event.currentTarget);
              }}
              onDoubleClick={toggleListItemCollapse}
              onKeyDown={(event) => handleEditorKeys(event, { kind: 'composer' })}
            />
            <div className="composer-footer">
              <span>{draft ? 'Ready to become a block' : 'Waiting for a thought'}</span>
              <button className="primary-button" type="button" onClick={commitDraft}><Plus size={16} /> Add block</button>
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
                {firstLines(block.content.plainText)}
              </a>
            ))}
          </div>
        </section>

        <section className="panel-card desktop-preview">
          <div className="panel-title"><MapPin size={16} /> Pinned</div>
          {pinnedBlocks.length ? pinnedBlocks.map((block) => (
            <button
              className="desktop-card"
              key={block.id}
              type="button"
              onClick={() => openPinnedWindow(block.id)}
            >
              <div dangerouslySetInnerHTML={{ __html: block.content.html }} />
            </button>
          )) : <p className="muted">Pin blocks to keep them close.</p>}
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
}

function Toolbar({
  applyCommand,
  insertTodo,
  applyHighlight,
  applyInlineCode
}: {
  applyCommand: (command: string, value?: string) => void;
  insertTodo: () => void;
  applyHighlight: () => void;
  applyInlineCode: () => void;
}) {
  return (
    <div className="format-toolbar" aria-label="Formatting toolbar">
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('bold')} title="Bold: Command B"><Bold size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('italic')} title="Italic: Command I"><Italic size={16} /></button>
      <button className="tool-button highlight-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={applyHighlight} title="Highlight: Command H"><Highlighter size={16} /></button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('formatBlock', 'h1')} title="Heading 1">H1</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('formatBlock', 'h2')} title="Heading 2">H2</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('formatBlock', 'h3')} title="Heading 3">H3</button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={applyInlineCode} title="Inline code"><Type size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('formatBlock', 'pre')} title="Code block"><Braces size={16} /></button>
      <span className="toolbar-divider" />
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('insertUnorderedList')} title="Bullet list"><List size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('insertOrderedList')} title="Numbered list"><ListOrdered size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={insertTodo} title="Todo"><CheckSquare size={16} /></button>
      <span className="toolbar-divider" />
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('indent')} title="Indent: Tab"><Indent size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applyCommand('outdent')} title="Outdent: Shift Tab"><Outdent size={16} /></button>
    </div>
  );
}
