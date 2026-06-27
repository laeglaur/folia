import fs from 'node:fs/promises';
import path from 'node:path';
import { emojiRecords } from '../src/generated/emoji-records.ts';

const fluentSourceDir = process.argv[2] ?? '/tmp/fluent-emoji-unicode/assets';
const flagSourceDir = process.argv[3] ?? '/tmp/flag-icons/flags/4x3';
const fluentTargetDir = './public/app-assets/emoji/fluent-color';
const flagTargetDir = './public/app-assets/emoji/flags';

const toCodepointKey = (emoji) =>
  Array.from(emoji).map((character) => character.codePointAt(0).toString(16)).join('-');

const withoutVariationSelector = (codepointKey) =>
  codepointKey.split('-').filter((part) => part !== 'fe0f').join('-');

const flagEmojiToCountryCode = (emoji) => {
  const points = Array.from(emoji).map((character) => character.codePointAt(0));
  if (points.length !== 2) return null;
  const letters = points.map((point) => {
    if (!point || point < 0x1f1e6 || point > 0x1f1ff) return null;
    return String.fromCharCode(97 + point - 0x1f1e6);
  });
  return letters.every(Boolean) ? letters.join('') : null;
};

await fs.rm(fluentTargetDir, { recursive: true, force: true });
await fs.rm(flagTargetDir, { recursive: true, force: true });
await fs.mkdir(fluentTargetDir, { recursive: true });
await fs.mkdir(flagTargetDir, { recursive: true });

const emojiAssetMap = {};
let copiedEmoji = 0;
let skippedPeople = 0;
let missingEmoji = 0;

for (const record of emojiRecords) {
  if (record.group === 'People & Body' || (record.group === 'Flags' && record.subgroup === 'country-flag')) {
    if (record.group === 'People & Body') skippedPeople += 1;
    continue;
  }
  const codepointKey = toCodepointKey(record.emoji);
  const candidates = [
    `${codepointKey}_color.svg`,
    `${withoutVariationSelector(codepointKey)}_color.svg`,
    `${record.emoji}_color.svg`
  ];
  let source = null;
  for (const candidate of candidates) {
    const candidatePath = path.join(fluentSourceDir, candidate);
    try {
      await fs.access(candidatePath);
      source = candidatePath;
      break;
    } catch {
      // Try the next asset naming convention.
    }
  }
  if (!source) {
    missingEmoji += 1;
    continue;
  }
  const filename = `${codepointKey}.svg`;
  await fs.copyFile(source, path.join(fluentTargetDir, filename));
  emojiAssetMap[record.emoji] = `/app-assets/emoji/fluent-color/${filename}`;
  copiedEmoji += 1;
}

const flagEmojiAssetMap = {};
let copiedFlags = 0;
let missingFlags = 0;

for (const record of emojiRecords) {
  if (record.group !== 'Flags' || record.subgroup !== 'country-flag') continue;
  const countryCode = flagEmojiToCountryCode(record.emoji);
  if (!countryCode) continue;
  const source = path.join(flagSourceDir, `${countryCode}.svg`);
  try {
    await fs.access(source);
  } catch {
    missingFlags += 1;
    continue;
  }
  await fs.copyFile(source, path.join(flagTargetDir, `${countryCode}.svg`));
  flagEmojiAssetMap[record.emoji] = `/app-assets/emoji/flags/${countryCode}.svg`;
  copiedFlags += 1;
}

await fs.writeFile(
  './src/generated/emoji-asset-map.ts',
  `// Generated from Unicode emoji records and local Fluent Emoji assets.\n// People & Body and Flags are intentionally omitted here; flags use flag-emoji-asset-map.ts.\nexport const emojiAssetMap: Record<string, string> = ${JSON.stringify(emojiAssetMap)};\n`
);

await fs.writeFile(
  './src/generated/flag-emoji-asset-map.ts',
  `// Generated from Unicode country flags and local flag-icons assets.\nexport const flagEmojiAssetMap: Record<string, string> = ${JSON.stringify(flagEmojiAssetMap)};\n`
);

console.log({
  copiedEmoji,
  skippedPeople,
  missingEmoji,
  copiedFlags,
  missingFlags
});
