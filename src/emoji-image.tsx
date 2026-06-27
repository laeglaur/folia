import { emojiAssetFor } from './emoji-assets';

export function EmojiImage({
  emoji,
  className = '',
  label,
  decorative = false
}: {
  emoji: string;
  className?: string;
  label?: string;
  decorative?: boolean;
}) {
  const asset = emojiAssetFor(emoji);
  const classes = `emoji-image ${asset ? 'has-emoji-asset' : 'is-emoji-fallback'} ${className}`.trim();
  if (!asset) {
    return (
      <span className={classes} aria-hidden={decorative ? 'true' : undefined} aria-label={decorative ? undefined : label ?? emoji}>
        {emoji}
      </span>
    );
  }
  return (
    <img
      className={classes}
      src={asset}
      alt={decorative ? '' : label ?? emoji}
      aria-hidden={decorative ? 'true' : undefined}
      draggable={false}
    />
  );
}
