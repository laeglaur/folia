import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const markdownPath = join(tmpdir(), `notebook-import-${Date.now()}.md`);
await writeFile(markdownPath, [
  '---',
  'title: Frontmatter Smoke',
  'tags: [travel, literature]',
  'date: 2026-05-02',
  'status: draft',
  'aliases:',
  '  - Hengdian notes',
  '  - Qin palace',
  '---',
  '',
  '# Imported Smoke',
  '',
  '## Section Smoke',
  '',
  '### Detail Smoke',
  '',
  'A paragraph with **bold**, *italic*, ~~strike~~, ==mark==, `inline`, and [link](https://example.com).',
  '',
  '> A quote that Typora themes should be able to shape.',
  '',
  '---',
  '',
  '![diagram](https://example.com/diagram.png)',
  '',
  'https://example.com/sample.mp4',
  '',
  'https://example.com/audio.m4a',
  '',
  '[Demo video](https://youtu.be/dQw4w9WgXcQ)',
  '',
  '- first bullet',
  '  - nested bullet',
  '- second bullet',
  '',
  '- [ ] open task',
  '- [x] done task',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| table row | 42 |',
  '',
  '```',
  'const imported = true;',
  '```',
  '',
  '  ```',
  '  ┌────┬────┐',
  '  │ P0 │ OK │',
  '  └────┴────┘',
  '  ```'
].join('\n'));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('http://127.0.0.1:5173/');
await page.evaluate(() => localStorage.clear());
await page.reload();

await page.locator('input[type="file"]').setInputFiles(markdownPath);
await page.locator('.page-title').waitFor({ state: 'visible' });

const pageTitle = await page.locator('.page-title').inputValue();
const pageTreeText = await page.locator('.page-tree').innerText();
const pageText = await page.locator('.page-surface').innerText();
const pageHtml = await page.locator('.page-surface').evaluate((node) => node.innerHTML);
const outlineText = await page.locator('.outline-list').innerText();
const importNoticeText = await page.locator('.import-notice').innerText();
const importNoticeClass = await page.locator('.import-notice').getAttribute('class');
const metadataText = await page.locator('.page-metadata').innerText();
const blockCount = await page.locator('.block').count();
const storedState = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const storedPage = storedState.pages?.find((storedPage) => storedPage.id === storedState.activePageId);

const checks = {
  title: pageTitle === 'Frontmatter Smoke',
  singleBlock: blockCount === 1,
  pageTree: pageTreeText.includes('Frontmatter Smoke'),
  outline: outlineText.includes('Frontmatter Smoke') && outlineText.includes('Section Smoke') && outlineText.includes('Detail Smoke'),
  frontmatterHidden: !pageText.includes('title: Frontmatter Smoke') && !pageText.includes('tags: [travel, literature]') && !pageText.includes('aliases:'),
  metadataUi: metadataText.includes('2026-05-02') && metadataText.includes('draft') && metadataText.includes('#travel') && metadataText.includes('#literature') && metadataText.includes('Hengdian notes') && metadataText.includes('Qin palace'),
  metadataState: storedPage?.metadata?.sourceFilename?.endsWith('.md') && storedPage.metadata.tags.includes('travel') && storedPage.metadata.tags.includes('literature') && storedPage.metadata.date === '2026-05-02' && storedPage.metadata.status === 'draft' && storedPage.metadata.aliases.includes('Hengdian notes') && storedPage.metadata.frontmatter.title === 'Frontmatter Smoke',
  paragraph: pageText.includes('A paragraph with bold'),
  bullet: pageHtml.includes('<ul') && pageText.includes('first bullet'),
  nestedBullet: pageHtml.includes('<ul') && pageText.includes('nested bullet'),
  blockquote: pageHtml.includes('<blockquote') && pageText.includes('A quote that Typora themes should be able to shape.'),
  horizontalRule: pageHtml.includes('<hr'),
  strike: pageHtml.includes('<s>strike</s>') || pageHtml.includes('<del>strike</del>'),
  task: pageHtml.includes('data-type="taskList"') && pageHtml.includes('open task') && pageHtml.includes('done task'),
  table: pageHtml.includes('<table') && pageText.includes('table row') && pageText.includes('42'),
  link: pageHtml.includes('href="https://example.com"'),
  image: pageHtml.includes('src="https://example.com/diagram.png"') && pageHtml.includes('alt="diagram"'),
  video: pageHtml.includes('<video') && pageHtml.includes('src="https://example.com/sample.mp4"'),
  audio: pageHtml.includes('<audio') && pageHtml.includes('src="https://example.com/audio.m4a"'),
  embed: pageHtml.includes('<iframe') && pageHtml.includes('https://www.youtube.com/embed/dQw4w9WgXcQ'),
  inlineCode: pageHtml.includes('<code>inline</code>'),
  highlight: pageHtml.includes('<mark'),
  codeBlock: pageHtml.includes('<pre><code>') && pageText.includes('const imported = true;'),
  indentedFence: pageHtml.includes('┌────┬────┐') && !pageText.includes('```'),
  importNotice: importNoticeClass?.includes('success') && importNoticeText.includes('Imported 1 page with 1 block')
};

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
