export type ThemeId = 'paper' | 'atelier' | 'garden';

export interface Notebook {
  id: string;
  name: string;
  pageIds: string[];
}

export interface Page {
  id: string;
  notebookId: string;
  title: string;
  blockIds: string[];
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
  theme: ThemeId;
  operations: OperationLogEntry[];
}
