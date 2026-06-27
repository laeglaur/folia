import fs from 'node:fs/promises';

const sourceUrl = 'https://unicode.org/Public/emoji/15.1/emoji-test.txt';
const outputPath = new URL('../src/generated/emoji-records.ts', import.meta.url);

const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Could not download emoji data: ${response.status}`);

const text = await response.text();
const records = [];
let group = 'Emoji';
let subgroup = 'General';

for (const line of text.split(/\r?\n/)) {
  const groupMatch = line.match(/^# group: (.+)$/);
  if (groupMatch) {
    group = groupMatch[1];
    continue;
  }
  const subgroupMatch = line.match(/^# subgroup: (.+)$/);
  if (subgroupMatch) {
    subgroup = subgroupMatch[1];
    continue;
  }
  const match = line.match(/^[0-9A-F ]+\s*;\s*fully-qualified\s*#\s*(\S+)\s+E\d+\.\d+\s+(.+)$/);
  if (!match) continue;
  records.push({ emoji: match[1], name: match[2], group, subgroup });
}

const output = `// Generated from ${sourceUrl}
export type EmojiRecord = { emoji: string; name: string; group: string; subgroup: string };

export const emojiRecords: EmojiRecord[] = ${JSON.stringify(records)};
`;

await fs.mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
await fs.writeFile(outputPath, output);
console.log(`Wrote ${records.length} emoji records to ${outputPath.pathname}`);
