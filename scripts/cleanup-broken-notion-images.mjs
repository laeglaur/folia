import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const dbPath = args.find((arg) => !arg.startsWith('--'))
  ?? process.env.NOTEBOOK_DB
  ?? join(homedir(), 'Library/Application Support/com.laeglaur.notebook/notebook.sqlite3');
const appDataDir = dirname(dbPath);
const tempSqlPath = join(tmpdir(), `notebook-cleanup-images-${Date.now()}.sql`);

const quoteSql = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`;
const sqliteJson = (sql) => {
  const raw = execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 }).trim();
  return raw ? JSON.parse(raw) : [];
};
const sqlite = (sql) => execFileSync('sqlite3', [dbPath, sql], { stdio: 'inherit', maxBuffer: 1024 * 1024 * 200 });

const decodeRepeatedly = (value) => {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
};

const normalizeAbsolutePath = (value) =>
  decodeRepeatedly(value).replace(/^\/+(?=(Users|private|Volumes|var)\b)/, '/');

const pathFromStoredMediaSrc = (src) => {
  try {
    if (src.startsWith('asset://localhost/') || src.startsWith('file://')) {
      return normalizeAbsolutePath(new URL(src).pathname);
    }
    if (/^https?:\/\/asset\.localhost\//i.test(src)) {
      return normalizeAbsolutePath(new URL(src).pathname);
    }
  } catch {
    return null;
  }
  if (src.startsWith('/Users/') || src.startsWith('/private/') || src.startsWith('/Volumes/') || src.startsWith('/var/')) {
    return normalizeAbsolutePath(src);
  }
  return null;
};

const isNotionCoverSrc = (src) =>
  /^https?:\/\/www\.notion\.so\/images\/page-cover\//i.test(src)
  || /^https?:\/\/(?:prod-files-secure|s3)\./i.test(src)
  || /\/(notion|images)\/page-cover\//i.test(src);

const removalReasonForSrc = (src) => {
  if (!src) return 'empty src';
  if (isNotionCoverSrc(src)) return 'notion cover';
  const path = pathFromStoredMediaSrc(src);
  if (path && !existsSync(path)) return 'missing local asset';
  return null;
};

const compactText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const textFromHtml = (html) => compactText(
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
);

const cleanBlockHtml = (html, onRemoved) => {
  if (typeof html !== 'string' || !/<img\b/i.test(html)) return html;
  return html.replace(/<img\b[^>]*\bsrc=(["'])([^"']*)\1[^>]*>/gi, (match, _quote, src) => {
    const reason = removalReasonForSrc(src.trim());
    if (!reason) return match;
    onRemoved(src.trim(), reason);
    return '';
  });
};

if (!existsSync(dbPath)) {
  console.log(`No SQLite database found at ${dbPath}`);
  process.exit(0);
}

const rows = sqliteJson(`
SELECT
  pages.id AS page_id,
  pages.title AS page_title,
  pages.content_json AS content_json
FROM pages
WHERE pages.content_json LIKE '%<img%';
`);

const changedPages = [];
const removals = [];

for (const row of rows) {
  let content;
  try {
    content = JSON.parse(row.content_json || '{}');
  } catch {
    continue;
  }
  const blocks = Array.isArray(content.blocks) ? content.blocks : Array.isArray(content) ? content : [];
  let changed = false;
  const nextBlocks = blocks.map((block) => {
    const html = block?.content?.html;
    const nextHtml = cleanBlockHtml(html, (src, reason) => {
      changed = true;
      removals.push({
        pageId: row.page_id,
        pageTitle: row.page_title,
        blockId: block.id,
        reason,
        src
      });
    });
    return nextHtml === html ? block : { ...block, content: { ...block.content, html: nextHtml } };
  });
  if (!changed) continue;
  const nextContent = Array.isArray(content)
    ? nextBlocks
    : { ...content, blocks: nextBlocks };
  const searchText = nextBlocks
    .map((block) => `${block?.content?.plainText ?? block?.content?.plain_text ?? ''} ${textFromHtml(block?.content?.html ?? '')}`)
    .join(' ');
  changedPages.push({
    pageId: row.page_id,
    pageTitle: row.page_title,
    contentJson: JSON.stringify(nextContent),
    searchText
  });
}

const summary = {
  mode: shouldWrite ? 'write' : 'dry-run',
  dbPath,
  scannedPages: rows.length,
  changedPages: changedPages.length,
  removedImages: removals.length,
  removalsByReason: removals.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {}),
  sample: removals.slice(0, 20)
};

console.log(JSON.stringify(summary, null, 2));

if (!shouldWrite || !changedPages.length) {
  process.exit(0);
}

const statements = changedPages.map((page) => `
UPDATE pages
SET
  content_json = ${quoteSql(page.contentJson)},
  search_text = ${quoteSql(page.searchText)},
  updated_at = CURRENT_TIMESTAMP
WHERE id = ${quoteSql(page.pageId)};
DELETE FROM fts_pages WHERE page_id = ${quoteSql(page.pageId)};
INSERT INTO fts_pages (page_id, title, search_text, metadata_text)
SELECT id, title, search_text, metadata_json FROM pages WHERE id = ${quoteSql(page.pageId)};
`).join('\n');

await writeFile(tempSqlPath, `
PRAGMA busy_timeout = 5000;
BEGIN;
${statements}
COMMIT;
`);

try {
  sqlite(`.read ${tempSqlPath}`);
  writeFileSync(`${tempSqlPath}.summary.json`, JSON.stringify(summary, null, 2));
  console.log(`Removed ${removals.length} broken image reference${removals.length === 1 ? '' : 's'} from ${changedPages.length} page${changedPages.length === 1 ? '' : 's'}.`);
  console.log(`Summary saved to ${tempSqlPath}.summary.json`);
} finally {
  await rm(tempSqlPath, { force: true });
}
