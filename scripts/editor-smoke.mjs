import { chromium } from '@playwright/test';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  permissions: ['clipboard-read', 'clipboard-write']
});
const page = await context.newPage();

await page.goto('http://127.0.0.1:5173/');
await page.evaluate(() => localStorage.clear());
await page.reload();

const composer = page.locator('.composer').last();
await composer.click();
await page.keyboard.type('# Heading smoke');
await page.keyboard.press('Space');
await page.keyboard.type('Title');
await page.keyboard.press('Enter');
await page.keyboard.type('- Nested parent');
await page.keyboard.press('Enter');
await page.keyboard.press('Tab');
await page.keyboard.type('Nested child');
await page.keyboard.press('Enter');
await page.keyboard.press('Shift+Tab');
await page.keyboard.type('[] todo item');
await page.keyboard.press('Enter');
await page.keyboard.type('【】 cn todo item');
await page.keyboard.press('Enter');
await page.keyboard.type('==marked== ');
await page.keyboard.type('`inline` ');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.type('```');
await page.keyboard.press('Enter');
await page.keyboard.type('const a = 1;');

const html = await composer.evaluate((node) => node.innerHTML);
const checks = {
  heading: html.includes('<h1'),
  bullet: html.includes('<ul') && html.includes('<li'),
  task: html.includes('data-type="taskList"') && html.includes('data-checked="false"'),
  highlight: html.includes('<mark'),
  inlineCode: html.includes('<code>inline</code>'),
  codeBlock: html.includes('<pre><code>') || html.includes('<pre><code class=')
};

await page.evaluate(() => localStorage.clear());
await page.reload();
const freshComposer = page.locator('.composer').last();
await freshComposer.click();
await page.keyboard.type('【】 中文 todo');
const cnTodoHtml = await freshComposer.evaluate((node) => node.innerHTML);
checks.cnTodo = cnTodoHtml.includes('data-type="taskList"') && cnTodoHtml.includes('中文 todo');

await page.evaluate(() => localStorage.clear());
await page.reload();
const commandComposer = page.locator('.composer').last();
await commandComposer.click();
await page.keyboard.type('toggle copy paste');
await page.keyboard.press(`${modKey}+A`);
await page.keyboard.press(`${modKey}+H`);
let commandHtml = await commandComposer.evaluate((node) => node.innerHTML);
const highlightedByCommand = commandHtml.includes('<mark');
await page.keyboard.press(`${modKey}+H`);
commandHtml = await commandComposer.evaluate((node) => node.innerHTML);
checks.commandHighlightToggle = highlightedByCommand && !commandHtml.includes('<mark');
await page.keyboard.press(`${modKey}+A`);
await page.keyboard.press(`${modKey}+C`);
const clipboardText = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Enter');
await page.evaluate(() => navigator.clipboard.writeText('toggle copy paste'));
await page.keyboard.press(`${modKey}+V`);
const copiedText = await commandComposer.innerText();
checks.copyPaste = clipboardText === 'toggle copy paste' && copiedText.includes('toggle copy paste');

await page.evaluate(() => localStorage.clear());
await page.reload();
const enterComposer = page.locator('.composer').last();
await enterComposer.click();
await page.keyboard.type('abcde');
await page.keyboard.press('Shift+Enter');
const firstBlock = page.locator('.block-content').first();
await firstBlock.click();
await page.keyboard.press(`${modKey}+A`);
await page.keyboard.type('abcde');
await firstBlock.evaluate((node) => {
  const textNode = node.querySelector('.ProseMirror p')?.firstChild;
  if (!textNode) return;
  const range = document.createRange();
  range.setStart(textNode, 3);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
});
await page.keyboard.press('Enter');
const enteredText = await firstBlock.innerText();
checks.enterAtCaret = /abc\s+de/.test(enteredText);

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
