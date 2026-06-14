import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const themes = ['garden', 'ledger'];
const typoraThemes = [
  'typora-proof',
  'typora-konayuki',
  'typora-swiss',
  'typora-folio',
  'typora-zeus',
  'typora-bonne-nouvelle',
  'typora-flexoki-light'
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const themeDemoPath = join(tmpdir(), `notebook-theme-demo-${Date.now()}.md`);

await writeFile(themeDemoPath, [
  '# Theme Demo Smoke',
  '',
  '```python',
  'import os',
  'client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))',
  'print("ready")',
  '```',
  '',
  '$$',
  'q(x_t \\mid x_{t-1})=\\mathcal N\\bigl(x_t;\\sqrt{1-\\beta_t}\\,x_{t-1},\\,\\beta_t\\mathbf I\\bigr)',
  '$$',
  '',
  '| 项目 / Item | 数量 / Qty |',
  '| --- | --- |',
  '| 铅笔 / Pencil | 2 |'
].join('\n'));

await page.goto(appUrl);
await page.evaluate(() => localStorage.clear());
await page.reload();

const checks = {};
const shellSelect = page.getByLabel('Shell theme');

for (const theme of themes) {
  await shellSelect.selectOption(theme);
  checks[`${theme}:dataset`] = await page.evaluate((expected) => document.documentElement.dataset.theme === expected, theme);
  checks[`${theme}:tokens`] = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return Boolean(
      styles.getPropertyValue('--theme-bg').trim() &&
      styles.getPropertyValue('--theme-accent').trim() &&
      styles.getPropertyValue('--theme-highlight').trim() &&
      styles.getPropertyValue('--theme-bracket-todo').trim() &&
      styles.getPropertyValue('--layout-sidebar-width').trim() &&
      styles.getPropertyValue('--shape-page-radius').trim() &&
      styles.getPropertyValue('--nav-item-radius').trim() &&
      styles.getPropertyValue('--block-list-gap').trim()
    );
  });
}

checks.ledgerDiffersFromGarden = await page.evaluate(() => {
  document.documentElement.dataset.theme = 'garden';
  const gardenStyles = getComputedStyle(document.documentElement);
  const gardenWidth = gardenStyles.getPropertyValue('--layout-page-width').trim();
  const gardenRadius = gardenStyles.getPropertyValue('--nav-item-radius').trim();
  document.documentElement.dataset.theme = 'ledger';
  const ledgerStyles = getComputedStyle(document.documentElement);
  return (
    ledgerStyles.getPropertyValue('--layout-page-width').trim() !== gardenWidth &&
    ledgerStyles.getPropertyValue('--nav-item-radius').trim() !== gardenRadius
  );
});

await shellSelect.selectOption('ledger');
checks.ledgerCanHideDecorativeSidebar = await page.evaluate(() => {
  const eyebrow = document.querySelector('.eyebrow');
  const title = document.querySelector('.brand-block h1');
  const profile = document.querySelector('.profile-id');
  const note = document.querySelector('.sidebar-note');
  if (!(eyebrow instanceof HTMLElement) || !(title instanceof HTMLElement) || !(profile instanceof HTMLElement) || !(note instanceof HTMLElement)) return false;
  return [eyebrow, title, profile, note].every((element) => getComputedStyle(element).display === 'none');
});

const contentSelect = page.locator('.content-theme-select');
await contentSelect.selectOption('notebook');
const notebookContentFont = await page.locator('.composer').last().evaluate((element) => getComputedStyle(element).fontFamily);
const sidebarFontBeforeContentTheme = await page.locator('.sidebar').evaluate((element) => getComputedStyle(element).fontFamily);

const composer = page.locator('.composer').last();
await composer.click();
await composer.evaluate((element) => {
  element.innerHTML = [
    '<h1 class="md-heading md-end-block" data-heading-level="1">Contract Heading One</h1>',
    '<p class="md-end-block">Paragraph alias with <mark>theme mark</mark>, <kbd class="md-kbd">Cmd</kbd>, <code>inline</code>, and <a href="https://example.com">link</a>.</p>',
    '<blockquote class="md-end-block"><p class="md-end-block">Quote alias</p></blockquote>',
    '<ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">Parent</p><ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">Child</p></li></ul></li></ul>',
    '<ul class="contains-task-list task-list md-list" data-type="taskList"><li data-checked="false" data-type="taskItem" class="task-list-item md-task-list-item md-end-block" data-list-collapsed="false" data-todo-style="plain"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p class="md-end-block">task alias</p></div></li></ul>',
    '<pre class="md-fences md-end-block"><code>const ok = true;</code></pre>'
  ].join('');
});

checks.editorStillWorks = (await composer.innerText()).includes('Contract Heading One');
checks.typoraDomAliases = await composer.evaluate((element) => Boolean(
  element.querySelector('h1.md-heading.md-end-block[data-heading-level="1"]') &&
  element.querySelector('p.md-end-block') &&
  element.querySelector('ul.md-list li.md-list-item.md-end-block') &&
  element.querySelector('li.task-list-item.md-task-list-item.md-end-block[data-type="taskItem"]') &&
  element.querySelector('pre.md-fences.md-end-block')
));

await composer.evaluate((element) => {
  element.insertAdjacentHTML('beforeend', `
    <table class="md-table"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
    <img class="md-image" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="probe" />
    <div class="md-math-block mathjax-block" data-type="block-math">x^2</div>
    <div class="md-alert md-alert-warning" data-alert-type="warning"><p class="md-alert-title md-alert-text">Warning</p><p>Alert body</p></div>
  `);
});

await contentSelect.selectOption('typora-base');
checks.contentThemeDataset = await page.evaluate(() => document.documentElement.dataset.contentTheme === 'typora-base');
checks.typoraScopeHooks = await page.evaluate(() => {
  const shell = document.querySelector('.typora-theme[data-content-theme="typora-base"]');
  const write = document.querySelector('.page-surface.typora-write');
  const toc = document.querySelector('.outline-list.typora-toc.md-toc.md-toc-content');
  const tocItem = document.querySelector('.outline-entry.md-toc-item');
  return Boolean(shell && write && toc && tocItem);
});
checks.typoraWriteIsPageOnly = await page.evaluate(() => {
  const writeElements = [...document.querySelectorAll('.typora-write')];
  return writeElements.length === 1 &&
    writeElements[0].classList.contains('page-surface') &&
    !document.querySelector('.desktop-card.typora-write') &&
    !document.querySelector('.composer.typora-write') &&
    !document.querySelector('.block-content.typora-write');
});
checks.contentThemeChangesWritingSurface = await page.locator('.composer').last().evaluate((element, previousFont) =>
  getComputedStyle(element).fontFamily !== previousFont,
  notebookContentFont
);
checks.contentThemeDoesNotStyleSidebarFont = await page.locator('.sidebar').evaluate((element, previousFont) =>
  getComputedStyle(element).fontFamily === previousFont,
  sidebarFontBeforeContentTheme
);

const assertNoHorizontalOverflow = async (theme) => {
  await contentSelect.selectOption(theme);
  return page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const pageSurface = document.querySelector('.page-surface');
    const composer = document.querySelector('.composer');
    if (!(shell instanceof HTMLElement) || !(pageSurface instanceof HTMLElement) || !(composer instanceof HTMLElement)) return false;
    const shellRect = shell.getBoundingClientRect();
    const pageRect = pageSurface.getBoundingClientRect();
    const offenders = [...composer.querySelectorAll('pre, table, img, video, audio, iframe, [data-type="block-math"], .md-math-block')]
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => node.scrollWidth - node.clientWidth > 2 && node.getBoundingClientRect().width > pageRect.width + 2);
    return pageRect.left >= -1 &&
      pageRect.right <= shellRect.right + 1 &&
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2 &&
      offenders.length === 0;
  });
};

checks.typoraProofGeneratedCssApplies = await (async () => {
  await contentSelect.selectOption('typora-proof');
  return page.locator('.composer').last().evaluate((element) => {
    const styles = getComputedStyle(element);
    return styles.fontFamily.includes('Times New Roman') &&
      Math.abs(Number.parseFloat(styles.letterSpacing) - 0.51) < 0.05 &&
      Math.abs(Number.parseFloat(styles.lineHeight) - 30.26) < 1;
  });
})();
checks.typoraProofTocMapsToRightOutline = await page.locator('.outline-entry.md-toc-item').first().evaluate((element) =>
  getComputedStyle(element).textTransform === 'uppercase'
);

checks.konayukiCodeAndTableUseTheme = await (async () => {
  await contentSelect.selectOption('typora-konayuki');
  return page.locator('.composer').last().evaluate((element) => {
    const pre = element.querySelector('pre.md-fences');
    const table = element.querySelector('table');
    const mark = element.querySelector('mark');
    const math = element.querySelector('[data-type="block-math"]');
    const alert = element.querySelector('.md-alert-warning');
    const kbd = element.querySelector('kbd');
    const td = element.querySelector('td');
    const cellParagraph = element.querySelector('td p');
    if (!(pre instanceof HTMLElement) || !(table instanceof HTMLElement) || !(mark instanceof HTMLElement) || !(math instanceof HTMLElement) || !(alert instanceof HTMLElement) || !(kbd instanceof HTMLElement) || !(td instanceof HTMLElement) || !(cellParagraph instanceof HTMLElement)) return false;
    const preStyles = getComputedStyle(pre);
    const tableStyles = getComputedStyle(table);
    const markStyles = getComputedStyle(mark);
    const mathStyles = getComputedStyle(math);
    const alertStyles = getComputedStyle(alert);
    const kbdStyles = getComputedStyle(kbd);
    const tdStyles = getComputedStyle(td);
    const cellParagraphStyles = getComputedStyle(cellParagraph);
    return preStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
      preStyles.backgroundImage === 'none' &&
      preStyles.borderTopStyle !== 'none' &&
      tableStyles.borderCollapse === 'separate' &&
      tableStyles.borderTopColor === 'rgb(226, 221, 211)' &&
      tdStyles.textAlign === 'left' &&
      tdStyles.verticalAlign === 'middle' &&
      cellParagraphStyles.marginTop === '0px' &&
      cellParagraphStyles.marginBottom === '0px' &&
      markStyles.backgroundColor === 'rgb(255, 243, 205)' &&
      markStyles.boxShadow === 'none' &&
      mathStyles.backgroundColor === preStyles.backgroundColor &&
      mathStyles.backgroundImage === 'none' &&
      alertStyles.borderLeftStyle === 'solid' &&
      alertStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
      kbdStyles.borderTopStyle === 'solid';
  });
})();
checks.konayukiTaskCheckboxAligns = await page.locator('.composer').last().evaluate((element) => {
  const input = element.querySelector('li.task-list-item input[type="checkbox"]');
  const text = element.querySelector('li.task-list-item p');
  if (!(input instanceof HTMLElement) || !(text instanceof HTMLElement)) return false;
  const inputRect = input.getBoundingClientRect();
  const textRect = text.getBoundingClientRect();
  const inputCenter = inputRect.top + inputRect.height / 2;
  const firstLineCenter = textRect.top + Math.min(textRect.height, 24) / 2;
  return Math.abs(inputCenter - firstLineCenter) < 8;
});
checks.konayukiNoOverflow = await assertNoHorizontalOverflow('typora-konayuki');

checks.swissCodeAndTableUseTheme = await (async () => {
  await contentSelect.selectOption('typora-swiss');
  return page.locator('.composer').last().evaluate((element) => {
    const pre = element.querySelector('pre.md-fences');
    const table = element.querySelector('table');
    const h1 = element.querySelector('h1');
    const mark = element.querySelector('mark');
    if (!(pre instanceof HTMLElement) || !(table instanceof HTMLElement) || !(h1 instanceof HTMLElement) || !(mark instanceof HTMLElement)) return false;
    const preStyles = getComputedStyle(pre);
    const tableStyles = getComputedStyle(table);
    const h1Styles = getComputedStyle(h1);
    const markStyles = getComputedStyle(mark);
    return preStyles.backgroundColor === 'rgb(255, 255, 255)' &&
      preStyles.backgroundImage === 'none' &&
      preStyles.borderTopStyle === 'solid' &&
      preStyles.color === 'rgb(36, 41, 47)' &&
      tableStyles.borderCollapse === 'collapse' &&
      h1Styles.borderLeftWidth === '5px' &&
      markStyles.backgroundColor === 'rgb(255, 250, 246)' &&
      markStyles.borderTopStyle === 'solid' &&
      markStyles.boxShadow === 'none';
  });
})();
checks.swissTaskCheckboxAligns = await page.locator('.composer').last().evaluate((element) => {
  const input = element.querySelector('li.task-list-item input[type="checkbox"]');
  const text = element.querySelector('li.task-list-item p');
  if (!(input instanceof HTMLElement) || !(text instanceof HTMLElement)) return false;
  const inputRect = input.getBoundingClientRect();
  const textRect = text.getBoundingClientRect();
  const inputCenter = inputRect.top + inputRect.height / 2;
  const firstLineCenter = textRect.top + Math.min(textRect.height, 24) / 2;
  return Math.abs(inputCenter - firstLineCenter) < 8;
});
checks.swissNoOverflow = await assertNoHorizontalOverflow('typora-swiss');

await page.evaluate(() => localStorage.clear());
await page.reload();
await page.locator('input[type="file"]').setInputFiles(themeDemoPath);
await page.locator('.page-title').waitFor({ state: 'visible' });

checks.importedThemeDemoCodeTableMath = true;
for (const theme of ['typora-konayuki', 'typora-swiss']) {
  await contentSelect.selectOption(theme);
  await page.waitForTimeout(150);
  checks.importedThemeDemoCodeTableMath = checks.importedThemeDemoCodeTableMath && await page.locator('.page-surface').evaluate((surface, currentTheme) => {
    const pre = surface.querySelector('pre.md-fences');
    const keyword = surface.querySelector('pre.md-fences .hljs-keyword');
    const string = surface.querySelector('pre.md-fences .hljs-string');
    const table = surface.querySelector('table');
    const th = surface.querySelector('th');
    const td = surface.querySelector('td');
    const cellParagraph = surface.querySelector('td p');
    const math = surface.querySelector('[data-type="block-math"]');
    const mathInner = surface.querySelector('[data-type="block-math"] .block-math-inner');
    if (!(pre instanceof HTMLElement) || !(keyword instanceof HTMLElement) || !(string instanceof HTMLElement) || !(table instanceof HTMLElement) || !(th instanceof HTMLElement) || !(td instanceof HTMLElement) || !(cellParagraph instanceof HTMLElement) || !(math instanceof HTMLElement) || !(mathInner instanceof HTMLElement)) return false;

    const preStyles = getComputedStyle(pre);
    const keywordStyles = getComputedStyle(keyword);
    const stringStyles = getComputedStyle(string);
    const tableStyles = getComputedStyle(table);
    const thStyles = getComputedStyle(th);
    const tdStyles = getComputedStyle(td);
    const cellParagraphStyles = getComputedStyle(cellParagraph);
    const mathStyles = getComputedStyle(math);
    const mathInnerStyles = getComputedStyle(mathInner);

    const codeIsTokenized = keywordStyles.color !== preStyles.color && stringStyles.color !== preStyles.color;
    const mathIsCentered = mathInnerStyles.textAlign === 'center';
    const mathUsesCodeFrame = mathStyles.backgroundColor === preStyles.backgroundColor && mathStyles.borderTopStyle === preStyles.borderTopStyle;

    if (currentTheme === 'typora-konayuki') {
      return codeIsTokenized &&
        preStyles.backgroundImage === 'none' &&
        preStyles.borderTopColor === 'rgb(233, 227, 216)' &&
        tableStyles.borderCollapse === 'separate' &&
        tableStyles.borderTopColor === 'rgb(226, 221, 211)' &&
        thStyles.backgroundColor === 'rgb(247, 244, 239)' &&
        tdStyles.textAlign === 'left' &&
        tdStyles.verticalAlign === 'middle' &&
        cellParagraphStyles.marginTop === '0px' &&
        cellParagraphStyles.marginBottom === '0px' &&
        mathUsesCodeFrame &&
        mathIsCentered;
    }

    return codeIsTokenized &&
      preStyles.backgroundColor === 'rgb(255, 255, 255)' &&
      preStyles.backgroundImage === 'none' &&
      tableStyles.borderCollapse === 'collapse' &&
      mathUsesCodeFrame &&
      mathIsCentered;
  }, theme);
}

checks.zeusDarkThemeKeepsOutlineReadable = await (async () => {
  await contentSelect.selectOption('typora-zeus');
  return page.locator('.outline-entry.md-toc-item').first().evaluate((element) => {
    const styles = getComputedStyle(element);
    return styles.color !== 'rgb(212, 212, 212)' && Number.parseFloat(styles.fontSize) > 0;
  });
})();

checks.typoraKeepsPinnedCardsCompactAcrossThemes = await page.locator('.desktop-card').first().evaluate((element) => {
  const styles = getComputedStyle(element);
  return Number.parseFloat(styles.fontSize) <= 13.5 &&
    (styles.backgroundImage !== 'none' || styles.backgroundColor !== 'rgba(0, 0, 0, 0)') &&
    !styles.fontFamily.includes('Cascadia');
});

checks.typoraThemesAreSelectable = true;
for (const theme of typoraThemes) {
  await contentSelect.selectOption(theme);
  const themeApplied = await page.evaluate((expected) => document.documentElement.dataset.contentTheme === expected, theme);
  const sidebarVisible = await page.locator('.sidebar').evaluate((element) => getComputedStyle(element).display !== 'none');
  const pageVisible = await page.locator('.page-surface').evaluate((element) => {
    const styles = getComputedStyle(element);
    return Number.parseFloat(styles.width) > 200 && styles.display !== 'none';
  });
  checks.typoraThemesAreSelectable = checks.typoraThemesAreSelectable && themeApplied && sidebarVisible && pageVisible;
}

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
