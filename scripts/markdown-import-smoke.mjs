import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const markdownPath = join(tmpdir(), `filename-title-smoke-${Date.now()}.md`);
const expectedTitle = markdownPath.match(/([^/]+)\.md$/)?.[1] ?? 'filename-title-smoke';
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
  'Use <kbd>Cmd</kbd> + <kbd>K</kbd> to test keyboard key styling.',
  '',
  'A sentence with a footnote.[^note]',
  '',
  'Inline math: $E = mc^2$ should render.',
  '',
  '> A quote that Typora themes should be able to shape.',
  '',
  '> [!WARNING]',
  '> A warning callout imported from Markdown.',
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
  '$$',
  '\\int_0^1 x^2 dx',
  '$$',
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
  '  ```',
  '',
  '[^note]: Footnote content with **bold** text.'
].join('\n'));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173/';

await page.goto(appUrl);
await page.evaluate(() => localStorage.clear());
await page.reload();

await page.locator('input[type="file"]').setInputFiles(markdownPath);
await page.locator('.page-title').waitFor({ state: 'visible' });

const pageTitle = await page.locator('.page-title').inputValue();
const pageTreeText = await page.locator('.page-tree').innerText();
const pageText = await page.locator('.page-surface').innerText();
const pageHtml = await page.locator('.page-surface').evaluate((node) => node.innerHTML);
const outlineText = await page.locator('.outline-list').innerText();
const outlineSnapshot = await page.locator('.outline-entry').evaluateAll((entries) => entries.map((entry) => ({
  className: entry.className,
  level: (entry instanceof HTMLElement ? entry.style.getPropertyValue('--level') : '').trim(),
  text: entry.textContent ?? ''
})));
const importNoticeText = await page.locator('.import-notice').innerText();
const importNoticeClass = await page.locator('.import-notice').getAttribute('class');
const metadataText = await page.locator('.page-metadata').innerText();
const blockCount = await page.locator('.block').count();
const storedState = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const storedPage = storedState.pages?.find((storedPage) => storedPage.id === storedState.activePageId);
const storedBlock = storedState.blocks?.find((block) => block.id === storedPage?.blockIds?.[0]);
const hasNestedBulletDom = await page.locator('.page-surface li > ul li').evaluateAll((items) =>
  items.some((item) => item.textContent?.includes('nested bullet'))
);
const footnoteReferenceCount = await page.locator('.page-surface .md-footnote').count();
const footnoteDefinitionText = await page.locator('.page-surface .md-def-footnote').innerText();
const inlineMathCount = await page.locator('.page-surface [data-type="inline-math"]').count();
const blockMathCount = await page.locator('.page-surface [data-type="block-math"]').count();
const katexCount = await page.locator('.page-surface .katex').count();
const kbdCount = await page.locator('.page-surface kbd').count();
const alertCount = await page.locator('.page-surface .md-alert.md-alert-warning').count();
const codeFenceCount = await page.locator('.page-surface pre.md-fences code').count();
const hasBlockOutlineEntry = outlineSnapshot.some((entry) => entry.className.includes('outline-kind-block') && entry.text.includes('Imported Smoke') && entry.text.includes('Section Smoke'));
const hasHeadingOutlineEntry = outlineSnapshot.some((entry) => entry.className.includes('outline-kind-heading') && entry.text.includes('Section Smoke'));
const pageAndBlockArePeers = outlineSnapshot.some((entry) => entry.className.includes('outline-kind-page') && entry.level === '1') &&
  outlineSnapshot.some((entry) => entry.className.includes('outline-kind-block') && entry.level === '1');
const headingsNestUnderBlocks = outlineSnapshot.some((entry) => entry.className.includes('outline-kind-heading') && entry.text.includes('Imported Smoke') && entry.level === '2');

const checks = {
  title: pageTitle === expectedTitle,
  singleBlock: blockCount === 1,
  pageTree: pageTreeText.includes(expectedTitle),
  outline: outlineText.includes('Imported Smoke') && hasBlockOutlineEntry && hasHeadingOutlineEntry && pageAndBlockArePeers && headingsNestUnderBlocks && outlineText.includes('Detail Smoke') && outlineText.includes('first bullet'),
  frontmatterHidden: !pageText.includes('title: Frontmatter Smoke') && !pageText.includes('tags: [travel, literature]') && !pageText.includes('aliases:'),
  metadataUi: metadataText.includes('2026-05-02') && metadataText.includes('draft') && metadataText.includes('#travel') && metadataText.includes('#literature') && metadataText.includes('Hengdian notes') && metadataText.includes('Qin palace'),
  metadataState: storedPage?.metadata?.sourceFilename?.endsWith('.md') && storedPage.metadata.tags.includes('travel') && storedPage.metadata.tags.includes('literature') && storedPage.metadata.date === '2026-05-02' && storedPage.metadata.status === 'draft' && storedPage.metadata.aliases.includes('Hengdian notes') && storedPage.metadata.frontmatter.title === 'Frontmatter Smoke',
  paragraph: pageText.includes('Imported Smoke') && pageText.includes('A paragraph with bold'),
  footnote: footnoteReferenceCount === 1 && footnoteDefinitionText.includes('Footnote content with bold text') && storedBlock?.content?.html?.includes('data-type="footnotes"'),
  math: inlineMathCount === 1 && blockMathCount === 1 && katexCount >= 2 && storedBlock?.content?.html?.includes('data-latex="E = mc^2"') && storedBlock?.content?.html?.includes('data-latex="\\int_0^1 x^2 dx"'),
  bullet: pageHtml.includes('<ul') && pageText.includes('first bullet'),
  nestedBullet: hasNestedBulletDom,
  blockquote: pageHtml.includes('<blockquote') && pageText.includes('A quote that Typora themes should be able to shape.'),
  alert: alertCount === 1 && pageText.includes('A warning callout imported from Markdown.'),
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
  kbd: kbdCount === 2 && pageText.includes('Cmd') && pageText.includes('K'),
  highlight: pageHtml.includes('<mark'),
  codeBlock: codeFenceCount >= 1 && pageText.includes('const imported = true;'),
  indentedFence: pageHtml.includes('┌────┬────┐') && !pageText.includes('```'),
  importNotice: importNoticeClass?.includes('success') && importNoticeText.includes('Imported 1 page with 1 block')
};

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
