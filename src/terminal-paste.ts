import { Editor, Extension, Mark, Node } from '@tiptap/core';
import { TextSelection } from 'prosemirror-state';
import StarterKit from '@tiptap/starter-kit';
import { invoke, isTauri } from '@tauri-apps/api/core';

const MAX_SIZE = 2_000_000;
const properties = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'line-height', 'letter-spacing', 'white-space', 'tab-size'];
export type TerminalFragment = { version: 1; html: string; plainText: string };

// Rebuild a small, inert subset: no external resources, scripts, event handlers or CSS URLs.
export function cleanTerminalHtml(html: string, plainText = ''): TerminalFragment {
  if (html.length > MAX_SIZE || plainText.length > MAX_SIZE) throw new Error('终端片段太大，请分段粘贴（每次不超过 2 MB）。');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rules: CSSStyleRule[] = [];
  for (const style of doc.querySelectorAll('style')) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(style.textContent || '');
      for (const rule of Array.from(sheet.cssRules)) if (rule instanceof CSSStyleRule) rules.push(rule);
    } catch { /* Unsupported clipboard CSS is omitted. */ }
  }
  doc.querySelectorAll('script,style,link,meta,iframe,object,embed,img,svg,math,template').forEach(e => e.remove());
  const output = document.createElement('div');
  const visit = (source: globalThis.Node, parent: HTMLElement) => {
    if (source.nodeType === globalThis.Node.TEXT_NODE) { parent.appendChild(document.createTextNode(source.textContent || '')); return; }
    if (!(source instanceof HTMLElement)) return;
    const tag = source.tagName.toLowerCase();
    const target = document.createElement(tag === 'br' ? 'br' : ['p', 'div', 'pre', 'body'].includes(tag) ? 'div' : 'span');
    const css = document.createElement('span').style;
    for (const rule of rules) { try { if (source.matches(rule.selectorText)) for (const prop of properties) if (rule.style.getPropertyValue(prop)) css.setProperty(prop, rule.style.getPropertyValue(prop)); } catch { /* Ignore unsupported selectors. */ } }
    for (const prop of properties) if (source.style.getPropertyValue(prop)) css.setProperty(prop, source.style.getPropertyValue(prop));
    if (tag === 'font' && source.getAttribute('color')) css.color = source.getAttribute('color')!;
    if (['b', 'strong'].includes(tag)) css.fontWeight = 'bold';
    if (['i', 'em'].includes(tag)) css.fontStyle = 'italic';
    if (tag === 'u') css.textDecoration = 'underline';
    for (const prop of properties) { const value = css.getPropertyValue(prop); if (value && !/url\(|var\(|expression|inherit|revert/i.test(value)) target.style.setProperty(prop, value); }
    target.style.whiteSpace = 'pre-wrap';
    source.childNodes.forEach(child => visit(child, target));
    parent.appendChild(target);
  };
  visit(doc.body, output);
  if (!plainText) {
    const text = output.cloneNode(true) as HTMLElement;
    text.querySelectorAll('br').forEach(e => e.replaceWith('\n'));
    text.querySelectorAll('div').forEach(e => e.append('\n'));
    plainText = (text.textContent || '').replace(/\n+$/, '');
  }
  if (!html) output.textContent = plainText;
  return { version: 1, html: output.innerHTML, plainText };
}

const TerminalInk = Mark.create({
  name: 'terminalInk',
  addAttributes() { return { style: { default: '', parseHTML: element => element.getAttribute('style') || '' } }; },
  parseHTML() { return [{ tag: 'span[style]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', HTMLAttributes, 0]; }
});

// Flatten terminal lines while carrying inherited inline styles into each run.
// This avoids feeding nested div/pre wrappers into a paragraph-only editor.
function editableTerminalDocument(fragment: TerminalFragment) {
  const source = new DOMParser().parseFromString(fragment.html, 'text/html');
  const lines: Array<{ type: string; content: Array<{ type: string; text: string; marks: Array<{ type: string; attrs: { style: string } }> }> }> = [];
  let content: typeof lines[number]['content'] = [];
  const flush = () => { lines.push({ type: 'paragraph', content }); content = []; };
  const visit = (node: globalThis.Node, inherited: string) => {
    if (node.nodeType === globalThis.Node.TEXT_NODE) {
      const parts = (node.textContent || '').split('\n');
      parts.forEach((text, index) => { if (index) flush(); if (text) content.push({ type: 'text', text, marks: [{ type: 'terminalInk', attrs: { style: inherited } }] }); });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'BR') { flush(); return; }
    const block = ['DIV', 'P', 'PRE'].includes(node.tagName);
    if (block && content.length) flush();
    const style = document.createElement('span').style;
    style.cssText = inherited;
    for (const prop of properties) if (node.style.getPropertyValue(prop)) style.setProperty(prop, node.style.getPropertyValue(prop));
    node.childNodes.forEach(child => visit(child, style.cssText));
    if (block && content.length) flush();
  };
  source.body.childNodes.forEach(child => visit(child, ''));
  if (content.length || !lines.length) flush();
  return { type: 'doc', content: lines };
}

export const TerminalSnippet = Node.create({
  name: 'terminalSnippet', priority: 1000, group: 'block', atom: true, selectable: true, draggable: false,
  addAttributes() { return { fragment: { default: null, rendered: false } }; },
  parseHTML() { return [{ tag: 'pre[data-terminal-fragment]', getAttrs: element => {
    try { const data = JSON.parse((element as HTMLElement).getAttribute('data-terminal-fragment') || '');
      if (data.version !== 1 || typeof data.html !== 'string' || typeof data.plainText !== 'string') return false;
      return { fragment: cleanTerminalHtml(data.html, data.plainText) };
    } catch { return false; }
  } }]; },
  renderHTML({ node }) { const f = node.attrs.fragment as TerminalFragment; return ['pre', { 'data-terminal-fragment': JSON.stringify(f), 'data-terminal-version': '1' }, ['code', {}, f?.plainText || '']]; },
  renderText({ node }) { return (node.attrs.fragment as TerminalFragment)?.plainText || ''; },
  addNodeView() { return ({ node, editor, getPos }) => {
    const dom = document.createElement('div');
    dom.className = 'terminal-snippet';
    dom.contentEditable = 'false';
    dom.setAttribute('aria-label', '原样终端片段');
    const shadow = dom.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{display:block;margin:12px 0;max-width:100%;} .terminal{all:initial;display:block;box-sizing:border-box;max-width:100%;overflow:auto;padding:14px;border:1px solid #8886;border-radius:6px;background:#171717;color:#eee;font:13px/1.5 Menlo,Monaco,monospace;white-space:pre-wrap;overflow-wrap:normal;tab-size:8;user-select:text;}';
    const body = document.createElement('div'); body.className = 'terminal';
    const editSlot = document.createElement('slot'); editSlot.name = 'terminal-editor';
    const lightStyle = document.createElement('style');
    lightStyle.textContent = `.terminal-snippet .terminal-edit-surface { display:block; box-sizing:border-box; padding:14px; border:1px solid #8886; border-radius:6px; overflow:auto; background:#171717; color:#eee; font:13px/1.5 Menlo,Monaco,monospace; white-space:pre-wrap; }
      .terminal-snippet .terminal-edit-surface .tiptap { padding:0; margin:0; min-height:1.5em; outline:none; background:transparent; color:inherit; font:inherit; white-space:pre-wrap; }
      .terminal-snippet .terminal-edit-surface .tiptap p { margin:0; padding:0; min-height:1.5em; border:0; background:transparent; color:inherit; font:inherit; }
      .terminal-snippet .terminal-edit-surface, .terminal-snippet .terminal-edit-surface * { -webkit-user-select:text; user-select:text; }`;
    dom.append(lightStyle);
    // Let the browser copy a text selection inside the isolated fragment, rather
    // than the editor replacing it with the selected atom's Markdown.
    body.addEventListener('copy', event => event.stopPropagation());
    let currentNode = node;
    let fragment = cleanTerminalHtml(node.attrs.fragment.html, node.attrs.fragment.plainText);
    let inner: Editor | null = null;
    let savedSelection: ReturnType<Editor['state']['selection']['getBookmark']> | null = null;
    let syncing = false;
    let destroyed = false;
    body.innerHTML = fragment.html;
    body.title = '双击编辑文字';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:6px;font:12px system-ui;color:inherit';
    const button = (text: string) => {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
      element.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:4px;padding:3px 7px;cursor:pointer';
      return element;
    };
    const edit = button('编辑文字');
    const convert = button('转为普通文本');
    const toolbar = document.createElement('div');
    toolbar.className = 'terminal-format-toolbar'; toolbar.hidden = true;
    toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '终端文字格式');
    const currentStyle = () => {
      const css = document.createElement('span').style;
      if (inner) {
        let marks = inner.state.storedMarks || inner.state.selection.$from.marks();
        if (!inner.state.selection.empty) {
          let found = false;
          inner.state.doc.nodesBetween(inner.state.selection.from, inner.state.selection.to, node => {
            if (!found && node.isText) { marks = node.marks; found = true; }
          });
        }
        css.cssText = marks.find(mark => mark.type.name === 'terminalInk')?.attrs.style || '';
      }
      return css;
    };
    // Modify only the requested property on each run: a mixed-color selection
    // must keep its individual colors when applying bold or a new font size.
    const applyStyles = (values: Record<string, string>) => {
      if (!inner) return;
      const { view } = inner;
      if (savedSelection) view.dispatch(inner.state.tr.setSelection(savedSelection.resolve(inner.state.doc)));
      const { state } = inner;
      const { from, to, empty } = state.selection;
      const markType = state.schema.marks.terminalInk;
      const merge = (previous: string) => {
        const css = document.createElement('span').style; css.cssText = previous;
        for (const [property, value] of Object.entries(values)) css.setProperty(property, value);
        return markType.create({ style: css.cssText });
      };
      const tr = state.tr;
      if (empty) tr.addStoredMark(merge(currentStyle().cssText));
      else state.doc.nodesBetween(from, to, (text, pos) => {
        if (!text.isText) return;
        const previous = text.marks.find(mark => mark.type === markType)?.attrs.style || '';
        tr.addMark(Math.max(from, pos), Math.min(to, pos + text.nodeSize), merge(previous));
      });
      view.dispatch(tr); view.focus(); refreshToolbar();
    };
    const applyStyle = (property: string, value: string) => applyStyles({ [property]: value });
    // Native color pickers and selects take focus; preserve the text range first.
    toolbar.addEventListener('pointerdown', () => {
      if (inner) savedSelection = inner.state.selection.getBookmark();
    });
    const toggles: Array<{ element: HTMLButtonElement; property: string; on: string; off: string }> = [];
    for (const [label, property, on, off] of [
      ['加粗', 'font-weight', 'bold', 'normal'], ['斜体', 'font-style', 'italic', 'normal'],
      ['下划线', 'text-decoration-line', 'underline', 'none'], ['删除线', 'text-decoration-line', 'line-through', 'none']
    ]) {
      const element = button(label); element.setAttribute('aria-label', label);
      element.addEventListener('mousedown', event => event.preventDefault());
      element.addEventListener('click', () => {
        const css = currentStyle();
        if (property === 'text-decoration-line') {
          const lines = new Set((css.textDecorationLine || '').split(' ').filter(line => line && line !== 'none'));
          if (lines.has(on)) lines.delete(on); else lines.add(on);
          applyStyle(property, [...lines].join(' ') || 'none');
        } else applyStyle(property, css.getPropertyValue(property) === on ? off : on);
      });
      toggles.push({ element, property, on, off }); toolbar.append(element);
    }
    for (const [label, property, initial] of [['文字颜色', 'color', '#eeeeee'], ['文字底色', 'background-color', '#fff09a']]) {
      const field = document.createElement('label'); field.textContent = label;
      const input = document.createElement('input'); input.type = 'color'; input.value = initial; input.setAttribute('aria-label', label);
      input.addEventListener('input', () => applyStyle(property, input.value));
      input.addEventListener('change', () => applyStyle(property, input.value));
      field.append(input); toolbar.append(field);
    }
    const sizeLabel = document.createElement('label'); sizeLabel.textContent = '字号';
    const size = document.createElement('select'); size.setAttribute('aria-label', '终端字号');
    const mixed = document.createElement('option'); mixed.value = ''; mixed.textContent = '原字号'; size.append(mixed);
    for (const value of [10, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48]) {
      const option = document.createElement('option'); option.value = String(value); option.textContent = `${value}px`; size.append(option);
    }
    size.addEventListener('change', () => { if (size.value) applyStyle('font-size', `${size.value}px`); });
    sizeLabel.append(size); toolbar.append(sizeLabel);
    for (const [label, color, ink] of [['浅黄高亮', '#fff09a', '#3d3519'], ['浅绿高亮', '#c6ebc9', '#203d2b']]) {
      const preset = button(label);
      preset.style.backgroundColor = color; preset.style.color = ink;
      preset.addEventListener('mousedown', event => event.preventDefault());
      preset.addEventListener('click', () => applyStyles({ 'background-color': color, color: ink }));
      toolbar.append(preset);
    }
    const clearBackground = button('清除底色');
    clearBackground.addEventListener('mousedown', event => event.preventDefault());
    clearBackground.addEventListener('click', () => applyStyle('background-color', 'transparent'));
    toolbar.append(clearBackground);
    const refreshToolbar = () => {
      const css = currentStyle();
      for (const { element, property, on } of toggles) element.setAttribute('aria-pressed', String(css.getPropertyValue(property).includes(on)));
      const fontSize = css.fontSize.endsWith('pt') ? Number.parseFloat(css.fontSize) * 4 / 3 : Number.parseFloat(css.fontSize);
      size.value = Number.isFinite(fontSize) ? String(fontSize) : '';
    };
    const save = () => {
      if (!inner || syncing || destroyed) return;
      const wrapper = document.createElement('div');
      wrapper.style.cssText = body.style.cssText;
      wrapper.innerHTML = inner.getHTML();
      const next = cleanTerminalHtml(wrapper.outerHTML, inner.getText({ blockSeparator: '\n' }));
      if (next.html === fragment.html && next.plainText === fragment.plainText) return;
      const pos = getPos(); if (typeof pos !== 'number' || editor.isDestroyed) return;
      fragment = next;
      syncing = true;
      try { editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, fragment: next })); }
      finally { syncing = false; }
    };
    const finish = () => {
      if (!inner) return;
      save(); inner.destroy(); inner = null; savedSelection = null; toolbar.hidden = true;
      editSlot.replaceWith(body); body.removeAttribute('slot'); body.classList.remove('terminal-edit-surface');
      body.removeAttribute('style'); body.innerHTML = fragment.html; edit.textContent = '编辑文字';
    };
    const start = () => {
      if (inner || !editor.isEditable) return;
      const original = new DOMParser().parseFromString(fragment.html, 'text/html');
      let wrapper = original.body.firstElementChild;
      while (wrapper instanceof HTMLElement && wrapper.tagName === 'DIV') {
        for (const prop of properties) if (wrapper.style.getPropertyValue(prop)) body.style.setProperty(prop, wrapper.style.getPropertyValue(prop));
        wrapper = wrapper.children.length === 1 ? wrapper.firstElementChild : null;
      }
      // WebKit cannot reliably expose ShadowRoot selections to ProseMirror.
      // A slotted light-DOM editing surface uses the document's native selection.
      body.replaceWith(editSlot); body.slot = 'terminal-editor'; body.classList.add('terminal-edit-surface'); dom.append(body);
      body.replaceChildren(); edit.textContent = '完成编辑'; toolbar.hidden = false;
      inner = new Editor({
        element: body,
        extensions: [StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, horizontalRule: false, link: false }), TerminalInk,
          Extension.create({ name: 'terminalEditingKeys', addKeyboardShortcuts() { return {
            Escape: () => { finish(); edit.focus(); return true; },
            Tab: () => this.editor.commands.insertContent('\t'),
            'Mod-b': () => { toggles[0].element.click(); return true; },
            'Mod-i': () => { toggles[1].element.click(); return true; },
            'Mod-u': () => { toggles[2].element.click(); return true; }
          }; } })],
        content: editableTerminalDocument(fragment),
        editorProps: {
          attributes: { 'aria-label': '编辑终端片段', role: 'textbox', 'aria-multiline': 'true' },
          handleKeyDown: (view, event) => {
            if ((!event.metaKey && !event.altKey) || event.ctrlKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
            const selection = window.getSelection();
            if (!selection || !view.dom.contains(selection.focusNode)) return false;
            const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
            if (event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
              const edge = backward ? TextSelection.atStart(view.state.doc).from : TextSelection.atEnd(view.state.doc).to;
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, event.shiftKey ? view.state.selection.anchor : edge, edge)).scrollIntoView());
              event.preventDefault(); return true;
            }
            const granularity = event.metaKey
              ? (event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 'documentboundary' : 'lineboundary')
              : (event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 'paragraphboundary' : 'word');
            selection.modify(event.shiftKey ? 'extend' : 'move', backward ? 'backward' : 'forward', granularity);
            if (selection.anchorNode && selection.focusNode && view.dom.contains(selection.anchorNode) && view.dom.contains(selection.focusNode)) {
              const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
              const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
            }
            event.preventDefault(); return true;
          },
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain');
            if (text == null) return false;
            event.preventDefault();
            const lines = text.replace(/\r\n?/g, '\n').split('\n');
            const marks = view.state.storedMarks || view.state.selection.$from.marks();
            inner?.commands.insertContent(lines.map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line, marks: marks.map(mark => mark.toJSON()) }] : [] })));
            return true;
          }
        },
        onUpdate: () => { save(); refreshToolbar(); },
        onSelectionUpdate: () => {
          if (inner) savedSelection = inner.state.selection.getBookmark();
          refreshToolbar();
        }
      });
      inner.commands.focus('end'); refreshToolbar();
    };
    style.textContent += ' .tiptap,.tiptap *{-webkit-user-select:text;user-select:text;} .tiptap{outline:none;white-space:pre-wrap;min-height:1.5em;} .tiptap p{margin:0;min-height:1.5em;}';
    style.textContent += ' .terminal-format-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding:8px;margin-bottom:6px;border:1px solid #8886;border-radius:6px;font:12px system-ui;color:inherit;} .terminal-format-toolbar[hidden]{display:none;} .terminal-format-toolbar label{display:flex;align-items:center;gap:4px;} .terminal-format-toolbar input[type=color]{width:28px;height:25px;padding:1px;border:1px solid #8886;border-radius:4px;background:transparent;} .terminal-format-toolbar select{font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:4px;padding:4px;} .terminal-format-toolbar button[aria-pressed=true]{background:#8884!important;}';
    body.addEventListener('dblclick', start);
    edit.addEventListener('click', () => inner ? finish() : start());
    // Keep editing through native picker focus changes; Done/Escape ends editing.
    // Events from the nested editor must not trigger outer block/editor handlers.
    for (const type of ['mousedown', 'pointerdown', 'keydown', 'keyup']) {
      shadow.addEventListener(type, event => { if (inner) event.stopPropagation(); });
      body.addEventListener(type, event => { if (inner) event.stopPropagation(); });
    }
    convert.addEventListener('click', () => {
      finish();
      const pos = getPos(); if (typeof pos !== 'number') return;
      editor.chain().focus().insertContentAt({ from: pos, to: pos + currentNode.nodeSize }, fragment.plainText.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))).run();
    });
    actions.append(edit, convert);
    shadow.append(style, toolbar, body, actions);
    return {
      dom, ignoreMutation: () => true,
      stopEvent: event => Boolean(inner) || event.composedPath().includes(actions) || event.type === 'dblclick',
      update: next => {
        if (next.type !== currentNode.type) return false;
        currentNode = next;
        if (syncing) return true;
        if (JSON.stringify(next.attrs.fragment) === JSON.stringify(fragment)) return true;
        fragment = cleanTerminalHtml(next.attrs.fragment.html, next.attrs.fragment.plainText);
        if (inner) { syncing = true; try { inner.commands.setContent(editableTerminalDocument(fragment), { emitUpdate: false }); } finally { syncing = false; } }
        else body.innerHTML = fragment.html;
        return true;
      },
      destroy: () => { destroyed = true; inner?.destroy(); inner = null; }
    };
  }; }
});

export async function pasteOriginalTerminal(editor: Editor) {
  const doc = editor.state.doc;
  const { from, to } = editor.state.selection;
  try {
    let html = '', text = '';
    if (isTauri() && /Mac/i.test(navigator.platform)) {
      const data = await invoke<{ html: string; text: string }>('read_terminal_clipboard');
      html = data.html; text = data.text;
    } else {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
        if (html || text) break;
      }
    }
    if (!html) throw new Error('剪贴板没有可读取的 HTML 格式内容。请在来源应用中复制带样式的文本，或使用 Cmd/Ctrl+V 普通粘贴。仅 RTF 格式的转换目前只支持 macOS 桌面版。');
    const fragment = cleanTerminalHtml(html, text);
    if (editor.isDestroyed || !editor.state.doc.eq(doc)) throw new Error('读取剪贴板期间正文已变化，请重新粘贴。');
    editor.chain().focus().insertContentAt({ from, to }, { type: 'terminalSnippet', attrs: { fragment } }).run();
  } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
}
