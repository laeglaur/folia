import safeParser from 'postcss-safe-parser';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const refreshDownloads = process.argv.includes('--refresh');
const downloadCacheDir = '.cache/typora-theme-audit/downloads';

const installedThemes = new Map([
  ['Konayuki', {
    id: 'typora-konayuki',
    rawCss: 'src/styles/typora/raw/typora-konayuki.css',
    sourceUrl: 'https://raw.githubusercontent.com/aerandirsf/Konayuki/main/konayuki-light.css'
  }],
  ['Folio', {
    id: 'typora-folio',
    rawCss: 'src/styles/typora/raw/typora-folio.css',
    sourceUrl: 'https://raw.githubusercontent.com/liyoulu/typora-folio-theme/main/folio.css'
  }],
  ['Zeus', {
    id: 'typora-zeus',
    rawCss: 'src/styles/typora/raw/typora-zeus.css',
    sourceUrl: 'https://raw.githubusercontent.com/zmtsikriteas/zeus-typora-theme/main/zeus.css'
  }],
  ['Bonne nouvelle', {
    id: 'typora-bonne-nouvelle',
    rawCss: 'src/styles/typora/raw/typora-bonne-nouvelle.css',
    sourceUrl: 'https://raw.githubusercontent.com/senges/typora-bonne-nouvelle/main/bonne-nouvelle.css'
  }],
  ['Flexoki Light', {
    id: 'typora-flexoki-light',
    rawCss: 'src/styles/typora/raw/typora-flexoki-light.css',
    sourceUrl: 'https://raw.githubusercontent.com/guidovicino/flexoki-typora/main/flexoki-light.css'
  }]
]);

const targets = [
  ['Inkwell', 'Inkwell'],
  ['Salamander', 'Salamander'],
  ['Maodie', 'Maodie'],
  ['Crisp', 'Crisp'],
  ['Folio', 'Folio'],
  ['Swiss', 'Swiss'],
  ['Blue Topaz', 'Blue-Topaz'],
  ['LaTeX Typora', 'LaTeX-Typora'],
  ['Paperglow Theme', 'Paperglow-Theme'],
  ['Gruvbox', 'Gruvbox'],
  ['Zeus', 'Zeus'],
  ['Bit Clean', 'Bit-Clean'],
  ['Bonne nouvelle', 'Bonne-nouvelle'],
  ['Print', 'Print'],
  ['Konayuki', 'Konayuki'],
  ['Neon', 'Neon'],
  ['Everforest', 'Everforest'],
  ['Screenplay', 'Screenplay'],
  ['Flexoki Light', 'Flexoki-Light'],
  ['mdmdt', 'Mdmdt'],
  ['Ravel', 'Ravel'],
  ['Ceylon', 'Ceylon'],
  ['Blackout', 'Blackout'],
  ['Whitelines', 'Whitelines'],
  ['LCARS', 'LCARS'],
  ['Valve', 'Valve'],
  ['Alise', 'Alise'],
  ['Torillic', 'Torillic'],
  ['Chocolate Box', 'Chocolate-Box'],
  ['Eloquent', 'Eloquent'],
  ['Inside', 'Inside'],
  ['Law', 'Law'],
  ['Minimalism', 'Minimalism']
].map(([name, slug]) => ({ name, slug, installed: installedThemes.get(name) ?? null }));

const categoryPatterns = {
  base: [/\bhtml\b/, /\bbody\b/, /#write\b/, /\bp\b/, /\bh[1-6]\b/],
  code: [/\bcode\b/, /\bpre\b/, /\.md-fences\b/, /\.CodeMirror\b/, /\.cm-/, /#typora-source\b/],
  renderedCode: [/\bcode\b/, /\bpre\b/, /\.md-fences\b/],
  codeMirror: [/\.CodeMirror\b/, /\.cm-/, /#typora-source\b/],
  table: [/\btable\b/, /\bthead\b/, /\btbody\b/, /\btr\b/, /\bth\b/, /\btd\b/],
  list: [/\bul\b/, /\bol\b/, /\bli\b/, /::marker/],
  task: [/task-list/i, /md-task/i, /checkbox/i, /input\[type=['"]?checkbox/i],
  media: [/\bimg\b/, /\.md-image\b/, /\bvideo\b/, /\baudio\b/, /iframe\b/],
  inlineMarks: [/\bstrong\b/, /\bem\b/, /\bmark\b/, /\bdel\b/, /\bs\b/, /\bu\b/, /\ba\b/],
  blockSemantics: [/\bblockquote\b/, /\bhr\b/, /\.md-alert\b/],
  toc: [/\.md-toc\b/, /\.md-toc-content\b/, /\.md-toc-item\b/],
  footnote: [/\.md-footnote\b/, /\.md-def-footnote\b/, /\.md-def-link\b/],
  math: [/math/i, /mermaid/i, /diagram/i, /jax/i],
  typoraUi: [
    /#typora-sidebar\b/,
    /#typora-quick-open\b/,
    /#md-searchpanel\b/,
    /\.sidebar\b/,
    /\.file-node\b/,
    /\.dropdown-menu\b/,
    /\.modal\b/,
    /\.popover\b/,
    /\.ty-preferences\b/,
    /\.context-menu\b/,
    /#footer\b/,
    /#top-titlebar\b/,
    /focus-mode/i
  ]
};

const cjkFontPatterns = [
  /PingFang\s*SC/i,
  /Hiragino\s*Sans\s*GB/i,
  /Microsoft\s*YaHei/i,
  /Noto\s*Sans\s*CJK/i,
  /Source\s*Han/i,
  /Songti\s*SC/i,
  /STSong/i,
  /SimSun/i,
  /SimHei/i,
  /Sarasa/i,
  /LXGW/i,
  /霞鹜/,
  /思源/,
  /方正/,
  /更纱/,
  /黑体/,
  /宋体/
];

const cssUrlPattern = /href=["']([^"']+\.css[^"']*)["']/gi;
const githubUrlPattern = /href=["'](https:\/\/github\.com\/[^"']+)["']/i;
const galleryItemPattern = /<a\s+class=["']item-inner["']\s+href=["']([^"']+)["'][\s\S]*?<div\s+class=["']item-name["']>([\s\S]*?)<\/div>/gi;
const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const hrefPattern = /href=["']([^"']+)["']/i;
const releaseZipPattern = /href=["']([^"']+\.zip(?:\?[^"']*)?)["']/gi;
const releaseTagPattern = /href=["']\/([^/]+)\/([^/]+)\/releases\/tag\/([^"']+)["']/i;
const githubUrlPatternFull = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/(.*))?$/i;

const themePageUrl = (slug) => `https://theme.typora.io/theme/${slug}/`;
const galleryUrl = 'https://theme.typora.io/';

const normalizeName = (value) => value.toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, '');

const toAbsoluteUrl = (url, base) => {
  if (!url) return null;
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
};

const curlEnv = () => ({
  ...process.env,
  https_proxy: process.env.https_proxy ?? process.env.HTTPS_PROXY ?? 'http://127.0.0.1:7890',
  http_proxy: process.env.http_proxy ?? process.env.HTTP_PROXY ?? 'http://127.0.0.1:7890',
  all_proxy: process.env.all_proxy ?? process.env.ALL_PROXY ?? 'socks5://127.0.0.1:7890'
});

const fetchTextWithCurl = async (url) => {
  const { stdout } = await execFileAsync(
    'curl',
    ['-L', '-sS', '--fail', '--connect-timeout', '12', '--max-time', '60', '-A', 'block-first-notebook-theme-auditor', url],
    { env: curlEnv(), maxBuffer: 32 * 1024 * 1024 }
  );
  if (!stdout.trim()) throw new Error(`${url}: empty response`);
  return stdout;
};

const fetchBufferWithCurl = async (url) => {
  const { stdout } = await execFileAsync(
    'curl',
    ['-L', '-sS', '--fail', '--connect-timeout', '12', '--max-time', '90', '-A', 'block-first-notebook-theme-auditor', url],
    { env: curlEnv(), encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 }
  );
  if (!stdout.length) throw new Error(`${url}: empty download`);
  return stdout;
};

const fetchHeaderWithCurl = async (url) => {
  const { stdout } = await execFileAsync(
    'curl',
    ['-L', '-sS', '--fail', '--connect-timeout', '12', '--max-time', '45', '-I', '-A', 'block-first-notebook-theme-auditor', url],
    { env: curlEnv(), maxBuffer: 1024 * 1024 }
  );
  return stdout;
};

const cachePathFor = (url, extension) => {
  const hash = createHash('sha256').update(url).digest('hex');
  return join(downloadCacheDir, `${hash}.${extension}`);
};

const readCache = async (url, extension) => {
  if (refreshDownloads) return null;
  try {
    return await readFile(cachePathFor(url, extension));
  } catch {
    return null;
  }
};

const writeCache = async (url, extension, data) => {
  await mkdir(downloadCacheDir, { recursive: true });
  await writeFile(cachePathFor(url, extension), data);
};

const fetchText = async (url) => {
  const cached = await readCache(url, 'txt');
  if (cached) return cached.toString('utf8');
  try {
    const text = await fetchTextWithCurl(url);
    await writeCache(url, 'txt', text);
    return text;
  } catch (curlError) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'block-first-notebook-theme-auditor' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const text = await response.text();
      await writeCache(url, 'txt', text);
      return text;
    } catch (fetchError) {
      throw new Error(`${url}: curl failed (${curlError instanceof Error ? curlError.message : String(curlError)}); fetch failed (${fetchError instanceof Error ? fetchError.message : String(fetchError)})`);
    }
  }
};

const fetchBuffer = async (url) => {
  const cached = await readCache(url, 'bin');
  if (cached) return cached;
  try {
    const buffer = await fetchBufferWithCurl(url);
    await writeCache(url, 'bin', buffer);
    return buffer;
  } catch (curlError) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'block-first-notebook-theme-auditor' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeCache(url, 'bin', buffer);
      return buffer;
    } catch (fetchError) {
      throw new Error(`${url}: curl failed (${curlError instanceof Error ? curlError.message : String(curlError)}); fetch failed (${fetchError instanceof Error ? fetchError.message : String(fetchError)})`);
    }
  }
};

const buildGalleryIndex = async () => {
  const html = await fetchText(galleryUrl);
  const index = new Map();
  for (const match of html.matchAll(galleryItemPattern)) {
    const url = toAbsoluteUrl(match[1], galleryUrl);
    const name = match[2].replace(/<[^>]+>/g, '').trim();
    if (url && name) index.set(normalizeName(name), { name, url });
  }
  return index;
};

const resolveThemePageUrl = (target, galleryIndex) =>
  galleryIndex.get(normalizeName(target.name))?.url ?? themePageUrl(target.slug);

const getNamedButtonUrl = (html, pageUrl, label) => {
  for (const match of html.matchAll(anchorPattern)) {
    const attrs = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim().toLowerCase();
    if (text !== label.toLowerCase()) continue;
    const href = attrs.match(hrefPattern)?.[1];
    return toAbsoluteUrl(href, pageUrl);
  }
  return null;
};

const isZipBuffer = (buffer) => buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

const parseGitHubUrl = (url) => {
  const match = url.match(githubUrlPatternFull);
  if (!match) return null;
  const [, owner, repo, rest = ''] = match;
  const parts = rest.split('/').filter(Boolean);
  return { owner, repo: repo.replace(/\.git$/i, ''), parts };
};

const branchArchiveUrl = ({ owner, repo }, branch) => `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
const tagArchiveUrl = ({ owner, repo }, tag) => `https://github.com/${owner}/${repo}/archive/refs/tags/${tag}.zip`;

const getDefaultBranchFromRepoPage = async (repoUrl) => {
  const html = await fetchText(repoUrl);
  return (
    html.match(/"defaultBranch"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/data-default-branch=["']([^"']+)["']/)?.[1] ??
    html.match(/\/tree\/([^"'/]+)["']/)?.[1] ??
    'main'
  );
};

const getLatestReleaseZipFromPage = async (repoRef, releasesUrl) => {
  const html = await fetchText(releasesUrl);
  const asset = [...html.matchAll(releaseZipPattern)]
    .map((match) => toAbsoluteUrl(match[1].replace(/&amp;/g, '&'), releasesUrl))
    .filter(Boolean)
    .find((url) => /\/releases\/download\//i.test(url) || /archive\/refs\/tags\//i.test(url));
  if (asset) return asset;

  const tag = html.match(releaseTagPattern)?.[3];
  return tag ? tagArchiveUrl(repoRef, decodeURIComponent(tag)) : null;
};

const resolveGitHubDownloadSource = async (downloadUrl) => {
  const github = parseGitHubUrl(downloadUrl);
  if (!github) return null;
  const { owner, repo, parts } = github;
  const repoRef = { owner, repo };

  if (parts[0] === 'blob' && parts.length >= 3) {
    const branch = parts[1];
    const path = parts.slice(2).join('/');
    if (/\.css$/i.test(path)) {
      return {
        kind: 'css',
        url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
        preferredPath: path
      };
    }
  }

  if (parts[0] === 'tree' && parts.length >= 2) {
    const branch = parts[1];
    const preferredPath = parts.slice(2).join('/');
    return {
      kind: 'zip',
      url: branchArchiveUrl(repoRef, branch),
      preferredPath
    };
  }

  if (parts[0] === 'releases') {
    const releasesUrl = parts[1] === 'latest'
      ? `https://github.com/${owner}/${repo}/releases/latest`
      : `https://github.com/${owner}/${repo}/releases`;
    const zipUrl = await getLatestReleaseZipFromPage(repoRef, releasesUrl);
    if (zipUrl) return { kind: 'zip', url: zipUrl, preferredPath: '' };
  }

  if (!parts.length || parts[0] === 'tags') {
    const branch = await getDefaultBranchFromRepoPage(`https://github.com/${owner}/${repo}`);
    return {
      kind: 'zip',
      url: branchArchiveUrl(repoRef, branch),
      preferredPath: ''
    };
  }

  return null;
};

const resolveDownloadSource = async (downloadUrl) => {
  if (!downloadUrl) return null;
  if (/\.zip(?:$|[?#])/i.test(downloadUrl)) return { kind: 'zip', url: downloadUrl, preferredPath: '' };
  if (/raw\.githubusercontent\.com\/.+\.css(?:$|[?#])/i.test(downloadUrl)) return { kind: 'css', url: downloadUrl, preferredPath: '' };
  if (/github\.com\//i.test(downloadUrl)) {
    const source = await resolveGitHubDownloadSource(downloadUrl);
    if (source?.url) return source;
  }

  if (/github\.com\/[^/]+\/[^/]+\/releases\/latest(?:$|[?#/])/i.test(downloadUrl)) {
    const releaseHtml = await fetchText(downloadUrl);
    const candidates = [...releaseHtml.matchAll(releaseZipPattern)]
      .map((match) => toAbsoluteUrl(match[1], downloadUrl))
      .filter(Boolean)
      .filter((url) => /\/releases\/download\//i.test(url));
    if (candidates.length) return { kind: 'zip', url: candidates[0], preferredPath: '' };
  }

  const headers = await fetchHeaderWithCurl(downloadUrl);
  if (/content-type:\s*(application\/zip|application\/octet-stream)/i.test(headers)) return { kind: 'zip', url: downloadUrl, preferredPath: '' };
  return null;
};

const selectorMatches = (selector, patterns) => patterns.some((pattern) => pattern.test(selector));

const blankCounts = () => Object.fromEntries(Object.keys(categoryPatterns).map((key) => [key, 0]));

const analyzeCss = (css) => {
  const root = safeParser(css);
  const counts = blankCounts();
  const declarations = {
    fontFamily: [],
    layoutRisk: [],
    colors: 0,
    backgrounds: 0
  };
  const selectors = [];

  root.walkRules((rule) => {
    selectors.push(rule.selector);
    for (const [category, patterns] of Object.entries(categoryPatterns)) {
      if (selectorMatches(rule.selector, patterns)) counts[category] += 1;
    }
  });

  root.walkDecls((declaration) => {
    const value = declaration.value.trim();
    if (declaration.prop === 'font-family' || declaration.prop === 'font') declarations.fontFamily.push(value);
    if (/color/i.test(declaration.prop)) declarations.colors += 1;
    if (/background/i.test(declaration.prop)) declarations.backgrounds += 1;
    if (
      ['width', 'max-width', 'min-width', 'padding', 'padding-left', 'padding-right', 'margin-left', 'margin-right', 'left', 'right', 'transform', 'position'].includes(declaration.prop) &&
      /(?:\d+(?:\.\d+)?(?:in|mm|cm)|absolute|fixed|translateX|100vw|120%|8in|210mm)/i.test(`${declaration.prop}:${value}`)
    ) {
      declarations.layoutRisk.push(`${declaration.prop}: ${value}`);
    }
  });

  const fontText = declarations.fontFamily.join(' | ');
  const cjkMatches = [...new Set(cjkFontPatterns.filter((pattern) => pattern.test(fontText)).map((pattern) => pattern.source.replace(/\\s\*/g, ' ')))];
  const hasCjkFallback = cjkMatches.length > 0;

  const has = (key, threshold = 1) => counts[key] >= threshold;
  const contentCoverage = [
    has('base', 5),
    has('renderedCode', 2),
    has('table', 3),
    has('list', 3),
    has('inlineMarks', 4),
    has('blockSemantics', 2),
    has('media', 1)
  ].filter(Boolean).length;
  const advancedCoverage = [has('toc'), has('footnote'), has('math')].filter(Boolean).length;
  const cjkScore = hasCjkFallback ? 2 : declarations.fontFamily.length ? 1 : 0;
  const layoutPenalty = Math.min(3, declarations.layoutRisk.length);
  const uiPenalty = counts.typoraUi >= 30 ? 1 : counts.typoraUi >= 12 ? 0.5 : 0;
  const codeMirrorPenalty = counts.codeMirror >= 30 ? 2 : counts.codeMirror >= 8 ? 1 : 0;
  const readinessScore = contentCoverage * 2 + advancedCoverage + cjkScore - layoutPenalty - uiPenalty - codeMirrorPenalty;

  let offload = 'none';
  if (contentCoverage < 3 || (counts.renderedCode < 2 && counts.codeMirror >= 8)) offload = 'heavy';
  else if (layoutPenalty >= 2 || codeMirrorPenalty >= 2 || !has('renderedCode', 2)) offload = 'medium';
  else if (!hasCjkFallback || advancedCoverage < 2 || codeMirrorPenalty) offload = 'light';

  let grade = 'ready';
  if (offload === 'light') grade = 'good candidate';
  if (offload === 'medium') grade = 'needs shim';
  if (offload === 'heavy') grade = 'experimental';

  return {
    counts,
    fontFamilies: [...new Set(declarations.fontFamily)].slice(0, 10),
    cjkSupport: hasCjkFallback ? 'explicit/acceptable' : declarations.fontFamily.length ? 'weak/unknown' : 'unknown',
    cjkMatches,
    layoutRisk: declarations.layoutRisk.slice(0, 12),
    colors: declarations.colors,
    backgrounds: declarations.backgrounds,
    contentCoverage,
    advancedCoverage,
    readinessScore,
    offload,
    grade,
    notes: buildNotes(counts, declarations, hasCjkFallback)
  };
};

const buildNotes = (counts, declarations, hasCjkFallback) => {
  const notes = [];
  if (!hasCjkFallback) notes.push('CJK fallback weak or not detected');
  if (counts.renderedCode < 2 && counts.codeMirror > 0) notes.push('code depends more on CodeMirror/source selectors than rendered fences');
  if (counts.renderedCode < 2 && counts.codeMirror === 0) notes.push('rendered code styling is sparse');
  if (counts.typoraUi >= 12) notes.push('heavy Typora UI/source/sidebar leakage');
  if (declarations.layoutRisk.length) notes.push('fixed/print-like layout declarations need containment');
  if (counts.table < 3) notes.push('table styling sparse');
  if (counts.media === 0) notes.push('media/image styling sparse');
  return notes;
};

const buildMergedNotes = (counts, layoutRisk, hasCjkFallback) =>
  buildNotes(
    counts,
    {
      layoutRisk
    },
    hasCjkFallback
  );

const auditInstalledTheme = async (theme) => {
  const css = await readFile(theme.rawCss, 'utf8');
  return {
    sourceStatus: 'verified installed',
    sourceUrl: theme.sourceUrl,
    cssVariants: [theme.rawCss],
    ...analyzeCss(css)
  };
};

const listZipEntries = async (zipPath) => {
  const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
};

const readZipEntry = async (zipPath, entry) => {
  const { stdout } = await execFileAsync('unzip', ['-p', zipPath, entry], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  return stdout.toString('utf8');
};

const isThemeCssEntry = (entry) =>
  /\.css$/i.test(entry) &&
  !/(node_modules|vendor|fontawesome|font-awesome|highlight|normalize|reset|bootstrap|github\.css|pure-min|syntax|typora-theme\.css|jekyllthemes|site|docs?\/|example|demo)/i.test(entry);

const rankCssEntry = (entry, target, preferredPath = '') => {
  const lower = entry.toLowerCase();
  const normalizedEntry = normalizeName(entry);
  const normalizedName = normalizeName(target.name);
  const normalizedSlug = normalizeName(target.slug);
  let score = 0;
  if (preferredPath && lower.includes(preferredPath.toLowerCase())) score += 20;
  if (normalizedEntry.includes(normalizedName) || normalizedEntry.includes(normalizedSlug)) score += 10;
  if (/\/themes?\//i.test(entry)) score += 6;
  if (/\/assets\//i.test(entry)) score += 4;
  if (/\/latest\//i.test(entry)) score += 5;
  if (/\/dist\//i.test(entry)) score += 4;
  const depth = entry.split(/[\\/]/).filter(Boolean).length;
  if (depth <= 2) score += 5;
  if (/dark|light|noir|night|print|compact/i.test(entry)) score += 2;
  if (/readme|license|index|gallery|preview|website/i.test(entry)) score -= 8;
  return score;
};

const selectCssEntries = (entries, target, preferredPath = '') =>
  entries
    .filter(isThemeCssEntry)
    .map((entry) => ({ entry, score: rankCssEntry(entry, target, preferredPath) }))
    .sort((a, b) => b.score - a.score || a.entry.localeCompare(b.entry))
    .slice(0, 12)
    .map(({ entry }) => entry);

const auditGalleryTheme = async (target, tempDir, galleryIndex) => {
  const pageUrl = resolveThemePageUrl(target, galleryIndex);
  const html = await fetchText(pageUrl);
  const github = html.match(githubUrlPattern)?.[1] ?? null;
  const downloadUrl = getNamedButtonUrl(html, pageUrl, 'Download');
  const downloadSource = await resolveDownloadSource(downloadUrl);
  const cssLinks = [...html.matchAll(cssUrlPattern)]
    .map((match) => toAbsoluteUrl(match[1], pageUrl))
    .filter(Boolean)
    .filter((url) => !/font-awesome|github\.css|pure-min|syntax|typora-theme|highlight|jekyllthemes/i.test(url));

  const cssVariants = [];
  const analyses = [];

  if (downloadSource?.kind === 'css') {
    const css = await fetchText(downloadSource.url);
    cssVariants.push(downloadSource.url);
    analyses.push(analyzeCss(css));
  } else if (downloadSource?.kind === 'zip') {
    const zipPath = join(tempDir, `${target.slug}.zip`);
    const zipBuffer = await fetchBuffer(downloadSource.url);
    if (!isZipBuffer(zipBuffer)) throw new Error(`${downloadSource.url}: download button did not return a zip file`);
    await writeFile(zipPath, zipBuffer);
    const entries = await listZipEntries(zipPath);
    const cssEntries = selectCssEntries(entries, target, downloadSource.preferredPath);
    for (const entry of cssEntries.slice(0, 12)) {
      const css = await readZipEntry(zipPath, entry);
      cssVariants.push(entry);
      analyses.push(analyzeCss(css));
    }
  } else {
    for (const cssUrl of cssLinks.slice(0, 6)) {
      const css = await fetchText(cssUrl);
      cssVariants.push(cssUrl);
      analyses.push(analyzeCss(css));
    }
  }

  if (!analyses.length) {
    return {
      sourceStatus: 'source found, css pending',
      sourceUrl: github ?? pageUrl,
      pageUrl,
      downloadUrl,
      downloadSource,
      cssVariants,
      ...emptyAnalysis('No CSS files discovered from gallery links')
    };
  }

  return {
    sourceStatus: 'verified gallery',
    sourceUrl: github ?? downloadSource?.url ?? pageUrl,
    pageUrl,
    downloadUrl,
    downloadSource,
    cssVariants,
    ...mergeAnalyses(analyses)
  };
};

const emptyAnalysis = (note) => ({
  counts: blankCounts(),
  fontFamilies: [],
  cjkSupport: 'unknown',
  cjkMatches: [],
  layoutRisk: [],
  colors: 0,
  backgrounds: 0,
  contentCoverage: 0,
  advancedCoverage: 0,
  readinessScore: 0,
  offload: 'unknown',
  grade: 'source pending',
  notes: [note]
});

const mergeAnalyses = (analyses) => {
  const counts = blankCounts();
  const fontFamilies = new Set();
  const cjkMatches = new Set();
  const layoutRisk = [];
  let colors = 0;
  let backgrounds = 0;
  let bestScore = -Infinity;
  let best = analyses[0];

  for (const analysis of analyses) {
    for (const key of Object.keys(counts)) counts[key] += analysis.counts[key] ?? 0;
    analysis.fontFamilies.forEach((font) => fontFamilies.add(font));
    analysis.cjkMatches.forEach((match) => cjkMatches.add(match));
    layoutRisk.push(...analysis.layoutRisk);
    colors += analysis.colors;
    backgrounds += analysis.backgrounds;
    if (analysis.readinessScore > bestScore) {
      bestScore = analysis.readinessScore;
      best = analysis;
    }
  }

  const merged = {
    ...best,
    counts,
    fontFamilies: [...fontFamilies].slice(0, 10),
    cjkSupport: cjkMatches.size ? 'explicit/acceptable' : fontFamilies.size ? 'weak/unknown' : 'unknown',
    cjkMatches: [...cjkMatches],
    layoutRisk: [...new Set(layoutRisk)].slice(0, 12),
    colors,
    backgrounds,
    notes: buildMergedNotes(counts, [...new Set(layoutRisk)], cjkMatches.size > 0)
  };
  return merged;
};

const markdownCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const compactCount = (analysis) =>
  `base ${analysis.counts.base}; code ${analysis.counts.renderedCode}/${analysis.counts.codeMirror}; table ${analysis.counts.table}; list ${analysis.counts.list}; task ${analysis.counts.task}; media ${analysis.counts.media}; UI ${analysis.counts.typoraUi}`;

const buildMarkdownAudit = (results) => {
  const lines = [
    '# Typora Theme Capability Audit',
    '',
    'Generated by `pnpm audit:typora-themes`. Download responses are cached under `.cache/typora-theme-audit/`; pass `--refresh` to force a fresh download pass.',
    '',
    '| Theme | Source | CSS variants | CJK | Coverage counts | Layout risk | Grade | Offload | Notes |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- | --- |'
  ];

  for (const result of results) {
    lines.push(`| ${markdownCell(result.name)} | ${markdownCell(result.sourceStatus)} | ${result.cssVariants.length} | ${markdownCell(result.cjkSupport)} | ${markdownCell(compactCount(result))} | ${result.layoutRisk.length} | ${markdownCell(result.grade)} | ${markdownCell(result.offload)} | ${markdownCell(result.notes.join('; '))} |`);
  }

  lines.push(
    '',
    '## Recommended First Adaptation Candidates',
    '',
    ...results
      .filter((result) => result.grade === 'ready' || result.grade === 'good candidate')
      .sort((a, b) => b.readinessScore - a.readinessScore)
      .slice(0, 10)
      .map((result) => `- ${result.name}: ${result.grade}, offload ${result.offload}, score ${result.readinessScore}`),
    '',
    '## Themes To Offload First',
    '',
    ...results
      .filter((result) => result.offload === 'heavy' || result.grade === 'experimental')
      .sort((a, b) => a.readinessScore - b.readinessScore)
      .slice(0, 12)
      .map((result) => `- ${result.name}: ${result.grade}, ${result.notes.join('; ') || 'low readiness score'}`),
    ''
  );

  return `${lines.join('\n')}\n`;
};

const updateTargetsDoc = async (results) => {
  const path = 'docs/typora-theme-targets.md';
  const current = await readFile(path, 'utf8');
  const markerStart = '<!-- typora-audit:start -->';
  const markerEnd = '<!-- typora-audit:end -->';
  const table = [
    markerStart,
    '',
    '## Capability Audit Summary',
    '',
    'Generated by `pnpm audit:typora-themes`. Source links are discovered from the Typora Theme Gallery when possible; installed pilot themes are audited from local raw CSS. Download responses are cached under `.cache/typora-theme-audit/`; pass `--refresh` to force a fresh download pass.',
    '',
    '| Theme | Source Status | CSS Variants | CJK Support | Code | Table | Media | UI Leakage | Layout Risks | Grade | Offload |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ...results.map((result) => `| ${markdownCell(result.name)} | ${markdownCell(result.sourceStatus)} | ${result.cssVariants.length} | ${markdownCell(result.cjkSupport)} | ${result.counts.renderedCode}/${result.counts.codeMirror} | ${result.counts.table} | ${result.counts.media} | ${result.counts.typoraUi} | ${result.layoutRisk.length} | ${markdownCell(result.grade)} | ${markdownCell(result.offload)} |`),
    '',
    markerEnd
  ].join('\n');

  const next = current.includes(markerStart)
    ? current.replace(new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`), table)
    : `${current.trimEnd()}\n\n${table}\n`;
  await writeFile(path, next);
};

const main = async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'typora-theme-audit-'));
  const results = [];

  try {
    const galleryIndex = await buildGalleryIndex();
    for (const target of targets) {
      process.stdout.write(`Auditing ${target.name}... `);
      try {
        const audit = target.installed
          ? await auditInstalledTheme(target.installed)
          : await auditGalleryTheme(target, tempDir, galleryIndex);
        results.push({ name: target.name, slug: target.slug, importId: target.installed?.id ?? null, ...audit });
        process.stdout.write(`${audit.grade} / ${audit.offload}\n`);
      } catch (error) {
        results.push({
          name: target.name,
          slug: target.slug,
          importId: target.installed?.id ?? null,
          sourceStatus: 'verification failed',
          sourceUrl: resolveThemePageUrl(target, galleryIndex),
          cssVariants: [],
          ...emptyAnalysis(error instanceof Error ? error.message : String(error))
        });
        process.stdout.write('failed\n');
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  const reportPath = 'docs/typora-theme-audit-report.json';
  const markdownPath = 'docs/typora-theme-capability-audit.md';
  await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  await writeFile(markdownPath, buildMarkdownAudit(results));
  await updateTargetsDoc(results);
  console.log(`Wrote ${reportPath}, ${markdownPath}, and docs/typora-theme-targets.md`);
};

await main();
