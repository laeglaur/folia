import type { Notebook, NotebookCalendarDateSource, NotebookCalendarViewConfig, Page, PageCalendarDisplayField, PageMetadata } from './types';
import { localDateKey } from './app-utils';
import { metadataFieldTypeFor, shouldHideMetadataField } from './metadata-fields';

export type PageCalendarFieldCandidate = {
  key: NotebookCalendarDateSource;
  label: string;
  count: number;
};

export type PageCalendarEntry = {
  page: Page;
  key: string;
  source: NotebookCalendarDateSource;
  date: string;
  startDate: string;
  endDate: string;
  title: string;
  fields: PageCalendarDisplayField[];
  colorKey: string;
};

const preferredVisibleFields = [
  '类型',
  'type',
  '状态',
  'status',
  '评分',
  'score',
  'rating',
  '作者',
  'author',
  '观看时间',
  '完成时间',
  'Date',
  'Created',
  'date',
  'tags'
];

const preferredDateFieldNames = [
  '观看时间',
  '完成时间',
  '阅读时间',
  'Date',
  'Created',
  'created',
  'date',
  '日期',
  '时间',
  'finished',
  'completed',
  'watched'
];

export const normalizeCalendarFieldKey = (key: string) =>
  key.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

const scalarValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(', ');
  return typeof value === 'string' ? value.trim() : '';
};

const fieldsFromMetadata = (metadata: PageMetadata) => {
  const fields: Record<string, string | string[]> = { ...(metadata.frontmatter ?? {}) };
  if (metadata.date) fields.date = fields.date ?? metadata.date;
  if (metadata.status) fields.status = fields.status ?? metadata.status;
  if (metadata.tags.length) fields.tags = fields.tags ?? metadata.tags;
  if (metadata.aliases.length) fields.aliases = fields.aliases ?? metadata.aliases;
  if (metadata.sourceFilename) fields.sourceFilename = fields.sourceFilename ?? metadata.sourceFilename;
  return fields;
};

const fieldValue = (metadata: PageMetadata, key: string) => {
  const fields = fieldsFromMetadata(metadata);
  const normalized = normalizeCalendarFieldKey(key);
  const found = Object.entries(fields).find(([candidate]) => normalizeCalendarFieldKey(candidate) === normalized);
  return scalarValue(found?.[1]);
};

const calendarSourceFieldKey = (source: NotebookCalendarDateSource) => {
  if (source === 'createdAt') return '';
  if (source.startsWith('metadata.')) return source.slice('metadata.'.length);
  if (source.startsWith('frontmatter.')) return source.slice('frontmatter.'.length);
  return '';
};

const parseDateValue = (value: string) => {
  const normalized = value
    .trim()
    .replace(/[年月]/g, '-')
    .replace(/[日号]/g, '')
    .replace(/\./g, '-')
    .replace(/\//g, '-');
  const direct = localDateKey(normalized);
  if (direct) return direct;
  const match = normalized.match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (!match) return '';
  const [, year, month, day = '1'] = match;
  return localDateKey(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
};

const normalizeDateRange = (startDate: string, endDate: string) => {
  if (!startDate) return null;
  if (!endDate) return { startDate, endDate: startDate };
  return startDate <= endDate
    ? { startDate, endDate }
    : { startDate: endDate, endDate: startDate };
};

const parseDateRangeValue = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return null;
  const rangeMatch = normalized.match(/(.+?)\s+(?:to|until|through|至|到|—|–|~)\s+(.+)/i);
  if (rangeMatch) {
    return normalizeDateRange(parseDateValue(rangeMatch[1]), parseDateValue(rangeMatch[2]));
  }
  const dateMatches = Array.from(normalized.matchAll(/\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?/g), (match) => match[0]);
  if (dateMatches.length >= 2) {
    return normalizeDateRange(parseDateValue(dateMatches[0]), parseDateValue(dateMatches[1]));
  }
  const singleDate = parseDateValue(normalized);
  return singleDate ? { startDate: singleDate, endDate: singleDate } : null;
};

export const pageDateRangeForCalendar = (page: Page, source: NotebookCalendarDateSource) => {
  if (source === 'createdAt') {
    const date = localDateKey(page.createdAt);
    return date ? { startDate: date, endDate: date } : null;
  }
  if (source.startsWith('metadata.')) {
    const key = source.slice('metadata.'.length);
    if (key === 'date') return parseDateRangeValue(page.metadata.date ?? '');
    if (key === 'status') return parseDateRangeValue(page.metadata.status ?? '');
    return parseDateRangeValue(fieldValue(page.metadata, key));
  }
  if (source.startsWith('frontmatter.')) {
    return parseDateRangeValue(fieldValue(page.metadata, source.slice('frontmatter.'.length)));
  }
  return null;
};

export const pageDateForCalendar = (page: Page, source: NotebookCalendarDateSource) =>
  pageDateRangeForCalendar(page, source)?.startDate ?? '';

export const calendarDateCandidatesForPages = (pages: Page[]): PageCalendarFieldCandidate[] => {
  const counts = new Map<NotebookCalendarDateSource, PageCalendarFieldCandidate>();
  const add = (key: NotebookCalendarDateSource, label: string, count = 1) => {
    const current = counts.get(key) ?? { key, label, count: 0 };
    current.count += count;
    counts.set(key, current);
  };
  pages.forEach((page) => {
    if (localDateKey(page.createdAt)) add('createdAt', 'Created at');
    if (parseDateRangeValue(page.metadata.date ?? '')) add('metadata.date', 'date');
    Object.entries(page.metadata.frontmatter ?? {}).forEach(([key, rawValue]) => {
      const normalized = normalizeCalendarFieldKey(key);
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      const parseableCount = values.filter((value) => parseDateRangeValue(String(value))).length;
      const looksLikeDate = preferredDateFieldNames.some((candidate) => normalizeCalendarFieldKey(candidate) === normalized);
      if (!parseableCount && !looksLikeDate) return;
      add(`frontmatter.${key}`, key, parseableCount || 1);
    });
  });
  return [...counts.values()].sort((left, right) => {
    if (left.key === 'createdAt') return -1;
    if (right.key === 'createdAt') return 1;
    const leftOrder = preferredDateFieldNames.map(normalizeCalendarFieldKey).indexOf(normalizeCalendarFieldKey(left.label));
    const rightOrder = preferredDateFieldNames.map(normalizeCalendarFieldKey).indexOf(normalizeCalendarFieldKey(right.label));
    if (leftOrder !== -1 || rightOrder !== -1) return (leftOrder === -1 ? 999 : leftOrder) - (rightOrder === -1 ? 999 : rightOrder);
    if (right.count !== left.count) return right.count - left.count;
    return left.label.localeCompare(right.label);
  });
};

export const visibleCalendarFieldsForPages = (pages: Page[], limit = 5) => {
  const counts = new Map<string, { key: string; count: number }>();
  pages.forEach((page) => {
    Object.entries(fieldsFromMetadata(page.metadata)).forEach(([key, value]) => {
      const normalized = normalizeCalendarFieldKey(key);
      if (shouldHideMetadataField(normalized)) return;
      if (!scalarValue(value)) return;
      const current = counts.get(normalized) ?? { key, count: 0 };
      current.count += 1;
      counts.set(normalized, current);
    });
  });
  return [...counts.values()]
    .sort((left, right) => {
      const leftOrder = preferredVisibleFields.map(normalizeCalendarFieldKey).indexOf(normalizeCalendarFieldKey(left.key));
      const rightOrder = preferredVisibleFields.map(normalizeCalendarFieldKey).indexOf(normalizeCalendarFieldKey(right.key));
      if (leftOrder !== -1 || rightOrder !== -1) return (leftOrder === -1 ? 999 : leftOrder) - (rightOrder === -1 ? 999 : rightOrder);
      if (right.count !== left.count) return right.count - left.count;
      return left.key.localeCompare(right.key);
    })
    .slice(0, limit)
    .map(({ key }) => key);
};

export const defaultCalendarConfigForPages = (pages: Page[]): NotebookCalendarViewConfig => ({
  enabled: true,
  dateSource: 'createdAt',
  dateSources: ['createdAt'],
  visibleFields: visibleCalendarFieldsForPages(pages),
  colorField: visibleCalendarFieldsForPages(pages, 8).find((field) => ['类型', 'type', '状态', 'status'].includes(field))
    ?? visibleCalendarFieldsForPages(pages, 1)[0]
});

export const buildPageCalendarEntries = (
  pages: Page[],
  config: NotebookCalendarViewConfig,
  activeNotebook: Notebook
) => pages.flatMap((page): PageCalendarEntry[] => {
    const sources = (config.dateSources?.length ? config.dateSources : [config.dateSource])
      .filter((source, index, list) => list.indexOf(source) === index);
    const hiddenFieldKeys = new Set([
      config.colorField,
      ...sources.map(calendarSourceFieldKey)
    ].filter(Boolean).map((key) => normalizeCalendarFieldKey(key as string)));
    const fields = config.visibleFields
      .filter((key) => !hiddenFieldKeys.has(normalizeCalendarFieldKey(key)))
      .map((key) => {
        const value = fieldValue(page.metadata, key);
        return {
          key,
          value,
          type: metadataFieldTypeFor(activeNotebook, key, value, Array.isArray(fieldsFromMetadata(page.metadata)[key]) ? 'list' : 'text')
        };
      })
      .filter((field) => field.value);
    return sources
      .map((source): PageCalendarEntry | null => {
        const range = pageDateRangeForCalendar(page, source);
        if (!range) return null;
        return {
          page,
          key: `${page.id}:${source}:${range.startDate}:${range.endDate}`,
          source,
          date: range.startDate,
          startDate: range.startDate,
          endDate: range.endDate,
          title: page.title || 'Untitled',
          fields,
          colorKey: config.colorField ? fieldValue(page.metadata, config.colorField) : activeNotebook.name
        };
      })
      .filter((entry): entry is PageCalendarEntry => Boolean(entry));
  });
