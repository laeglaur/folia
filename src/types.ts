export type ThemeId = 'garden' | 'ledger';
export type ShellId = 'native-garden' | 'native-ledger' | 'typora-base';
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
  | 'typora-salamander';

export interface Notebook {
  id: string;
  name: string;
  pageIds: string[];
}

export interface PageMetadata {
  sourceFilename?: string;
  tags: string[];
  date?: string;
  status?: string;
  aliases: string[];
  frontmatter: Record<string, string | string[]>;
}

export interface Page {
  id: string;
  notebookId: string;
  parentId: string | null;
  title: string;
  blockIds: string[];
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
}
