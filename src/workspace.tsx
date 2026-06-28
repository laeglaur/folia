import { Fragment, type CSSProperties } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Block, ContentThemeId, NotebookCalendarDateSource, NotebookCalendarViewConfig, Page } from './types';
import type { PageCalendarEntry, PageCalendarFieldCandidate } from './page-calendar';
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
import { EmojiImage } from './emoji-image';

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
      <div className={`page-title-row ${activePage.metadata.emoji ? 'has-page-emoji' : ''}`}>
        {activePage.metadata.emoji ? <EmojiImage emoji={activePage.metadata.emoji} className="page-title-emoji" decorative /> : null}
        <input className="page-title" value={activePage.title} onChange={(event) => onRenamePage(event.target.value)} aria-label="Page title" />
      </div>
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
  pageEntries: PageCalendarEntry[];
  pageConfig: NotebookCalendarViewConfig | null;
  pageDateOptions: PageCalendarFieldCandidate[];
  pageFieldOptions: string[];
  title: string;
  mode: 'blocks' | 'pages';
  onMoveMonth: (delta: number) => void;
  onJumpToBlock: (pageId: string, blockId: string) => void;
  onOpenPage: (pageId: string) => void;
  onCreatePageForDate: (date: string) => void;
  onPageDateSourcesChange: (dateSources: NotebookCalendarDateSource[]) => void;
  onPageVisibleFieldsChange: (fields: string[]) => void;
  onPageColorFieldChange: (field: string) => void;
  onShowWrite: () => void;
};

function CalendarWorkspace({
  calendarMonth,
  calendarDays,
  entriesByDate,
  pageEntries,
  pageConfig,
  pageDateOptions,
  pageFieldOptions,
  title,
  mode,
  onMoveMonth,
  onJumpToBlock,
  onOpenPage,
  onCreatePageForDate,
  onPageDateSourcesChange,
  onPageVisibleFieldsChange,
  onPageColorFieldChange,
  onShowWrite
}: CalendarWorkspaceProps) {
  const currentMonthKey = monthKey(calendarMonth);
  const todayKey = localDateKey(new Date());
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const visibleFields = pageConfig?.visibleFields ?? [];
  const activeDateSources = pageConfig
    ? (pageConfig.dateSources?.length ? pageConfig.dateSources : [pageConfig.dateSource])
    : [];
  const colorKeys = [...new Set(pageEntries.map((entry) => entry.colorKey).filter(Boolean))];
  const colorClass = (entry: PageCalendarEntry) => {
    const index = Math.max(0, colorKeys.indexOf(entry.colorKey));
    return `collection-color-${(index % 6) + 1}`;
  };
  const visibleDayKeys = new Map(calendarDays.map((day, index) => [localDateKey(day), index]));
  const pageEntriesByDate = new Map<string, PageCalendarEntry[]>();
  const rangeSegments: Array<{
    entry: PageCalendarEntry;
    key: string;
    weekIndex: number;
    columnStart: number;
    columnEnd: number;
    lane: number;
    startsInWeek: boolean;
    endsInWeek: boolean;
  }> = [];
  const rangeLaneByWeek = new Map<number, string[]>();

  pageEntries.forEach((entry) => {
    const startIndex = visibleDayKeys.get(entry.startDate);
    const endIndex = visibleDayKeys.get(entry.endDate);
    if (entry.startDate === entry.endDate) {
      if (startIndex !== undefined) {
        pageEntriesByDate.set(entry.startDate, [...(pageEntriesByDate.get(entry.startDate) ?? []), entry]);
      }
      return;
    }
    if (startIndex === undefined && endIndex === undefined) {
      const firstKey = localDateKey(calendarDays[0]);
      const lastKey = localDateKey(calendarDays[calendarDays.length - 1]);
      if (entry.endDate < firstKey || entry.startDate > lastKey) return;
    }
    const visibleStartIndex = startIndex ?? 0;
    const visibleEndIndex = endIndex ?? calendarDays.length - 1;
    const firstWeek = Math.floor(visibleStartIndex / 7);
    const lastWeek = Math.floor(visibleEndIndex / 7);
    for (let weekIndex = firstWeek; weekIndex <= lastWeek; weekIndex += 1) {
      const weekStartIndex = weekIndex * 7;
      const weekEndIndex = weekStartIndex + 6;
      const segmentStart = Math.max(visibleStartIndex, weekStartIndex);
      const segmentEnd = Math.min(visibleEndIndex, weekEndIndex);
      const lanes = rangeLaneByWeek.get(weekIndex) ?? [];
      const lane = lanes.findIndex((laneEndDate) => laneEndDate < localDateKey(calendarDays[segmentStart]));
      const nextLane = lane === -1 ? lanes.length : lane;
      lanes[nextLane] = localDateKey(calendarDays[segmentEnd]);
      rangeLaneByWeek.set(weekIndex, lanes);
      rangeSegments.push({
        entry,
        key: `${entry.key}:${weekIndex}`,
        weekIndex,
        columnStart: (segmentStart % 7) + 1,
        columnEnd: (segmentEnd % 7) + 2,
        lane: nextLane,
        startsInWeek: segmentStart === startIndex,
        endsInWeek: segmentEnd === endIndex
      });
    }
  });
  const rangeLanesByWeek = new Map(Array.from(rangeLaneByWeek.entries(), ([weekIndex, lanes]) => [weekIndex, lanes.length]));

  return (
    <section className="calendar-workspace typora-content-surface typora-write" aria-label="Calendar workspace">
      <div className="calendar-workspace-header">
        <div>
          <p className="section-label">Calendar</p>
          <h2>{title}</h2>
        </div>
        {mode === 'blocks' ? <button className="secondary-button" type="button" onClick={onShowWrite}>Write</button> : null}
      </div>
      {mode === 'pages' && pageConfig ? (
        <div className="collection-controls page-calendar-controls" aria-label="Calendar controls">
          <div className="collection-control-row">
            <span className="collection-control-label">Fields</span>
            <div className="collection-chip-strip" role="group" aria-label="Visible fields">
              {pageFieldOptions.map((field) => {
                const checked = visibleFields.includes(field);
                const isColorField = pageConfig.colorField === field;
                return (
                  <label
                    className={`collection-chip ${checked ? 'active' : ''} ${isColorField ? 'is-color-field' : ''}`}
                    key={field}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      onPageColorFieldChange(field);
                    }}
                    title="Double-click to color by this field"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const nextFields = event.target.checked
                          ? [...visibleFields, field]
                          : visibleFields.filter((candidate) => candidate !== field);
                        onPageVisibleFieldsChange(nextFields);
                      }}
                    />
                    <span>{field}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="collection-control-row">
            <span className="collection-control-label">Date</span>
            <div className="collection-chip-strip" role="group" aria-label="Date field">
              {pageDateOptions.map((option) => (
                <label className={`collection-chip ${activeDateSources.includes(option.key) ? 'active' : ''}`} key={option.key}>
                  <input
                    type="checkbox"
                    checked={activeDateSources.includes(option.key)}
                    onChange={(event) => {
                      const nextSources = event.target.checked
                        ? [...activeDateSources, option.key]
                        : activeDateSources.filter((source) => source !== option.key);
                      onPageDateSourcesChange(nextSources.length ? nextSources : [option.key]);
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
              {pageDateOptions.length ? null : <span className="collection-control-empty">No date fields</span>}
            </div>
          </div>
        </div>
      ) : null}
      <div className="calendar-view" aria-label={mode === 'pages' ? 'Page calendar' : 'Block calendar'}>
        <div className="calendar-header">
          <button className="mini-button" type="button" onClick={() => onMoveMonth(-1)} aria-label="Previous month"><ChevronRight className="flip-x" size={14} /></button>
          <div className="calendar-title">{monthLabel(calendarMonth)}</div>
          <button className="mini-button" type="button" onClick={() => onMoveMonth(1)} aria-label="Next month"><ChevronRight size={14} /></button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div
          className="calendar-grid"
        >
          {calendarDays.map((day) => {
            const key = localDateKey(day);
            const entries = entriesByDate.get(key) ?? [];
            const pageEntries = pageEntriesByDate.get(key) ?? [];
            const weekIndex = Math.floor((visibleDayKeys.get(key) ?? 0) / 7);
            return (
              <div
                className={`calendar-day ${monthKey(day) !== currentMonthKey ? 'is-muted' : ''} ${key === todayKey ? 'is-today' : ''}`}
                key={key}
                data-date={key}
                style={{ '--calendar-range-lanes': rangeLanesByWeek.get(weekIndex) ?? 0 } as CSSProperties}
              >
                <div className="calendar-day-top">
                  <span className="calendar-day-number">{day.getDate()}</span>
                  {mode === 'pages' ? (
                    <button
                      className="calendar-day-add"
                      type="button"
                      onClick={() => onCreatePageForDate(key)}
                      aria-label={`Create page for ${key}`}
                      title={`Create page for ${key}`}
                    >
                      <Plus size={12} />
                    </button>
                  ) : null}
                </div>
                <div className="calendar-day-entries">
                  {mode === 'pages' ? pageEntries.slice(0, 3).map((entry) => (
                    <button
                      className={`calendar-entry page-calendar-entry collection-calendar-entry ${colorClass(entry)}`}
                      key={entry.key}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenPage(entry.page.id);
                      }}
                      title={entry.title}
                    >
                      <span>{entry.colorKey || title}</span>
                      <span>{entry.title}</span>
                      {entry.fields.length ? (
                        <span className="page-calendar-entry-fields">
                          {entry.fields.slice(0, 3).map((field) => (
                            <span key={field.key}>{field.value}</span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  )) : entries.slice(0, 2).map(({ block, page }) => (
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
                  {mode === 'pages' && pageEntries.length > 3 ? <div className="calendar-more">+{pageEntries.length - 3}</div> : null}
                  {mode === 'blocks' && entries.length > 2 ? <div className="calendar-more">+{entries.length - 2}</div> : null}
                </div>
              </div>
            );
          })}
          {mode === 'pages' ? rangeSegments.map((segment) => (
            <button
              className={`calendar-range-entry collection-calendar-entry ${colorClass(segment.entry)} ${segment.startsInWeek ? 'starts-in-week' : 'continues-from-before'} ${segment.endsInWeek ? 'ends-in-week' : 'continues-after'}`}
              key={segment.key}
              type="button"
              onClick={() => onOpenPage(segment.entry.page.id)}
              title={`${segment.entry.title}: ${segment.entry.startDate} to ${segment.entry.endDate}`}
              style={{
                gridColumn: `${segment.columnStart} / ${segment.columnEnd}`,
                gridRow: segment.weekIndex + 1,
                '--calendar-range-lane': segment.lane
              } as CSSProperties}
            >
              <span>{segment.entry.colorKey || title}</span>
              <strong>{segment.entry.title}</strong>
              {segment.entry.fields.length ? (
                <em>{segment.entry.fields.slice(0, 3).map((field) => field.value).join(' · ')}</em>
              ) : null}
            </button>
          )) : null}
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
