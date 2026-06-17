import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(tmpdir(), `folder-import-smoke-${Date.now()}`);
const folder = join(root, 'work-notes');
const largeFolder = join(root, 'large-work-notes');
await mkdir(join(folder, 'project-a', 'assets'), { recursive: true });
await mkdir(join(folder, 'project-b'), { recursive: true });
await mkdir(join(largeFolder, 'group'), { recursive: true });

await writeFile(join(folder, 'project-a', 'day.md'), [
  '---',
  'Created: 2026-06-17T09:30:00',
  'Tags:',
  '  - notion',
  'Score: ✅✅',
  '评分: ★★★★',
  '类型: TV Series',
  '总结: |-',
  '  line one',
  '  line two',
  'cover: "[[Notion/work-notes/project-a/assets/tiny.png]]"',
  '---',
  '',
  '# First line belongs to the body',
  '',
  'Project A keeps **bold** text.',
  '',
  'See [[review]] and [Review file](../project-b/review.md).',
  '',
  '![[Notion/work-notes/project-a/assets/tiny.png]]',
  '',
  '![tiny](./assets/tiny.png)'
].join('\n'));
await writeFile(join(folder, 'project-b', 'review.md'), [
  '---',
  'tags: [review]',
  '---',
  '',
  '## Review body',
  '',
  '- nested folder import',
  '- keeps hierarchy'
].join('\n'));
await writeFile(
  join(folder, 'project-a', 'assets', 'tiny.png'),
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lY+0NwAAAABJRU5ErkJggg==', 'base64')
);

for (let index = 0; index < 85; index += 1) {
  await writeFile(join(largeFolder, 'group', `note-${String(index).padStart(2, '0')}.md`), `# Note ${index}\n\nLarge import body ${index}.`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173/';

await page.goto(appUrl);
await page.evaluate(() => localStorage.clear());
await page.reload();

const folderInput = page.locator('input[webkitdirectory]').first();
await folderInput.setInputFiles(folder);
await page.locator('.import-notice.success').waitFor({ state: 'visible' });
await page.waitForFunction(() => {
  const storedState = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return Array.isArray(storedState.blocks) && storedState.blocks.length >= 2;
});

const pageTreeText = await page.locator('.page-tree').innerText();
const pageHtml = await page.locator('.page-surface').evaluate((node) => node.innerHTML);
const importNoticeText = await page.locator('.import-notice').innerText();
const storedState = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const activeNotebook = storedState.notebooks?.find((notebook) => notebook.id === storedState.activeNotebookId);
const projectAPage = storedState.pages?.find((storedPage) => storedPage.title === 'project-a');
const projectBPage = storedState.pages?.find((storedPage) => storedPage.title === 'project-b');
const dayPage = storedState.pages?.find((storedPage) => storedPage.title === 'day');
const reviewPage = storedState.pages?.find((storedPage) => storedPage.title === 'review');
const dayBlock = storedState.blocks?.find((block) => dayPage?.blockIds?.includes(block.id));
const reviewBlock = storedState.blocks?.find((block) => reviewPage?.blockIds?.includes(block.id));

const checks = {
  notebookName: activeNotebook?.name === 'work-notes',
  pageTree: pageTreeText.includes('project-a') && pageTreeText.includes('project-b') && pageTreeText.includes('day') && pageTreeText.includes('review'),
  documentsImported: dayBlock?.content?.plainText?.includes('First line belongs to the body') && reviewBlock?.content?.plainText?.includes('Review body'),
  folderParents: dayPage?.parentId === projectAPage?.id && reviewPage?.parentId === projectBPage?.id,
  filenameTitle: dayPage?.title === 'day' && !storedState.pages?.some((storedPage) => storedPage.title === 'First line belongs to the body'),
  sourceFilename: dayPage?.metadata?.sourceFilename === 'project-a/day.md' && reviewPage?.metadata?.sourceFilename === 'project-b/review.md',
  notionMetadata: dayPage?.metadata?.date === '2026-06-17T09:30:00' && dayPage?.metadata?.tags?.includes('notion') && dayPage?.metadata?.status === '✅✅' && dayPage?.metadata?.frontmatter?.评分 === '★★★★' && dayPage?.metadata?.frontmatter?.类型 === 'TV Series' && dayPage?.metadata?.frontmatter?.总结 === 'line one\nline two' && dayPage?.metadata?.frontmatterRaw?.includes('cover: "[[Notion/work-notes/project-a/assets/tiny.png]]"'),
  relativeImageReference: dayBlock?.content?.html?.includes('src="./assets/tiny.png"') || dayBlock?.content?.html?.includes('src="assets/tiny.png"') || pageHtml.includes('src="./assets/tiny.png"') || pageHtml.includes('src="assets/tiny.png"'),
  notionWikiImage: dayBlock?.content?.html?.includes('src="Notion/work-notes/project-a/assets/tiny.png"'),
  pageLinks: dayBlock?.content?.html?.includes(`href="page:${reviewPage?.id}"`) && dayBlock?.content?.html?.includes(`data-page-id="${reviewPage?.id}"`),
  noDataUrlImage: !dayBlock?.content?.html?.includes('src="data:image/png;base64,') && !pageHtml.includes('src="data:image/png;base64,'),
  notice: importNoticeText.includes('Imported folder "work-notes" with 4 pages and 2 blocks')
};

await page.evaluate(() => localStorage.clear());
await page.reload();
await page.locator('input[webkitdirectory]').first().setInputFiles(largeFolder);
await page.locator('.import-notice.success').waitFor({ state: 'visible' });
const largeImportState = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const largeNotebook = largeImportState.notebooks?.find((notebook) => notebook.id === largeImportState.activeNotebookId);
const largePages = largeImportState.pages?.filter((storedPage) => storedPage.notebookId === largeNotebook?.id) ?? [];
checks.largeImportImportedAllPages = largePages.length === 86;
checks.largeImportDoesNotExpandEverything = largePages.filter((storedPage) => largeImportState.expandedPageIds?.includes(storedPage.id)).length < largePages.length;

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
