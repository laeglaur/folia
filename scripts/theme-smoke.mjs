import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5173/';

await page.goto(appUrl);
await page.evaluate(() => localStorage.clear());
await page.reload();

const checks = {};
const gruvboxGeneratedCss = await readFile('src/styles/typora/generated/typora-gruvbox-dark.scoped.css', 'utf8');
checks.typoraMissingAssetsAreInert = gruvboxGeneratedCss.includes('url(data:font/ttf;base64,)') &&
  !gruvboxGeneratedCss.includes('url(monospace/Inconsolata');
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
    '<pre class="md-fences md-end-block"><code>function ok(value) {\n  const doubled = value * 2;\n  return doubled;\n}</code></pre>',
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
const selectableTyporaThemes = [
  'typora-proof',
  'typora-konayuki',
  'typora-swiss',
  'typora-folio',
  'typora-zeus',
  'typora-bonne-nouvelle',
  'typora-flexoki-light',
  'typora-inkwell',
  'typora-gruvbox-dark',
  'typora-bit-clean-light',
  'typora-print',
  'typora-ravel-light',
  'typora-chocolate-box',
  'typora-torillic',
  'typora-eloquent',
  'typora-law',
  'typora-blackout',
  'typora-salamander',
  'typora-minimalism',
  'typora-everforest-light',
  'typora-everforest-dark',
  'typora-mdmdt-light',
  'typora-paperglow',
  'typora-latex',
  'typora-alise'
];

checks.typoraThemesAreSelectable = true;
for (const theme of selectableTyporaThemes) {
  await chooseContentTheme(theme);
  checks.typoraThemesAreSelectable = checks.typoraThemesAreSelectable && await page.evaluate((expected) => document.documentElement.dataset.contentTheme === expected, theme);
}

checks.localRawTyporaThemesKeepBaseLayout = true;
for (const theme of ['typora-inkwell', 'typora-gruvbox-dark', 'typora-bit-clean-light', 'typora-print', 'typora-ravel-light']) {
  await chooseContentTheme(theme);
  checks.localRawTyporaThemesKeepBaseLayout = checks.localRawTyporaThemesKeepBaseLayout && await page.locator('.typora-write').evaluate((surface, currentTheme) => {
    const write = document.querySelector('.page-surface.typora-write');
    const pre = surface.querySelector('pre.md-fences');
    const table = surface.querySelector('table');
    const title = document.querySelector('.page-title');
    if (!(write instanceof HTMLElement) || !(pre instanceof HTMLElement) || !(table instanceof HTMLElement) || !(title instanceof HTMLElement)) return false;
    const writeRect = write.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const preStyles = getComputedStyle(pre);
    const tableStyles = getComputedStyle(table);
    const printThemeKeepsPrintSizing = currentTheme === 'typora-print' &&
      preStyles.overflowX === 'visible' &&
      tableStyles.display === 'table';
    const screenThemeKeepsOverflowSafety = preStyles.overflowX === 'auto' &&
      tableStyles.display === 'table';

    return writeRect.width >= 760 &&
      titleRect.top - writeRect.top < 18 &&
      (printThemeKeepsPrintSizing || screenThemeKeepsOverflowSafety);
  }, theme);
}

checks.newTyporaThemeAssetsAreRouted = true;
for (const theme of ['typora-chocolate-box', 'typora-torillic', 'typora-eloquent', 'typora-law', 'typora-salamander', 'typora-minimalism', 'typora-latex', 'typora-alise']) {
  const generatedCss = await readFile(`src/styles/typora/generated/${theme}.scoped.css`, 'utf8');
  const urls = [...generatedCss.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((match) => match[2].trim());
  checks.newTyporaThemeAssetsAreRouted = checks.newTyporaThemeAssetsAreRouted &&
    urls.every((url) => /^(data:|https?:|\/typora-assets\/|#)/i.test(url));
}

const nativeGardenTableHeader = 'rgba(229, 247, 240, 0.82)';
checks.typoraTableHeadersDoNotUseNativeGardenFallback = true;
for (const theme of ['typora-print', 'typora-inkwell', 'typora-ravel-light']) {
  await chooseContentTheme(theme);
  checks.typoraTableHeadersDoNotUseNativeGardenFallback = checks.typoraTableHeadersDoNotUseNativeGardenFallback && await page.locator('.typora-write').evaluate((surface, currentTheme, gardenHeader) => {
    const th = surface.querySelector('th');
    if (!(th instanceof HTMLElement)) return false;
    const styles = getComputedStyle(th);
    const background = styles.backgroundColor;
    const expectedThemeHeader = currentTheme === 'typora-print'
      ? 'rgb(240, 240, 240)'
      : currentTheme === 'typora-inkwell'
        ? 'rgb(241, 245, 249)'
        : null;
    return background !== gardenHeader && (!expectedThemeHeader || background === expectedThemeHeader);
  }, theme, nativeGardenTableHeader);
}

await chooseContentTheme('typora-chocolate-box');
checks.chocolateBoxFallbackUsesThemePanel = await page.locator('.typora-write').evaluate((surface) => {
  const channelsFromColor = (value) => {
    const rgbMatch = value.match(/rgba?\(([^)]+)\)/i);
    if (rgbMatch) {
      return rgbMatch[1].split(/[\s,\/]+/).slice(0, 3).map((part) => Number.parseFloat(part));
    }
    const srgbMatch = value.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i);
    if (srgbMatch) {
      return srgbMatch.slice(1, 4).map((part) => Number.parseFloat(part) * 255);
    }
    return null;
  };
  const luminance = (value) => {
    const channels = channelsFromColor(value);
    if (!channels || channels.some((channel) => Number.isNaN(channel))) return null;
    const [r, g, b] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const readablePair = (background, color) => {
    const bgLuminance = luminance(background);
    const textLuminance = luminance(color);
    if (bgLuminance === null || textLuminance === null) return false;
    return Math.abs(bgLuminance - textLuminance) > 0.18;
  };
  const notLightGrayPanel = (background) => {
    const channels = channelsFromColor(background);
    if (!channels) return false;
    return background !== 'rgb(208, 208, 208)' && channels.some((channel) => channel < 160);
  };
  const elements = [
    surface.querySelector('pre.md-fences'),
    surface.querySelector('blockquote'),
    surface.querySelector('th'),
    surface.querySelector('mark')
  ];
  if (elements.some((element) => !(element instanceof HTMLElement))) return false;
  return elements.every((element) => {
    const styles = getComputedStyle(element);
    return notLightGrayPanel(styles.backgroundColor) &&
      readablePair(styles.backgroundColor, styles.color);
  });
});

checks.fencedCodeDoesNotUseInlineCodeChrome = true;
for (const theme of ['typora-zeus', 'typora-folio', 'typora-flexoki-light']) {
  await chooseContentTheme(theme);
  checks.fencedCodeDoesNotUseInlineCodeChrome = checks.fencedCodeDoesNotUseInlineCodeChrome && await page.locator('.typora-write').evaluate((surface) => {
    const pre = surface.querySelector('pre.md-fences');
    const blockCode = surface.querySelector('pre.md-fences > code');
    const inlineCode = surface.querySelector('p code');
    if (!(pre instanceof HTMLElement) || !(blockCode instanceof HTMLElement) || !(inlineCode instanceof HTMLElement)) return false;
    const preStyles = getComputedStyle(pre);
    const blockCodeStyles = getComputedStyle(blockCode);
    const inlineStyles = getComputedStyle(inlineCode);
    return blockCodeStyles.backgroundColor === 'rgba(0, 0, 0, 0)' &&
      blockCodeStyles.borderTopStyle === 'none' &&
      blockCodeStyles.borderTopWidth === '0px' &&
      blockCodeStyles.borderRadius === '0px' &&
      blockCodeStyles.boxShadow === 'none' &&
      blockCodeStyles.display === 'block' &&
      blockCodeStyles.color === preStyles.color &&
      inlineStyles.display === 'inline' &&
      inlineStyles.paddingLeft !== blockCodeStyles.paddingLeft;
  });
}

await chooseContentTheme('typora-paperglow');
checks.paperglowFencedCodeKeepsBlockRhythm = await page.locator('.typora-write').evaluate((surface) => {
  const pre = surface.querySelector('pre.md-fences');
  const code = surface.querySelector('pre.md-fences > code');
  if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) return false;
  const preStyles = getComputedStyle(pre);
  const codeStyles = getComputedStyle(code);
  const preRect = pre.getBoundingClientRect();
  const codeRect = code.getBoundingClientRect();
  return preStyles.backgroundColor === 'rgb(252, 251, 248)' &&
    preStyles.borderRadius === '16px' &&
    preStyles.whiteSpace === 'pre' &&
    codeStyles.display === 'block' &&
    codeStyles.backgroundColor === 'rgba(0, 0, 0, 0)' &&
    codeStyles.whiteSpace === 'pre' &&
    codeStyles.fontSize === '14px' &&
    codeRect.left > preRect.left &&
    codeRect.right < preRect.right &&
    codeRect.height > 60;
});

checks.typoraTaskItemsAlignCheckboxWithText = true;
for (const theme of ['typora-ravel-light', 'typora-gruvbox-dark', 'typora-zeus', 'typora-minimalism']) {
  await chooseContentTheme(theme);
  checks.typoraTaskItemsAlignCheckboxWithText = checks.typoraTaskItemsAlignCheckboxWithText && await page.locator('.typora-write').evaluate((surface) => {
    const item = surface.querySelector('li.task-list-item');
    const input = item?.querySelector('input[type="checkbox"]');
    const text = item?.querySelector('div > p:first-child');
    if (!(item instanceof HTMLElement) || !(input instanceof HTMLElement) || !(text instanceof HTMLElement)) return false;
    const itemStyles = getComputedStyle(item);
    const inputRect = input.getBoundingClientRect();
    const textRect = text.getBoundingClientRect();
    const delta = Math.abs((inputRect.top + inputRect.height / 2) - (textRect.top + textRect.height / 2));
    return itemStyles.display === 'grid' &&
      inputRect.width > 8 &&
      inputRect.height > 8 &&
      delta <= 4;
  });
}

await chooseContentTheme('typora-chocolate-box');
checks.typoraBlockDividerUsesThemeHrUi = await page.evaluate(() => {
  const divider = document.querySelector('.typora-write hr.block-divider');
  if (!(divider instanceof HTMLHRElement)) return false;
  const styles = getComputedStyle(divider);
  return divider.classList.contains('uses-theme-divider') &&
    styles.backgroundImage.includes('/typora-assets/typora-chocolate-box/ChocolateBox/hr.svg') &&
    Number.parseFloat(styles.height) >= 80 &&
    styles.boxShadow === 'none';
});

await chooseContentTheme('typora-proof');
checks.typoraBlockDividerFallbackIsExplicit = await page.evaluate(() => {
  const divider = document.querySelector('.typora-write hr.block-divider');
  if (!(divider instanceof HTMLHRElement)) return false;
  const styles = getComputedStyle(divider);
  return divider.classList.contains('uses-default-divider') &&
    Number.parseFloat(styles.height) >= 12 &&
    styles.boxShadow !== 'none';
});

await chooseContentTheme('typora-bonne-nouvelle');
checks.typoraFallbackDoesNotUseNativeGardenChrome = await page.locator('.typora-write').evaluate((surface) => {
  const h1 = surface.querySelector('h1');
  const inlineCode = surface.querySelector('p code');
  const mark = surface.querySelector('mark');
  const pre = surface.querySelector('pre.md-fences');
  if (!(h1 instanceof HTMLElement) || !(inlineCode instanceof HTMLElement) || !(mark instanceof HTMLElement) || !(pre instanceof HTMLElement)) return false;
  const h1Styles = getComputedStyle(h1);
  const codeStyles = getComputedStyle(inlineCode);
  const markStyles = getComputedStyle(mark);
  const preStyles = getComputedStyle(pre);
  return h1Styles.color === 'rgb(184, 191, 198)' &&
    h1Styles.fontFamily.includes('Courier') &&
    codeStyles.backgroundColor !== 'rgb(238, 247, 241)' &&
    codeStyles.color !== 'rgb(36, 83, 76)' &&
    markStyles.backgroundColor !== 'rgb(237, 246, 234)' &&
    markStyles.color !== 'rgb(47, 115, 95)' &&
    preStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    preStyles.color !== 'rgb(36, 83, 76)';
});

await chooseContentTheme('typora-proof');
checks.proofKeepsTyporaShellLayout = await page.evaluate(() => {
  const sidebar = document.querySelector('#typora-sidebar');
  const workspace = document.querySelector('.typora-workspace');
  const write = document.querySelector('#write');
  if (!(sidebar instanceof HTMLElement) || !(workspace instanceof HTMLElement) || !(write instanceof HTMLElement)) return false;
  const sidebarStyles = getComputedStyle(sidebar);
  const workspaceRect = workspace.getBoundingClientRect();
  const writeRect = write.getBoundingClientRect();
  return sidebarStyles.display !== 'none' &&
    workspaceRect.width > 900 &&
    writeRect.width >= 800 &&
    writeRect.left > workspaceRect.left;
});

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
await page.getByRole('button', { name: 'Files' }).click();
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

checks.konayukiFileActiveDoesNotNestFrame = await page.evaluate(() => {
  const activeRows = [...document.querySelectorAll('.file-node-content.active')];
  const title = activeRows[0]?.querySelector('.file-node-title');
  if (activeRows.length !== 1 || !(title instanceof HTMLElement)) return false;
  const activeStyles = getComputedStyle(activeRows[0]);
  const titleStyles = getComputedStyle(title);
  return activeStyles.display === 'grid' &&
    titleStyles.backgroundImage === 'none' &&
    titleStyles.borderTopStyle === 'none' &&
    titleStyles.boxShadow === 'none';
});

checks.typoraEditorChromeBaseOwnsBlockUi = await page.evaluate(() => {
  const write = document.querySelector('.page-surface.typora-write');
  const title = document.querySelector('.page-title');
  const block = document.querySelector('.typora-write .block');
  const blockDivider = document.querySelector('.typora-write hr.block-divider');
  const composerCard = document.querySelector('.composer-card');
  if (!(write instanceof HTMLElement) || !(title instanceof HTMLElement) || !(block instanceof HTMLElement) || !(blockDivider instanceof HTMLHRElement) || !(composerCard instanceof HTMLElement)) return false;

  const writeStyles = getComputedStyle(write);
  const titleStyles = getComputedStyle(title);
  const blockStyles = getComputedStyle(block);
  const composerStyles = getComputedStyle(composerCard);
  const writeRect = write.getBoundingClientRect();
  const titleRect = title.getBoundingClientRect();

  return writeStyles.paddingTop === '8px' &&
    titleRect.top - writeRect.top < 16 &&
    Number.parseFloat(titleStyles.fontSize) < 36 &&
    titleStyles.borderRadius === '0px' &&
    blockStyles.backgroundColor === 'rgba(0, 0, 0, 0)' &&
    blockStyles.borderTopStyle === 'none' &&
    blockStyles.borderRadius === '0px' &&
    blockDivider.classList.contains('block-divider') &&
    composerStyles.backgroundColor === 'rgba(0, 0, 0, 0)' &&
    composerStyles.borderRadius === '0px' &&
    Number.parseFloat(composerStyles.marginTop) < 48;
});

await composer.click();
checks.typoraEditorToolbarIsCompact = await page.evaluate(() => {
  const toolbar = document.querySelector('.typora-write .format-toolbar');
  if (!(toolbar instanceof HTMLElement)) return false;
  const styles = getComputedStyle(toolbar);
  const rect = toolbar.getBoundingClientRect();
  return styles.flexWrap === 'nowrap' &&
    Number.parseFloat(styles.borderRadius) <= 4 &&
    rect.height <= 40 &&
    rect.width > 500 &&
    styles.boxShadow === 'none';
});

await chooseContentTheme('typora-ravel-light');
checks.ravelEditorChromeKeepsPillIconsCentered = await page.evaluate(() => {
  const elements = [
    document.querySelector('.typora-write .tool-button'),
    document.querySelector('.typora-write .fold-button')
  ];
  return elements.every((element) => {
    if (!(element instanceof HTMLElement)) return false;
    const icon = element.querySelector('svg');
    if (!(icon instanceof SVGElement)) return false;
    const styles = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const dx = Math.abs((iconRect.left + iconRect.width / 2) - (rect.left + rect.width / 2));
    const dy = Math.abs((iconRect.top + iconRect.height / 2) - (rect.top + rect.height / 2));
    return styles.borderRadius === '999px' &&
      styles.paddingLeft === '0px' &&
      styles.paddingRight === '0px' &&
      dx < 0.5 &&
      dy < 0.5;
  });
});

await page.getByRole('button', { name: 'Outline' }).click();
checks.typoraOutlineDoesNotUseContentTocCard = await page.evaluate(() => {
  const outline = document.querySelector('#typora-sidebar .outline-content.md-toc-content');
  if (!(outline instanceof HTMLElement)) return false;
  const styles = getComputedStyle(outline);
  return styles.backgroundColor === 'rgba(0, 0, 0, 0)' &&
    styles.borderTopStyle === 'none' &&
    styles.boxShadow === 'none' &&
    styles.paddingTop === '0px' &&
    styles.marginTop === '0px';
});

checks.typoraOutlineKeepsTypeLabels = await page.evaluate(() => {
  const firstItem = document.querySelector('#typora-sidebar .outline-item');
  const expander = firstItem?.querySelector('.outline-expander');
  const label = firstItem?.querySelector('.outline-label');
  if (!(firstItem instanceof HTMLElement) || !(expander instanceof HTMLElement) || !(label instanceof HTMLElement)) return false;
  return expander.textContent?.trim().length > 0 &&
    label.textContent?.trim().length > 0 &&
    firstItem.textContent?.trim().startsWith(expander.textContent?.trim() ?? '');
});

await chooseContentTheme('typora-zeus');
checks.zeusShellUsesThemeSidebarBackground = await page.evaluate(() => {
  const sidebar = document.querySelector('#typora-sidebar');
  const label = document.querySelector('#typora-sidebar .outline-label');
  if (!(sidebar instanceof HTMLElement) || !(label instanceof HTMLElement)) return false;
  const sidebarStyles = getComputedStyle(sidebar);
  const labelStyles = getComputedStyle(label);
  return sidebarStyles.backgroundColor === 'rgb(37, 37, 38)' &&
    labelStyles.color === 'rgb(204, 204, 204)';
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
