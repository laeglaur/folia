import { chromium } from '@playwright/test';

const themes = ['garden', 'ledger'];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('http://127.0.0.1:5173/');
await page.evaluate(() => localStorage.clear());
await page.reload();

const checks = {};
const select = page.getByLabel('Shell theme');

for (const theme of themes) {
  await select.selectOption(theme);
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

await select.selectOption('ledger');
checks.ledgerCanHideDecorativeSidebar = await page.evaluate(() => {
  const eyebrow = document.querySelector('.eyebrow');
  const title = document.querySelector('.brand-block h1');
  const profile = document.querySelector('.profile-id');
  const note = document.querySelector('.sidebar-note');
  if (!(eyebrow instanceof HTMLElement) || !(title instanceof HTMLElement) || !(profile instanceof HTMLElement) || !(note instanceof HTMLElement)) return false;
  return [eyebrow, title, profile, note].every((element) => getComputedStyle(element).display === 'none');
});

const composer = page.locator('.composer').last();
await composer.click();
await page.keyboard.type('theme smoke');
checks.editorStillWorks = (await composer.innerText()).includes('theme smoke');

const contentSelect = page.locator('.content-theme-select');
await contentSelect.selectOption('notebook');
const notebookContentFont = await page.locator('.composer').last().evaluate((element) => getComputedStyle(element).fontFamily);
const sidebarFontBeforeContentTheme = await page.locator('.sidebar').evaluate((element) => getComputedStyle(element).fontFamily);

await contentSelect.selectOption('typora-base');
checks.contentThemeDataset = await page.evaluate(() => document.documentElement.dataset.contentTheme === 'typora-base');
checks.typoraScopeHooks = await page.evaluate(() => {
  const shell = document.querySelector('.typora-theme[data-content-theme="typora-base"]');
  const write = document.querySelector('.typora-write');
  const toc = document.querySelector('.outline-list.typora-toc.md-toc.md-toc-content');
  const tocItem = document.querySelector('.outline-entry.md-toc-item');
  return Boolean(shell && write && toc && tocItem);
});
checks.contentThemeChangesWritingSurface = await page.locator('.composer').last().evaluate((element, previousFont) =>
  getComputedStyle(element).fontFamily !== previousFont,
  notebookContentFont
);
checks.contentThemeDoesNotStyleSidebar = await page.locator('.sidebar').evaluate((element, previousFont) =>
  getComputedStyle(element).fontFamily === previousFont,
  sidebarFontBeforeContentTheme
);

await contentSelect.selectOption('typora-proof');
checks.typoraProofGeneratedCssApplies = await page.locator('.composer').last().evaluate((element) => {
  const styles = getComputedStyle(element);
  return styles.fontFamily.includes('Times New Roman') &&
    Math.abs(Number.parseFloat(styles.letterSpacing) - 0.51) < 0.05 &&
    Math.abs(Number.parseFloat(styles.lineHeight) - 30.26) < 1;
});
checks.typoraProofTocMapsToRightOutline = await page.locator('.outline-entry.md-toc-item').first().evaluate((element) =>
  getComputedStyle(element).textTransform === 'uppercase'
);
checks.typoraProofIgnoresTyporaSidebar = await page.locator('.sidebar').evaluate((element) =>
  getComputedStyle(element).display !== 'none'
);
checks.typoraProofKeepsPinnedCardsCompact = await page.locator('.desktop-card').first().evaluate((element) => {
  const styles = getComputedStyle(element);
  return styles.letterSpacing === 'normal' && Number.parseFloat(styles.fontSize) <= 13.5;
});

const pilotThemes = ['typora-konayuki', 'typora-folio', 'typora-zeus', 'typora-bonne-nouvelle', 'typora-flexoki-light'];
checks.pilotThemesAreSelectable = true;
for (const theme of pilotThemes) {
  await contentSelect.selectOption(theme);
  const themeApplied = await page.evaluate((expected) => document.documentElement.dataset.contentTheme === expected, theme);
  const writingSurfaceChanged = await page.locator('.composer').last().evaluate((element, baseFont) => {
    const styles = getComputedStyle(element);
    return styles.fontFamily !== baseFont || styles.backgroundColor !== 'rgba(0, 0, 0, 0)' || styles.letterSpacing !== 'normal';
  }, notebookContentFont);
  const sidebarVisible = await page.locator('.sidebar').evaluate((element) => getComputedStyle(element).display !== 'none');
  checks.pilotThemesAreSelectable = checks.pilotThemesAreSelectable && themeApplied && writingSurfaceChanged && sidebarVisible;
}

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
