import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
let browser;
for (let attempt = 0; attempt < 30; attempt++) {
  try { browser = await chromium.connectOverCDP('http://localhost:9222'); break; } catch { await new Promise(r => setTimeout(r,1000)); }
}
if (!browser) throw Error('WebView2 debugging endpoint never became available');
try {
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  page.setDefaultTimeout(20000);
  // Match the test-only main WebView environment when the UI creates child windows.
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (command, args, options) => {
      if (command === 'plugin:webview|create_webview_window') {
        args.options.additionalBrowserArgs = '--remote-debugging-port=9222';
      }
      return original(command, args, options);
    };
  });
  page.on('console', message => console.log('App:', message.text()));
  page.on('pageerror', error => console.log('App error:', error.message));
  await page.locator('.composer-card [contenteditable=true]').waitFor();
  await page.keyboard.press('Control+n');
  await page.getByLabel('Page title', {exact:true}).fill('Windows window test');
  const composer = page.locator('.composer-card [contenteditable=true]').first();
  await composer.fill('Portable window content');
  await composer.press('Shift+Enter');
  const pin = page.getByRole('button', {name:'Pin block',exact:true}).last();
  await pin.click();
  await page.locator('.sidebar-pin-card').last().click();
  async function findWindow(param) {
    for(let n=0;n<40;n++) {
      const found = context.pages().find(p => new URL(p.url()).searchParams.has(param));
      if(found) return found;
      await new Promise(r=>setTimeout(r,500));
    }
    throw Error(`Missing ${param} window. Main UI: ${await page.locator('body').innerText()}`);
  }
  const card = await findWindow('card');
  await card.getByText('Portable window content',{exact:true}).first().waitFor();
  await page.locator('.page-node-content').filter({hasText:'Windows window test'}).first().click({button:'right'});
  await page.getByRole('menuitem',{name:'Open in Window',exact:true}).click();
  const single = await findWindow('page');
  await single.getByLabel('Page title',{exact:true}).waitFor();
  assert.equal(await single.getByLabel('Page title',{exact:true}).inputValue(),'Windows window test');
  await single.getByText('Portable window content',{exact:true}).first().waitFor();
  console.log('Windows pinned and page windows render saved content: PASS');
} finally {await browser.close();}
