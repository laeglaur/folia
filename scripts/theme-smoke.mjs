import { chromium } from '@playwright/test';

const themes = ['garden', 'paper', 'studio', 'archive'];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('http://127.0.0.1:5173/');
await page.evaluate(() => localStorage.clear());
await page.reload();

const checks = {};
const select = page.locator('.theme-select');

for (const theme of themes) {
  await select.selectOption(theme);
  checks[`${theme}:dataset`] = await page.evaluate((expected) => document.documentElement.dataset.theme === expected, theme);
  checks[`${theme}:tokens`] = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return Boolean(
      styles.getPropertyValue('--theme-bg').trim() &&
      styles.getPropertyValue('--theme-accent').trim() &&
      styles.getPropertyValue('--theme-highlight').trim() &&
      styles.getPropertyValue('--theme-bracket-todo').trim()
    );
  });
}

const composer = page.locator('.composer').last();
await composer.click();
await page.keyboard.type('theme smoke');
checks.editorStillWorks = (await composer.innerText()).includes('theme smoke');

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
