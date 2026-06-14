import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
await writeFile('/tmp/notebook-at-test.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  permissions: ['clipboard-read', 'clipboard-write']
});
const page = await context.newPage();
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const resetApp = async () => {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.composer').last().waitFor({ state: 'visible' });
};

await page.goto(appUrl);
await resetApp();

const composer = page.locator('.composer').last();
await composer.click();
await composer.evaluate((element) => {
  element.innerHTML = [
    '<h1 class="md-heading md-end-block" data-heading-level="1">Heading smoke Title</h1>',
    '<ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">Nested parent</p><ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">Nested child</p></li></ul></li></ul>',
    '<ul class="contains-task-list md-list" data-type="taskList"><li data-checked="false" data-type="taskItem" class="task-list-item md-task-list-item md-end-block" data-list-collapsed="false" data-todo-style="plain"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p class="md-end-block">todo item</p></div></li></ul>',
    '<p class="md-end-block"><mark>marked</mark> <code>inline</code></p>',
    '<pre class="md-fences md-end-block"><code>const a = 1;</code></pre>'
  ].join('');
});

const html = await composer.evaluate((node) => node.innerHTML);
const checks = {
  heading: html.includes('<h1'),
  bullet: html.includes('<ul') && html.includes('<li'),
  task: html.includes('data-type="taskList"') && html.includes('data-checked="false"'),
  plainTodo: html.includes('data-todo-style="plain"') && html.includes('todo item'),
  highlight: html.includes('<mark'),
  inlineCode: html.includes('<code>inline</code>'),
  codeBlock: await composer.locator('pre.md-fences code').count() > 0
};

await resetApp();
const freshComposer = page.locator('.composer').last();
await freshComposer.click();
await page.keyboard.type('【】 中文 todo');
const cnTodoHtml = await freshComposer.evaluate((node) => node.innerHTML);
checks.cnTodo = cnTodoHtml.includes('data-type="taskList"') && cnTodoHtml.includes('data-todo-style="bracket"') && cnTodoHtml.includes('中文 todo');
checks.cnTodoHighlightWrapsCheckbox = await freshComposer.evaluate((node) => {
  const item = node.querySelector('li[data-todo-style="bracket"]');
  const checkbox = item?.querySelector('input[type="checkbox"]');
  const paragraph = item?.querySelector('p');
  if (!(item instanceof HTMLElement) || !(checkbox instanceof HTMLElement) || !(paragraph instanceof HTMLElement)) return false;
  const itemStyles = getComputedStyle(item);
  const itemRect = item.getBoundingClientRect();
  const checkboxRect = checkbox.getBoundingClientRect();
  const paragraphRect = paragraph.getBoundingClientRect();
  return itemStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    checkboxRect.left >= itemRect.left &&
    checkboxRect.right <= itemRect.right &&
    paragraphRect.left >= itemRect.left &&
    paragraphRect.right <= itemRect.right;
});

await resetApp();
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

await resetApp();
const markdownPasteComposer = page.locator('.composer').last();
await markdownPasteComposer.click();
await page.evaluate(() => navigator.clipboard.writeText('**bold paste**\n\n- first\n- second'));
await page.keyboard.press(`${modKey}+V`);
const markdownPasteHtml = await markdownPasteComposer.evaluate((node) => node.innerHTML);
checks.markdownPasteKeepsStructure = markdownPasteHtml.includes('<strong>bold paste</strong>') &&
  markdownPasteHtml.includes('<ul') &&
  markdownPasteHtml.includes('first') &&
  markdownPasteHtml.includes('second');

await resetApp();
const greenPasteComposer = page.locator('.composer').last();
await greenPasteComposer.click();
await page.evaluate(async () => {
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob(['<span style="color: rgb(0, 180, 80)">green terminal text</span>'], { type: 'text/html' }),
      'text/plain': new Blob(['green terminal text'], { type: 'text/plain' })
    })
  ]);
});
await page.keyboard.press(`${modKey}+V`);
const greenPasteHtml = await greenPasteComposer.evaluate((node) => node.innerHTML);
checks.greenHtmlPasteBecomesHighlight = greenPasteHtml.includes('<mark>green terminal text</mark>');

await resetApp();
const ansiPasteComposer = page.locator('.composer').last();
await ansiPasteComposer.click();
await ansiPasteComposer.evaluate((node) => {
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', '\u001b[32mansi green\u001b[0m');
  node.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData,
    bubbles: true,
    cancelable: true
  }));
});
const ansiPasteHtml = await ansiPasteComposer.evaluate((node) => node.innerHTML);
checks.ansiGreenPasteBecomesHighlight = ansiPasteHtml.includes('<mark>ansi green</mark>');

await resetApp();
const markComposer = page.locator('.composer').last();
await markComposer.click();
await page.keyboard.type('styled marks');
await page.keyboard.press(`${modKey}+A`);
await page.locator('.format-toolbar .tool-button[title="Underline"]').click();
await page.locator('.format-toolbar .tool-button[title="Strikethrough"]').click();
const markHtml = await markComposer.evaluate((node) => node.innerHTML);
checks.underline = markHtml.includes('<u>styled marks</u>');
checks.strike = markHtml.includes('<s>') && markHtml.includes('styled marks');
checks.semanticToolbarButtons = await page.locator('.format-toolbar').evaluate((toolbar) => {
  const requiredTitles = [
    'Keyboard key',
    'Quote',
    'Table',
    'Inline math',
    'Block math',
    'Footnote',
    'Attachment'
  ];
  const removedTitles = [
    'Link',
    'Add table row',
    'Add table column',
    'Delete table row',
    'Delete table column',
    'Horizontal rule',
    'Image',
    'Video',
    'Audio',
    'Embed'
  ];
  return requiredTitles.every((title) => toolbar.querySelector(`button[title="${title}"]`)) &&
    removedTitles.every((title) => !toolbar.querySelector(`button[title="${title}"]`));
});

await resetApp();
const inputRulesComposer = page.locator('.composer').last();
await inputRulesComposer.click();
await page.keyboard.type('~underlined~');
await page.keyboard.press('Enter');
await page.keyboard.type('$a+b$');
await page.keyboard.press('Enter');
await page.keyboard.type('> ');
await page.keyboard.type('quoted');
await page.keyboard.press('Enter');
await page.keyboard.type('/table ');
await page.waitForFunction(() => document.querySelector('.composer table'));
let inputRulesHtml = await inputRulesComposer.evaluate((node) => node.innerHTML);
checks.underlineInputRule = inputRulesHtml.includes('<u>underlined</u>');
checks.inlineMathInputRule = inputRulesHtml.includes('data-type="inline-math"') && inputRulesHtml.includes('data-latex="a+b"');
checks.quoteInputRule = inputRulesHtml.includes('<blockquote') && inputRulesHtml.includes('quoted');
checks.tableInputRule = inputRulesHtml.includes('<table');
checks.tableControlsAppearInTable = await page.locator('.table-controls').evaluate((controls) => {
  const requiredTitles = ['Add row', 'Add column', 'Delete selected row', 'Delete selected column'];
  const text = controls.textContent ?? '';
  return requiredTitles.every((title) => controls.querySelector(`button[title="${title}"]`)) &&
    text.includes('- row') &&
    text.includes('- col');
});

await resetApp();
const strikeInputComposer = page.locator('.composer').last();
await strikeInputComposer.click();
await page.keyboard.type('> ');
await page.keyboard.type('~~非服务~~');
inputRulesHtml = await strikeInputComposer.evaluate((node) => node.innerHTML);
checks.strikeInputRuleSurvivesUnderlineRule = inputRulesHtml.includes('<blockquote') &&
  inputRulesHtml.includes('<s>非服务</s>') &&
  !inputRulesHtml.includes('<u>非服务</u>');

await resetApp();
await page.evaluate(() => {
  window.prompt = () => 'https://example.com/embed';
});
const embeddedLinkComposer = page.locator('.composer').last();
await embeddedLinkComposer.click();
await page.keyboard.type('/link ');
inputRulesHtml = await embeddedLinkComposer.evaluate((node) => node.innerHTML);
checks.embeddedLinkInputRule = inputRulesHtml.includes('iframe') && inputRulesHtml.includes('https://example.com/embed');

await resetApp();
const mathBlockComposer = page.locator('.composer').last();
await mathBlockComposer.click();
await page.keyboard.type('/math');
await page.keyboard.press('Enter');
inputRulesHtml = await mathBlockComposer.evaluate((node) => node.innerHTML);
checks.mathBlockEnterRule = inputRulesHtml.includes('data-type="block-math"') || inputRulesHtml.includes('md-math-block');

await resetApp();
const aliasComposer = page.locator('.composer').last();
await aliasComposer.click();
await page.keyboard.type('[[[ ');
let aliasHtml = await aliasComposer.evaluate((node) => node.innerHTML);
checks.tableTripleBracketInputRule = aliasHtml.includes('<table');
await resetApp();
const mathDollarComposer = page.locator('.composer').last();
await mathDollarComposer.click();
await page.keyboard.type('$$ ');
aliasHtml = await mathDollarComposer.evaluate((node) => node.innerHTML);
checks.mathBlockDollarInputRule = aliasHtml.includes('data-type="block-math"') || aliasHtml.includes('md-math-block');

await resetApp();
const attachmentComposer = page.locator('.composer').last();
await attachmentComposer.click();
const chooserPromise = page.waitForEvent('filechooser');
await page.keyboard.type('/at ');
const chooser = await chooserPromise;
await chooser.setFiles('/tmp/notebook-at-test.png');
await page.waitForFunction(() => Boolean(document.querySelector('.composer img')));
aliasHtml = await attachmentComposer.evaluate((node) => node.innerHTML);
checks.attachmentShortcutInsertsImage = aliasHtml.includes('<img') && aliasHtml.includes('notebook-at-test.png');

await resetApp();
const listComposer = page.locator('.composer').last();
await page.locator('.content-theme-select').selectOption('typora-swiss');
await listComposer.click();
await page.keyboard.type('[] first task');
await page.keyboard.press('Enter');
await page.keyboard.type('second task');
let listHtml = await listComposer.evaluate((node) => node.innerHTML);
checks.continuousTodoEntry = (listHtml.match(/data-type="taskItem"/g) ?? []).length >= 2 && listHtml.includes('first task') && listHtml.includes('second task');

await resetApp();
const bulletComposer = page.locator('.composer').last();
await page.locator('.content-theme-select').selectOption('typora-swiss');
await bulletComposer.click();
await page.locator('.format-toolbar .tool-button[title="Bullet list"]').click();
await page.keyboard.type('parent');
await page.keyboard.press('Enter');
await page.keyboard.type('child');
await page.locator('.format-toolbar .tool-button[title="Indent: Tab"]').click();
listHtml = await bulletComposer.evaluate((node) => node.innerHTML);
checks.toolbarIndentInSwiss = listHtml.includes('<ul') && listHtml.includes('<ul') && listHtml.includes('child');
await page.locator('.format-toolbar .tool-button[title="Outdent: Shift Tab"]').click();
checks.toolbarOutdentInSwiss = await bulletComposer.evaluate((node) => {
  const html = node.innerHTML;
  return html.includes('child') && (html.match(/<ul/g) ?? []).length === 1;
});

await resetApp();
const enterComposer = page.locator('.composer').last();
await enterComposer.click();
await page.keyboard.type('abcde');
const editableBlockCount = await page.locator('.block-content.editable').count();
await page.keyboard.press('Shift+Enter');
await page.waitForFunction((count) => document.querySelectorAll('.block-content.editable').length > count, editableBlockCount);
const nextEditableBlockCount = await page.locator('.block-content.editable').count();
const firstBlock = page.locator('.block-content.editable').nth(nextEditableBlockCount - 1);
await firstBlock.click();
await page.keyboard.press(`${modKey}+A`);
await page.keyboard.type('abcde');
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowLeft');
await page.waitForFunction(() => {
  const selection = window.getSelection();
  return selection?.anchorNode?.textContent === 'abcde' && selection.anchorOffset === 3;
});
await page.waitForTimeout(80);
await page.keyboard.press('Enter');
checks.enterAtCaret = await firstBlock.evaluate((node) => {
  const paragraphs = [...node.querySelectorAll('p')].map((paragraph) => paragraph.textContent);
  return paragraphs[0] === 'abc' && paragraphs[1] === 'de';
});

await resetApp();
const collapseComposer = page.locator('.composer').last();
await collapseComposer.click();
await collapseComposer.evaluate((element) => {
  element.innerHTML = '<ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">parent</p><ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">child</p></li></ul></li></ul>';
});
const parentListItemBox = await collapseComposer.locator('li:has(ul), li:has(ol)').first().boundingBox();
if (parentListItemBox) {
  await page.mouse.click(parentListItemBox.x + 8, parentListItemBox.y + 8);
}
const collapsedHtml = await collapseComposer.evaluate((node) => node.innerHTML);
checks.persistedListCollapse = collapsedHtml.includes('data-list-collapsed="true"');

await resetApp();
await page.evaluate(() => {
  window.confirm = () => true;
});
await page.getByLabel('New page').click();
await page.locator('.page-title').fill('Parent ops');
await page.getByLabel('New page').click();
await page.locator('.page-title').fill('Child ops');
const childButton = page.getByRole('button', { name: /Child ops/ }).first();
await childButton.focus();
await page.keyboard.press('Shift+Tab');
await childButton.focus();
await page.keyboard.press('Tab');
await page.getByLabel('Duplicate page Parent ops').click();
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return state.pages?.some((storedPage) => storedPage.title === 'Parent ops copy');
});
const stateAfterPageCopy = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const parentCopy = stateAfterPageCopy.pages.find((storedPage) => storedPage.title === 'Parent ops copy');
const childCopy = stateAfterPageCopy.pages.find((storedPage) => storedPage.title === 'Child ops' && storedPage.parentId === parentCopy?.id);
checks.pageTreeDuplicate = Boolean(parentCopy && childCopy);
await page.evaluate(() => {
  window.confirm = () => true;
});
await page.getByLabel('Delete page Parent ops copy').click();
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return !state.pages?.some((storedPage) => storedPage.title === 'Parent ops copy');
});
const stateAfterPageDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.pageTreeDelete = !stateAfterPageDelete.pages.some((storedPage) => storedPage.title === 'Parent ops copy') &&
  stateAfterPageDelete.pages.some((storedPage) => storedPage.title === 'Parent ops');

await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  const child = state.pages?.find((storedPage) => storedPage.title === 'Child ops');
  if (child) {
    state.activeNotebookId = child.notebookId;
    state.activePageId = child.id;
    localStorage.setItem('block-first-notebook.state.v1', JSON.stringify(state));
  }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.page-title').waitFor({ state: 'visible' });
await page.getByRole('button', { name: /^Child ops$/ }).first().click();
await page.locator('.composer').last().click();
await page.keyboard.type('copy delete body');
await page.keyboard.press('Shift+Enter');
await page.getByLabel('Duplicate page Child ops').click();
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return state.pages?.filter((storedPage) => storedPage.title === 'Child ops copy').length === 1;
});
const stateAfterBlockPageCopy = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const childPageCopy = stateAfterBlockPageCopy.pages.find((storedPage) => storedPage.title === 'Child ops copy');
const copiedBlock = stateAfterBlockPageCopy.blocks.find((block) => childPageCopy?.blockIds?.includes(block.id));
checks.pageDuplicateCopiesBlocks = Boolean(copiedBlock?.content?.plainText?.includes('copy delete body'));
await page.evaluate(() => {
  window.confirm = () => true;
});
await page.getByLabel('Delete page Child ops copy').click();
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return !state.pages?.some((storedPage) => storedPage.title === 'Child ops copy');
});
const stateAfterBlockPageDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.pageDeleteRemovesBlocks = !stateAfterBlockPageDelete.blocks.some((block) => block.id === copiedBlock?.id);

await page.getByLabel('Duplicate notebook Notebook').click();
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return state.notebooks?.some((notebook) => notebook.name === 'Notebook copy');
});
const stateAfterNotebookCopy = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const notebookCopy = stateAfterNotebookCopy.notebooks.find((notebook) => notebook.name === 'Notebook copy');
checks.notebookDuplicate = Boolean(notebookCopy && notebookCopy.pageIds.length >= 2 && stateAfterNotebookCopy.pages.some((storedPage) => storedPage.notebookId === notebookCopy.id && storedPage.title === 'Parent ops'));
await page.evaluate(() => {
  window.confirm = () => true;
});
await page.getByLabel('Delete notebook Notebook copy').click();
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return !state.notebooks?.some((notebook) => notebook.name === 'Notebook copy');
});
const stateAfterNotebookDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.notebookDelete = !stateAfterNotebookDelete.notebooks.some((notebook) => notebook.name === 'Notebook copy') &&
  stateAfterNotebookDelete.pages.every((storedPage) => storedPage.notebookId !== notebookCopy?.id) &&
  stateAfterNotebookDelete.notebooks.some((notebook) => notebook.id === stateAfterNotebookDelete.activeNotebookId) &&
  stateAfterNotebookDelete.pages.some((storedPage) => storedPage.id === stateAfterNotebookDelete.activePageId);

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
