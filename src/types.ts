export type ThemeId = 'garden' | 'ledger';
export type ShellId = 'native-garden' | 'native-ledger' | 'typora-base' | 'typora-garden';
export type ContentThemeId =
  | 'notebook'
  | 'typora-base'
  | 'typora-proof'
  | 'typora-konayuki'
  | 'typora-swiss'
  | 'typora-folio'
  | 'typora-zeus'
  | 'typora-bonne-nouvelle'
  | 'typora-flexoki-light'
  | 'typora-inkwell'
  | 'typora-gruvbox-dark'
  | 'typora-bit-clean-light'
  | 'typora-print'
  | 'typora-ravel-light'
  | 'typora-chocolate-box'
  | 'typora-torillic'
  | 'typora-eloquent'
  | 'typora-law'
  | 'typora-blackout'
  | 'typora-salamander'
  | 'typora-minimalism'
  | 'typora-everforest-light'
  | 'typora-everforest-dark'
  | 'typora-mdmdt-light'
  | 'typora-paperglow'
  | 'typora-latex'
  | 'typora-alise';

export interface Notebook {
  id: string;
  name: string;
  pageIds: string[];
  metadata: NotebookMetadata;
}

export interface NotebookMetadata {
  emoji?: string;
  calendarView?: NotebookCalendarViewConfig;
  metadataFields?: Record<string, NotebookMetadataField>;
}

export type MetadataFieldType = 'text' | 'longText' | 'date' | 'dateRange' | 'select' | 'multiSelect';

export interface NotebookMetadataField {
  type: MetadataFieldType;
}

export type NotebookCalendarDateSource = 'createdAt' | `metadata.${string}` | `frontmatter.${string}`;

export interface NotebookCalendarViewConfig {
  enabled: boolean;
  dateSource: NotebookCalendarDateSource;
  dateSources?: NotebookCalendarDateSource[];
  visibleFields: string[];
  colorField?: string;
  dateMode?: 'point' | 'range';
  dateStartField?: NotebookCalendarDateSource;
  dateEndField?: NotebookCalendarDateSource;
}

export interface PageMetadata {
  sourceFilename?: string;
  tags: string[];
  date?: string;
  status?: string;
  aliases: string[];
  frontmatter: Record<string, string | string[]>;
  frontmatterRaw?: string;
  emoji?: string;
}

export type PageMetadataFieldSource = 'date' | 'status' | 'tags' | 'aliases' | 'frontmatter';

export interface PageMetadataField {
  key: string;
  value: string;
  source: PageMetadataFieldSource;
  type: MetadataFieldType;
  valueKind: 'text' | 'list';
}

export interface PageCalendarDisplayField {
  key: string;
  value: string;
  type: MetadataFieldType;
}

export interface Page {
  id: string;
  notebookId: string;
  parentId: string | null;
  title: string;
  blockIds: string[];
  blockOrder?: 'asc' | 'desc';
  metadata: PageMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface RichContent {
  html: string;
  plainText: string;
}

export interface Block {
  id: string;
  pageId: string;
  content: RichContent;
  collapsed: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OperationLogEntry {
  id: string;
  timestamp: string;
  entity: 'notebook' | 'page' | 'block';
  entityId: string;
  kind: string;
  payload: unknown;
}

export interface AppState {
  notebooks: Notebook[];
  pages: Page[];
  blocks: Block[];
  activeNotebookId: string;
  activePageId: string;
  shell: ShellId;
  theme: ThemeId;
  contentTheme: ContentThemeId;
  openCardWindowBlockId: string | null;
  expandedPageIds: string[];
  operations: OperationLogEntry[];
  showPageMetadata: boolean;
}
