import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
await writeFile('/tmp/notebook-at-test.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dfe7ff"/><circle cx="245" cy="112" r="34" fill="#6f7fcf"/></svg>');
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
const chooseContentTheme = async (theme) => {
  await page.locator('.content-theme-select').first().evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, theme);
  await page.waitForFunction((expected) => document.documentElement.dataset.contentTheme === expected, theme);
};
const ensureToolbarVisible = async () => {
  await page.locator('.composer').last().click({ button: 'right' });
  await page.locator('.floating-format-toolbar .format-toolbar').waitFor({ state: 'visible' });
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
const orderedCopyComposer = page.locator('.composer').last();
await orderedCopyComposer.click();
await orderedCopyComposer.evaluate((element) => {
  element.innerHTML = '<ol><li><p>first numbered</p></li><li><p>second numbered</p></li></ol>';
});
await orderedCopyComposer.click();
await page.keyboard.press(`${modKey}+A`);
await page.keyboard.press(`${modKey}+C`);
const copiedOrdered = await page.evaluate(async () => {
  const text = await navigator.clipboard.readText().catch(() => '');
  const items = await navigator.clipboard.read().catch(() => []);
  const htmlItem = items.find((item) => item.types.includes('text/html'));
  const html = htmlItem ? await (await htmlItem.getType('text/html')).text() : '';
  return { text, html };
});
checks.externalCopyKeepsOrderedList = copiedOrdered.html.includes('<ol') &&
  copiedOrdered.html.includes('<li') &&
  /1\.?\s+first numbered/.test(copiedOrdered.text);

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
const chatgptCodePasteComposer = page.locator('.composer').last();
await chatgptCodePasteComposer.click();
await page.evaluate(async () => {
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([[
        '<p>Linux 程序运行时，很多函数并不是编译进可执行文件里的，而是来自动态库，例如：</p>',
        '<div class="overflow-y-auto p-4" data-testid="code-block">',
        '<div><button>Copy code</button></div>',
        '<pre><code>main()\n ├── printf()      ---&gt; libc.so\n ├── malloc()      ---&gt; libc.so\n ├── cudaLaunchKernel() ---&gt; libcudart.so\n └── cuLaunchKernel()   ---&gt; libcuda.so</code></pre>',
        '</div>',
        '<p>正常情况下：</p>'
      ].join('')], { type: 'text/html' }),
      'text/plain': new Blob([[
        'Linux 程序运行时，很多函数并不是编译进可执行文件里的，而是来自动态库，例如：\n\n',
        'main()\n ├── printf()      ---> libc.so\n ├── malloc()      ---> libc.so\n ├── cudaLaunchKernel() ---> libcudart.so\n └── cuLaunchKernel()   ---> libcuda.so\n\n',
        '正常情况下：'
      ].join('')], { type: 'text/plain' })
    })
  ]);
});
await page.keyboard.press(`${modKey}+V`);
const chatgptCodePaste = await chatgptCodePasteComposer.evaluate((node) => ({
  html: node.innerHTML,
  pres: [...node.querySelectorAll('pre')].map((pre) => pre.querySelector('code')?.textContent?.trim() ?? pre.textContent?.trim() ?? '')
}));
checks.chatgptCodePasteHasSingleNonEmptyCodeBlock = chatgptCodePaste.pres.length === 1 &&
  chatgptCodePaste.pres[0].includes('cudaLaunchKernel') &&
  !chatgptCodePaste.html.includes('Copy code') &&
  !chatgptCodePaste.pres.some((text) => !text || text === 'Empty code block');

await resetApp();
const assetIdPasteComposer = page.locator('.composer').last();
await assetIdPasteComposer.click();
await page.evaluate(async () => {
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob(['<img src="https://example.com/persist.png" data-asset-id="asset_smoke" data-original-src="/tmp/persist.png" data-width="50%">'], { type: 'text/html' }),
      'text/plain': new Blob(['persist image'], { type: 'text/plain' })
    })
  ]);
});
await page.keyboard.press(`${modKey}+V`);
const assetIdPasteHtml = await assetIdPasteComposer.evaluate((node) => node.innerHTML);
checks.mediaAssetAttributesSurviveEditor = assetIdPasteHtml.includes('data-asset-id="asset_smoke"') &&
  assetIdPasteHtml.includes('data-original-src="/tmp/persist.png"') &&
  assetIdPasteHtml.includes('data-width="50%"');

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
checks.greenHtmlPasteSanitizesWithoutHighlight = greenPasteHtml.includes('green terminal text') &&
  !greenPasteHtml.includes('<mark') &&
  !greenPasteHtml.includes('style=');

await resetApp();
const dirtySpanPasteComposer = page.locator('.composer').last();
await dirtySpanPasteComposer.click();
await page.evaluate(async () => {
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([
        '<span style="font-size: 16px; font-style: normal; font-variant-caps: normal; letter-spacing: normal; orphans: 2; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; text-decoration-line: none; color: oklch(0.693 0.17 162.479996); font-family: &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;; font-weight: 300; text-align: justify; background-color: rgb(255, 255, 255); float: none; display: inline !important;">clean pasted source</span>'
      ], { type: 'text/html' }),
      'text/plain': new Blob(['clean pasted source'], { type: 'text/plain' })
    })
  ]);
});
await page.keyboard.press(`${modKey}+V`);
const dirtySpanPasteHtml = await dirtySpanPasteComposer.evaluate((node) => node.innerHTML);
checks.dirtySpanPasteIsSanitized = dirtySpanPasteHtml.includes('clean pasted source') &&
  !/style=|font-family|oklch|PingFang|Microsoft YaHei/.test(dirtySpanPasteHtml);

await resetApp();
const bulkGreenPasteComposer = page.locator('.composer').last();
await bulkGreenPasteComposer.click();
await page.evaluate(async () => {
  const html = Array.from({ length: 5 }, (_, index) =>
    `<span style="color: rgb(0, 180, 80); font-family: &quot;PingFang SC&quot;;">green line ${index + 1}</span>`
  ).join('<br>');
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob(['green line 1\ngreen line 2\ngreen line 3\ngreen line 4\ngreen line 5'], { type: 'text/plain' })
    })
  ]);
});
await page.keyboard.press(`${modKey}+V`);
const bulkGreenPasteHtml = await bulkGreenPasteComposer.evaluate((node) => node.innerHTML);
checks.bulkGreenPasteSanitizesWithoutHighlight = bulkGreenPasteHtml.includes('green line 1') &&
  !bulkGreenPasteHtml.includes('<mark') &&
  !/style=|font-family|PingFang/.test(bulkGreenPasteHtml);

await resetApp();
const escapedMathPasteComposer = page.locator('.composer').last();
await escapedMathPasteComposer.click();
await page.evaluate(async () => {
  const text = [
    'The Timekeeper server and client library comprise &lt;math alttext="{\\sim}800" class="ltx_Math" display="inline" id="S5.p1.1.m1" style="font-variant-caps: normal; color: rgb(0, 0, 0);"&gt;&lt;semantics&gt;&lt;mrow&gt;&lt;mi&gt;&lt;/mi&gt;&lt;mo mathsize="0.900em"&gt;∼&lt;/mo&gt;&lt;mn mathsize="0.900em"&gt;800&lt;/mn&gt;&lt;/mrow&gt;&lt;/semantics&gt;&lt;/math&gt; lines of C++, with Python bindings for framework integration. ',
    'The device emulator adds &lt;math alttext="{\\sim}6000" class="ltx_Math" display="inline" id="S5.p1.2.m2" style="font-variant-caps: normal; color: rgb(0, 0, 0);"&gt;&lt;semantics&gt;&lt;mrow&gt;&lt;mi&gt;&lt;/mi&gt;&lt;mo mathsize="0.900em"&gt;∼&lt;/mo&gt;&lt;mn mathsize="0.900em"&gt;6000&lt;/mn&gt;&lt;/mrow&gt;&lt;/semantics&gt;&lt;/math&gt; lines of C++.'
  ].join('');
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/plain': new Blob([text], { type: 'text/plain' })
    })
  ]);
});
await page.keyboard.press(`${modKey}+V`);
await page.waitForFunction(() => document.querySelector('.composer')?.innerHTML.includes('data-type="inline-math"'));
const escapedMathPaste = await escapedMathPasteComposer.evaluate((node) => ({
  html: node.innerHTML,
  text: node.textContent ?? ''
}));
checks.escapedMathHtmlPasteIsDefuddled = escapedMathPaste.text.includes('800') &&
  escapedMathPaste.text.includes('6000') &&
  escapedMathPaste.html.includes('data-type="inline-math"') &&
  escapedMathPaste.html.includes('data-latex="{\\sim}800"') &&
  escapedMathPaste.html.includes('data-latex="{\\sim}6000"') &&
  !escapedMathPaste.html.includes('&lt;math') &&
  !/ltx_Math|font-variant-caps/.test(escapedMathPaste.html);

await resetApp();
const markComposer = page.locator('.composer').last();
await markComposer.click();
await page.keyboard.type('styled marks');
await page.keyboard.press(`${modKey}+A`);
await page.keyboard.press(`${modKey}+U`);
await page.keyboard.press(`${modKey}+D`);
const markHtml = await markComposer.evaluate((node) => node.innerHTML);
checks.underline = markHtml.includes('<u>styled marks</u>');
checks.strike = markHtml.includes('<s>') && markHtml.includes('styled marks');

await resetApp();
const strikeShortcutComposer = page.locator('.composer').last();
await strikeShortcutComposer.click();
await page.keyboard.type('shortcut strike');
await page.keyboard.press(`${modKey}+A`);
await page.keyboard.press(`${modKey}+D`);
const strikeShortcutHtml = await strikeShortcutComposer.evaluate((node) => node.innerHTML);
checks.strikeShortcut = strikeShortcutHtml.includes('<s>') && strikeShortcutHtml.includes('shortcut strike');

await ensureToolbarVisible();
checks.semanticToolbarButtons = await page.locator('.floating-format-toolbar .format-toolbar').evaluate((toolbar) => {
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
  const requiredTitles = ['Add row', 'Add column', 'Delete selected row', 'Delete selected column', 'Delete table'];
  const text = controls.textContent ?? '';
  return requiredTitles.every((title) => controls.querySelector(`button[title="${title}"]`)) &&
    text.includes('- row') &&
    text.includes('- col') &&
    text.includes('del');
});
await page.locator('.table-controls button[title="Delete table"]').click();
checks.tableControlDeletesWholeTable = await page.waitForFunction(() => !document.querySelector('.composer table')).then(() => true).catch(() => false);

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
await page.evaluate(() => {
  window.prompt = () => 'https://example.com/audio.mp3';
});
const audioLinkComposer = page.locator('.composer').last();
await audioLinkComposer.click();
await page.keyboard.type('/link ');
inputRulesHtml = await audioLinkComposer.evaluate((node) => node.innerHTML);
checks.linkInputRuleEmbedsAudio = inputRulesHtml.includes('<audio') && inputRulesHtml.includes('https://example.com/audio.mp3');

await resetApp();
await page.evaluate(() => {
  window.prompt = () => 'https://example.com/video.mp4';
});
const videoLinkComposer = page.locator('.composer').last();
await videoLinkComposer.click();
await page.keyboard.type('/link ');
inputRulesHtml = await videoLinkComposer.evaluate((node) => node.innerHTML);
checks.linkInputRuleEmbedsVideo = inputRulesHtml.includes('<video') && inputRulesHtml.includes('https://example.com/video.mp4');

await resetApp();
await page.evaluate(() => {
  window.prompt = () => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
});
const youtubeLinkComposer = page.locator('.composer').last();
await youtubeLinkComposer.click();
await page.keyboard.type('/link ');
inputRulesHtml = await youtubeLinkComposer.evaluate((node) => node.innerHTML);
checks.linkInputRuleEmbedsYoutube = inputRulesHtml.includes('<iframe') && inputRulesHtml.includes('youtube.com/embed/dQw4w9WgXcQ');

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
await page.locator('.math-block-editor input').waitFor({ state: 'visible' });
checks.mathBlockDollarEditorFocused = await page.locator('.math-block-editor input').evaluate((input) => document.activeElement === input);
await page.keyboard.type('E=mc^2');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelector('.composer')?.innerHTML.includes('data-latex="E=mc^2"'));
aliasHtml = await mathDollarComposer.evaluate((node) => node.innerHTML);
checks.mathBlockDollarInputRule = (aliasHtml.includes('data-type="block-math"') || aliasHtml.includes('md-math-block')) &&
  aliasHtml.includes('data-latex="E=mc^2"');

await resetApp();
const attachmentComposer = page.locator('.composer').last();
await attachmentComposer.click();
const chooserPromise = page.waitForEvent('filechooser');
await page.keyboard.type('/at ');
const chooser = await chooserPromise;
await chooser.setFiles('/tmp/notebook-at-test.svg');
await page.waitForFunction(() => Boolean(document.querySelector('.composer img')));
aliasHtml = await attachmentComposer.evaluate((node) => node.innerHTML);
checks.attachmentShortcutInsertsImage = aliasHtml.includes('<img') && aliasHtml.includes('notebook-at-test.svg');
await attachmentComposer.locator('img').scrollIntoViewIfNeeded();
const imageBox = await attachmentComposer.locator('img').boundingBox();
if (imageBox) {
  await page.mouse.move(imageBox.x + imageBox.width - 4, imageBox.y + imageBox.height - 4);
  checks.attachmentResizeCornerCursor = await attachmentComposer.locator('.annotated-image').evaluate((image) => getComputedStyle(image).cursor === 'nwse-resize');
  await page.mouse.down();
  await page.mouse.move(imageBox.x + imageBox.width - 170, imageBox.y + imageBox.height - 4, { steps: 5 });
  await page.mouse.up();
}
checks.attachmentResizePersistsWidth = await attachmentComposer.locator('img').evaluate((image) =>
  Number.parseFloat(image.getAttribute('data-width') ?? '100') < 100
);
await attachmentComposer.locator('img').click();
await page.keyboard.press('Tab');
await page.waitForFunction(() => document.querySelector('.composer img')?.getAttribute('data-indent') === '1');
checks.attachmentTabIndentsImage = await attachmentComposer.evaluate((node) => node.querySelector('img')?.getAttribute('data-indent') === '1');
await attachmentComposer.locator('img').click();
await page.keyboard.press('Shift+Tab');
await page.waitForFunction(() => !document.querySelector('.composer img')?.hasAttribute('data-indent'));
checks.attachmentShiftTabOutdentsImage = await attachmentComposer.evaluate((node) => !node.querySelector('img')?.hasAttribute('data-indent') && Boolean(node.querySelector('img')));

await resetApp();
const listComposer = page.locator('.composer').last();
await chooseContentTheme('typora-swiss');
await listComposer.click();
await page.keyboard.type('[] first task');
await page.keyboard.press('Enter');
await page.keyboard.type('second task');
let listHtml = await listComposer.evaluate((node) => node.innerHTML);
checks.continuousTodoEntry = (listHtml.match(/data-type="taskItem"/g) ?? []).length >= 2 && listHtml.includes('first task') && listHtml.includes('second task');

await resetApp();
const bulletComposer = page.locator('.composer').last();
await chooseContentTheme('typora-swiss');
await bulletComposer.click();
await ensureToolbarVisible();
await page.locator('.floating-format-toolbar .tool-button[title="Bullet list"]').click();
await page.keyboard.type('parent');
await page.keyboard.press('Enter');
await page.keyboard.type('child');
await ensureToolbarVisible();
await page.locator('.floating-format-toolbar .tool-button[title="Indent: Tab"]').click();
listHtml = await bulletComposer.evaluate((node) => node.innerHTML);
checks.toolbarIndentInSwiss = listHtml.includes('<ul') && listHtml.includes('<ul') && listHtml.includes('child');
await ensureToolbarVisible();
await page.locator('.floating-format-toolbar .tool-button[title="Outdent: Shift Tab"]').click();
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
await page.getByLabel('New page').click();
await page.locator('.page-title').fill('Parent ops');
await page.getByLabel('New page').click();
await page.locator('.page-title').fill('Child ops');
const childButton = page.getByRole('button', { name: /Child ops/ }).first();
await childButton.focus();
await page.keyboard.press('Shift+Tab');
await childButton.focus();
await page.keyboard.press('Tab');
await page.getByRole('button', { name: /^Parent ops$/ }).first().focus();
await page.keyboard.press(`${modKey}+C`);
await page.keyboard.press(`${modKey}+V`);
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return state.pages?.some((storedPage) => storedPage.title === 'Parent ops copy');
});
const stateAfterPageCopy = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const parentCopy = stateAfterPageCopy.pages.find((storedPage) => storedPage.title === 'Parent ops copy');
const childCopy = stateAfterPageCopy.pages.find((storedPage) => storedPage.title === 'Child ops' && storedPage.parentId === parentCopy?.id);
checks.pageTreeDuplicate = Boolean(parentCopy && childCopy);
await page.getByRole('button', { name: /^Parent ops copy$/ }).first().focus();
await page.keyboard.press('Delete');
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return !state.pages?.some((storedPage) => storedPage.title === 'Parent ops copy');
});
const stateAfterPageDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.pageTreeDelete = !stateAfterPageDelete.pages.some((storedPage) => storedPage.title === 'Parent ops copy') &&
  stateAfterPageDelete.pages.some((storedPage) => storedPage.title === 'Parent ops');
await page.getByLabel('New page').click();
await page.locator('.page-title').fill('Delete from selected row');
await page.getByRole('button', { name: /^Delete from selected row$/ }).first().click();
await page.locator('.workspace').click({ position: { x: 8, y: 8 } });
await page.keyboard.press('Backspace');
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return !state.pages?.some((storedPage) => storedPage.title === 'Delete from selected row');
});
const stateAfterSelectedPageBackspace = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.pageBackspaceDeletesSelectedPage = !stateAfterSelectedPageBackspace.pages.some((storedPage) => storedPage.title === 'Delete from selected row');
await page.getByLabel('New page').click();
await page.locator('.page-title').fill('Delete from icon');
await page.getByLabel('Delete page Delete from icon').click();
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return !state.pages?.some((storedPage) => storedPage.title === 'Delete from icon');
});
const stateAfterPageIconDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.pageIconDelete = !stateAfterPageIconDelete.pages.some((storedPage) => storedPage.title === 'Delete from icon');

await page.getByLabel('New page').click();
await page.locator('.page-title').fill('Page click rename source');
await page.getByRole('button', { name: /^Page click rename source$/ }).first().dblclick();
const pageRenameInput = page.getByLabel('Rename page Page click rename source').first();
await pageRenameInput.fill('Page click renamed');
await pageRenameInput.press('Enter');
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return state.pages?.some((storedPage) => storedPage.title === 'Page click renamed');
});
const stateAfterPageRename = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.pageDoubleClickRename = stateAfterPageRename.pages.some((storedPage) => storedPage.title === 'Page click renamed') &&
  stateAfterPageRename.operations.some((operation) => operation.kind === 'page.rename' && operation.payload?.title === 'Page click renamed');

await page.getByLabel('New page').click();
await page.locator('.page-title').fill('Draft cache first');
const draftCacheComposer = page.locator('.composer').last();
await draftCacheComposer.click();
await page.keyboard.type('unsaved composer draft');
await page.getByLabel('New page').click();
await page.locator('.page-title').fill('Draft cache second');
await page.getByRole('button', { name: /^Draft cache first$/ }).first().click();
await page.waitForFunction(() => document.querySelector('.composer')?.textContent?.includes('unsaved composer draft'));
checks.composerDraftSurvivesPageSwitch = (await page.locator('.composer').last().innerText()).includes('unsaved composer draft');

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
await page.getByRole('button', { name: /^Child ops$/ }).first().focus();
await page.keyboard.press(`${modKey}+C`);
await page.keyboard.press(`${modKey}+V`);
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return state.pages?.filter((storedPage) => storedPage.title === 'Child ops copy').length === 1;
});
const stateAfterBlockPageCopy = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const childPageCopy = stateAfterBlockPageCopy.pages.find((storedPage) => storedPage.title === 'Child ops copy');
const copiedBlock = stateAfterBlockPageCopy.blocks.find((block) => childPageCopy?.blockIds?.includes(block.id));
checks.pageDuplicateCopiesBlocks = Boolean(copiedBlock?.content?.plainText?.includes('copy delete body'));
await page.getByRole('button', { name: /^Child ops copy$/ }).first().focus();
await page.keyboard.press('Delete');
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return !state.pages?.some((storedPage) => storedPage.title === 'Child ops copy');
});
const stateAfterBlockPageDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.pageDeleteRemovesBlocks = !stateAfterBlockPageDelete.blocks.some((block) => block.id === copiedBlock?.id);

await page.getByRole('button', { name: /^Notebook$/ }).first().dblclick();
const renameInput = page.getByLabel('Rename notebook Notebook').first();
await renameInput.fill('Renamed notebook');
await renameInput.press('Enter');
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return state.notebooks?.some((notebook) => notebook.name === 'Renamed notebook');
});
const stateAfterNotebookRename = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.notebookRename = stateAfterNotebookRename.notebooks.some((notebook) => notebook.name === 'Renamed notebook') &&
  stateAfterNotebookRename.operations.some((operation) => operation.kind === 'notebook.rename' && operation.payload?.name === 'Renamed notebook');

await page.getByLabel('Duplicate notebook Renamed notebook').click();
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return state.notebooks?.some((notebook) => notebook.name === 'Renamed notebook copy');
});
const stateAfterNotebookCopy = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
const notebookCopy = stateAfterNotebookCopy.notebooks.find((notebook) => notebook.name === 'Renamed notebook copy');
checks.notebookDuplicate = Boolean(notebookCopy && notebookCopy.pageIds.length >= 2 && stateAfterNotebookCopy.pages.some((storedPage) => storedPage.notebookId === notebookCopy.id && storedPage.title === 'Parent ops'));
await page.getByLabel('Delete notebook Renamed notebook copy').click();
await page.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  return !state.notebooks?.some((notebook) => notebook.name === 'Renamed notebook copy');
});
const stateAfterNotebookDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}'));
checks.notebookDelete = !stateAfterNotebookDelete.notebooks.some((notebook) => notebook.name === 'Renamed notebook copy') &&
  stateAfterNotebookDelete.pages.every((storedPage) => storedPage.notebookId !== notebookCopy?.id) &&
  stateAfterNotebookDelete.notebooks.some((notebook) => notebook.id === stateAfterNotebookDelete.activeNotebookId) &&
  stateAfterNotebookDelete.pages.some((storedPage) => storedPage.id === stateAfterNotebookDelete.activePageId);

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
