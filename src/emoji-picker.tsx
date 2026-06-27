import { useMemo, useState } from 'react';
import { ChevronLeft, Search, X } from 'lucide-react';
import { emojiRecords, type EmojiRecord } from './generated/emoji-records';
import { EmojiImage } from './emoji-image';
import { emojiAssetFor } from './emoji-assets';
import type { Notebook, Page } from './types';

type EmojiPickerTarget =
  | { kind: 'notebook'; notebookId: string }
  | { kind: 'page'; pageId: string };

export type EmojiPickerRequest = {
  target: EmojiPickerTarget;
};

const recentEmojiStorageKey = 'notebook.recentEmoji';
const searchResultLimit = 80;
const categoryPreviewLimit = 8;

const readRecentEmoji = () => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentEmojiStorageKey) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

const writeRecentEmoji = (emoji: string) => {
  if (typeof window === 'undefined') return [];
  const next = [emoji, ...readRecentEmoji().filter((entry) => entry !== emoji)].slice(0, 30);
  window.localStorage.setItem(recentEmojiStorageKey, JSON.stringify(next));
  return next;
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
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [recentEmoji, setRecentEmoji] = useState(readRecentEmoji);
  const target = request?.target ?? null;
  const targetLabel = target?.kind === 'notebook'
    ? notebooks.find((notebook) => notebook.id === target.notebookId)?.name ?? 'Notebook'
    : target?.kind === 'page'
      ? pages.find((page) => page.id === target.pageId)?.title ?? 'Page'
      : '';
  const trimmedQuery = query.trim().toLowerCase();
  const availableRecords = useMemo(() => emojiRecords.filter((record) => emojiAssetFor(record.emoji)), []);
  const groups = useMemo(() => {
    return availableRecords.reduce<Array<{ label: string; records: EmojiRecord[] }>>((items, record) => {
      const existing = items.find((item) => item.label === record.group);
      if (existing) existing.records.push(record);
      else items.push({ label: record.group, records: [record] });
      return items;
    }, []);
  }, [availableRecords]);
  const searchRecords = useMemo(() => {
    if (!trimmedQuery) return [];
    return availableRecords.filter((record) =>
        record.emoji.includes(trimmedQuery) ||
        record.name.toLowerCase().includes(trimmedQuery) ||
        record.group.toLowerCase().includes(trimmedQuery) ||
        record.subgroup.toLowerCase().includes(trimmedQuery)
      ).slice(0, searchResultLimit);
  }, [availableRecords, trimmedQuery]);
  const activeRecords = useMemo(() => {
    if (!activeGroup) return [];
    return groups.find((group) => group.label === activeGroup)?.records ?? [];
  }, [activeGroup, groups]);
  const recentRecords = useMemo(() => {
    const recentSet = new Set(recentEmoji);
    return recentEmoji
      .map((emoji) => availableRecords.find((record) => record.emoji === emoji))
      .filter((record): record is EmojiRecord => Boolean(record && recentSet.has(record.emoji)));
  }, [availableRecords, recentEmoji]);
  const chooseEmoji = (emoji: string) => {
    if (!target) return;
    setRecentEmoji(writeRecentEmoji(emoji));
    onChoose(target, emoji);
    onClose();
  };
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
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveGroup(null);
            }}
            placeholder="Search emoji"
            autoFocus
          />
        </label>

        <div className="emoji-picker-groups">
          {trimmedQuery ? (
            <section className="emoji-picker-group">
              <h2>Matches</h2>
              <div className="emoji-picker-grid">
                {searchRecords.map((record) => (
                  <button
                    className="emoji-choice"
                    key={`search-${record.emoji}-${record.name}`}
                    type="button"
                    onClick={() => chooseEmoji(record.emoji)}
                    title={record.name}
                    aria-label={`Use ${record.name}`}
                  >
                    <EmojiImage emoji={record.emoji} decorative />
                  </button>
                ))}
              </div>
            </section>
          ) : activeGroup ? (
            <section className="emoji-picker-group">
              <button className="emoji-picker-back" type="button" onClick={() => setActiveGroup(null)}>
                <ChevronLeft size={15} />
                <span>{activeGroup}</span>
              </button>
              <div className="emoji-picker-grid">
                {activeRecords.map((record) => (
                  <button
                    className="emoji-choice"
                    key={`${activeGroup}-${record.emoji}-${record.name}`}
                    type="button"
                    onClick={() => chooseEmoji(record.emoji)}
                    title={record.name}
                    aria-label={`Use ${record.name}`}
                  >
                    <EmojiImage emoji={record.emoji} decorative />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <>
              {recentRecords.length ? (
                <section className="emoji-picker-group">
                  <h2>Recent</h2>
                  <div className="emoji-picker-grid emoji-picker-grid-preview">
                    {recentRecords.map((record) => (
                      <button
                        className="emoji-choice"
                        key={`recent-${record.emoji}-${record.name}`}
                        type="button"
                        onClick={() => chooseEmoji(record.emoji)}
                        title={record.name}
                        aria-label={`Use ${record.name}`}
                      >
                        <EmojiImage emoji={record.emoji} decorative />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              <div className="emoji-category-list">
                {groups.map((group) => (
                  <button className="emoji-category-card" key={group.label} type="button" onClick={() => setActiveGroup(group.label)}>
                    <span className="emoji-category-title">{group.label}</span>
                    <span className="emoji-category-count">{group.records.length}</span>
                    <span className="emoji-category-preview" aria-hidden="true">
                      {group.records.slice(0, categoryPreviewLimit).map((record) => (
                        <EmojiImage emoji={record.emoji} key={`${group.label}-preview-${record.emoji}`} decorative />
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {trimmedQuery && !searchRecords.length ? <p className="emoji-picker-empty">No emoji found.</p> : null}
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
