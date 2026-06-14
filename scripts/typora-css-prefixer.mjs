import postcss from 'postcss';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const themes = [
  {
    id: 'typora-proof',
    input: 'src/styles/typora/raw/typora-proof.css',
    output: 'src/styles/typora/generated/typora-proof.scoped.css'
  },
  {
    id: 'typora-konayuki',
    label: 'Konayuki',
    sourceUrl: 'https://raw.githubusercontent.com/aerandirsf/Konayuki/main/konayuki-light.css'
  },
  {
    id: 'typora-swiss',
    label: 'Swiss',
    sourceUrl: 'https://raw.githubusercontent.com/ChivaLryCieux/swiss-theme/main/swiss.css'
  },
  {
    id: 'typora-folio',
    label: 'Folio',
    sourceUrl: 'https://raw.githubusercontent.com/liyoulu/typora-folio-theme/main/folio.css'
  },
  {
    id: 'typora-zeus',
    label: 'Zeus',
    sourceUrl: 'https://raw.githubusercontent.com/zmtsikriteas/zeus-typora-theme/main/zeus.css'
  },
  {
    id: 'typora-bonne-nouvelle',
    label: 'Bonne nouvelle',
    sourceUrl: 'https://raw.githubusercontent.com/senges/typora-bonne-nouvelle/main/bonne-nouvelle.css'
  },
  {
    id: 'typora-flexoki-light',
    label: 'Flexoki Light',
    sourceUrl: 'https://raw.githubusercontent.com/guidovicino/flexoki-typora/main/flexoki-light.css'
  }
];

const ignoredSelectorPatterns = [
  /#typora-sidebar\b/,
  /#typora-source\b/,
  /\.CodeMirror\b/,
  /\.cm-s-inner\b/,
  /\.file-node\b/,
  /\.megamenu\b/,
  /\.context-menu\b/,
  /\.md-search\b/,
  /#md-searchpanel\b/,
  /\.sidebar\b/,
  /#sidebar-content\b/,
  /\.sidebar-content\b/,
  /\.sidebar-tab\b/,
  /\.outline-item\b/,
  /\.file-list\b/,
  /\.file-list-item\b/,
  /\.typora-node\b/,
  /\.typora-quick-open\b/,
  /contentmenu/i,
  /footer\b/
];

const splitSelectors = (selector) => {
  const selectors = [];
  let current = '';
  let quote = null;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (const char of selector) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === ',' && parenDepth === 0 && bracketDepth === 0) {
      if (current.trim()) selectors.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) selectors.push(current.trim());
  return selectors;
};

const shouldIgnoreSelector = (selector) => ignoredSelectorPatterns.some((pattern) => pattern.test(selector));

const normalizeTyporaSelector = (selector) =>
  selector
    .replace(/#write\b/g, '.typora-write')
    .replace(/\.typora-export\b/g, '.typora-write');

const isTocSelector = (selector) => /\.md-toc\b|\.md-toc-content\b|\.md-toc-item\b/.test(selector);

const findTyporaRootFontSize = (root) => {
  let rootFontSize = null;
  root.walkRules((rule) => {
    if (rootFontSize) return;
    const hasHtmlSelector = splitSelectors(rule.selector).some((selector) => /(^|[\s>,+~])html\b/.test(selector.trim()));
    if (!hasHtmlSelector) return;
    rule.walkDecls('font-size', (declaration) => {
      rootFontSize = declaration.value.trim();
    });
  });
  return rootFontSize;
};

const remValuePattern = /(-?\d*\.?\d+)rem\b/g;

const rewriteRemUnits = (value) =>
  value.replace(remValuePattern, (_, amount) => {
    const numericAmount = Number.parseFloat(amount);
    if (numericAmount === 0) return '0';
    return `calc(${numericAmount} * var(--typora-root-font-size, 16px))`;
  });

const scopeSelector = (selector, themeId) => {
  if (shouldIgnoreSelector(selector)) return null;

  const root = `.typora-theme[data-content-theme="${themeId}"]`;
  const write = `${root} .typora-write`;
  let scoped = normalizeTyporaSelector(selector);

  if (isTocSelector(scoped)) {
    return `${root} ${scoped.replace(/^\s*\.typora-write\s+/, '')}`;
  }

  scoped = scoped
    .replace(/^:root\b/, '.typora-write')
    .replace(/^html\b/, '.typora-write')
    .replace(/^body\b/, '.typora-write');

  if (scoped.startsWith('.typora-write')) return `${root} ${scoped}`;
  return `${write} ${scoped}`;
};

const scopeCss = (css, themeId) => {
  const root = postcss.parse(css);
  const typoraRootFontSize = findTyporaRootFontSize(root);

  root.walkAtRules((rule) => {
    if (rule.name === 'include-when-export') rule.remove();
  });

  root.walkDecls((declaration) => {
    if (declaration.value.includes('rem')) {
      declaration.value = rewriteRemUnits(declaration.value);
    }
  });

  root.walkRules((rule) => {
    const selectors = splitSelectors(rule.selector)
      .map((selector) => scopeSelector(selector, themeId))
      .filter(Boolean);

    if (!selectors.length) {
      rule.remove();
      return;
    }

    rule.selector = [...new Set(selectors)].join(',\n');
  });

  if (typoraRootFontSize) {
    root.append(
      postcss.rule({
        selector: `.typora-theme[data-content-theme="${themeId}"] .typora-write`,
        nodes: [
          postcss.decl({
            prop: '--typora-root-font-size',
            value: typoraRootFontSize
          })
        ]
      })
    );
  }

  return `/* Generated by scripts/typora-css-prefixer.mjs. Do not edit by hand. */\n${root.toString()}\n`;
};

const rewriteRelativeAssetUrls = (css, sourceUrl) => {
  if (!sourceUrl) return css;
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, url) => {
    const trimmed = url.trim();
    if (/^(?:data:|https?:|asset:|\/|#)/i.test(trimmed)) return match;
    return `url(${quote}${new URL(trimmed, sourceUrl).href}${quote})`;
  });
};

const readThemeCss = async (theme) => {
  if (theme.sourceUrl) {
    const cachedRawPath = join(process.cwd(), rawPathFor(theme));
    try {
      await access(cachedRawPath);
      return { css: await readFile(cachedRawPath, 'utf8'), fromCache: true };
    } catch {
      // Download below when the managed raw copy does not exist yet.
    }

    const response = await fetch(theme.sourceUrl, { headers: { 'User-Agent': 'block-first-notebook-theme-importer' } });
    if (!response.ok) throw new Error(`Could not download ${theme.sourceUrl}: ${response.status} ${response.statusText}`);
    return { css: await response.text(), fromCache: false };
  }

  const inputPath = join(process.cwd(), theme.input);
  return { css: await readFile(inputPath, 'utf8'), fromCache: true };
};

const rawPathFor = (theme) => theme.input ?? `src/styles/typora/raw/${theme.id}.css`;
const outputPathFor = (theme) => theme.output ?? `src/styles/typora/generated/${theme.id}.scoped.css`;

for (const theme of themes) {
  const rawPath = rawPathFor(theme);
  const outputPath = join(process.cwd(), outputPathFor(theme));
  const { css: rawCss, fromCache } = await readThemeCss(theme);
  const cssForScoping = rewriteRelativeAssetUrls(rawCss, theme.sourceUrl);

  if (theme.sourceUrl && !fromCache) {
    const rawOutputPath = join(process.cwd(), rawPath);
    await mkdir(dirname(rawOutputPath), { recursive: true });
    await writeFile(rawOutputPath, `/* Source: ${theme.sourceUrl} */\n${rawCss}`);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, scopeCss(cssForScoping, theme.id));
  console.log(`Scoped ${rawPath} -> ${outputPathFor(theme)}`);
}

const manifest = themes.map((theme) => ({
  id: theme.id,
  label: theme.label ?? 'Typora proof',
  rawCss: rawPathFor(theme),
  scopedCss: outputPathFor(theme),
  sourceUrl: theme.sourceUrl ?? null
}));

await writeFile(
  join(process.cwd(), 'src/styles/typora/manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);
