import { Fragment } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Block, ContentThemeId, Page } from './types';
import {
  RichEditor,
  Toolbar,
  type MathEditorState,
  type ImageAnnotationRequest,
  type MediaResizeRequest,
  type TableControlsState,
  type ToolbarCommand
} from './editor';
import {
  blockTimestampLabel,
  firstLines,
  htmlWithOutlineAnchors,
  localDateKey,
  monthKey,
  monthLabel,
  type CalendarEntry,
  type ImportNotice,
  type WorkspaceView
} from './app-utils';

type ImageAnnotationTarget = NonNullable<ImageAnnotationRequest['target']>;

const themesWithoutNativeDivider = new Set<ContentThemeId>([
  'notebook',
  'typora-base',
  'typora-proof',
  'typora-bonne-nouvelle',
  'typora-eloquent',
  'typora-everforest-light',
  'typora-law'
]);

export type EditorTarget = { kind: 'composer' } | { kind: 'block'; blockId: string };

type ToolbarActions = {
  runCommand: (command: ToolbarCommand) => void;
  insertTodo: () => void;
  applyHighlight: () => void;
  applyInlineCode: () => void;
};

type ComposerCardProps = {
  activeEditor: EditorTarget;
  draftKey: string;
  draft: string;
  showToolbar: boolean;
  showFooter: boolean;
  tableControls: TableControlsState;
  mathEditor: MathEditorState | null;
  toolbarActions: ToolbarActions;
  onEditorRef: (editor: Editor | null) => void;
  onFocus: (editor: Editor) => void;
  onSelectionUpdate: (editor: Editor) => void;
  onRunTableCommand: (command: ToolbarCommand) => void;
  onMediaResizeStart: (request: MediaResizeRequest) => void;
  onImageAnnotate: (request: ImageAnnotationRequest) => void;
  onMathChange: (latex: string) => void;
  onMathClose: () => void;
  onDraftChange: (html: string) => void;
  onCommitDraft: () => void;
};

function ComposerCard({
  activeEditor,
  draftKey,
  draft,
  showToolbar,
  showFooter,
  tableControls,
  mathEditor,
  toolbarActions,
  onEditorRef,
  onFocus,
  onSelectionUpdate,
  onRunTableCommand,
  onMediaResizeStart,
  onImageAnnotate,
  onMathChange,
  onMathClose,
  onDraftChange,
  onCommitDraft
}: ComposerCardProps) {
  const annotateTarget: ImageAnnotationTarget = { kind: 'composer', pageId: draftKey };
  return (
    <div className="composer-card">
      {showToolbar && activeEditor.kind === 'composer' && (
        <Toolbar
          runCommand={toolbarActions.runCommand}
          insertTodo={toolbarActions.insertTodo}
          applyHighlight={toolbarActions.applyHighlight}
          applyInlineCode={toolbarActions.applyInlineCode}
        />
      )}
      <RichEditor
        key={draftKey}
        editorRef={onEditorRef}
        html={draft}
        className="composer"
        placeholder="写点什么。按 Shift Enter 变成 block，Tab 缩进。"
        onFocus={onFocus}
        onSelectionUpdate={onSelectionUpdate}
        tableControls={activeEditor.kind === 'composer' ? tableControls : undefined}
        runTableCommand={onRunTableCommand}
        onMediaResizeStart={onMediaResizeStart}
        onImageAnnotate={(request) => onImageAnnotate({ ...request, target: annotateTarget })}
        mathEditor={activeEditor.kind === 'composer' ? mathEditor : null}
        onMathChange={onMathChange}
        onMathClose={onMathClose}
        onUpdate={(html) => onDraftChange(html)}
        onShiftEnter={() => {
          onCommitDraft();
          return true;
        }}
      />
      {showFooter && (
        <div className="composer-footer">
          <span>{draft ? 'Ready to become a block' : 'Waiting for a thought'}</span>
          <button className="primary-button" type="button" onClick={onCommitDraft}><Plus size={16} /> Add block</button>
        </div>
      )}
    </div>
  );
}

function BlockDivider({
  contentTheme
}: {
  contentTheme: ContentThemeId;
}) {
  return (
    <hr
      className={`block-divider md-hr md-end-block ${themesWithoutNativeDivider.has(contentTheme) ? 'uses-default-divider' : 'uses-theme-divider'}`}
      aria-hidden="true"
    />
  );
}

type BlockItemProps = {
  block: Block;
  activeEditor: EditorTarget;
  draggingBlockId: string | null;
  showToolbar: boolean;
  tableControls: TableControlsState;
  mathEditor: MathEditorState | null;
  toolbarActions: ToolbarActions;
  onDraggingBlockIdChange: (blockId: string | null) => void;
  onReorderBlock: (sourceId: string, targetId: string) => void;
  onToggleBlock: (blockId: string, key: 'collapsed' | 'pinned') => void;
  onEditorRef: (blockId: string, editor: Editor | null) => void;
  onFocus: (blockId: string, editor: Editor) => void;
  onSelectionUpdate: (editor: Editor) => void;
  onRunTableCommand: (command: ToolbarCommand) => void;
  onMediaResizeStart: (request: MediaResizeRequest) => void;
  onImageAnnotate: (request: ImageAnnotationRequest) => void;
  onMathChange: (latex: string) => void;
  onMathClose: () => void;
  onMoveBlock: (blockId: string, direction: -1 | 1) => boolean;
  onDeleteBlock: (blockId: string) => boolean;
  onUpdateBlock: (blockId: string, html: string, plainText: string) => void;
};

function BlockItem({
  block,
  activeEditor,
  draggingBlockId,
  showToolbar,
  tableControls,
  mathEditor,
  toolbarActions,
  onDraggingBlockIdChange,
  onReorderBlock,
  onToggleBlock,
  onEditorRef,
  onFocus,
  onSelectionUpdate,
  onRunTableCommand,
  onMediaResizeStart,
  onImageAnnotate,
  onMathChange,
  onMathClose,
  onMoveBlock,
  onDeleteBlock,
  onUpdateBlock
}: BlockItemProps) {
  const annotateTarget: ImageAnnotationTarget = { kind: 'block', blockId: block.id };
  const expandCollapsedBlock = (event: React.MouseEvent<HTMLElement>) => {
    if (!block.collapsed) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
    onToggleBlock(block.id, 'collapsed');
  };

  return (
    <article
      className={`block ${block.collapsed ? 'is-collapsed' : ''} ${draggingBlockId === block.id ? 'is-dragging' : ''}`}
      id={block.id}
      data-block-id={block.id}
      onClick={expandCollapsedBlock}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onReorderBlock(event.dataTransfer.getData('text/plain'), block.id);
        onDraggingBlockIdChange(null);
      }}
    >
      <div
        className="block-rail"
        draggable
        onDragStart={(event) => {
          onDraggingBlockIdChange(block.id);
          event.dataTransfer.setData('text/plain', block.id);
        }}
        onDragEnd={() => onDraggingBlockIdChange(null)}
      >
        <button className="fold-button" onClick={() => onToggleBlock(block.id, 'collapsed')} aria-label="Collapse block" type="button">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="block-body">
        <button
          className={`block-created-at ${block.pinned ? 'is-pinned' : ''}`}
          type="button"
          onClick={() => onToggleBlock(block.id, 'pinned')}
          aria-pressed={block.pinned}
          aria-label={block.pinned ? 'Unpin block' : 'Pin block'}
        >
          <time dateTime={block.createdAt}>{blockTimestampLabel(block.createdAt)}</time>
        </button>
        {showToolbar && activeEditor.kind === 'block' && activeEditor.blockId === block.id && (
          <Toolbar
            runCommand={toolbarActions.runCommand}
            insertTodo={toolbarActions.insertTodo}
            applyHighlight={toolbarActions.applyHighlight}
            applyInlineCode={toolbarActions.applyInlineCode}
          />
        )}
        {!block.collapsed ? (
          <RichEditor
            editorRef={(editor) => onEditorRef(block.id, editor)}
            className="block-content editable"
            html={htmlWithOutlineAnchors(block.content.html, block.id)}
            onFocus={(editor) => onFocus(block.id, editor)}
            onSelectionUpdate={onSelectionUpdate}
            tableControls={activeEditor.kind === 'block' && activeEditor.blockId === block.id ? tableControls : undefined}
            runTableCommand={onRunTableCommand}
            onMediaResizeStart={onMediaResizeStart}
            onImageAnnotate={(request) => onImageAnnotate({ ...request, target: annotateTarget })}
            mathEditor={activeEditor.kind === 'block' && activeEditor.blockId === block.id ? mathEditor : null}
            onMathChange={onMathChange}
            onMathClose={onMathClose}
            onMoveBlock={(direction) => onMoveBlock(block.id, direction)}
            onDeleteBlock={() => onDeleteBlock(block.id)}
            onBlur={(html, plainText) => onUpdateBlock(block.id, html, plainText)}
          />
        ) : (
          <div className="block-content preview">{firstLines(block.content.plainText)}</div>
        )}
      </div>
    </article>
  );
}

type WriteSurfaceProps = {
  activePage: Page;
  metadataChips: string[];
  metadataRaw: string;
  blockOrder: 'asc' | 'desc';
  blocks: Block[];
  draggingBlockId: string | null;
  contentTheme: ContentThemeId;
  showBlockDividers: boolean;
  showBlockBorders: boolean;
  composer: ComposerCardProps;
  activeEditor: EditorTarget;
  showToolbar: boolean;
  tableControls: TableControlsState;
  mathEditor: MathEditorState | null;
  toolbarActions: ToolbarActions;
  onRenamePage: (title: string) => void;
  onDraggingBlockIdChange: (blockId: string | null) => void;
  onReorderBlock: (sourceId: string, targetId: string) => void;
  onToggleBlock: (blockId: string, key: 'collapsed' | 'pinned') => void;
  onBlockEditorRef: (blockId: string, editor: Editor | null) => void;
  onBlockFocus: (blockId: string, editor: Editor) => void;
  onSelectionUpdate: (editor: Editor) => void;
  onRunTableCommand: (command: ToolbarCommand) => void;
  onMediaResizeStart: (request: MediaResizeRequest) => void;
  onImageAnnotate: (request: ImageAnnotationRequest) => void;
  onMathChange: (latex: string) => void;
  onMathClose: () => void;
  onMoveBlock: (blockId: string, direction: -1 | 1) => boolean;
  onDeleteBlock: (blockId: string) => boolean;
  onUpdateBlock: (blockId: string, html: string, plainText: string) => void;
};

function WriteSurface({
  activePage,
  metadataChips,
  metadataRaw,
  blockOrder,
  blocks,
  draggingBlockId,
  contentTheme,
  showBlockDividers,
  showBlockBorders,
  composer,
  activeEditor,
  showToolbar,
  tableControls,
  mathEditor,
  toolbarActions,
  onRenamePage,
  onDraggingBlockIdChange,
  onReorderBlock,
  onToggleBlock,
  onBlockEditorRef,
  onBlockFocus,
  onSelectionUpdate,
  onRunTableCommand,
  onMediaResizeStart,
  onImageAnnotate,
  onMathChange,
  onMathClose,
  onMoveBlock,
  onDeleteBlock,
  onUpdateBlock
}: WriteSurfaceProps) {
  const divider = () => showBlockDividers ? <BlockDivider contentTheme={contentTheme} /> : null;
  const composerCard = <ComposerCard {...composer} />;

  return (
    <section className={`page-surface typora-content-surface typora-write ${showBlockBorders ? 'show-block-borders' : ''}`} id="write">
      <input className="page-title" value={activePage.title} onChange={(event) => onRenamePage(event.target.value)} aria-label="Page title" />
      {metadataChips.length || metadataRaw ? (
        <div className="page-metadata" aria-label="Page metadata">
          {metadataChips.map((chip, index) => <span key={`${chip}-${index}`}>{chip}</span>)}
          {metadataRaw ? <pre className="page-frontmatter">{metadataRaw}</pre> : null}
        </div>
      ) : null}

      {blockOrder === 'desc' ? (
        <>
          {composerCard}
          {blocks.length ? divider() : null}
        </>
      ) : null}

      <div className="block-list">
        {blocks.map((block, index) => (
          <Fragment key={block.id}>
            <BlockItem
              block={block}
              activeEditor={activeEditor}
              draggingBlockId={draggingBlockId}
              showToolbar={showToolbar}
              tableControls={tableControls}
              mathEditor={mathEditor}
              toolbarActions={toolbarActions}
              onDraggingBlockIdChange={onDraggingBlockIdChange}
              onReorderBlock={onReorderBlock}
              onToggleBlock={onToggleBlock}
              onEditorRef={onBlockEditorRef}
              onFocus={onBlockFocus}
              onSelectionUpdate={onSelectionUpdate}
              onRunTableCommand={onRunTableCommand}
              onMediaResizeStart={onMediaResizeStart}
              onImageAnnotate={onImageAnnotate}
              onMathChange={onMathChange}
              onMathClose={onMathClose}
              onMoveBlock={onMoveBlock}
              onDeleteBlock={onDeleteBlock}
              onUpdateBlock={onUpdateBlock}
            />
            {index < blocks.length - 1 ? divider() : null}
          </Fragment>
        ))}
      </div>

      {blockOrder === 'asc' ? (
        <>
          {blocks.length ? divider() : null}
          {composerCard}
        </>
      ) : null}
    </section>
  );
}

function ImportNotice({ notice }: { notice: ImportNotice }) {
  return notice.kind !== 'idle' ? (
    <div className={`import-notice ${notice.kind}`} role="status" aria-live="polite">
      <span>{notice.message}</span>
      {notice.details?.length ? (
        <ul>
          {notice.details.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
      ) : null}
    </div>
  ) : null;
}

type CalendarWorkspaceProps = {
  calendarMonth: Date;
  calendarDays: Date[];
  entriesByDate: Map<string, CalendarEntry[]>;
  onMoveMonth: (delta: number) => void;
  onJumpToBlock: (pageId: string, blockId: string) => void;
  onShowWrite: () => void;
};

function CalendarWorkspace({
  calendarMonth,
  calendarDays,
  entriesByDate,
  onMoveMonth,
  onJumpToBlock,
  onShowWrite
}: CalendarWorkspaceProps) {
  const currentMonthKey = monthKey(calendarMonth);
  const todayKey = localDateKey(new Date());
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <section className="calendar-workspace typora-content-surface typora-write" aria-label="Calendar workspace">
      <div className="calendar-workspace-header">
        <div>
          <p className="section-label">Calendar</p>
          <h2>Blocks by day</h2>
        </div>
        <button className="secondary-button" type="button" onClick={onShowWrite}>Write</button>
      </div>
      <div className="calendar-view" aria-label="Block calendar">
        <div className="calendar-header">
          <button className="mini-button" type="button" onClick={() => onMoveMonth(-1)} aria-label="Previous month"><ChevronRight className="flip-x" size={14} /></button>
          <div className="calendar-title">{monthLabel(calendarMonth)}</div>
          <button className="mini-button" type="button" onClick={() => onMoveMonth(1)} aria-label="Next month"><ChevronRight size={14} /></button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="calendar-grid">
          {calendarDays.map((day) => {
            const key = localDateKey(day);
            const entries = entriesByDate.get(key) ?? [];
            return (
              <div
                className={`calendar-day ${monthKey(day) !== currentMonthKey ? 'is-muted' : ''} ${key === todayKey ? 'is-today' : ''}`}
                key={key}
                data-date={key}
              >
                <div className="calendar-day-number">{day.getDate()}</div>
                <div className="calendar-day-entries">
                  {entries.slice(0, 2).map(({ block, page }) => (
                    <button
                      className="calendar-entry"
                      key={block.id}
                      type="button"
                      onClick={() => onJumpToBlock(page.id, block.id)}
                      title={`${page.title}: ${block.content.plainText}`}
                    >
                      <span>{page.title}</span>
                      <span>{firstLines(block.content.plainText, 44)}</span>
                    </button>
                  ))}
                  {entries.length > 2 ? <div className="calendar-more">+{entries.length - 2}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export type WorkspaceContentProps = {
  importNotice: ImportNotice;
  workspaceView: WorkspaceView;
  writeSurface: WriteSurfaceProps;
  calendar: CalendarWorkspaceProps;
};

export function WorkspaceContent({
  importNotice,
  workspaceView,
  writeSurface,
  calendar
}: WorkspaceContentProps) {
  return (
    <>
      <ImportNotice notice={importNotice} />
      {workspaceView === 'calendar' ? <CalendarWorkspace {...calendar} /> : <WriteSurface {...writeSurface} />}
    </>
  );
}
