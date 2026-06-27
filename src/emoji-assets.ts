import { emojiAssetMap } from './generated/emoji-asset-map';
import { flagEmojiAssetMap } from './generated/flag-emoji-asset-map';

export const emojiAssetFor = (emoji: string) => emojiAssetMap[emoji] ?? flagEmojiAssetMap[emoji] ?? null;

export const emojiToCodepointKey = (emoji: string) =>
  Array.from(emoji).map((character) => character.codePointAt(0)?.toString(16) ?? '').join('-');
