import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
 await page.goto('http://127.0.0.1:5173');
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 const choose = async (selector, value) => {
  await page.locator(selector).first().evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
 };
 for (const shell of ['typora-tilted', 'typora-collage']) {
  await choose('.shell-theme-select', shell);
  await choose('.content-theme-select', 'typora-base');
  await page.waitForSelector(`.paper-shell[data-shell="${shell}"]`);
  await page.locator('.fish-desk-trigger').click();
  await page.locator('.paper-settings summary').click();
  await page.getByLabel('左下文字', { exact: true }).fill(`Saved ${shell}`);
  await page.locator('.paper-settings summary').click();
  await page.reload();
  await page.waitForSelector(`.paper-shell[data-shell="${shell}"]`);
  assert.equal(await page.locator('.paper-sidebar-footer p').textContent(), `Saved ${shell}`);
  assert.equal(await page.locator('.typora-write .block').first().evaluate(el => getComputedStyle(el).boxShadow), 'none');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.paper-sprite svg image')).every(img => ['/app-assets/paper/material-sheet.png', '/app-assets/paper/material-sheet-2.png'].includes(img.getAttribute('href'))));
  await page.screenshot({ path: `/tmp/${shell}.png` });
  assert.equal(await page.locator('.typora-workspace').evaluate(el => getComputedStyle(el).transform), 'none');
  const paperColor = () => page.locator('.typora-workspace-frame').evaluate(el => getComputedStyle(el, '::before').backgroundColor);
  const initialPaper = await paperColor();
  await choose('.content-theme-select', 'typora-everforest-dark');
  assert.notEqual(await paperColor(), initialPaper, 'Paper must follow the content palette');
  await page.screenshot({ path: `/tmp/${shell}-dark.png` });
  await choose('.content-theme-select', 'typora-base');
  if (shell === 'typora-tilted') {
    for (const selector of ['#typora-sidebar', '.typora-workspace-frame', '.outline-drawer']) {
      const matrix = await page.locator(selector).evaluate(el => {
        const m = new DOMMatrix(getComputedStyle(el, '::before').transform);
        return { a: m.a, b: m.b, c: m.c, d: m.d };
      });
      assert.equal(matrix.c, 0, 'Vertical edges must stay upright');
      assert.notEqual(matrix.b, 0, 'Top edge must slope');
    }
  } else {
    const rects = await page.evaluate(() => ['#typora-sidebar', '.typora-workspace-frame', '.outline-drawer', '.paper-pinned-card'].map(s => {
      const r = document.querySelector(s).getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom };
    }));
    assert(rects[0].right > rects[1].left + 20);
    assert(rects[1].right > rects[2].left + 24);
    assert(rects[3].bottom > rects[2].top);
  }
  await choose('.content-theme-select', 'typora-swiss');
  assert.equal(await page.locator('.paper-shell').getAttribute('data-content-theme'), 'typora-swiss');
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForFunction(() => document.querySelector('.typora-workspace').getBoundingClientRect().width > 500);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1500, height: 950 });
 }
 assert.deepEqual(errors, []);
 console.log('Paper shells: persistence, independent content themes, horizontal content and narrow layout passed.');
} finally { await browser.close(); }
