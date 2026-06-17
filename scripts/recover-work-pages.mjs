import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';

const args = new Set(process.argv.slice(2));
const shouldWrite = args.has('--write');
const dbPath = process.env.NOTEBOOK_DB
  ?? `${process.env.HOME}/Library/Application Support/com.laeglaur.notebook/notebook.sqlite3`;
const sourceRoot = process.env.NOTES_ORGANIZED
  ?? '/Users/laeglaur/Documents/work/notes_organized';

const quoteSql = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;
const jsonSql = (value) => quoteSql(JSON.stringify(value));
const nowIso = () => new Date().toISOString();

const sqlite = (sql) => execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 });
const queryJson = (sql) => {
  const raw = execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 }).trim();
  return raw ? JSON.parse(raw) : [];
};

const trimQuotes = (value) => value.trim().replace(/^['"]|['"]$/g, '');

const parseFrontmatterValue = (value) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => trimQuotes(item))
      .filter(Boolean);
  }
  return trimQuotes(trimmed);
};

const normalizeStringList = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value.map(trimQuotes).filter(Boolean) : [trimQuotes(value)].filter(Boolean);
};

const parseFrontmatter = (markdown, filename) => {
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { body: markdown, metadataPatch: { sourceFilename: filename } };

  const frontmatter = {};
  let currentListKey = null;
  match[1].split('\n').forEach((line) => {
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      frontmatter[currentListKey] = [...normalizeStringList(frontmatter[currentListKey]), trimQuotes(listMatch[1])];
      return;
    }
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) {
      currentListKey = null;
      return;
    }
    const [, key, rawValue] = keyValue;
    if (!rawValue.trim()) {
      frontmatter[key] = [];
      currentListKey = key;
      return;
    }
    frontmatter[key] = parseFrontmatterValue(rawValue);
    currentListKey = null;
  });

  return {
    body: normalized.slice(match[0].length),
    metadataPatch: {
      sourceFilename: filename,
      tags: normalizeStringList(frontmatter.tags),
      date: typeof frontmatter.date === 'string' ? frontmatter.date : null,
      status: typeof frontmatter.status === 'string' ? frontmatter.status : null,
      aliases: normalizeStringList(frontmatter.aliases),
      frontmatter
    }
  };
};

const escapeHtml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const markdownInlineToHtml = (value) => {
  const html = marked.parseInline(value.replace(/==([^=\n][\s\S]*?[^=\n])==/g, '<mark>$1</mark>'), {
    async: false,
    gfm: true
  });
  return typeof html === 'string' ? html : escapeHtml(value);
};

const slugAttribute = (value) => escapeHtml(value.replace(/[^a-zA-Z0-9_-]/g, '-'));

const normalizeMarkdownWhitespace = (markdown) =>
  markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (/^[\t ]*```/.test(line) ? line.trimStart() : line))
    .join('\n');

const normalizeFootnotes = (markdown) => {
  const footnotes = [];
  const withoutDefinitions = markdown
    .replace(/(?:^|\n)\[\^([^\]\n]+)\]:[^\S\r\n]*(.+(?:\n[ \t]{2,}.+)*)/g, (match, id, body) => {
      const content = body
        .split('\n')
        .map((line) => line.replace(/^[ \t]{2,}/, ''))
        .join('\n')
        .trim();
      footnotes.push({ id, html: markdownInlineToHtml(content) });
      return match.startsWith('\n') ? '\n' : '';
    });

  if (!footnotes.length) return withoutDefinitions;
  const referenced = withoutDefinitions.replace(/\[\^([^\]\n]+)\]/g, (_match, id) => {
    const safeId = slugAttribute(id);
    return `<sup class="md-footnote" data-footnote-id="${safeId}"><a href="#fn-${safeId}" id="fnref-${safeId}">[${escapeHtml(id)}]</a></sup>`;
  });
  const section = `<section class="footnotes" data-type="footnotes">${footnotes.map(({ id, html }) => {
    const safeId = slugAttribute(id);
    return `<div class="md-def-footnote" data-type="footnote-item" data-footnote-id="${safeId}" id="fn-${safeId}"><p><span class="footnote-label">[${escapeHtml(id)}]</span> ${html}</p></div>`;
  }).join('')}</section>`;
  return `${referenced.trimEnd()}\n\n${section}`;
};

const normalizeMath = (markdown) => {
  const withBlockMath = markdown.replace(/(^|\n)\$\$\n?([\s\S]*?)\n?\$\$(?=\n|$)/g, (match, prefix, latex) => {
    const trimmed = latex.trim();
    if (!trimmed) return match;
    return `${prefix}<div class="md-math-block" data-type="block-math" data-latex="${escapeHtml(trimmed)}"></div>`;
  });
  return withBlockMath.replace(/(?<!\\)\$(?!\$|\d)([^$\n]+?)(?<!\\)\$(?!\$|\d)/g, (_match, latex) => {
    const trimmed = latex.trim();
    if (!trimmed) return _match;
    return `<span class="md-math-inline" data-type="inline-math" data-latex="${escapeHtml(trimmed)}"></span>`;
  });
};

const alertTypeLabels = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};

const normalizeAlerts = (markdown) =>
  markdown.replace(/(?:^|\n)>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\n]*(?:\n>[ \t]?.*)*/gi, (match) => {
    const lines = match.replace(/^\n/, '').split('\n');
    const type = lines[0].match(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)?.[1].toLowerCase() ?? 'note';
    const body = lines
      .slice(1)
      .map((line) => line.replace(/^>[ \t]?/, ''))
      .join('\n')
      .trim();
    const title = alertTypeLabels[type] ?? 'Note';
    const bodyHtml = body ? markdownInlineToHtml(body) : '';
    return `\n<div class="md-alert md-alert-${type}" data-alert-type="${type}"><p class="md-alert-title md-alert-text">${title}</p>${bodyHtml ? `<p>${bodyHtml}</p>` : ''}</div>`;
  });

const urlWithoutQuery = (url) => url.split(/[?#]/)[0] ?? url;
const isVideoUrl = (url) => /\.(mp4|mov|webm|m4v)$/i.test(urlWithoutQuery(url));
const isAudioUrl = (url) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(urlWithoutQuery(url));

const embedUrlFor = (url) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return `https://www.youtube.com/embed/${escapeHtml(parsed.pathname.slice(1))}`;
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const videoId = parsed.searchParams.get('v');
      if (videoId) return `https://www.youtube.com/embed/${escapeHtml(videoId)}`;
      if (parsed.pathname.startsWith('/embed/')) return escapeHtml(parsed.href);
    }
    if (host === 'vimeo.com') {
      const videoId = parsed.pathname.split('/').filter(Boolean)[0];
      if (videoId) return `https://player.vimeo.com/video/${escapeHtml(videoId)}`;
    }
  } catch {
    return null;
  }
  return null;
};

const mediaHtmlForUrl = (url, label = '') => {
  const src = escapeHtml(url.trim());
  const title = escapeHtml(label.trim() || 'Embedded media');
  const embedUrl = embedUrlFor(url.trim());
  if (isVideoUrl(url)) return `<video controls src="${src}"></video>`;
  if (isAudioUrl(url)) return `<audio controls src="${src}"></audio>`;
  if (embedUrl) return `<iframe class="media-embed" src="${embedUrl}" title="${title}" loading="lazy" allowfullscreen></iframe>`;
  return null;
};

const normalizeMarkdownForMarked = (markdown) =>
  normalizeMath(normalizeFootnotes(normalizeAlerts(normalizeMarkdownWhitespace(markdown))))
    .replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (_match, alt, src) => `<img src="${escapeHtml(src.trim())}" alt="${escapeHtml(alt)}">`)
    .replace(/^[^\S\r\n]*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)[^\S\r\n]*$/gm, (match, label, url) => mediaHtmlForUrl(url, label) ?? match)
    .replace(/^[^\S\r\n]*(https?:\/\/\S+\.(?:mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|flac)(?:[?#]\S*)?)[^\S\r\n]*$/gim, (_match, url) => mediaHtmlForUrl(url) ?? _match)
    .replace(/^[^\S\r\n]*(https?:\/\/(?:www\.)?(?:youtu\.be|youtube\.com|m\.youtube\.com|vimeo\.com)\/\S+)[^\S\r\n]*$/gim, (_match, url) => mediaHtmlForUrl(url) ?? _match)
    .replace(/==([^=\n][\s\S]*?[^=\n])==/g, '<mark>$1</mark>')
    .replace(/^[^\S\r\n]*【】[^\S\r\n]+(.+)$/gm, '- [ ] <mark>$1</mark>')
    .replace(/(?:^[^\S\r\n]*[-*+][^\S\r\n]+\[[ xX]\][^\S\r\n]+.+(?:\n|$))+/gm, (block) => {
      const items = block
        .trimEnd()
        .split('\n')
        .map((line) => line.match(/^[^\S\r\n]*[-*+][^\S\r\n]+\[([ xX])\][^\S\r\n]+(.+)$/))
        .filter(Boolean);
      if (!items.length) return block;
      return `<ul data-type="taskList">${items.map((match) => {
        const checked = match[1].toLowerCase() === 'x';
        return `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}" data-todo-style="plain"><label><input type="checkbox" ${checked ? 'checked="checked"' : ''}><span></span></label><div><p>${markdownInlineToHtml(match[2])}</p></div></li>`;
      }).join('')}</ul>\n`;
    });

const markdownToHtml = (markdown) => {
  const html = marked.parse(normalizeMarkdownForMarked(markdown), {
    async: false,
    breaks: false,
    gfm: true
  });
  return typeof html === 'string' ? html.trim() : '';
};

const decodeEntities = (value) =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const htmlToPlainText = (html) =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const metadataText = (metadata) => [
  metadata.sourceFilename,
  metadata.date,
  metadata.status,
  ...(metadata.tags ?? []),
  ...(metadata.aliases ?? []),
  ...Object.values(metadata.frontmatter ?? {}).flatMap((value) => Array.isArray(value) ? value : [value])
].filter((value) => typeof value === 'string' && value.trim()).join(' ');

const rows = queryJson(`
  SELECT
    pages.id,
    pages.title,
    pages.notebook_id AS notebookId,
    pages.block_ids_json AS blockIdsJson,
    pages.metadata_json AS metadataJson,
    pages.created_at AS createdAt,
    pages.updated_at AS updatedAt
  FROM pages
  JOIN notebooks ON notebooks.id = pages.notebook_id
  WHERE notebooks.name = 'work'
    AND (length(pages.content_json) <= 60 OR pages.content_json LIKE '%"blocks":[]%')
    AND json_extract(pages.metadata_json, '$.sourceFilename') IS NOT NULL
  ORDER BY pages.rowid
`);

const recoveries = [];
const missingSources = [];
const skipped = [];

for (const row of rows) {
  const metadata = JSON.parse(row.metadataJson);
  const sourceFilename = metadata.sourceFilename;
  const sourcePath = join(sourceRoot, sourceFilename);
  if (!existsSync(sourcePath)) {
    missingSources.push({ title: row.title, sourceFilename });
    continue;
  }
  const blockIds = JSON.parse(row.blockIdsJson);
  const blockId = blockIds[0];
  if (!blockId) {
    skipped.push({ title: row.title, sourceFilename, reason: 'missing block id' });
    continue;
  }
  const markdown = readFileSync(sourcePath, 'utf8');
  const parsed = parseFrontmatter(markdown, sourceFilename);
  const body = parsed.body.trim();
  const html = markdownToHtml(body) || '<p></p>';
  const plainText = htmlToPlainText(html);
  const updatedAt = nowIso();
  const nextMetadata = {
    ...metadata,
    ...parsed.metadataPatch,
    sourceFilename,
    iconId: metadata.iconId ?? null
  };
  const block = {
    id: blockId,
    pageId: row.id,
    content: { html, plainText },
    collapsed: false,
    pinned: false,
    createdAt: row.createdAt,
    updatedAt
  };
  const content = {
    contentType: 'page_document',
    version: 1,
    blocks: [block]
  };
  recoveries.push({
    page: row,
    sourceFilename,
    metadata: nextMetadata,
    block,
    content,
    searchText: `${plainText} ${html}`,
    metadataText: metadataText(nextMetadata),
    updatedAt
  });
}

console.log(JSON.stringify({
  mode: shouldWrite ? 'write' : 'dry-run',
  dbPath,
  sourceRoot,
  emptyPagesWithSource: rows.length,
  recoverable: recoveries.length,
  missingSources,
  skipped,
  sample: recoveries.slice(0, 5).map((item) => ({
    title: item.page.title,
    sourceFilename: item.sourceFilename,
    plainTextLength: item.block.content.plainText.length,
    htmlLength: item.block.content.html.length
  }))
}, null, 2));

if (!shouldWrite) process.exit(0);

const statements = recoveries.map((item) => `
UPDATE pages
SET
  block_ids_json = ${jsonSql([item.block.id])},
  metadata_json = ${jsonSql(item.metadata)},
  content_json = ${jsonSql(item.content)},
  search_text = ${quoteSql(item.searchText)},
  updated_at = ${quoteSql(item.updatedAt)}
WHERE id = ${quoteSql(item.page.id)}
  AND (length(content_json) <= 60 OR content_json LIKE '%"blocks":[]%');

DELETE FROM page_block_index WHERE page_id = ${quoteSql(item.page.id)};
INSERT INTO page_block_index (
  block_id, page_id, notebook_id, sort_index, created_at, updated_at,
  pinned, collapsed, plain_text, block_json
) VALUES (
  ${quoteSql(item.block.id)},
  ${quoteSql(item.page.id)},
  ${quoteSql(item.page.notebookId)},
  0,
  ${quoteSql(item.block.createdAt)},
  ${quoteSql(item.block.updatedAt)},
  0,
  0,
  ${quoteSql(item.block.content.plainText)},
  ${jsonSql(item.block)}
);

DELETE FROM fts_pages WHERE page_id = ${quoteSql(item.page.id)};
INSERT INTO fts_pages (page_id, title, search_text, metadata_text)
VALUES (${quoteSql(item.page.id)}, ${quoteSql(item.page.title)}, ${quoteSql(item.searchText)}, ${quoteSql(item.metadataText)});
`).join('\n');

const sql = `BEGIN IMMEDIATE;\n${statements}\nCOMMIT;\n`;
const sqlPath = '/tmp/recover-work-pages.sql';
writeFileSync(sqlPath, sql);
sqlite(`.read ${quoteSql(sqlPath)}`);
console.log(`Recovered ${recoveries.length} work pages.`);
