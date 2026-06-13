import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const markdownPath = join(tmpdir(), `notebook-import-${Date.now()}.md`);
await writeFile(markdownPath, [
  '# Imported Smoke',
  '',
  'A paragraph with **bold**, *italic*, ==mark==, `inline`, and [link](https://example.com).',
  '',
  '![diagram](https://example.com/diagram.png)',
  '',
  '- first bullet',
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
const blockCount = await page.locator('.block').count();

const checks = {
  title: pageTitle === 'Imported Smoke',
  singleBlock: blockCount === 1,
  pageTree: pageTreeText.includes('Imported Smoke'),
  paragraph: pageText.includes('A paragraph with bold'),
  bullet: pageHtml.includes('<ul') && pageText.includes('first bullet'),
  task: pageHtml.includes('data-type="taskList"') && pageHtml.includes('open task') && pageHtml.includes('done task'),
  table: pageHtml.includes('<table') && pageText.includes('table row') && pageText.includes('42'),
  link: pageHtml.includes('href="https://example.com"'),
  image: pageHtml.includes('src="https://example.com/diagram.png"') && pageHtml.includes('alt="diagram"'),
  inlineCode: pageHtml.includes('<code>inline</code>'),
  highlight: pageHtml.includes('<mark'),
  codeBlock: pageHtml.includes('<pre><code>') && pageText.includes('const imported = true;'),
  indentedFence: pageHtml.includes('┌────┬────┐') && !pageText.includes('```')
};

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
