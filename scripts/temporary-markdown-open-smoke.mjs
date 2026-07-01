import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const rust = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../src/workspace.tsx', import.meta.url), 'utf8');

const associations = config.bundle?.fileAssociations ?? [];
const markdownAssociation = associations.find((association) => {
  const extensions = association.ext ?? [];
  return ['md', 'markdown', 'txt'].every((extension) => extensions.includes(extension));
});

const checks = {
  fileAssociation: Boolean(markdownAssociation) && markdownAssociation.role === 'Editor',
  openedRunEvent: rust.includes('RunEvent::Opened') && rust.includes('notebook://open-markdown-file'),
  readCommand: rust.includes('fn read_markdown_file') && rust.includes('drain_pending_markdown_opens'),
  frontendListener: app.includes("listen<string>('notebook://open-markdown-file'") && app.includes("invoke<OpenedMarkdownFilePayload>('read_markdown_file'"),
  temporaryState: app.includes('temporaryMarkdownPages') && app.includes('page.open_temporary_markdown'),
  savePath: app.includes('notebook.save_temporary_markdown') && app.includes('persistImportBatch'),
  uiButton: workspace.includes('temporary-markdown-save') && workspace.includes('Save to Notebook')
};

console.log(JSON.stringify({ checks }, null, 2));

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
