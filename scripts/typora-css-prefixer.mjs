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
  /#typora-source\b/,
  /\.CodeMirror\b/,
  /\.cm-s-inner\b/,
  /\.megamenu\b/,
  /\.context-menu\b/,
  /\.popover\b/,
  /\.dropdown-menu\b/,
  /\.modal-content\b/,
  /\.md-search\b/,
  /#md-searchpanel\b/,
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

const isRootSelector = (selector) => /^(:root|html|body)\b/.test(selector.trim());

const shellSelectorPatterns = [
  /#typora-sidebar\b/,
  /\.sidebar\b/,
  /#sidebar-content\b/,
  /\.sidebar-content\b/,
  /\.sidebar-tabs\b/,
  /\.sidebar-tab\b/,
  /\.sidebar-tab-active\b/,
  /\.active-tab-/,
  /\.file-library\b/,
  /\.file-library-node\b/,
  /\.file-node-/,
  /\.file-name\b/,
  /\.file-list\b/,
  /\.file-list-item\b/,
  /\.outline-content\b/,
  /\.outline-item\b/,
  /\.outline-label\b/,
  /\.outline-expander\b/
];

const isShellSelector = (selector) => shellSelectorPatterns.some((pattern) => pattern.test(selector));

const ruleHasOnlyCustomProperties = (rule) => {
  let hasDeclaration = false;
  let onlyVariables = true;
  rule.walkDecls((declaration) => {
    hasDeclaration = true;
    if (!declaration.prop.startsWith('--')) onlyVariables = false;
  });
  return hasDeclaration && onlyVariables;
};

const cloneRuleWithDeclarations = (rule, selector, declarationFilter) => {
  if (!selector.trim()) return null;
  const clone = postcss.rule({ selector });
  rule.each((node) => {
    if (node.type !== 'decl') return;
    if (declarationFilter(node)) clone.append(node.clone());
  });
  return clone.nodes?.length ? clone : null;
};

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

const scopeSelector = (selector, themeId, mode = 'content') => {
  if (shouldIgnoreSelector(selector)) return null;

  const root = `.typora-theme[data-content-theme="${themeId}"]`;
  const shell = `${root}.typora-app-shell`;
  const write = `${root} .typora-write`;
  let scoped = normalizeTyporaSelector(selector);

  if (mode === 'vars') return root;

  if (mode === 'shell') {
    scoped = scoped
      .replace(/^html\s+body\b/, '')
      .replace(/^html\b/, '')
      .replace(/^body\b/, '')
      .replace(/^content\b/, '.typora-workspace')
      .replace(/^#typora-sidebar\b/, '#typora-sidebar')
      .replace(/^\.sidebar-content\b/, '.sidebar-content')
      .replace(/^\.sidebar-tabs\b/, '.sidebar-tabs')
      .replace(/^\.sidebar-tab\b/, '.sidebar-tab')
      .replace(/^\.sidebar(?=[\s.#:[>+~]|$)/, '#typora-sidebar')
      .trim();

    if (!scoped || scoped === ',') return shell;
    if (scoped.startsWith('#typora-sidebar')) return `${shell} ${scoped}`;
    if (scoped.startsWith('.typora-workspace')) return `${shell} ${scoped}`;
    return `${shell} ${scoped}`;
  }

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
    const originalSelectors = splitSelectors(rule.selector);
    const rootVariableSelectors = originalSelectors.filter((selector) => isRootSelector(selector) && ruleHasOnlyCustomProperties(rule));
    const shellSelectors = originalSelectors.filter((selector) => isShellSelector(selector));
    const canvasSelectors = originalSelectors.filter((selector) => isRootSelector(selector) && !ruleHasOnlyCustomProperties(rule));
    const contentSelectors = originalSelectors.filter((selector) => !isShellSelector(selector) && !(isRootSelector(selector) && ruleHasOnlyCustomProperties(rule)));

    const extraRules = [];

    if (rootVariableSelectors.length) {
      const selectors = rootVariableSelectors
        .map((selector) => scopeSelector(selector, themeId, 'vars'))
        .filter(Boolean);
      const uniqueSelectors = [...new Set(selectors)];
      const cloned = cloneRuleWithDeclarations(rule, uniqueSelectors.join(',\n'), () => true);
      if (cloned) extraRules.push(cloned);
    }

    if (canvasSelectors.length) {
      const selectors = canvasSelectors
        .map((selector) => scopeSelector(selector, themeId, 'shell'))
        .filter(Boolean);
      const uniqueSelectors = [...new Set(selectors)];
      const cloned = cloneRuleWithDeclarations(rule, uniqueSelectors.join(',\n'), (declaration) =>
        ['background', 'background-color', 'background-image', 'color', 'font-family', 'font-size', 'line-height', '-webkit-font-smoothing'].includes(declaration.prop) ||
        declaration.prop.startsWith('--')
      );
      if (cloned) extraRules.push(cloned);
    }

    if (shellSelectors.length) {
      const selectors = shellSelectors
        .map((selector) => scopeSelector(selector, themeId, 'shell'))
        .filter(Boolean);
      const uniqueSelectors = [...new Set(selectors)];
      const cloned = cloneRuleWithDeclarations(rule, uniqueSelectors.join(',\n'), () => true);
      if (cloned) extraRules.push(cloned);
    }

    const selectors = contentSelectors
      .map((selector) => scopeSelector(selector, themeId, 'content'))
      .filter(Boolean);

    if (!selectors.length) {
      extraRules.forEach((extraRule) => rule.parent?.insertBefore(rule, extraRule));
      rule.remove();
      return;
    }

    rule.selector = [...new Set(selectors)].join(',\n');
    extraRules.forEach((extraRule) => rule.parent?.insertBefore(rule, extraRule));
  });

  if (typoraRootFontSize) {
    root.append(
      postcss.rule({
        selector: `.typora-theme[data-content-theme="${themeId}"]`,
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
