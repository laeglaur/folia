import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, 'dist-view-model-test');

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'src'), { recursive: true });
await writeFile(join(outDir, 'package.json'), '{"type":"module"}\n');
await writeFile(join(outDir, 'tsconfig.json'), JSON.stringify({
  extends: '../tsconfig.json',
  compilerOptions: {
    noEmit: false,
    outDir: '.',
    rootDir: '..',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'react-jsx',
    declaration: false,
    sourceMap: false
  },
  include: [
    '../src/workspace-view-model.ts',
    '../src/types.ts',
    '../src/app-utils.ts',
    '../src/state.ts',
    '../src/editor.tsx'
  ]
}, null, 2));

await execFileAsync('pnpm', ['exec', 'tsc', '-p', join(outDir, 'tsconfig.json')], { cwd: repoRoot });

const patchCompiledImports = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await patchCompiledImports(path);
      return;
    }
    if (!entry.name.endsWith('.js')) return;
    const source = await readFile(path, 'utf8');
    const patched = source.replace(/from '(\.[^']+)'/g, (match, specifier) =>
      specifier.endsWith('.js') ? match : `from '${specifier}.js'`
    );
    if (patched !== source) await writeFile(path, patched);
  }));
};

await patchCompiledImports(outDir);

const {
  applyBlockDeleteToViewState,
  applyMarkdownFilesImportToViewState,
  applyPageNavigationToViewState,
  applyRestoredPageDocumentToViewState
} = await import(`file://${join(outDir, 'src/workspace-view-model.js')}`);

const timestamp = '2026-06-17T00:00:00.000Z';
const emptyMetadata = { tags: [], aliases: [], frontmatter: {} };
const notebook = { id: 'notebook_a', name: 'A', pageIds: ['page_root', 'page_child'], metadata: {} };
const rootPage = {
  id: 'page_root',
  notebookId: notebook.id,
  parentId: null,
  title: 'Root',
  blockIds: ['block_root'],
  metadata: emptyMetadata,
  createdAt: timestamp,
  updatedAt: timestamp
};
const childPage = {
  ...rootPage,
  id: 'page_child',
  parentId: rootPage.id,
  title: 'Child',
  blockIds: ['block_child']
};
const rootBlock = {
  id: 'block_root',
  pageId: rootPage.id,
  content: { html: '<p>Root</p>', plainText: 'Root' },
  collapsed: false,
  pinned: false,
  createdAt: timestamp,
  updatedAt: timestamp
};
const childBlock = {
  ...rootBlock,
  id: 'block_child',
  pageId: childPage.id,
  content: { html: '<p>Child</p>', plainText: 'Child' }
};
const baseState = {
  notebooks: [notebook],
  pages: [rootPage, childPage],
  blocks: [rootBlock],
  activeNotebookId: notebook.id,
  activePageId: rootPage.id,
  shell: 'typora-base',
  theme: 'garden',
  contentTheme: 'notebook',
  openCardWindowBlockId: 'block_child',
  expandedPageIds: [],
  operations: [],
  showPageMetadata: true
};

const op = {
  id: 'op_import',
  timestamp,
  entity: 'notebook',
  entityId: notebook.id,
  kind: 'notebook.import_markdown_files',
  payload: {}
};
const importedPageA = { ...rootPage, id: 'page_import_a', title: 'Import A', blockIds: ['block_import_a'] };
const importedPageB = { ...rootPage, id: 'page_import_b', title: 'Import B', blockIds: ['block_import_b'] };
const importedBlockA = { ...rootBlock, id: 'block_import_a', pageId: importedPageA.id };
const importedBlockB = { ...rootBlock, id: 'block_import_b', pageId: importedPageB.id };

const desktopImport = applyMarkdownFilesImportToViewState(
  baseState,
  notebook.id,
  [importedPageA, importedPageB],
  [importedBlockA, importedBlockB],
  op,
  true
);
assert.equal(desktopImport.activePageId, importedPageB.id);
assert.deepEqual(desktopImport.blocks.map((block) => block.id), [importedBlockB.id]);
assert.deepEqual(desktopImport.notebooks[0].pageIds, ['page_root', 'page_child', importedPageA.id, importedPageB.id]);

const browserImport = applyMarkdownFilesImportToViewState(
  baseState,
  notebook.id,
  [importedPageA, importedPageB],
  [importedBlockA, importedBlockB],
  op,
  false
);
assert.deepEqual(browserImport.blocks.map((block) => block.id), [rootBlock.id, importedBlockA.id, importedBlockB.id]);

const navigated = applyPageNavigationToViewState(baseState, childPage.id);
assert.equal(navigated.activePageId, childPage.id);
assert.equal(navigated.activeNotebookId, notebook.id);
assert.deepEqual(navigated.expandedPageIds, [rootPage.id]);

const deleteOperation = { ...op, id: 'op_delete', entity: 'block', entityId: childBlock.id, kind: 'block.delete' };
const deleted = applyBlockDeleteToViewState(
  { ...baseState, activePageId: childPage.id, blocks: [childBlock] },
  { ...childPage, blockIds: [] },
  [],
  childBlock.id,
  deleteOperation,
  true
);
assert.equal(deleted.openCardWindowBlockId, null);
assert.deepEqual(deleted.blocks, []);
assert.equal(deleted.operations.at(-1)?.id, deleteOperation.id);

const restoreOperation = { ...op, id: 'op_restore', entity: 'page', entityId: childPage.id, kind: 'page.restore_revision' };
const restored = applyRestoredPageDocumentToViewState(baseState, {
  page: { ...childPage, title: 'Restored' },
  content: { contentType: 'page_document', version: 1, blocks: [childBlock] }
}, restoreOperation, true);
assert.equal(restored.pages.find((page) => page.id === childPage.id)?.title, 'Restored');
assert.deepEqual(restored.blocks.map((block) => block.id), [childBlock.id]);
assert.equal(restored.operations.at(-1)?.id, restoreOperation.id);

console.log(JSON.stringify({
  checks: {
    desktopImportKeepsOnlyActivePageBlocks: true,
    browserImportKeepsAllBlocks: true,
    pageNavigationExpandsAncestors: true,
    blockDeleteClosesMatchingPinnedCard: true,
    restoredDocumentAppendsOperation: true
  }
}, null, 2));

await rm(outDir, { recursive: true, force: true });
