import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const dbPath = process.argv[2] ?? join(homedir(), 'Library/Application Support/com.laeglaur.notebook/notebook.sqlite3');
const appDataDir = dirname(dbPath);
const attachmentsRoot = join(appDataDir, 'attachments');
const tempStatePath = join(tmpdir(), `notebook-state-${Date.now()}.json`);
const tempSqlPath = join(tmpdir(), `notebook-migrate-${Date.now()}.sql`);

const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

const extensionForMime = (mimeType) => {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'video/webm':
      return 'webm';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/flac':
      return 'flac';
    default:
      return 'bin';
  }
};

const decodeDataUrl = (dataUrl) => {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const payload = match[3] ?? '';
  const bytes = match[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload));
  return { mimeType, bytes };
};

const assetUrlForPath = (storedPath) => `asset://localhost/${storedPath.replace(/^\/+/, '')}`;

const importedAssets = new Map();
let migratedMediaCount = 0;

const importDataUrl = async (dataUrl, label) => {
  const parsed = decodeDataUrl(dataUrl);
  if (!parsed || parsed.bytes.length === 0) return null;
  const sha256 = createHash('sha256').update(parsed.bytes).digest('hex');
  const extension = extensionForMime(parsed.mimeType);
  const storedDir = join(attachmentsRoot, sha256.slice(0, 2));
  const storedPath = join(storedDir, `${sha256}.${extension}`);
  await mkdir(storedDir, { recursive: true });
  if (!existsSync(storedPath)) await writeFile(storedPath, parsed.bytes);
  const asset = {
    id: `asset_${sha256}`,
    originalPath: label,
    storedPath,
    assetUrl: assetUrlForPath(storedPath),
    mimeType: parsed.mimeType,
    size: parsed.bytes.length,
    sha256
  };
  importedAssets.set(sha256, asset);
  migratedMediaCount += 1;
  return asset;
};

const migrateHtml = async (html, label) => {
  if (typeof html !== 'string' || !html.includes('data:')) return html;
  const replacements = [];
  const srcRegex = /(<(?:img|video|audio)\b[^>]*?\ssrc=(["']))(data:[\s\S]*?)(\2)/gi;
  for (const match of html.matchAll(srcRegex)) {
    const asset = await importDataUrl(match[3], label);
    if (!asset) continue;
    replacements.push({ from: match[0], to: `${match[1]}${asset.assetUrl}${match[4]}` });
  }
  let nextHtml = html;
  for (const replacement of replacements) {
    nextHtml = nextHtml.replace(replacement.from, replacement.to);
  }
  return nextHtml.replace(/\sdata-original-src=(["'])data:[\s\S]*?\1/gi, '');
};

const sanitizePayload = (value) => {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `[data-url omitted: ${value.length} chars]`;
    if (value.includes('data:') && value.length > 20_000) return `[large data payload omitted: ${value.length} chars]`;
    if (value.length > 200_000) return `${value.slice(0, 200_000)}\n[truncated: ${value.length} chars]`;
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizePayload(entry)]));
  }
  return value;
};

if (!existsSync(dbPath)) {
  console.log(`No SQLite database found at ${dbPath}`);
  process.exit(0);
}

execFileSync('sqlite3', [dbPath, `.once ${tempStatePath}`, 'SELECT state_json FROM app_state WHERE id = 1;'], { stdio: 'inherit' });
const rawState = await readFile(tempStatePath, 'utf8');
const state = JSON.parse(rawState);

state.blocks = await Promise.all((state.blocks ?? []).map(async (block) => {
  const html = await migrateHtml(block?.content?.html, block?.id ?? 'block');
  return html === block?.content?.html ? block : { ...block, content: { ...block.content, html } };
}));
state.operations = (state.operations ?? []).slice(-500).map((entry) => ({
  ...entry,
  payload: sanitizePayload(entry.payload)
}));

await writeFile(tempStatePath, JSON.stringify(state));

const attachmentStatements = [...importedAssets.values()].map((asset) => `
INSERT INTO attachments (id, original_path, stored_path, mime_type, size, sha256, created_at)
VALUES (${sqlQuote(asset.id)}, ${sqlQuote(asset.originalPath)}, ${sqlQuote(asset.storedPath)}, ${sqlQuote(asset.mimeType)}, ${asset.size}, ${sqlQuote(asset.sha256)}, CURRENT_TIMESTAMP)
ON CONFLICT(sha256) DO UPDATE SET
  original_path = excluded.original_path,
  stored_path = excluded.stored_path,
  mime_type = excluded.mime_type,
  size = excluded.size;
`).join('\n');

await writeFile(tempSqlPath, `
PRAGMA busy_timeout = 5000;
BEGIN;
${attachmentStatements}
UPDATE app_state SET state_json = CAST(readfile(${sqlQuote(tempStatePath)}) AS TEXT), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
COMMIT;
VACUUM;
`);

execFileSync('sqlite3', [dbPath, `.read ${tempSqlPath}`], { stdio: 'inherit' });
await rm(tempStatePath, { force: true });
await rm(tempSqlPath, { force: true });

console.log(`Migrated ${migratedMediaCount} inline data media item${migratedMediaCount === 1 ? '' : 's'} into ${importedAssets.size} attachment file${importedAssets.size === 1 ? '' : 's'}.`);
