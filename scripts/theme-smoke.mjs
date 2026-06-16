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
const contentSelect = page.locator('.content-theme-select');
const chooseShell = async (shell) => {
  await page.locator('.shell-theme-select').first().evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, shell);
  await page.waitForFunction((expected) => document.documentElement.dataset.shell === expected, shell);
};
const chooseContentTheme = async (theme) => {
  await contentSelect.first().evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, theme);
  await page.waitForFunction((expected) => document.documentElement.dataset.contentTheme === expected, theme);
};

await chooseShell('native-garden');
checks.nativeGardenShell = await page.evaluate(() => Boolean(
  document.querySelector('.app-shell') &&
  document.querySelector('.sidebar') &&
  document.querySelector('.right-panel') &&
  !document.querySelector('.outline-drawer') &&
  !document.querySelector('#typora-sidebar')
));

checks.nativeRightPanelKeepsPinsAndPageRowsDrag = await page.evaluate(() => {
  const sidebarPinList = document.querySelector('.sidebar .sidebar-pin-list');
  const rightPanelPinned = document.querySelector('.right-panel .right-panel-pin-list');
  const pageRow = document.querySelector('.sidebar .page-row-shell');
  const pageButton = document.querySelector('.sidebar .page-button');
  return !(sidebarPinList instanceof HTMLElement) &&
    rightPanelPinned instanceof HTMLElement &&
    pageRow instanceof HTMLElement &&
    !pageRow.draggable &&
    pageButton instanceof HTMLButtonElement &&
    pageButton.draggable;
});

await page.setViewportSize({ width: 1100, height: 720 });
checks.nativeMediumViewportHidesLeftPanelFirst = await page.evaluate(() => {
  const sidebar = document.querySelector('.app-shell .sidebar');
  const rightPanel = document.querySelector('.app-shell .right-panel');
  const pageSurface = document.querySelector('.app-shell .page-surface');
  if (!(sidebar instanceof HTMLElement) || !(rightPanel instanceof HTMLElement) || !(pageSurface instanceof HTMLElement)) return false;
  return getComputedStyle(sidebar).display === 'none' &&
    getComputedStyle(rightPanel).display !== 'none' &&
    pageSurface.getBoundingClientRect().width > 0;
});
await page.setViewportSize({ width: 900, height: 720 });
checks.nativeNarrowViewportHidesRightPanelSecond = await page.evaluate(() => {
  const sidebar = document.querySelector('.app-shell .sidebar');
  const rightPanel = document.querySelector('.app-shell .right-panel');
  const pageSurface = document.querySelector('.app-shell .page-surface');
  if (!(sidebar instanceof HTMLElement) || !(rightPanel instanceof HTMLElement) || !(pageSurface instanceof HTMLElement)) return false;
  const pageRect = pageSurface.getBoundingClientRect();
  return getComputedStyle(sidebar).display === 'none' &&
    getComputedStyle(rightPanel).display === 'none' &&
    pageRect.width <= window.innerWidth &&
    pageRect.width > 0;
});
await page.setViewportSize({ width: 1280, height: 720 });

await page.locator('.fish-desk-trigger').hover();
await page.locator('.fish-desk .view-toggle').filter({ hasText: 'Sidebar' }).click();
checks.nativeSidebarCanCollapseFromFishDesk = await page.evaluate(() => Boolean(
  document.querySelector('.app-shell.sidebar-collapsed')
) && getComputedStyle(document.querySelector('.app-shell.sidebar-collapsed .sidebar')).display === 'none');
await page.locator('.fish-desk-trigger').hover();
await page.locator('.fish-desk .view-toggle').filter({ hasText: 'Sidebar' }).click();

await chooseShell('native-ledger');
checks.nativeLedgerDiffers = await page.evaluate(() => {
  const sidebar = document.querySelector('.sidebar');
  const note = document.querySelector('.sidebar-note');
  if (!(sidebar instanceof HTMLElement) || !(note instanceof HTMLElement)) return false;
  const sidebarStyles = getComputedStyle(sidebar);
  const noteStyles = getComputedStyle(note);
  return sidebarStyles.position === 'sticky' && noteStyles.display === 'none';
});
await page.setViewportSize({ width: 1100, height: 720 });
checks.nativeLedgerMediumViewportHidesLeftPanelFirst = await page.evaluate(() => {
  const sidebar = document.querySelector('.app-shell .sidebar');
  const rightPanel = document.querySelector('.app-shell .right-panel');
  const pageSurface = document.querySelector('.app-shell .page-surface');
  if (!(sidebar instanceof HTMLElement) || !(rightPanel instanceof HTMLElement) || !(pageSurface instanceof HTMLElement)) return false;
  return getComputedStyle(sidebar).display === 'none' &&
    getComputedStyle(rightPanel).display !== 'none' &&
    pageSurface.getBoundingClientRect().width > 0;
});
await page.setViewportSize({ width: 900, height: 720 });
checks.nativeLedgerNarrowViewportHidesRightPanelSecond = await page.evaluate(() => {
  const sidebar = document.querySelector('.app-shell .sidebar');
  const rightPanel = document.querySelector('.app-shell .right-panel');
  const pageSurface = document.querySelector('.app-shell .page-surface');
  if (!(sidebar instanceof HTMLElement) || !(rightPanel instanceof HTMLElement) || !(pageSurface instanceof HTMLElement)) return false;
  return getComputedStyle(sidebar).display === 'none' &&
    getComputedStyle(rightPanel).display === 'none' &&
    pageSurface.getBoundingClientRect().width > 0;
});
await page.setViewportSize({ width: 1280, height: 720 });

await chooseShell('typora-base');
await chooseContentTheme('notebook');
checks.typoraShellSwitches = await page.evaluate(() => Boolean(
  document.querySelector('.typora-app-shell') &&
  document.querySelector('#typora-sidebar') &&
  document.querySelector('.fish-desk') &&
  !document.querySelector('.brand-block') &&
  !document.querySelector('.sidebar-note') &&
  !document.querySelector('.topbar')
));
await page.waitForTimeout(220);
checks.typoraOutlineClosedByDefault = await page.evaluate(() => {
  const shell = document.querySelector('.typora-app-shell');
  const drawer = document.querySelector('.outline-drawer');
  if (!(shell instanceof HTMLElement) || !(drawer instanceof HTMLElement)) return false;
  const shellStyles = getComputedStyle(shell);
  const drawerStyles = getComputedStyle(drawer);
  return !shell.classList.contains('outline-open') &&
    drawerStyles.opacity === '0' &&
    drawerStyles.pointerEvents === 'none' &&
    shellStyles.gridTemplateColumns.endsWith('0px');
});

await page.locator('.fish-desk-trigger').hover();
await page.locator('.fish-desk .view-toggle').filter({ hasText: 'Outline' }).click();
await page.setViewportSize({ width: 1240, height: 720 });
checks.typoraMediumViewportHidesLeftPanelFirst = await page.evaluate(() => {
  const sidebar = document.querySelector('#typora-sidebar');
  const drawer = document.querySelector('.typora-app-shell .outline-drawer');
  const workspace = document.querySelector('.typora-workspace');
  if (!(sidebar instanceof HTMLElement) || !(drawer instanceof HTMLElement) || !(workspace instanceof HTMLElement)) return false;
  const drawerStyles = getComputedStyle(drawer);
  return getComputedStyle(sidebar).visibility === 'hidden' &&
    getComputedStyle(drawer).display !== 'none' &&
    drawerStyles.pointerEvents === 'auto' &&
    drawer.getBoundingClientRect().width > 0 &&
    workspace.getBoundingClientRect().width > 0;
});
await page.setViewportSize({ width: 980, height: 720 });
await page.waitForTimeout(220);
checks.typoraNarrowViewportHidesRightPanelSecond = await page.evaluate(() => {
  const sidebar = document.querySelector('#typora-sidebar');
  const drawer = document.querySelector('.typora-app-shell .outline-drawer');
  const workspace = document.querySelector('.typora-workspace');
  if (!(sidebar instanceof HTMLElement) || !(drawer instanceof HTMLElement) || !(workspace instanceof HTMLElement)) return false;
  const drawerStyles = getComputedStyle(drawer);
  return getComputedStyle(sidebar).visibility === 'hidden' &&
    getComputedStyle(drawer).display === 'none' &&
    workspace.getBoundingClientRect().width > 0;
});
await page.setViewportSize({ width: 1440, height: 720 });
await page.locator('.fish-desk-trigger').hover();
await page.locator('.fish-desk .view-toggle').filter({ hasText: 'Outline' }).click();
await page.waitForTimeout(220);

const composer = page.locator('.typora-write .composer');
await composer.click();
await composer.evaluate((element) => {
  element.innerHTML = [
    '<h1 class="md-heading md-end-block" data-heading-level="1">Contract Heading One</h1>',
    '<p class="md-end-block">Paragraph alias with <mark>theme mark</mark>, <kbd class="md-kbd">Cmd</kbd>, <code>inline</code>, and <a href="https://example.com">link</a>.</p>',
    '<blockquote class="md-end-block"><p class="md-end-block">Quote alias</p></blockquote>',
    '<ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">Parent</p><ul class="md-list"><li class="md-list-item md-end-block" data-list-collapsed="false"><p class="md-end-block">Child</p></li></ul></li></ul>',
    '<ul class="contains-task-list task-list md-list" data-type="taskList"><li data-checked="false" data-type="taskItem" class="task-list-item md-task-list-item md-end-block" data-list-collapsed="false" data-todo-style="plain"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p class="md-end-block">task alias</p></div></li></ul>',
    '<ul class="contains-task-list task-list md-list" data-type="taskList"><li data-checked="false" data-type="taskItem" class="task-list-item md-task-list-item md-end-block" data-list-collapsed="false" data-todo-style="bracket"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p class="md-end-block">bracket task alias</p></div></li></ul>',
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
    const bracketTask = surface.querySelector('li[data-type="taskItem"][data-todo-style="bracket"]');
    const math = surface.querySelector('[data-type="block-math"]');
    if (!(pre instanceof HTMLElement) || !(table instanceof HTMLElement) || !(td instanceof HTMLElement) || !(cellParagraph instanceof HTMLElement) || !(h1 instanceof HTMLElement) || !(mark instanceof HTMLElement) || !(bracketTask instanceof HTMLElement) || !(math instanceof HTMLElement)) return false;

    const preStyles = getComputedStyle(pre);
    const tableStyles = getComputedStyle(table);
    const tdStyles = getComputedStyle(td);
    const cellParagraphStyles = getComputedStyle(cellParagraph);
    const h1Styles = getComputedStyle(h1);
    const markStyles = getComputedStyle(mark);
    const bracketTaskStyles = getComputedStyle(bracketTask);
    const mathStyles = getComputedStyle(math);

    if (currentTheme === 'typora-swiss') {
      return preStyles.backgroundColor === 'rgb(255, 255, 255)' &&
        preStyles.backgroundImage === 'none' &&
        tableStyles.borderCollapse === 'collapse' &&
        tdStyles.verticalAlign === 'top' &&
        cellParagraphStyles.marginTop === '0px' &&
        h1Styles.borderLeftWidth === '5px' &&
        markStyles.borderTopStyle === 'solid' &&
        bracketTaskStyles.backgroundColor === markStyles.backgroundColor &&
        bracketTaskStyles.color === markStyles.color &&
        bracketTaskStyles.borderTopStyle === markStyles.borderTopStyle &&
        bracketTaskStyles.borderRadius === markStyles.borderRadius &&
        mathStyles.backgroundColor === preStyles.backgroundColor;
    }

    if (currentTheme === 'typora-konayuki') {
      return preStyles.backgroundImage === 'none' &&
        tableStyles.borderCollapse === 'separate' &&
        tdStyles.verticalAlign === 'middle' &&
        mathStyles.backgroundColor === preStyles.backgroundColor &&
        markStyles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        bracketTaskStyles.backgroundColor === markStyles.backgroundColor &&
        bracketTaskStyles.color === markStyles.color &&
        bracketTaskStyles.borderRadius === markStyles.borderRadius;
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

await page.locator('.fish-desk-trigger').hover();
await page.locator('.fish-desk .view-toggle').filter({ hasText: 'Outline' }).click();
checks.typoraOutlineDoesNotUseContentTocCard = await page.evaluate(() => {
  const drawer = document.querySelector('.outline-drawer.is-open');
  const outline = drawer?.querySelector('.outline-content.md-toc-content');
  if (!(drawer instanceof HTMLElement) || !(outline instanceof HTMLElement)) return false;
  const styles = getComputedStyle(outline);
  return styles.backgroundColor === 'rgba(0, 0, 0, 0)' &&
    styles.borderTopStyle === 'none' &&
    styles.boxShadow === 'none' &&
    styles.paddingTop === '0px' &&
    styles.marginTop === '0px';
});

checks.typoraOutlineKeepsTypeLabels = await page.evaluate(() => {
  const firstItem = document.querySelector('.outline-drawer .outline-item');
  const expander = firstItem?.querySelector('.outline-expander');
  const label = firstItem?.querySelector('.outline-label');
  if (!(firstItem instanceof HTMLElement) || !(expander instanceof HTMLElement) || !(label instanceof HTMLElement)) return false;
  return expander.textContent?.trim().length > 0 &&
    label.textContent?.trim().length > 0 &&
    firstItem.textContent?.trim().startsWith(expander.textContent?.trim() ?? '');
});

checks.typoraOutlineOpensFromFishDesk = await page.evaluate(() => {
  const drawer = document.querySelector('.outline-drawer.is-open');
  const shell = document.querySelector('.typora-app-shell.outline-open');
  if (!(drawer instanceof HTMLElement) || !(shell instanceof HTMLElement)) return false;
  const rect = drawer.getBoundingClientRect();
  return rect.width <= 250 && rect.width >= 220;
});

await chooseContentTheme('typora-zeus');
checks.zeusShellUsesThemeSidebarBackground = await page.evaluate(() => {
  const sidebar = document.querySelector('#typora-sidebar');
  const label = document.querySelector('.outline-drawer .outline-label');
  if (!(sidebar instanceof HTMLElement) || !(label instanceof HTMLElement)) return false;
  const sidebarStyles = getComputedStyle(sidebar);
  const labelStyles = getComputedStyle(label);
  return sidebarStyles.backgroundColor === 'rgb(37, 37, 38)' &&
    labelStyles.color === 'rgb(204, 204, 204)';
});

checks.typoraSidebarContract = await page.evaluate(() => {
  const sidebar = document.querySelector('#typora-sidebar');
  const files = document.querySelector('.file-library-node');
  const outline = document.querySelector('.outline-drawer .outline-item');
  const desk = document.querySelector('.fish-desk');
  const deskTools = document.querySelector('.fish-desk .typora-tool-controls');
  const pinList = document.querySelector('#typora-sidebar .sidebar-pin-list');
  const fileButton = document.querySelector('.file-node-content:not(.notebook-node)');
  if (!(sidebar instanceof HTMLElement) || !(files instanceof HTMLElement) || !(outline instanceof HTMLElement) || !(desk instanceof HTMLElement) || !(deskTools instanceof HTMLElement)) return false;
  const fileNodeContent = files.querySelector('.file-node-content');
  if (!(fileNodeContent instanceof HTMLElement)) return false;
  const fileStyles = getComputedStyle(fileNodeContent);
  const outlineStyles = getComputedStyle(outline);
  return getComputedStyle(sidebar).display !== 'none' &&
    fileStyles.borderRadius !== '999px' &&
    outlineStyles.borderRadius !== '999px' &&
    desk.querySelector('.fish-desk-trigger img') !== null &&
    deskTools.querySelector('.shell-theme-select') !== null &&
    [...deskTools.querySelectorAll('label')].some((label) => label.textContent?.includes('Outline') && label.querySelector('input[type="checkbox"]')) &&
    [...deskTools.querySelectorAll('label')].some((label) => label.textContent?.includes('Sidebar') && label.querySelector('input[type="checkbox"]')) &&
    pinList instanceof HTMLElement &&
    fileButton instanceof HTMLButtonElement &&
    fileButton.draggable &&
    fileButton.closest('.file-node-row-shell')?.draggable === false;
});

await page.setViewportSize({ width: 1440, height: 720 });
await page.waitForTimeout(120);
await chooseContentTheme('typora-gruvbox-dark');
await page.evaluate(() => {
  const composer = document.querySelector('.typora-write .composer');
  if (composer instanceof HTMLElement && !composer.querySelector('mark')) {
    composer.insertAdjacentHTML('beforeend', '<p class="md-end-block"><mark>theme mark probe</mark></p>');
  }
});
if (await page.locator('.block-created-at.is-pinned').count() > 0) {
  await page.locator('.block-created-at.is-pinned').first().click();
  await page.waitForFunction(() => !document.querySelector('.block-created-at')?.classList.contains('is-pinned'));
}
const typoraPinnedBlockDateBefore = await page.evaluate(() => {
  const blockTime = document.querySelector('.block-created-at');
  const mark = document.querySelector('.typora-write mark');
  if (!(blockTime instanceof HTMLElement) || !(mark instanceof HTMLElement)) return false;
  const beforeBackground = getComputedStyle(blockTime).backgroundColor;
  const markStyles = getComputedStyle(mark);
  return {
    unpinnedIsBare: beforeBackground === 'rgba(0, 0, 0, 0)',
    markBackground: markStyles.backgroundColor,
    markColor: markStyles.color
  };
});
await page.locator('.block-created-at').first().click();
await page.waitForFunction(() => document.querySelector('.block-created-at')?.classList.contains('is-pinned'));
const typoraPinnedBlockDateAfter = await page.evaluate(() => {
  const blockTime = document.querySelector('.block-created-at');
  if (!(blockTime instanceof HTMLElement)) return null;
  const afterStyles = getComputedStyle(blockTime);
  return {
    background: afterStyles.backgroundColor,
    color: afterStyles.color
  };
});
checks.typoraPinnedBlockDateMatchesThemeMark = Boolean(typoraPinnedBlockDateBefore && typoraPinnedBlockDateAfter) &&
  typoraPinnedBlockDateBefore.unpinnedIsBare &&
  typoraPinnedBlockDateAfter.background === typoraPinnedBlockDateBefore.markBackground &&
  typoraPinnedBlockDateAfter.color === typoraPinnedBlockDateBefore.markColor;

checks.typoraPinnedBlockDateMatchesPrintAndZeusMarks = true;
for (const theme of ['typora-print', 'typora-zeus']) {
  await chooseContentTheme(theme);
  await page.evaluate(() => {
    const composer = document.querySelector('.typora-write .composer');
    if (composer instanceof HTMLElement && !composer.querySelector('mark')) {
      composer.insertAdjacentHTML('beforeend', '<p class="md-end-block"><mark>theme mark probe</mark></p>');
    }
  });
  if (await page.locator('.block-created-at.is-pinned').count() > 0) {
    await page.locator('.block-created-at.is-pinned').first().click();
    await page.waitForFunction(() => !document.querySelector('.block-created-at')?.classList.contains('is-pinned'));
  }
  const beforeThemeDate = await page.evaluate(() => {
    const blockTime = document.querySelector('.block-created-at');
    const mark = document.querySelector('.typora-write mark');
    if (!(blockTime instanceof HTMLElement) || !(mark instanceof HTMLElement)) return null;
    const beforeBackground = getComputedStyle(blockTime).backgroundColor;
    const markStyles = getComputedStyle(mark);
    return {
      unpinnedIsBare: beforeBackground === 'rgba(0, 0, 0, 0)',
      backgroundColor: markStyles.backgroundColor,
      color: markStyles.color,
      fontWeight: markStyles.fontWeight,
      borderTopStyle: markStyles.borderTopStyle
    };
  });
  await page.locator('.block-created-at').first().click();
  await page.waitForFunction(() => document.querySelector('.block-created-at')?.classList.contains('is-pinned'));
  const afterThemeDate = await page.evaluate(() => {
    const blockTime = document.querySelector('.block-created-at');
    if (!(blockTime instanceof HTMLElement)) return null;
    const dateStyles = getComputedStyle(blockTime);
    return {
      backgroundColor: dateStyles.backgroundColor,
      color: dateStyles.color,
      fontWeight: dateStyles.fontWeight,
      borderTopStyle: dateStyles.borderTopStyle
    };
  });
  const themeMatch = Boolean(beforeThemeDate && afterThemeDate) &&
    beforeThemeDate.unpinnedIsBare &&
    afterThemeDate.backgroundColor === beforeThemeDate.backgroundColor &&
    afterThemeDate.color === beforeThemeDate.color &&
    afterThemeDate.fontWeight === beforeThemeDate.fontWeight &&
    afterThemeDate.borderTopStyle === beforeThemeDate.borderTopStyle;
  checks.typoraPinnedBlockDateMatchesPrintAndZeusMarks = checks.typoraPinnedBlockDateMatchesPrintAndZeusMarks && themeMatch;
}

await chooseContentTheme('typora-zeus');
checks.zeusBlockDividerHasOnlyThemeDashedLine = await page.evaluate(() => {
  const divider = document.querySelector('.typora-write hr.block-divider.uses-theme-divider');
  if (!(divider instanceof HTMLHRElement)) return false;
  const styles = getComputedStyle(divider);
  return styles.borderTopStyle === 'dashed' &&
    styles.borderRightStyle === 'none' &&
    styles.borderBottomStyle === 'none' &&
    styles.borderLeftStyle === 'none' &&
    styles.backgroundColor === 'rgba(0, 0, 0, 0)';
});

await chooseContentTheme('typora-gruvbox-dark');
await page.locator('#typora-sidebar .file-node-content:not(.notebook-node)').first().click();
checks.typoraDarkRenameAndChromeRemainReadable = await page.evaluate(() => {
  const channels = (value) => {
    const rgb = value.match(/rgba?\(([^)]+)\)/i);
    if (rgb) return rgb[1].split(/[\s,\/]+/).slice(0, 3).map((part) => Number.parseFloat(part));
    const srgb = value.match(/color\(srgb\s+([^)]+)\)/i);
    if (srgb) return srgb[1].split(/\s+/).slice(0, 3).map((part) => Number.parseFloat(part) * 255);
    return null;
  };
  const luminance = (value) => {
    const parts = channels(value);
    if (!parts) return null;
    const [r, g, b] = parts.map((part) => {
      const channel = part / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (foreground, background) => {
    const a = luminance(foreground);
    const b = luminance(background);
    if (a === null || b === null) return 0;
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
  };
  const backgroundFor = (element) => {
    let cursor = element;
    while (cursor instanceof HTMLElement) {
      const background = getComputedStyle(cursor).backgroundColor;
      if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return background;
      cursor = cursor.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const renameInput = document.querySelector('.page-name-input, .notebook-name-input');
  const outlineTitle = document.querySelector('.outline-drawer-head .panel-title');
  const blockTime = document.querySelector('.block-created-at');
  if (!(renameInput instanceof HTMLElement) || !(outlineTitle instanceof HTMLElement) || !(blockTime instanceof HTMLElement)) return false;
  const inputStyles = getComputedStyle(renameInput);
  const outlineStyles = getComputedStyle(outlineTitle);
  const timeStyles = getComputedStyle(blockTime);
  return contrast(inputStyles.color, inputStyles.backgroundColor) >= 4 &&
    contrast(outlineStyles.color, backgroundFor(outlineTitle)) >= 3 &&
    contrast(timeStyles.color, backgroundFor(blockTime)) >= 2.4;
});
await page.keyboard.press('Escape');
await page.waitForTimeout(120);
if (await page.locator('#typora-sidebar .sidebar-pin-card').count() === 0) {
  const isPinned = await page.locator('.block-created-at').first().evaluate((element) => element.classList.contains('is-pinned'));
  if (!isPinned) await page.locator('.block-created-at').first().click();
}
await page.locator('#typora-sidebar .sidebar-pin-card').first().click();
checks.typoraPinnedPopupUsesContentThemeBackground = await page.evaluate(() => {
  const channels = (value) => {
    const rgb = value.match(/rgba?\(([^)]+)\)/i);
    if (rgb) return rgb[1].split(/[\s,\/]+/).slice(0, 3).map((part) => Number.parseFloat(part));
    const srgb = value.match(/color\(srgb\s+([^)]+)\)/i);
    if (srgb) return srgb[1].split(/\s+/).slice(0, 3).map((part) => Number.parseFloat(part) * 255);
    return null;
  };
  const luminance = (value) => {
    const parts = channels(value);
    if (!parts) return null;
    const [r, g, b] = parts.map((part) => {
      const channel = part / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const popup = document.querySelector('.floating-card-window');
  const body = document.querySelector('.floating-card-window .floating-card-body');
  if (!(popup instanceof HTMLElement) || !(body instanceof HTMLElement)) return false;
  const popupStyles = getComputedStyle(popup);
  const bodyStyles = getComputedStyle(body);
  const backgroundLuminance = luminance(popupStyles.backgroundColor);
  const textLuminance = luminance(bodyStyles.color);
  const popupBackground = channels(popupStyles.backgroundColor);
  const bodyBackground = channels(bodyStyles.backgroundColor);
  const backgroundsMatch = popupBackground && bodyBackground && popupBackground.every((channel, index) => Math.abs(channel - bodyBackground[index]) <= 3);
  return backgroundLuminance !== null &&
    textLuminance !== null &&
    backgroundLuminance < 0.08 &&
    textLuminance > 0.65 &&
    backgroundsMatch &&
    bodyStyles.color === 'rgb(235, 219, 178)' &&
    popupStyles.color === bodyStyles.color;
});
const popupExpandedHeight = await page.locator('.floating-card-window').evaluate((element) => element.getBoundingClientRect().height);
await page.locator('.floating-card-title').click();
await page.waitForFunction(() => {
  const popup = document.querySelector('.floating-card-window');
  return popup?.classList.contains('is-collapsed') && !document.querySelector('.floating-card-window .floating-card-body');
});
checks.typoraPinnedPopupCollapseIsCompact = await page.evaluate((expandedHeight) => {
  const popup = document.querySelector('.floating-card-window');
  const title = document.querySelector('.floating-card-window .floating-card-title');
  if (!(popup instanceof HTMLElement) || !(title instanceof HTMLButtonElement)) return false;
  const collapsedHeight = popup.getBoundingClientRect().height;
  const body = document.querySelector('.floating-card-window .floating-card-body');
  return popup.classList.contains('is-collapsed') &&
    !(body instanceof HTMLElement) &&
    collapsedHeight < expandedHeight &&
    collapsedHeight <= 44 &&
    /\S+\s{2}\S+/.test(title.textContent ?? '');
}, popupExpandedHeight);
await page.locator('.floating-card-title').click();
await page.waitForFunction(() => document.querySelector('.floating-card-window .floating-card-body'));
await page.locator('.floating-card-head button[aria-label="Close pinned card"]').click();

await page.locator('.fish-desk-trigger').hover();
await page.locator('.fish-desk .view-toggle').filter({ hasText: 'Sidebar' }).click();
checks.typoraSidebarCanCollapseFromFishDesk = await page.evaluate(() => {
  const shell = document.querySelector('.typora-app-shell.sidebar-collapsed');
  const sidebar = document.querySelector('#typora-sidebar');
  if (!(shell instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) return false;
  const styles = getComputedStyle(sidebar);
  return styles.visibility === 'hidden' && styles.pointerEvents === 'none';
});
await page.locator('.fish-desk-trigger').hover();
await page.locator('.fish-desk .view-toggle').filter({ hasText: 'Sidebar' }).click();

await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.composer').last().waitFor({ state: 'visible' });
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  const activePage = state.pages?.find((storedPage) => storedPage.id === state.activePageId);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 1);
  const block = {
    id: 'block_calendar_smoke',
    pageId: activePage.id,
    content: {
      html: '<p>calendar smoke block</p>',
      plainText: 'calendar smoke block'
    },
    collapsed: false,
    pinned: false,
    createdAt: futureDate.toISOString(),
    updatedAt: futureDate.toISOString()
  };
  activePage.blockIds = [...activePage.blockIds, block.id];
  state.blocks = [...state.blocks, block];
  localStorage.setItem('block-first-notebook.state.v1', JSON.stringify(state));
});
await page.reload({ waitUntil: 'domcontentloaded' });
checks.nativeCalendarDataRemainsAvailable = await page.evaluate(() => {
  const localDateKey = (date) => `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
  const expectedDate = new Date();
  expectedDate.setDate(expectedDate.getDate() + 1);
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  const block = state.blocks?.find((candidate) => candidate.id === 'block_calendar_smoke');
  return Boolean(block?.content?.plainText?.includes('calendar smoke block')) &&
    localDateKey(new Date(block.createdAt)) === localDateKey(expectedDate) &&
    !document.querySelector('.right-panel .calendar-view');
});

await chooseShell('typora-base');
checks.typoraCalendarTabRemoved = await page.evaluate(() => {
  const sidebarTabs = document.querySelector('.sidebar-tabs');
  const hasCalendarTab = Array.from(sidebarTabs?.querySelectorAll('button') ?? []).some((button) => button.textContent?.trim() === 'Calendar');
  const hasOutlineTab = Array.from(sidebarTabs?.querySelectorAll('button') ?? []).some((button) => button.textContent?.trim() === 'Outline');
  return !sidebarTabs && !hasCalendarTab && !hasOutlineTab && Boolean(document.querySelector('.fish-desk .typora-tool-controls'));
});

await page.goto(appUrl);
await page.locator('.composer').last().waitFor({ state: 'visible' });
await page.locator('.composer').last().click();
await page.keyboard.type('```');
await page.keyboard.press('Enter');
await page.keyboard.type('const foldable = true;');
const codeFoldBefore = await page.evaluate(() => {
  const pre = document.querySelector('.composer pre.md-fences.notebook-code-block');
  const button = pre?.querySelector('.code-fold-button');
  const summary = pre?.querySelector('.code-block-summary');
  const code = pre?.querySelector('code');
  if (!(pre instanceof HTMLElement) || !(button instanceof HTMLElement) || !(summary instanceof HTMLElement) || !(code instanceof HTMLElement)) return false;
  return getComputedStyle(summary).display === 'none' && getComputedStyle(code).display !== 'none';
});
await page.locator('.composer .code-fold-button').click();
const codeFoldAfter = await page.evaluate(() => {
  const pre = document.querySelector('.composer pre.md-fences.notebook-code-block');
  const summary = pre?.querySelector('.code-block-summary');
  const code = pre?.querySelector('code');
  if (!(pre instanceof HTMLElement) || !(summary instanceof HTMLElement) || !(code instanceof HTMLElement)) return false;
  const summaryAfter = getComputedStyle(summary).display;
  const codeAfter = getComputedStyle(code).display;
  return pre.dataset.codeCollapsed === 'true' &&
    summaryAfter !== 'none' &&
    summary.textContent?.includes('const foldable') &&
    codeAfter === 'none';
});
checks.codeBlockCanCollapseInline = codeFoldBefore && codeFoldAfter;

const cardBlockId = 'block_card_smoke';
await page.evaluate((blockId) => {
  const state = JSON.parse(localStorage.getItem('block-first-notebook.state.v1') ?? '{}');
  const longHtml = `<p>${Array.from({ length: 80 }, (_, index) => `Pinned long card line ${index + 1}`).join('</p><p>')}</p>`;
  state.blocks = [
    ...(state.blocks ?? []),
    {
      id: blockId,
      pageId: state.activePageId,
      content: {
        html: `<p><strong>Pinned</strong> smoke card</p><ul><li>compact item</li></ul><ul data-type="taskList"><li data-checked="false" data-type="taskItem" data-todo-style="plain"><label><input type="checkbox"><span></span></label><div><p>task item</p></div></li></ul>${longHtml}`,
        plainText: 'Pinned smoke card compact item long scrolling content'
      },
      collapsed: false,
      pinned: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
  localStorage.setItem('block-first-notebook.state.v1', JSON.stringify(state));
}, cardBlockId);
await page.goto(`${appUrl}?card=${cardBlockId}`);
checks.cardWindowModeIsCompactAndShellFree = await page.evaluate(() => {
  const page = document.querySelector('.card-window-page');
  const grip = document.querySelector('.card-window-grip');
  const body = document.querySelector('.floating-card-body.card-mode');
  const list = document.querySelector('.card-mode-editor ul');
  const task = document.querySelector('.card-mode-editor li[data-checked]');
  if (!(page instanceof HTMLElement) || !(grip instanceof HTMLElement) || !(body instanceof HTMLElement) || !(list instanceof HTMLElement) || !(task instanceof HTMLElement)) return false;
  const bodyStyles = getComputedStyle(body);
  const gripStyles = getComputedStyle(grip);
  const listStyles = getComputedStyle(list);
  const taskStyles = getComputedStyle(task);
  return !document.querySelector('.typora-app-shell') &&
    !document.querySelector('.app-shell') &&
    !grip.textContent?.includes('Pin card') &&
    gripStyles.cursor === 'move' &&
    Number.parseFloat(bodyStyles.fontSize) <= 13.5 &&
    Number.parseFloat(listStyles.paddingLeft) <= 18 &&
    Number.parseFloat(taskStyles.columnGap) <= 5 &&
    body.textContent?.includes('Pinned smoke card');
});

checks.cardWindowHeaderStaysVisibleWhileEditingLongCard = await page.evaluate(() => {
  const page = document.querySelector('.card-window-page');
  const grip = document.querySelector('.card-window-grip');
  const body = document.querySelector('.floating-card-body.card-mode');
  if (!(page instanceof HTMLElement) || !(grip instanceof HTMLElement) || !(body instanceof HTMLElement)) return false;
  body.scrollTop = body.scrollHeight;
  const pageRect = page.getBoundingClientRect();
  const gripRect = grip.getBoundingClientRect();
  return body.scrollTop > 0 &&
    gripRect.top >= pageRect.top &&
    gripRect.top - pageRect.top <= 12 &&
    gripRect.bottom <= pageRect.bottom &&
    getComputedStyle(grip).position === 'sticky';
});

await page.goto(`${appUrl}?card=${cardBlockId}`);
const cardModeEditor = page.locator('.card-window-page .card-mode-editor');
await cardModeEditor.click();
await page.keyboard.type('!');
checks.cardWindowEditable = await page.evaluate(() => {
  const editor = document.querySelector('.card-window-page .card-mode-editor');
  const toolbar = document.querySelector('.card-window-page .format-toolbar');
  if (!(editor instanceof HTMLElement) || toolbar) return false;
  return editor.textContent?.includes('!') ?? false;
});

await page.evaluate(() => localStorage.clear());
console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
