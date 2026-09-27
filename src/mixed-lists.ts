import { Extension, InputRule, type Editor } from '@tiptap/core';
import { TextSelection } from 'prosemirror-state';

type ListKind = 'bulletList' | 'orderedList' | 'taskList';
const listNames = new Set(['bulletList', 'orderedList', 'taskList']);

/** Change only selected sibling items, preserving their nested lists and marks. */
export function setMixedListType(editor: Editor, kind: ListKind): boolean {
  const { state } = editor;
  const { $from, from, to } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !listNames.has($from.node(depth).type.name)) depth--;
  if (!depth) {
    return kind === 'taskList' ? editor.commands.toggleTaskList()
      : kind === 'orderedList' ? editor.commands.toggleOrderedList() : editor.commands.toggleBulletList();
  }
  const list = $from.node(depth);
  if (list.type.name === kind) return liftAcrossListTypes(editor) || editor.commands.liftListItem(kind === 'taskList' ? 'taskItem' : 'listItem');
  const start = $from.before(depth);
  const before: typeof list[] = [], selected: typeof list[] = [], after: typeof list[] = [];
  let offset = start + 1;
  let selectedStart = 0;
  list.forEach(item => {
    const end = offset + item.nodeSize;
    if (end <= from) before.push(item);
    else if (offset < to || (from === to && offset <= from && from < end)) {
      if (!selected.length) selectedStart = offset;
      const type = state.schema.nodes[kind === 'taskList' ? 'taskItem' : 'listItem'];
      selected.push(type.create({ ...item.attrs, checked: item.attrs.checked ?? false }, item.content, item.marks));
    } else after.push(item);
    offset = end;
  });
  if (!selected.length || to > start + list.nodeSize) return false;
  const replacements: typeof list[] = [];
  if (before.length) replacements.push(list.type.create(list.attrs, before));
  const targetStart = start + replacements.reduce((size, node) => size + node.nodeSize, 0);
  replacements.push(state.schema.nodes[kind].create(undefined, selected));
  if (after.length) replacements.push(list.type.create({ ...list.attrs, ...(list.type.name === 'orderedList' ? { start: (list.attrs.start || 1) + before.length + selected.length } : {}) }, after));
  const tr = state.tr.replaceWith(start, start + list.nodeSize, replacements);
  const shift = targetStart + 1 - selectedStart;
  tr.setSelection(TextSelection.create(tr.doc, from + shift, to + shift));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Tab across adjacent list types nests the current list under its previous sibling. */
export function sinkAcrossListTypes(editor: Editor): boolean {
  const { state } = editor;
  const { $from, from, to } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !listNames.has($from.node(depth).type.name)) depth--;
  if (!depth || $from.index(depth) !== 0) return false;
  const list = $from.node(depth), start = $from.before(depth);
  const previous = state.doc.resolve(start).nodeBefore;
  if (!previous || !listNames.has(previous.type.name) || !previous.lastChild) return false;
  if (to > start + list.nodeSize - 1) return false;
  const items: typeof list[] = [];
  let count = 0, offset = start + 1;
  list.forEach(item => { if (offset <= from || offset < to) { items.push(item); count++; } offset += item.nodeSize; });
  if (!items.length) return false;
  const nested = list.type.create(list.attrs, items);
  const children: typeof list[] = [];
  previous.forEach((item, _pos, index) => children.push(index === previous.childCount - 1 ? item.copy(item.content.addToEnd(nested)) : item));
  const replacement = previous.type.create(previous.attrs, children);
  const remaining: typeof list[] = [];
  list.forEach((item, _pos, index) => { if (index >= count) remaining.push(item); });
  const nodes = [replacement];
  if (remaining.length) nodes.push(list.type.create(list.attrs, remaining));
  const tr = state.tr.replaceWith(start - previous.nodeSize, start + list.nodeSize, nodes);
  tr.setSelection(TextSelection.create(tr.doc, from - 2, to - 2));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Lift across different wrappers without merging the child's text into its parent. */
export function liftAcrossListTypes(editor: Editor): boolean {
  const { state } = editor;
  const { $from, from, to } = state.selection;
  let depth = $from.depth;
  while (depth > 0 && !listNames.has($from.node(depth).type.name)) depth--;
  if (depth < 3) return false;
  const inner = $from.node(depth), parent = $from.node(depth - 1), outer = $from.node(depth - 2);
  if (!listNames.has(outer.type.name) || inner.type === outer.type) return false;
  const innerStart = $from.before(depth), outerStart = $from.before(depth - 2);
  if (to >= innerStart + inner.nodeSize) return false;
  const before: typeof inner[] = [], selected: typeof inner[] = [], after: typeof inner[] = [];
  let offset = innerStart + 1, selectedStart = 0;
  inner.forEach(item => {
    if (offset + item.nodeSize <= from) before.push(item);
    else if (offset < to || (from === to && offset <= from && from < offset + item.nodeSize)) {
      if (!selected.length) selectedStart = offset;
      selected.push(item);
    } else after.push(item);
    offset += item.nodeSize;
  });
  if (!selected.length) return false;
  const parentIndex = $from.index(depth - 2), innerIndex = $from.index(depth - 1);
  const parentChildren: typeof inner[] = [], tail: typeof inner[] = [];
  parent.forEach((node, _pos, index) => { if (index < innerIndex) parentChildren.push(node); else if (index > innerIndex) tail.push(node); });
  if (before.length) parentChildren.push(inner.type.create(inner.attrs, before));
  let last = selected[selected.length - 1];
  if (after.length) last = last.copy(last.content.addToEnd(inner.type.create(inner.attrs, after)));
  for (const node of tail) last = last.copy(last.content.addToEnd(node));
  selected[selected.length - 1] = last;
  const prefix: typeof inner[] = [], suffix: typeof inner[] = [];
  outer.forEach((node, _pos, index) => { if (index < parentIndex) prefix.push(node); else if (index > parentIndex) suffix.push(node); });
  prefix.push(parent.type.create(parent.attrs, parentChildren));
  const leading = outer.type.create(outer.attrs, prefix);
  const replacements = [leading, inner.type.create(inner.attrs, selected)];
  if (suffix.length) replacements.push(outer.type.create(outer.attrs, suffix));
  const shift = outerStart + leading.nodeSize + 1 - selectedStart;
  const tr = state.tr.replaceWith(outerStart, outerStart + outer.nodeSize, replacements);
  tr.setSelection(TextSelection.create(tr.doc, from + shift, to + shift));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Prefix rules run before the stock list rules and share their undo transaction. */
export const MixedListInput = Extension.create({
  name: 'mixedListInput',
  priority: 1100,
  addInputRules() {
    return [new InputRule({
      find: /^(\[\]|【】|-|\d+\.)\s$/,
      handler: ({ range, match, chain }) => {
        const kind: ListKind = match[1] === '-' ? 'bulletList' : /\d/.test(match[1]) ? 'orderedList' : 'taskList';
        chain().deleteRange(range).setTextSelection(range.from).command(({ state, commands }) => {
          // InputRule owns dispatch; use its chainable state so deletion and
          // item conversion are committed together, without a second transaction.
          const scoped = new Proxy(this.editor, {
            get: (target, key) => key === 'state' ? state : key === 'commands' ? commands : key === 'view' ? { dispatch: () => {} } : Reflect.get(target, key)
          });
          let depth = state.selection.$from.depth;
          while (depth > 0 && !listNames.has(state.selection.$from.node(depth).type.name)) depth--;
          if (!depth || state.selection.$from.node(depth).type.name !== kind) {
            if (!setMixedListType(scoped, kind)) return false;
          }
          if (kind === 'taskList') commands.updateAttributes('taskItem', { todoStyle: match[1] === '【】' ? 'bracket' : 'plain' });
          return true;
        }).run();
      }
    })];
  }
});
