import type { MetadataFieldType, Notebook, NotebookMetadataField, Page } from './types';

export const normalizeMetadataFieldKey = (key: string) => key.trim().toLowerCase().replace(/[_-]+/g, ' ');

const hiddenMetadataFieldKeys = new Set([
  'base',
  'cover',
  'url',
  'uri',
  'link',
  'notion id',
  'notion-id',
  'notion url',
  'notion-url',
  'id',
  'title',
  'iconid',
  'icon id',
  'sourcefilename',
  'source filename'
]);

export const shouldHideMetadataField = (key: string) => hiddenMetadataFieldKeys.has(normalizeMetadataFieldKey(key));

export const parseMetadataDateRange = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return { start: '', end: '' };
  const match = normalized.match(/(.+?)\s+(?:to|until|through|至|到|—|–|~)\s+(.+)/i);
  if (match) return { start: match[1].trim(), end: match[2].trim() };
  return { start: normalized, end: '' };
};

export const formatMetadataDateRange = (start: string, end: string) =>
  start && end ? `${start} to ${end}` : start || end;

export const inferMetadataFieldType = (key: string, value: string, valueKind: 'text' | 'list'): MetadataFieldType => {
  if (valueKind === 'list') return 'multiSelect';
  if (/\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?.+(?:to|至|到|—|–|~).+\d{4}[./-]\d{1,2}/i.test(value)) {
    return 'dateRange';
  }
  if (/^\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?$/.test(value.trim())) {
    return 'date';
  }
  if (value.length > 120 || value.includes('\n')) return 'longText';
  return 'text';
};

export const metadataFieldTypeFor = (
  notebook: Notebook,
  key: string,
  value: string,
  valueKind: 'text' | 'list'
) => notebook.metadata.metadataFields?.[key]?.type
  ?? Object.entries(notebook.metadata.metadataFields ?? {}).find(([candidate]) => normalizeMetadataFieldKey(candidate) === normalizeMetadataFieldKey(key))?.[1].type
  ?? inferMetadataFieldType(key, value, valueKind);

export const metadataSelectOptionsForPages = (pages: Page[], key: string) => {
  const normalized = normalizeMetadataFieldKey(key);
  const options = new Set<string>();
  pages.forEach((page) => {
    const fields: Record<string, string | string[] | undefined> = {
      ...page.metadata.frontmatter,
      date: page.metadata.date,
      status: page.metadata.status,
      tags: page.metadata.tags,
      aliases: page.metadata.aliases
    };
    Object.entries(fields).forEach(([candidate, rawValue]) => {
      if (normalizeMetadataFieldKey(candidate) !== normalized) return;
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      values.forEach((value) => {
        const text = String(value ?? '').trim();
        if (text) options.add(text);
      });
    });
  });
  return [...options].sort((left, right) => left.localeCompare(right));
};

export const inferNotebookMetadataFieldsForPages = (
  pages: Page[],
  existing: Record<string, NotebookMetadataField> = {}
) => {
  const schema: Record<string, NotebookMetadataField> = { ...existing };
  const add = (key: string, value: string, valueKind: 'text' | 'list') => {
    if (shouldHideMetadataField(key)) return;
    if (schema[key]?.type) return;
    schema[key] = { type: inferMetadataFieldType(key, value, valueKind) };
  };

  pages.forEach((page) => {
    if (page.metadata.date) add('date', page.metadata.date, 'text');
    if (page.metadata.status) add('status', page.metadata.status, 'text');
    if (page.metadata.tags.length) add('tags', page.metadata.tags.join(', '), 'list');
    if (page.metadata.aliases.length) add('aliases', page.metadata.aliases.join(', '), 'list');
    Object.entries(page.metadata.frontmatter ?? {}).forEach(([key, value]) => {
      if (['date', 'status', 'tags', 'aliases', 'alias', 'title'].includes(key.toLowerCase())) return;
      add(key, Array.isArray(value) ? value.join(', ') : value, Array.isArray(value) ? 'list' : 'text');
    });
  });

  return schema;
};
