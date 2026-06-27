import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { emojiRecords } from './generated/emoji-records';
import { EmojiImage } from './emoji-image';
import { emojiAssetFor } from './emoji-assets';
import type { Notebook, Page } from './types';

type EmojiPickerTarget =
  | { kind: 'notebook'; notebookId: string }
  | { kind: 'page'; pageId: string };

export type EmojiPickerRequest = {
  target: EmojiPickerTarget;
};

export function EmojiPicker({
  request,
  notebooks,
  pages,
  onClose,
  onChoose,
  onClear
}: {
  request: EmojiPickerRequest | null;
  notebooks: Notebook[];
  pages: Page[];
  onClose: () => void;
  onChoose: (target: EmojiPickerTarget, emoji: string) => void;
  onClear: (target: EmojiPickerTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const target = request?.target ?? null;
  const targetLabel = target?.kind === 'notebook'
    ? notebooks.find((notebook) => notebook.id === target.notebookId)?.name ?? 'Notebook'
    : target?.kind === 'page'
      ? pages.find((page) => page.id === target.pageId)?.title ?? 'Page'
      : '';
  const trimmedQuery = query.trim().toLowerCase();
  const groupedEmoji = useMemo(() => {
    const availableRecords = emojiRecords.filter((record) => emojiAssetFor(record.emoji));
    const records = trimmedQuery
      ? availableRecords.filter((record) =>
        record.emoji.includes(trimmedQuery) ||
        record.name.toLowerCase().includes(trimmedQuery) ||
        record.group.toLowerCase().includes(trimmedQuery) ||
        record.subgroup.toLowerCase().includes(trimmedQuery)
      ).slice(0, 240)
      : availableRecords;
    return records.reduce<Array<{ label: string; records: typeof emojiRecords }>>((groups, record) => {
      const label = trimmedQuery ? 'Matches' : record.group;
      const existing = groups.find((group) => group.label === label);
      if (existing) existing.records.push(record);
      else groups.push({ label, records: [record] });
      return groups;
    }, []);
  }, [trimmedQuery]);
  if (!target) return null;

  return (
    <div className="emoji-picker-backdrop" role="dialog" aria-modal="true" aria-label="Choose emoji">
      <div className="emoji-picker-dialog">
        <header className="emoji-picker-head">
          <div>
            <strong>Choose emoji</strong>
            <span>{targetLabel}</span>
          </div>
          <button className="mini-button" type="button" onClick={onClose} aria-label="Close emoji picker"><X size={15} /></button>
        </header>

        <label className="emoji-picker-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all emoji" autoFocus />
        </label>

        <div className="emoji-picker-groups">
          {groupedEmoji.map((group) => (
            <section className="emoji-picker-group" key={group.label}>
              <h2>{group.label}</h2>
              <div className="emoji-picker-grid">
                {group.records.map((record) => (
                  <button
                    className="emoji-choice"
                    key={`${group.label}-${record.emoji}-${record.name}`}
                    type="button"
                    onClick={() => {
                      onChoose(target, record.emoji);
                      onClose();
                    }}
                    title={record.name}
                    aria-label={`Use ${record.name}`}
                  >
                    <EmojiImage emoji={record.emoji} decorative />
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!groupedEmoji.length ? <p className="emoji-picker-empty">No emoji found.</p> : null}
        </div>

        <footer className="emoji-picker-foot">
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              onClear(target);
              onClose();
            }}
          >
            Clear emoji
          </button>
        </footer>
      </div>
    </div>
  );
}
