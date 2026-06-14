import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173/';

await page.goto(appUrl);
await page.evaluate(() => localStorage.clear());
await page.reload();

const checks = {};
const shellSelect = page.getByLabel('Shell theme');
const contentSelect = page.locator('.content-theme-select');
const chooseContentTheme = async (theme) => {
  await contentSelect.first().evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, theme);
  await page.waitForFunction((expected) => document.documentElement.dataset.contentTheme === expected, theme);
};

await shellSelect.selectOption('native-garden');
checks.nativeGardenShell = await page.evaluate(() => Boolean(
  document.querySelector('.app-shell') &&
  document.querySelector('.sidebar') &&
  document.querySelector('.right-panel') &&
  !document.querySelector('#typora-sidebar')
));

await shellSelect.selectOption('native-ledger');
checks.nativeLedgerDiffers = await page.evaluate(() => {
  const sidebar = document.querySelector('.sidebar');
  const note = document.querySelector('.sidebar-note');
  if (!(sidebar instanceof HTMLElement) || !(note instanceof HTMLElement)) return false;
  const sidebarStyles = getComputedStyle(sidebar);
  const noteStyles = getComputedStyle(note);
  return sidebarStyles.position === 'sticky' && noteStyles.display === 'none';
});

await shellSelect.selectOption('typora-base');
await page.getByRole('button', { name: 'Desk' }).click();
await chooseContentTheme('notebook');
checks.typoraShellSwitches = await page.evaluate(() => Boolean(
  document.querySelector('.typora-app-shell') &&
  document.querySelector('#typora-sidebar') &&
  !document.querySelector('.brand-block') &&
  !document.querySelector('.sidebar-note') &&
  !document.querySelector('.topbar')
));

const composer = page.locator('.typora-write .composer');
await composer.click();
await composer.evaluate((element) => {
  element.innerHTML = [
    '<h1 class="md-heading md-end-block" data-heading-level="1">Contract Heading One</h1>',
    '<p class="md-end-block">Paragraph alias with <mark>theme mark</mark>, <kbd class="md-kbd">Cmd</kbd>, <code>inline</code>, and <a href="https://example.com">link</a>.</p>',
    '<blockquote class="md-end-block"><p class="md-end-block">Quote alias</p></blockquote>',
    '<ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">Parent</p><ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">Child</p></li></ul></li></ul>',
    '<ul class="contains-task-list task-list md-list" data-type="taskList"><li data-checked="false" data-type="taskItem" class="task-list-item md-task-list-item md-end-block" data-list-collapsed="false" data-todo-style="plain"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p class="md-end-block">task alias</p></div></li></ul>',
    '<pre class="md-fences md-end-block"><code>const ok = true;</code></pre>',
    '<table class="md-table"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    '<div class="md-math-block mathjax-block" data-type="block-math">x^2</div>'
  ].join('');
});

checks.typoraDomAliases = await composer.evaluate((element) => Boolean(
  element.querySelector('h1.md-heading.md-end-block[data-heading-level="1"]') &&
  element.querySelector('p.md-end-block') &&
  element.querySelector('ul.md-list li.md-list-item.md-end-block') &&
  element.querySelector('li.task-list-item.md-task-list-item.md-end-block[data-type="taskItem"]') &&
  element.querySelector('pre.md-fences.md-end-block')
));

const contentThemeCheck = async (theme) => {
  await chooseContentTheme(theme);
  return page.locator('.typora-write').evaluate((surface, currentTheme) => {
    const pre = surface.querySelector('pre.md-fences');
    const table = surface.querySelector('table');
    const td = surface.querySelector('td');
    const cellParagraph = surface.querySelector('td p');
    const h1 = surface.querySelector('h1');
    const mark = surface.querySelector('mark');
    const math = surface.querySelector('[data-type="block-math"]');
    if (!(pre instanceof HTMLElement) || !(table instanceof HTMLElement) || !(td instanceof HTMLElement) || !(cellParagraph instanceof HTMLElement) || !(h1 instanceof HTMLElement) || !(mark instanceof HTMLElement) || !(math instanceof HTMLElement)) return false;

    const preStyles = getComputedStyle(pre);
    const tableStyles = getComputedStyle(table);
    const tdStyles = getComputedStyle(td);
    const cellParagraphStyles = getComputedStyle(cellParagraph);
    const h1Styles = getComputedStyle(h1);
    const markStyles = getComputedStyle(mark);
    const mathStyles = getComputedStyle(math);

    if (currentTheme === 'typora-swiss') {
      return preStyles.backgroundColor === 'rgb(255, 255, 255)' &&
        preStyles.backgroundImage === 'none' &&
        tableStyles.borderCollapse === 'collapse' &&
        tdStyles.verticalAlign === 'top' &&
        cellParagraphStyles.marginTop === '0px' &&
        h1Styles.borderLeftWidth === '5px' &&
        markStyles.borderTopStyle === 'solid' &&
        mathStyles.backgroundColor === preStyles.backgroundColor;
    }

    if (currentTheme === 'typora-konayuki') {
      return preStyles.backgroundImage === 'none' &&
        tableStyles.borderCollapse === 'separate' &&
        tdStyles.verticalAlign === 'middle' &&
        mathStyles.backgroundColor === preStyles.backgroundColor &&
        markStyles.backgroundColor !== 'rgba(0, 0, 0, 0)';
    }

    return true;
  }, theme);
};

checks.swissCodeAndTableUseTheme = await contentThemeCheck('typora-swiss');
checks.konayukiCodeAndTableUseTheme = await contentThemeCheck('typora-konayuki');
checks.typoraThemesAreSelectable = true;
for (const theme of ['typora-proof', 'typora-konayuki', 'typora-swiss', 'typora-folio', 'typora-zeus', 'typora-bonne-nouvelle', 'typora-flexoki-light']) {
  await chooseContentTheme(theme);
  checks.typoraThemesAreSelectable = checks.typoraThemesAreSelectable && await page.evaluate((expected) => document.documentElement.dataset.contentTheme === expected, theme);
}

await chooseContentTheme('typora-swiss');
checks.swissUsesTyporaBaseShell = await page.evaluate(() => {
  const shell = document.querySelector('.typora-app-shell');
  const fileRow = document.querySelector('.file-node-content');
  if (!(shell instanceof HTMLElement) || !(fileRow instanceof HTMLElement)) return false;
  const shellStyles = getComputedStyle(shell);
  const rowStyles = getComputedStyle(fileRow);
  return shellStyles.backgroundColor === 'rgb(252, 249, 244)' &&
    rowStyles.borderRadius !== '999px' &&
    rowStyles.boxShadow === 'none';
});

await chooseContentTheme('typora-konayuki');
checks.konayukiShellOverridesApply = await page.evaluate(() => {
  const sidebar = document.querySelector('#typora-sidebar');
  const fileRow = document.querySelector('.file-node-content.active');
  if (!(sidebar instanceof HTMLElement) || !(fileRow instanceof HTMLElement)) return false;
  const sidebarStyles = getComputedStyle(sidebar);
  const rowStyles = getComputedStyle(fileRow);
  return sidebarStyles.backgroundImage.includes('gradient') &&
    Number.parseFloat(sidebarStyles.borderRadius) >= 10 &&
    sidebarStyles.boxShadow !== 'none' &&
    rowStyles.backgroundImage.includes('gradient');
});

checks.typoraSidebarContract = await page.evaluate(() => {
  const sidebar = document.querySelector('#typora-sidebar');
  const files = document.querySelector('.file-library-node');
  const outline = document.querySelector('.outline-item');
  const desk = document.querySelector('.typora-desk-tab');
  const pin = document.querySelector('.typora-pin-card');
  if (!(sidebar instanceof HTMLElement) || !(files instanceof HTMLElement) || !(outline instanceof HTMLElement) || !(desk instanceof HTMLElement) || !(pin instanceof HTMLElement)) return false;
  const fileNodeContent = files.querySelector('.file-node-content');
  if (!(fileNodeContent instanceof HTMLElement)) return false;
  const fileStyles = getComputedStyle(fileNodeContent);
  const outlineStyles = getComputedStyle(outline);
  const pinStyles = getComputedStyle(pin);
  return getComputedStyle(sidebar).display !== 'none' &&
    fileStyles.borderRadius !== '999px' &&
    outlineStyles.borderRadius !== '999px' &&
    Number.parseFloat(pinStyles.fontSize) <= 13.5 &&
    desk.querySelector('.typora-tool-controls') !== null;
});

await page.evaluate(() => localStorage.clear());
console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
