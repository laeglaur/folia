import { useEffect, useRef } from 'react';
import { Bold, Braces, CheckSquare, ChevronRight, Highlighter, Indent, Italic, Keyboard, List, ListOrdered, Outdent, Paperclip, Quote, Sigma, Strikethrough, Table2, Type, Underline as UnderlineIcon } from 'lucide-react';
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import type { NodeViewProps } from '@tiptap/core';
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
import { ListItem, ListKeymap } from '@tiptap/extension-list';
import { Extension, InputRule, Mark, Node, markInputRule, mergeAttributes } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { marked } from 'marked';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { htmlToMarkdown } from './state';
import { escapeHtml } from './html-utils';
import { ImageAnnotationSvg, parseImageAnnotations, type ImageAnnotationDocument } from './image-annotations';

declare global {
  interface Window {
    __notebookActiveMathEditor?: Editor;
  }
}

export type ToolbarCommand =
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
  | 'table'
  | 'tableRowAfter'
  | 'tableColumnAfter'
  | 'tableDeleteRow'
  | 'tableDeleteColumn'
  | 'tableDelete'
  | 'inlineMath'
  | 'blockMath'
  | 'footnote'
  | 'attachment'
  | 'kbd'
  | 'bulletList'
  | 'orderedList'
  | 'indent'
  | 'outdent';

export type TableControlsState = {
  visible: boolean;
  top: number;
  left: number;
};

export type MediaNodeType = 'image' | 'video' | 'audio';

export type MediaResizeRequest = {
  editor: Editor;
  pos: number;
  nodeType: MediaNodeType;
  startClientX: number;
  startWidth: number;
  containerWidth: number;
  element: HTMLElement;
};

export type ImageAnnotationRequest = {
  editor: Editor;
  pos: number;
  src: string;
  alt?: string;
  annotations: ImageAnnotationDocument;
  target?: { kind: 'composer'; pageId: string } | { kind: 'block' | 'card'; blockId: string };
};

export type MathEditorState = {
  editor: Editor;
  pos: number;
  latex: string;
  top: number;
  left: number;
  width: number;
};

export type RichEditorProps = {
  className: string;
  html?: string;
  placeholder?: string;
  onFocus: (editor: Editor) => void;
  onUpdate?: (html: string, plainText: string) => void;
  onBlur?: (html: string, plainText: string) => void;
  onSelectionUpdate?: (editor: Editor) => void;
  onShiftEnter?: (editor: Editor) => boolean;
  onMoveBlock?: (direction: -1 | 1) => boolean;
  onDeleteBlock?: () => boolean;
  tableControls?: TableControlsState;
  runTableCommand?: (command: ToolbarCommand) => void;
  onMediaResizeStart?: (request: MediaResizeRequest) => void;
  onImageAnnotate?: (request: ImageAnnotationRequest) => void;
  mathEditor?: MathEditorState | null;
  onMathChange?: (latex: string) => void;
  onMathClose?: () => void;
  editorRef: (editor: Editor | null) => void;
};

const lowlight = createLowlight(common);

const blockTextPreview = (text: string, max = 56) => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact || 'Untitled block';
};

const codeBlockSummary = (value: string) => {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  return blockTextPreview(lines[0] ?? 'Empty code block', 88);
};

const dispatchAttachmentShortcut = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('notebook:attachment-shortcut'));
};

const dispatchMathEditRequest = (editor: Editor, pos: number) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('notebook:edit-block-math', { detail: { editor, pos } }));
};

const dispatchPageLinkRequest = (pageId: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('notebook:open-page-link', { detail: { pageId } }));
};

const tableColumnResizeHandleWidth = 6;
const tableCellMinWidth = 25;

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

export const runListIndentCommand = (editor: Editor, direction: 'in' | 'out') => {
  syncDomSelectionToEditor(editor);
  const command = direction === 'in' ? 'sinkListItem' : 'liftListItem';
  if (editor.commands[command]('taskItem') || editor.commands[command]('listItem')) return true;

  return runMediaIndentCommand(editor, direction);
};

const mediaNodeNames = ['image', 'video', 'audio', 'mediaEmbed'];
const maxMediaIndent = 8;

const updateMediaIndentAt = (
  editor: Editor,
  pos: number,
  node: NonNullable<ReturnType<Editor['state']['doc']['nodeAt']>>,
  direction: 'in' | 'out'
) => {
  const currentIndent = Number(node.attrs.mediaIndent ?? 0);
  const nextIndent = Math.max(0, Math.min(maxMediaIndent, currentIndent + (direction === 'in' ? 1 : -1)));
  if (nextIndent === currentIndent) return false;
  const transaction = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    mediaIndent: nextIndent
  });
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
};

const runMediaIndentCommand = (editor: Editor, direction: 'in' | 'out') => {
  const { state } = editor;
  const selectedNode = (state.selection as { node?: typeof state.doc }).node;
  if (selectedNode && mediaNodeNames.includes(selectedNode.type.name)) {
    return updateMediaIndentAt(editor, state.selection.from, selectedNode, direction);
  }

  const { from, to } = state.selection;
  if (from !== to) return false;
  for (const pos of [from, from - 1]) {
    if (pos < 0 || pos > state.doc.content.size) continue;
    const node = state.doc.nodeAt(pos);
    if (node && mediaNodeNames.includes(node.type.name)) return updateMediaIndentAt(editor, pos, node, direction);
  }
  return false;
};

const typoraClass = (existing: unknown, ...aliases: string[]) => {
  const classes = [
    ...(typeof existing === 'string' ? existing.split(/\s+/) : []),
    ...aliases
  ].map((name) => name.trim()).filter(Boolean);
  return [...new Set(classes)].join(' ');
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
  if (target.closest('a, button, input, textarea, select')) return;
  const rect = listItem.getBoundingClientRect();
  // The fold marker is rendered with a pseudo-element that sits to the left of the list item's content box.
  // Use a generous hit zone around that gutter so clicking the marker works without letting body clicks collapse the list.
  const markerZoneLeft = rect.left - 36;
  const markerZoneRight = rect.left + 10;
  if (event.clientX < markerZoneLeft || event.clientX > markerZoneRight) return;
  event.preventDefault();
  const collapsed = listItem.getAttribute('data-list-collapsed') !== 'true';
  setListItemCollapsed(editor, listItem, collapsed);
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

const mediaAssetAttributes = () => ({
  assetId: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-asset-id'),
    renderHTML: (attributes: Record<string, unknown>) =>
      typeof attributes.assetId === 'string' && attributes.assetId ? { 'data-asset-id': attributes.assetId } : {}
  },
  originalSrc: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-original-src'),
    renderHTML: (attributes: Record<string, unknown>) =>
      typeof attributes.originalSrc === 'string' && attributes.originalSrc ? { 'data-original-src': attributes.originalSrc } : {}
  }
});

const parseMediaWidth = (element: HTMLElement) => {
  const width = element.getAttribute('data-width') ?? element.style.width ?? element.getAttribute('width') ?? '';
  if (!width) return null;
  const numeric = Number.parseFloat(width);
  if (!Number.isFinite(numeric)) return null;
  return width.includes('%') ? `${Math.max(20, Math.min(100, numeric))}%` : `${Math.max(80, Math.min(1600, numeric))}px`;
};

const parseMediaIndent = (element: HTMLElement) => {
  const raw = element.getAttribute('data-indent') ?? '';
  const numeric = Number.parseInt(raw, 10);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(maxMediaIndent, numeric)) : 0;
};

const mediaIndentAttributes = () => ({
  mediaIndent: {
    default: 0,
    parseHTML: (element: HTMLElement) => parseMediaIndent(element),
    renderHTML: (attributes: Record<string, unknown>) => {
      const indent = typeof attributes.mediaIndent === 'number' ? attributes.mediaIndent : 0;
      return indent > 0 ? { 'data-indent': String(indent) } : {};
    }
  }
});

const mediaRenderAttributes = (HTMLAttributes: Record<string, unknown>) => {
  const { width, style, mediaIndent, annotations, 'data-indent': dataIndent, ...attributes } = HTMLAttributes;
  const indent = typeof mediaIndent === 'number'
    ? mediaIndent
    : Number.parseInt(String(dataIndent ?? '0'), 10) || 0;
  const existingStyle = typeof style === 'string' && style.trim() ? `${style.trim().replace(/;?$/, ';')} ` : '';
  const widthStyle = typeof width === 'string' && width ? `width: ${width};` : '';
  const indentStyle = indent > 0 ? `margin-left: ${indent * 2}em;` : '';
  return {
    ...attributes,
    ...(typeof width === 'string' && width ? { 'data-width': width } : {}),
    ...(indent > 0 ? { 'data-indent': String(indent) } : {}),
    tabindex: '0',
    ...(existingStyle || widthStyle || indentStyle ? { style: `${existingStyle}${widthStyle}${indentStyle}` } : {})
  };
};

function ImageNodeView({ node, selected }: NodeViewProps) {
  const annotations = parseImageAnnotations(node.attrs.annotations);
  const hasAnnotations = annotations.items.length > 0;
  const attrs = mediaRenderAttributes(node.attrs);
  const imageStyle = typeof attrs.style === 'string' ? Object.fromEntries(attrs.style.split(';').map((rule) => rule.trim()).filter(Boolean).map((rule) => {
    const [key, ...valueParts] = rule.split(':');
    return [key.trim().replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()), valueParts.join(':').trim()];
  })) : undefined;
  const img = (
    <img
      src={node.attrs.src}
      alt={node.attrs.alt ?? ''}
      title={node.attrs.title ?? undefined}
      data-asset-id={node.attrs.assetId ?? undefined}
      data-original-src={node.attrs.originalSrc ?? undefined}
      data-image-annotations={node.attrs.annotations ?? undefined}
      tabIndex={0}
    />
  );
  return (
    <NodeViewWrapper
      as="span"
      className={`annotated-image ${selected ? 'ProseMirror-selectednode' : ''}`}
      data-width={node.attrs.width ?? undefined}
      data-indent={node.attrs.mediaIndent ? String(node.attrs.mediaIndent) : undefined}
      data-image-annotations={node.attrs.annotations ?? undefined}
      style={imageStyle}
    >
      {img}
      {hasAnnotations ? <ImageAnnotationSvg annotations={annotations} /> : null}
    </NodeViewWrapper>
  );
}

const NotebookImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...mediaAssetAttributes(),
      ...mediaIndentAttributes(),
      annotations: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).getAttribute('data-image-annotations') ?? (element as HTMLElement).closest<HTMLElement>('.annotated-image')?.getAttribute('data-image-annotations'),
        renderHTML: (attributes) =>
          typeof attributes.annotations === 'string' && attributes.annotations ? { 'data-image-annotations': attributes.annotations } : {}
      },
      width: {
        default: null,
        parseHTML: (element) => parseMediaWidth(element as HTMLElement),
        renderHTML: (attributes) => {
          if (typeof attributes.width !== 'string' || !attributes.width) return {};
          return {
            'data-width': attributes.width,
            style: `width: ${attributes.width};`
          };
        }
      }
    };
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = mediaRenderAttributes(HTMLAttributes);
    return ['img', mergeAttributes(attrs)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  }
});

const NotebookVideo = Node.create({
  name: 'video',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true },
      ...mediaAssetAttributes(),
      ...mediaIndentAttributes(),
      width: {
        default: null,
        parseHTML: (element) => parseMediaWidth(element as HTMLElement),
        renderHTML: (attributes) => {
          if (typeof attributes.width !== 'string' || !attributes.width) return {};
          return {
            'data-width': attributes.width,
            style: `width: ${attributes.width};`
          };
        }
      }
    };
  },

  parseHTML() {
    return [{ tag: 'video[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(mediaRenderAttributes(HTMLAttributes), { controls: '' })];
  }
});

const NotebookAudio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true },
      ...mediaAssetAttributes(),
      ...mediaIndentAttributes(),
      width: {
        default: null,
        parseHTML: (element) => parseMediaWidth(element as HTMLElement),
        renderHTML: (attributes) => {
          if (typeof attributes.width !== 'string' || !attributes.width) return {};
          return {
            'data-width': attributes.width,
            style: `width: ${attributes.width};`
          };
        }
      }
    };
  },

  parseHTML() {
    return [{ tag: 'audio[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(mediaRenderAttributes(HTMLAttributes), { controls: '' })];
  }
});

const NotebookEmbed = Node.create({
  name: 'mediaEmbed',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: 'Embedded media' },
      ...mediaIndentAttributes()
    };
  },

  parseHTML() {
    return [{ tag: 'iframe.media-embed[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['iframe', mergeAttributes(mediaRenderAttributes(HTMLAttributes), {
      class: 'media-embed',
      loading: 'lazy',
      allowfullscreen: 'true'
    })];
  }
});

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const collapsed = Boolean(node.attrs.codeCollapsed);
  const summary = codeBlockSummary(node.textContent);

  return (
    <NodeViewWrapper
      as="pre"
      className={`md-fences md-end-block cm-s-inner notebook-code-block ${collapsed ? 'is-code-collapsed' : ''}`}
      data-code-collapsed={collapsed ? 'true' : 'false'}
    >
      <button
        className="code-fold-button"
        type="button"
        contentEditable={false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => updateAttributes({ codeCollapsed: !collapsed })}
        aria-label={collapsed ? 'Expand code block' : 'Collapse code block'}
        title={collapsed ? 'Expand code block' : 'Collapse code block'}
      >
        <ChevronRight size={13} />
      </button>
      <span className="code-block-summary" contentEditable={false}>{summary}</span>
      <NodeViewContent as={'code' as never} />
    </NodeViewWrapper>
  );
}

const NotebookCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      codeCollapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-code-collapsed') === 'true',
        renderHTML: (attributes) => ({
          'data-code-collapsed': attributes.codeCollapsed ? 'true' : 'false'
        })
      }
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
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

const urlWithoutQuery = (url: string) => url.split(/[?#]/)[0] ?? url;
const isVideoUrl = (url: string) => /\.(mp4|mov|webm|m4v|ogv)(?:$|\?)/i.test(urlWithoutQuery(url));
const isAudioUrl = (url: string) => /\.(mp3|wav|m4a|aac|ogg|flac|aiff?)(?:$|\?)/i.test(urlWithoutQuery(url));

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
  const trimmed = url.trim();
  if (!trimmed) return null;
  const src = escapeHtml(trimmed);
  const title = escapeHtml(label.trim() || 'Embedded media');
  const embedUrl = embedUrlFor(trimmed);
  if (isVideoUrl(trimmed)) return `<video controls src="${src}"></video>`;
  if (isAudioUrl(trimmed)) return `<audio controls src="${src}"></audio>`;
  return `<iframe class="media-embed md-media" src="${embedUrl ?? src}" title="${title}" loading="lazy" allowfullscreen="true"></iframe>`;
};

const markdownishText = (value: string) =>
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s+|\d+\.\s+|>\s|\[[ xX]\]\s|【】\s)|```|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|==[^=]+==|\[[^\]]+\]\([^)]+\)/.test(value);

const markdownToRichHtml = (value: string) => {
  const withHighlights = value.replace(/==([^=\n][\s\S]*?[^=\n])==/g, '<mark>$1</mark>');
  return marked.parse(withHighlights, { async: false }) as string;
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

const ansiRegex = /\x1b\[[0-9;]*m/g;
const hasAnsi = (value: string) => {
  ansiRegex.lastIndex = 0;
  return ansiRegex.test(value);
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

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error(`Could not read ${file.name}`));
    };
    reader.readAsDataURL(file);
  });

export const inferAttachmentKind = (file: File) => {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?|heic|heif)$/.test(name)) return 'image';
  if (file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|ogv|avi|mkv)$/.test(name)) return 'video';
  if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|aiff?)$/.test(name)) return 'audio';
  return 'file';
};

type ImportedAsset = {
  id: string;
  originalPath: string;
  storedPath: string;
  assetUrl: string;
  mimeType: string;
  size: number;
  sha256: string;
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

const importedAssetToEditorSrc = (imported: ImportedAsset) => ({
  src: convertFileSrc(imported.storedPath),
  assetId: imported.id
});

export const importAttachmentFile = async (file: File): Promise<{ src: string; assetId?: string }> => {
  if (!isTauri()) return { src: await readFileAsDataUrl(file) };
  const localPath = (file as File & { path?: string }).path;
  if (localPath) {
    const imported = await invoke<ImportedAsset>('import_local_asset', { sourcePath: localPath });
    return importedAssetToEditorSrc(imported);
  }
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const imported = await invoke<ImportedAsset>('import_asset_bytes', {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    bytes
  });
  return importedAssetToEditorSrc(imported);
};

const filenameFromMediaSrc = (src: string, fallback: string) => {
  try {
    const url = new URL(src);
    const filename = decodeURIComponent(url.pathname.split('/').pop() || '');
    return filename || fallback;
  } catch {
    return fallback;
  }
};

const fileFromDataUrl = async (src: string, fallbackName: string) => {
  const response = await fetch(src);
  const blob = await response.blob();
  const mimeType = blob.type || 'application/octet-stream';
  const fallback = fallbackName.includes('.') ? fallbackName : `${fallbackName}.${extensionForMime(mimeType)}`;
  return new File([blob], fallback, { type: mimeType });
};

const localPathFromMediaSrc = (src: string) => {
  if (src.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(src).pathname);
    } catch {
      return null;
    }
  }
  if (src.startsWith('/Users/') || src.startsWith('/private/') || src.startsWith('/Volumes/') || src.startsWith('/var/')) return src;
  return null;
};

const localizePastedMediaAssets = async (html: string) => {
  if (!isTauri()) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  const media = Array.from(container.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLAudioElement>('img[src], video[src], audio[src]'));
  if (!media.length) return html;

  await Promise.all(media.map(async (element, index) => {
    const src = element.getAttribute('src')?.trim() ?? '';
    if (!src || element.getAttribute('data-asset-id') || src.startsWith('/app-assets/')) return;
    if (/^https?:\/\/asset\.localhost\//i.test(src) || src.startsWith('asset://localhost/')) return;

    try {
      let imported: { src: string; assetId?: string } | null = null;
      if (src.startsWith('data:')) {
        const file = await fileFromDataUrl(src, `pasted-media-${index + 1}`);
        imported = await importAttachmentFile(file);
      } else if (/^https?:\/\//i.test(src)) {
        const remote = await invoke<ImportedAsset>('import_remote_asset', { url: src });
        imported = importedAssetToEditorSrc(remote);
        element.setAttribute('data-original-src', src);
      } else {
        const localPath = localPathFromMediaSrc(src);
        if (localPath) {
          const local = await invoke<ImportedAsset>('import_local_asset', { sourcePath: localPath });
          imported = importedAssetToEditorSrc(local);
          element.setAttribute('data-original-src', src);
        }
      }
      if (!imported) return;
      element.setAttribute('src', imported.src);
      if (imported.assetId) element.setAttribute('data-asset-id', imported.assetId);
    } catch (error) {
      console.warn('Could not localize pasted media.', src, error);
    }
  }));

  return container.innerHTML;
};

const clipboardFilesToHtml = async (files: FileList) => {
  const attachments = [...files].map(async (file) => {
    try {
      const kind = inferAttachmentKind(file);
      const { src, assetId } = await importAttachmentFile(file);
      const assetAttribute = assetId ? ` data-asset-id="${escapeHtml(assetId)}"` : '';
      if (kind === 'image') return `<img src="${escapeHtml(src)}" alt="${escapeHtml(file.name)}" title="${escapeHtml(assetId ?? file.name)}"${assetAttribute}>`;
      if (kind === 'video') return `<video controls src="${escapeHtml(src)}"${assetAttribute}></video>`;
      if (kind === 'audio') return `<audio controls src="${escapeHtml(src)}"${assetAttribute}></audio>`;
      return `<a href="${escapeHtml(src)}" download="${escapeHtml(file.name)}"${assetAttribute}>${escapeHtml(file.name)}</a>`;
    } catch (error) {
      console.warn('Could not import pasted attachment.', file.name, error);
      return null;
    }
  });
  return (await Promise.all(attachments)).filter(Boolean).join('');
};

const selectionHasAncestorNode = (editor: Editor, nodeNames: string[]) => {
  const names = new Set(nodeNames);
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if (names.has($from.node(depth).type.name)) return true;
  }
  return false;
};

const isSelectionInsideCodeBlock = (editor: Editor) => selectionHasAncestorNode(editor, ['codeBlock']);

const isSelectionInsideListItem = (editor: Editor) => selectionHasAncestorNode(editor, ['listItem', 'taskItem']);

const htmlToPlainText = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.innerText.replace(/\r\n?/g, '\n');
};

const insertPlainTextPreservingBreaks = (editor: Editor, text: string) => {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized) return false;
  const html = normalized
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br>');
  return editor.chain().focus().insertContent(html).run();
};

const insertPlainTextIntoCodeBlock = (editor: Editor, text: string) => {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized) return false;
  const { from, to } = editor.state.selection;
  const transaction = editor.state.tr.insertText(normalized, from, to);
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
};

const handleRichPaste = (editor: Editor | null, event: ClipboardEvent) => {
  if (!editor) return false;
  const clipboard = event.clipboardData;
  if (!clipboard) return false;
  syncDomSelectionToEditor(editor);

  const insideCodeBlock = isSelectionInsideCodeBlock(editor);
  const insideListItem = isSelectionInsideListItem(editor);

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

  // Keep code blocks plain-text only so pasted code cannot escape into neighboring nodes.
  if (insideCodeBlock) {
    const nextText = text || markdown || (html ? htmlToPlainText(html) : '');
    if (!nextText) return false;
    event.preventDefault();
    insertPlainTextIntoCodeBlock(editor, nextText);
    return true;
  }

  // Inside list items, prefer stable inline paste over rich structural paste that can break out of the list.
  if (insideListItem) {
    const nextText = text || markdown || (html ? htmlToPlainText(html) : '');
    if (!nextText) return false;
    event.preventDefault();
    insertPlainTextPreservingBreaks(editor, nextText);
    return true;
  }

  const shouldPreferMarkdownText = () => {
    const sourceText = markdown || text;
    if (!sourceText || !markdownishText(sourceText)) return false;
    if (!html) return true;
    const container = document.createElement('div');
    container.innerHTML = html;
    return !container.querySelector('ul, ol, li, table, pre, blockquote, h1, h2, h3, h4, h5, h6');
  };

  if (shouldPreferMarkdownText()) {
    const sourceText = markdown || text;
    if (!sourceText) return false;
    event.preventDefault();
    editor.chain().focus().insertContent(markdownToRichHtml(sourceText)).run();
    return true;
  }

  if (html) {
    event.preventDefault();
    const normalizedHtml = normalizePastedHtml(html);
    void localizePastedMediaAssets(normalizedHtml).then((nextHtml) => {
      if (nextHtml) editor.chain().focus().insertContent(nextHtml).run();
    });
    return true;
  }

  const nextHtml = markdown
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
  const serializer = (editor.view as unknown as {
    clipboardSerializer?: { serializeFragment: (fragment: unknown) => globalThis.Node };
  }).clipboardSerializer;
  const slice = editor.state.selection.content();
  const serialized = serializer?.serializeFragment(slice.content);
  container.appendChild(serialized ?? selection.getRangeAt(0).cloneContents());
  const listItems = Array.from(container.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement);
  if (listItems.length && listItems.length === container.children.length) {
    const anchorList = selection.anchorNode instanceof Element
      ? selection.anchorNode.closest('ol, ul')
      : selection.anchorNode?.parentElement?.closest('ol, ul');
    const orderedAnchorList = anchorList?.tagName.toLowerCase() === 'ol' ? anchorList as HTMLOListElement : null;
    const list = orderedAnchorList ? document.createElement('ol') : document.createElement('ul');
    if (orderedAnchorList && orderedAnchorList.start !== 1) {
      const firstValue = Number.parseInt(listItems[0].getAttribute('value') ?? '', 10);
      (list as HTMLOListElement).start = Number.isFinite(firstValue) ? firstValue : orderedAnchorList.start;
    }
    listItems.forEach((item) => list.appendChild(item));
    container.replaceChildren(list);
  }
  const html = container.innerHTML;
  if (!html.trim()) return false;
  const markdown = htmlToMarkdown(html);
  clipboard.setData('text/html', html);
  clipboard.setData('text/markdown', markdown);
  clipboard.setData('text/plain', markdown);
  event.preventDefault();
  return true;
};

const mediaAssetFromStoredMediaSrc = (src: string) => {
  const filename = src.split('/').pop() ?? '';
  const match = filename.match(/^([a-f0-9]{64})(?:\.[^.]+)?$/i);
  return match ? `asset_${match[1].toLowerCase()}` : null;
};

const findMediaNodePosition = (editor: Editor, element: HTMLElement) => {
  const mediaNodeNames = ['image', 'video', 'audio', 'mediaEmbed'];
  const candidates: number[] = [];
  try {
    const pos = editor.view.posAtDOM(element, 0);
    candidates.push(pos, pos - 1);
  } catch {
    return null;
  }
  for (const pos of candidates) {
    if (pos < 0 || pos > editor.state.doc.content.size) continue;
    const node = editor.state.doc.nodeAt(pos);
    if (node && mediaNodeNames.includes(node.type.name)) return { pos, node };
  }
  const src = element.getAttribute('src');
  if (!src) return null;
  let found: { pos: number; node: ReturnType<Editor['state']['doc']['nodeAt']> } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !mediaNodeNames.includes(node.type.name)) return true;
    if (node.attrs.src === src) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  return found;
};

const domTableCellAround = (target: EventTarget | null): HTMLTableCellElement | null => {
  let current = target instanceof globalThis.Node ? target : null;
  while (current) {
    if (current instanceof HTMLTableCellElement) return current;
    if (current instanceof HTMLElement && current.classList.contains('ProseMirror')) return null;
    current = current.parentNode;
  }
  return null;
};

const getTableCellForColumn = (table: HTMLTableElement, columnIndex: number) => {
  const firstRow = table.rows.item(0);
  if (!firstRow) return null;
  let currentColumn = 0;
  for (const cell of Array.from(firstRow.cells)) {
    const colspan = Math.max(1, cell.colSpan || 1);
    if (currentColumn <= columnIndex && currentColumn + colspan > columnIndex) return cell;
    currentColumn += colspan;
  }
  return null;
};

const findTableColumnResizeCandidate = (
  editor: Editor,
  target: EventTarget | null,
  clientX: number,
  clientY: number
) => {
  const cellElement = domTableCellAround(target);
  const targetElement = target instanceof HTMLElement ? target : null;
  const tableElement = cellElement?.closest('table') ?? targetElement?.closest('table') ?? null;
  if (!tableElement) return null;
  const columnWidths = getTableColumnPixelWidths(tableElement);
  if (!columnWidths.length) return null;
  const tableRect = tableElement.getBoundingClientRect();
  let boundaryX = tableRect.left;
  let columnIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  columnWidths.forEach((width, index) => {
    boundaryX += width;
    const distance = Math.abs(clientX - boundaryX);
    if (distance <= tableColumnResizeHandleWidth && distance < closestDistance) {
      columnIndex = index;
      closestDistance = distance;
    }
  });
  if (columnIndex < 0) return null;
  const resizeCellElement = getTableCellForColumn(tableElement, columnIndex);
  if (!resizeCellElement) return null;
  const resizeCellRect = resizeCellElement.getBoundingClientRect();
  const found = editor.view.posAtCoords({
    left: resizeCellRect.left + Math.min(resizeCellRect.width - 1, tableColumnResizeHandleWidth),
    top: resizeCellRect.top + Math.min(resizeCellRect.height - 1, tableColumnResizeHandleWidth)
  });
  if (!found) return null;
  const $pos = editor.state.doc.resolve(found.pos);
  let cellDepth = -1;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') {
      cellDepth = depth;
      break;
    }
  }
  if (cellDepth < 0) return null;
  const cellPos = $pos.before(cellDepth);
  const cellNode = editor.state.doc.nodeAt(cellPos);
  if (!cellNode) return null;
  const startWidth = columnWidths[columnIndex] ?? (cellNode.attrs.colwidth?.[cellNode.attrs.colspan - 1] as number | undefined) ?? resizeCellRect.width;
  return { cellPos, columnIndex, startWidth, tableElement };
};

const findTableNodeInfo = (editor: Editor, cellPos: number) => {
  const $cell = editor.state.doc.resolve(cellPos);
  for (let depth = $cell.depth; depth > 0; depth -= 1) {
    if ($cell.node(depth).type.spec.tableRole === 'table') {
      return { table: $cell.node(depth), tableStart: $cell.start(depth) };
    }
  }
  return null;
};

const getTableColumnPixelWidths = (table: HTMLTableElement) => {
  const firstRow = table.rows.item(0);
  if (!firstRow) return [];
  const widths: number[] = [];
  let columnIndex = 0;
  Array.from(firstRow.cells).forEach((cell) => {
    const rect = cell.getBoundingClientRect();
    const colspan = Math.max(1, cell.colSpan || 1);
    const width = Math.max(tableCellMinWidth, Math.round(rect.width / colspan));
    for (let index = 0; index < colspan; index += 1) {
      widths[columnIndex + index] = width;
    }
    columnIndex += colspan;
  });
  return widths;
};

const setTableColumnWidths = (editor: Editor, cellPos: number, columnWidths: number[]) => {
  const tableInfo = findTableNodeInfo(editor, cellPos);
  if (!tableInfo) return;
  const { table, tableStart } = tableInfo;
  const tr = editor.state.tr;

  table.forEach((rowNode, rowOffset) => {
    let currentColumn = 0;
    rowNode.forEach((node, cellOffset) => {
      const colspan = Number(node.attrs.colspan) || 1;
      const attrs = node.attrs;
      const colwidth = attrs.colwidth ? attrs.colwidth.slice() : Array(colspan).fill(0);
      let changed = false;

      for (let index = 0; index < colspan; index += 1) {
        const width = columnWidths[currentColumn + index] ?? tableCellMinWidth;
        if (colwidth[index] === width) continue;
        colwidth[index] = width;
        changed = true;
      }

      if (changed) tr.setNodeMarkup(tableStart + rowOffset + 1 + cellOffset, null, { ...attrs, colwidth });
      currentColumn += colspan;
    });
  });

  if (tr.docChanged) editor.view.dispatch(tr);
};

const formatDateTime = (value: Date) =>
  value.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

const blockTimestampLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
};

const todoInputRegex = /^\s*(\[\]|【】)\s$/;
const codeBlockInputRegex = /^\s*(```|\/code)\s$/;
const tableInputRegex = /^\s*(\/table|\[\[\[)\s$/;
const blockMathInputRegex = /^\s*(\$\$|\/math)\s$/;
const blockquoteInputRegex = /^\s*(>|\/quote)\s$/;
const inlineMathInputRegex = /\$([^$\n]+?)\$$/;
const embeddedLinkInputRegex = /^\s*\/link\s$/;
const attachmentInputRegex = /^\s*\/at\s$/;
const dateInputRegex = /^\s*\/date\s$/;

const BracketTodoInput = Extension.create({
  name: 'bracketTodoInput',

  addInputRules() {
    return [
      markInputRule({
        find: /(?<!~)~([^~\n]+)~(?!~)$/,
        type: this.editor.schema.marks.underline
      }),
      new InputRule({
        find: inlineMathInputRegex,
        handler: ({ range, match, chain }) => {
          const latex = match[1]?.trim();
          if (!latex) return;
          chain()
            .deleteRange(range)
            .insertContentAt(range.from, { type: 'inlineMath', attrs: { latex } })
            .setTextSelection(range.from + 1)
            .run();
        }
      }),
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
        find: tableInputRegex,
        handler: ({ range, commands }) => {
          commands.deleteRange(range);
          commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
        }
      }),
      new InputRule({
        find: blockMathInputRegex,
        handler: ({ range, chain }) => {
          const insertedAt = range.from;
          const inserted = chain()
            .deleteRange(range)
            .insertContentAt(range.from, { type: 'blockMath', attrs: { latex: '\\;' } })
            .setTextSelection(range.from + 1)
            .run();
          if (inserted) window.setTimeout(() => dispatchMathEditRequest(this.editor, insertedAt), 0);
        }
      }),
      new InputRule({
        find: blockquoteInputRegex,
        handler: ({ range, commands }) => {
          commands.deleteRange(range);
          commands.toggleBlockquote();
        }
      }),
      new InputRule({
        find: embeddedLinkInputRegex,
        handler: ({ range, commands }) => {
          commands.deleteRange(range);
          const src = window.prompt('Link or media URL', 'https://');
          const html = src ? mediaHtmlForUrl(src) : null;
          if (!html) return;
          commands.insertContent(html);
        }
      }),
      new InputRule({
        find: attachmentInputRegex,
        handler: ({ range, commands }) => {
          commands.deleteRange(range);
          dispatchAttachmentShortcut();
        }
      }),
      new InputRule({
        find: dateInputRegex,
        handler: ({ range, commands }) => {
          commands.deleteRange(range);
          commands.insertContent(formatDateTime(new Date()));
        }
      })
    ];
  }
});

const NotebookShortcuts = Extension.create<{
  onShiftEnter?: (editor: Editor) => boolean;
  onMoveBlock?: (direction: -1 | 1) => boolean;
  onDeleteBlock?: () => boolean;
}>({
  name: 'notebookShortcuts',
  priority: 1000,

  addKeyboardShortcuts() {
    const replaceCurrentParagraph = (editor: Editor, transform: 'blockquote' | 'blockMath') => {
      syncDomSelectionToEditor(editor);
      const { state } = editor;
      const { $from } = state.selection;
      if ($from.parent.type.name !== 'paragraph') return false;
      const text = $from.parent.textContent.trim();
      if (transform === 'blockquote' && !['>', '/quote'].includes(text)) return false;
      if (transform === 'blockMath' && !['$$', '/math'].includes(text)) return false;
      const insertAt = $from.before();
      const chain = editor.chain().deleteRange({ from: $from.start(), to: $from.end() });
      if (transform === 'blockquote') return chain.toggleBlockquote().run();
      const inserted = chain
        .insertContentAt(insertAt, { type: 'blockMath', attrs: { latex: '\\;' } })
        .setTextSelection(insertAt + 1)
        .run();
      if (inserted) window.setTimeout(() => dispatchMathEditRequest(editor, insertAt), 0);
      return inserted;
    };

    return {
      'Mod-h': () => this.editor.commands.toggleHighlight(),
      Space: () => replaceCurrentParagraph(this.editor, 'blockquote') || replaceCurrentParagraph(this.editor, 'blockMath'),
      Enter: () => {
        syncDomSelectionToEditor(this.editor);
        const { state } = this.editor;
        const { $from } = state.selection;
        const text = $from.parent.textContent.trim();
        if ($from.parent.type.name !== 'paragraph') return false;
        if (replaceCurrentParagraph(this.editor, 'blockMath')) return true;
        if (!['```', '/code'].includes(text)) return false;
        return this.editor
          .chain()
          .deleteRange({ from: $from.start(), to: $from.end() })
          .setCodeBlock()
          .run();
      },
      'Shift-Enter': () => this.options.onShiftEnter?.(this.editor) ?? false,
      'Mod-ArrowUp': () => this.options.onMoveBlock?.(-1) ?? false,
      'Mod-ArrowDown': () => this.options.onMoveBlock?.(1) ?? false,
      'Mod-Backspace': () => this.options.onDeleteBlock?.() ?? false,
      Tab: () => runListIndentCommand(this.editor, 'in'),
      'Shift-Tab': () => runListIndentCommand(this.editor, 'out')
    };
  }
});

const createEditorExtensions = (
  placeholder?: string,
  onShiftEnter?: (editor: Editor) => boolean,
  onMoveBlock?: (direction: -1 | 1) => boolean,
  onDeleteBlock?: () => boolean
) => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    codeBlock: false,
    listItem: false,
    link: false,
    underline: false
  }),
  NotebookCodeBlock.configure({
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
  NotebookImage.configure({
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
  ListKeymap.configure({
    listTypes: [
      { itemName: 'listItem', wrapperNames: ['bulletList', 'orderedList'] },
      { itemName: 'taskItem', wrapperNames: ['taskList'] }
    ]
  }),
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
    blockOptions: {
      onClick: (_node, pos) => {
        const active = window.__notebookActiveMathEditor;
        if (active) dispatchMathEditRequest(active, pos);
      }
    },
    katexOptions: {
      throwOnError: false
    }
  }),
  BracketTodoInput,
  NotebookShortcuts.configure({ onShiftEnter, onMoveBlock, onDeleteBlock }),
  Placeholder.configure({ placeholder: placeholder ?? '' })
];

const deferEditorSideEffect = (callback: () => void) => {
  if (typeof window === 'undefined') {
    callback();
    return;
  }
  window.setTimeout(callback, 0);
};

function RichEditor({
  className,
  html,
  placeholder,
  onFocus,
  onUpdate,
  onBlur,
  onSelectionUpdate,
  onShiftEnter,
  onMoveBlock,
  onDeleteBlock,
  tableControls,
  runTableCommand,
  onMediaResizeStart,
  onImageAnnotate,
  mathEditor,
  onMathChange,
  onMathClose,
  editorRef
}: RichEditorProps) {
  const externalHtmlRef = useRef(html ?? '');
  const editorHolderRef = useRef<Editor | null>(null);
  const hoverMediaRef = useRef<HTMLElement | null>(null);
  const editor = useEditor({
    extensions: createEditorExtensions(placeholder, onShiftEnter, onMoveBlock, onDeleteBlock),
    content: html || '',
    editorProps: {
      attributes: {
        class: `${className} tiptap-editor typora-block-doc`
      },
      handlePaste: (_view, event) => handleRichPaste(editorHolderRef.current, event),
      handleDOMEvents: {
        copy: (_view, event) => handleRichCopy(editorHolderRef.current, event),
        click: (_view, event) => {
          const target = event.target instanceof Element ? event.target : null;
          const link = target?.closest<HTMLAnchorElement>('a[href^="page:"], a[data-page-id]');
          if (!link) return false;
          const pageId = link.dataset.pageId ?? link.getAttribute('href')?.replace(/^page:/, '').split('#')[0] ?? '';
          if (!pageId) return false;
          event.preventDefault();
          dispatchPageLinkRequest(pageId);
          return true;
        }
      }
    },
    onFocus: ({ editor }) => {
      window.__notebookActiveMathEditor = editor;
      deferEditorSideEffect(() => onFocus(editor));
    },
    onSelectionUpdate: ({ editor }) => {
      window.__notebookActiveMathEditor = editor;
      deferEditorSideEffect(() => onSelectionUpdate?.(editor));
    },
    onUpdate: ({ editor }) => {
      const nextHtml = editor.getHTML();
      const nextText = editor.getText();
      deferEditorSideEffect(() => onUpdate?.(nextHtml, nextText));
    },
    onBlur: ({ editor }) => {
      const nextHtml = editor.getHTML();
      const nextText = editor.getText();
      deferEditorSideEffect(() => onBlur?.(nextHtml, nextText));
    }
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

  const clearMediaCursor = () => {
    if (!hoverMediaRef.current) return;
    hoverMediaRef.current.style.cursor = '';
    hoverMediaRef.current = null;
  };

  const mediaSelector = '.annotated-image, img, video, audio, iframe.media-embed';

  const mediaAtPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest(mediaSelector);
    if (!element || !(element instanceof HTMLElement)) return null;
    const mediaElement = element.matches('.annotated-image') ? element.querySelector<HTMLElement>('img') ?? element : element;
    const rect = mediaElement.getBoundingClientRect();
    const cornerSize = 24;
    const inResizeCorner = event.clientX >= rect.right - cornerSize && event.clientY >= rect.bottom - cornerSize;
    return { element: mediaElement, rect, inResizeCorner };
  };

  const updateMediaCursor = (event: React.MouseEvent<HTMLDivElement>) => {
    const media = mediaAtPointer(event);
    if (hoverMediaRef.current && hoverMediaRef.current !== media?.element) clearMediaCursor();
    if (!media) return;
    media.element.style.cursor = media.inResizeCorner ? 'nwse-resize' : '';
    hoverMediaRef.current = media.element;
  };

  const startResizeFromPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    const media = mediaAtPointer(event);
    const activeEditor = editorHolderRef.current;
    if (!media?.inResizeCorner || !activeEditor) return false;
    const found = findMediaNodePosition(activeEditor, media.element);
    if (!found?.node || !['image', 'video', 'audio'].includes(found.node.type.name)) return false;
    const editorRoot = activeEditor.view.dom instanceof HTMLElement ? activeEditor.view.dom : null;
    const editorRect = editorRoot?.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    hoverMediaRef.current = media.element;
    onMediaResizeStart?.({
      editor: activeEditor,
      pos: found.pos,
      nodeType: found.node.type.name as MediaNodeType,
      startClientX: event.clientX,
      startWidth: media.rect.width,
      containerWidth: editorRect?.width ?? 900,
      element: media.element
    });
    return true;
  };

  const startTableColumnResizeFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return false;
    const activeEditor = editorHolderRef.current;
    if (!activeEditor) return false;
    const candidate = findTableColumnResizeCandidate(activeEditor, event.target, event.clientX, event.clientY);
    if (!candidate) return false;

    event.preventDefault();
    event.stopPropagation();

    const startClientX = event.clientX;
    const root = activeEditor.view.dom as HTMLElement;
    const table = candidate.tableElement;
    const colgroup = table?.querySelector('colgroup');
    const colElements = colgroup ? Array.from(colgroup.querySelectorAll('col')) : [];
    const startColumnWidths = getTableColumnPixelWidths(table);
    const baseTableWidth = startColumnWidths.reduce((total, width) => total + width, 0);
    startColumnWidths.forEach((width, index) => {
      const colElement = colElements[index] as HTMLTableColElement | undefined;
      if (colElement) colElement.style.width = `${width}px`;
    });
    const startWidth = startColumnWidths[candidate.columnIndex] ?? candidate.startWidth;
    table.style.width = `${baseTableWidth}px`;
    table.style.minWidth = '';

    const applyPreviewWidth = (width: number) => {
      const colElement = colElements[candidate.columnIndex] as HTMLTableColElement | undefined;
      if (colElement) colElement.style.width = `${width}px`;
      const totalWidth = startColumnWidths.reduce((total, columnWidth, index) => {
        return total + (index === candidate.columnIndex ? width : columnWidth);
      }, 0);
      table.style.width = `${totalWidth}px`;
      table.style.minWidth = '';
    };

    root.classList.add('resize-cursor');
    document.body.classList.add('notebook-table-column-resizing');

    const onPointerMove = (moveEvent: PointerEvent) => {
      const width = Math.max(tableCellMinWidth, Math.round(startWidth + moveEvent.clientX - startClientX));
      applyPreviewWidth(width);
    };
    const stopDragging = (endEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
      root.classList.remove('resize-cursor');
      document.body.classList.remove('notebook-table-column-resizing');
      const width = Math.max(tableCellMinWidth, Math.round(startWidth + endEvent.clientX - startClientX));
      const nextColumnWidths = startColumnWidths.map((columnWidth, index) => {
        return index === candidate.columnIndex ? width : columnWidth;
      });
      setTableColumnWidths(activeEditor, candidate.cellPos, nextColumnWidths);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging, { once: true });
    window.addEventListener('pointercancel', stopDragging, { once: true });
    return true;
  };

  const selectMediaFromPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    const media = mediaAtPointer(event);
    const activeEditor = editorHolderRef.current;
    if (!media || !activeEditor) return false;
    const found = findMediaNodePosition(activeEditor, media.element);
    if (!found?.node || !['image', 'video', 'audio', 'mediaEmbed'].includes(found.node.type.name)) return false;
    event.preventDefault();
    event.stopPropagation();
    activeEditor.view.focus();
    activeEditor.commands.setNodeSelection(found.pos);
    return true;
  };

  const editImageFromPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.detail < 2) return false;
    const media = mediaAtPointer(event);
    const activeEditor = editorHolderRef.current;
    if (!media || !activeEditor || media.element.tagName.toLowerCase() !== 'img') return false;
    const found = findMediaNodePosition(activeEditor, media.element);
    if (!found?.node || found.node.type.name !== 'image') return false;
    event.preventDefault();
    event.stopPropagation();
    activeEditor.view.focus();
    activeEditor.commands.setNodeSelection(found.pos);
    onImageAnnotate?.({
      editor: activeEditor,
      pos: found.pos,
      src: media.element.getAttribute('src') ?? found.node.attrs.src ?? '',
      alt: media.element.getAttribute('alt') ?? found.node.attrs.alt ?? '',
      annotations: parseImageAnnotations(found.node.attrs.annotations)
    });
    return true;
  };

  const handleMediaKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const target = event.target as HTMLElement | null;
    const media = target?.closest(mediaSelector);
    const activeEditor = editorHolderRef.current;
    if (media instanceof HTMLElement && activeEditor) {
      const found = findMediaNodePosition(activeEditor, media);
      if (found?.node && ['image', 'video', 'audio', 'mediaEmbed'].includes(found.node.type.name)) {
        event.preventDefault();
        event.stopPropagation();
        activeEditor.commands.setNodeSelection(found.pos);
        updateMediaIndentAt(activeEditor, found.pos, found.node, event.shiftKey ? 'out' : 'in');
        return;
      }
    }
  };

  const handleBlockMoveKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!event.metaKey && !event.ctrlKey) return;
    if (event.altKey || event.shiftKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const moved = onMoveBlock?.(event.key === 'ArrowUp' ? -1 : 1) ?? false;
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      className="rich-editor-wrap"
      onMouseMove={updateMediaCursor}
      onMouseLeave={clearMediaCursor}
      onKeyDownCapture={handleBlockMoveKeyDownCapture}
      onKeyDown={handleMediaKeyDown}
      onPointerDown={(event) => {
        startTableColumnResizeFromPointer(event);
      }}
      onMouseDownCapture={(event) => {
        const activeEditor = editorHolderRef.current;
        if (!activeEditor) return;
        const candidate = findTableColumnResizeCandidate(activeEditor, event.target, event.clientX, event.clientY);
        if (!candidate) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.tableWrapper, table, th, td, .column-resize-handle')) return;
        if (editImageFromPointer(event)) return;
        if (startResizeFromPointer(event)) return;
        if (selectMediaFromPointer(event)) return;
        toggleCollapsibleListItem(event, editor);
      }}
    >
      <EditorContent editor={editor} />
      {tableControls?.visible && runTableCommand && (
        <TableControls runCommand={runTableCommand} position={tableControls} />
      )}
      {mathEditor && onMathChange && onMathClose && (
        <MathBlockEditor editorState={mathEditor} onChange={onMathChange} onClose={onMathClose} />
      )}
    </div>
  );
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
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('codeBlock')} title="Code block"><Braces size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('blockquote')} title="Quote"><Quote size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('table')} title="Table"><Table2 size={16} /></button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('inlineMath')} title="Inline math"><Sigma size={16} /></button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('blockMath')} title="Block math">Σ</button>
      <button className="tool-button text-tool" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('footnote')} title="Footnote">fn</button>
      <button className="tool-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('attachment')} title="Attachment"><Paperclip size={16} /></button>
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

function TableControls({
  runCommand,
  position
}: {
  runCommand: (command: ToolbarCommand) => void;
  position: TableControlsState;
}) {
  return (
    <div className="table-controls" aria-label="Table controls" style={{ top: position.top, left: position.left }}>
      <button className="table-control-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('tableRowAfter')} title="Add row">+ row</button>
      <button className="table-control-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('tableColumnAfter')} title="Add column">+ col</button>
      <button className="table-control-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('tableDeleteRow')} title="Delete selected row">- row</button>
      <button className="table-control-button" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('tableDeleteColumn')} title="Delete selected column">- col</button>
      <button className="table-control-button danger" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('tableDelete')} title="Delete table">del</button>
    </div>
  );
}

function MathBlockEditor({
  editorState,
  onChange,
  onClose
}: {
  editorState: MathEditorState;
  onChange: (latex: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editorState.pos]);

  return (
    <div
      className="math-block-editor"
      style={{ top: editorState.top, left: editorState.left, width: editorState.width }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="math-block-editor-delimiter">$$</span>
      <input
        ref={inputRef}
        value={editorState.latex}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="E = mc^2"
        aria-label="Math block latex"
      />
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onClose} aria-label="Close math editor">×</button>
    </div>
  );
}

export { RichEditor, Toolbar, TableControls, MathBlockEditor, escapeHtml };
