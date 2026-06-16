import { chromium } from '@playwright/test';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const targetFolder = process.argv[2] ?? process.env.IMPORT_FOLDER_PATH;
if (!targetFolder) {
  console.error('Usage: node scripts/markdown-folder-stress.mjs /path/to/folder');
  process.exit(1);
}

const markdownFileRegex = /\.(md|markdown|txt)$/i;

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(path));
      continue;
    }
    if (entry.isFile()) files.push(path);
  }
  return files;
};

const scanStarted = performance.now();
const files = await walk(targetFolder);
const stats = await Promise.all(files.map(async (path) => ({ path, size: (await stat(path)).size })));
const markdownFiles = stats.filter((item) => markdownFileRegex.test(item.path));
const scanMs = performance.now() - scanStarted;
const totalBytes = stats.reduce((sum, item) => sum + item.size, 0);
const markdownBytes = markdownFiles.reduce((sum, item) => sum + item.size, 0);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(Number(process.env.STRESS_TIMEOUT_MS ?? 300_000));

const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:5173/');
appUrl.searchParams.set('importStress', '1');
appUrl.searchParams.set('persistence', 'off');

await page.goto(appUrl.toString());
await page.evaluate(() => localStorage.clear());
await page.reload();

const importStarted = performance.now();
await page.locator('input[webkitdirectory]').first().setInputFiles(targetFolder);
const notice = page.locator('.import-notice.success, .import-notice.error').first();
await notice.waitFor({ state: 'visible' });
const importMs = performance.now() - importStarted;
const noticeText = await notice.innerText();
const noticeClass = await notice.getAttribute('class');

const result = {
  folder: targetFolder,
  rootName: basename(targetFolder),
  scan: {
    files: stats.length,
    markdownFiles: markdownFiles.length,
    totalMb: Number((totalBytes / 1024 / 1024).toFixed(1)),
    markdownMb: Number((markdownBytes / 1024 / 1024).toFixed(1)),
    ms: Math.round(scanMs)
  },
  import: {
    ok: Boolean(noticeClass?.includes('success')),
    ms: Math.round(importMs),
    seconds: Number((importMs / 1000).toFixed(1)),
    notice: noticeText
  }
};

console.log(JSON.stringify(result, null, 2));
await browser.close();

if (!result.import.ok) process.exit(1);
