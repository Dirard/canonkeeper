type ProjectCounts = {
  bookCount: number;
  chapterCount: number;
  wordCount: number;
};

const integerFormatter = new Intl.NumberFormat('ru-RU');
const compactFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export const unavailableSectionCopy = 'Раздел пока недоступен в этом рабочем месте.';

/** Human-readable label for a search result, keyed by its `kind`. */
export function searchResultKindLabel(kind: string): string {
  switch (kind) {
    case 'material':
      return 'Материал · открывается в читалке';
    case 'annotation':
      return 'Заметка · локатор';
    case 'canon_fact':
      return 'Канон · локатор';
    default:
      return 'Глава · локатор';
  }
}

export function formatProjectMeta(project: ProjectCounts | null | undefined): string {
  if (!project) {
    return 'Проект загружается';
  }
  return [
    formatCount(project.bookCount, 'книга', 'книги', 'книг'),
    formatCount(project.chapterCount, 'глава', 'главы', 'глав'),
    formatWordCount(project.wordCount),
  ].join(' · ');
}

function formatWordCount(value: number): string {
  if (value >= 1_000_000) {
    return `${compactFormatter.format(value / 1_000_000)} млн слов`;
  }
  if (value >= 1_000) {
    return `${compactFormatter.format(value / 1_000)} тыс. слов`;
  }
  return formatCount(value, 'слово', 'слова', 'слов');
}

function formatCount(value: number, one: string, few: string, many: string): string {
  return `${integerFormatter.format(value)} ${pluralize(value, one, few, many)}`;
}

const timeFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Human-readable relative time for save/update status copy. */
export function formatRelativeTime(value: string | number | Date | null | undefined, now: number = Date.now()): string {
  if (value === null || value === undefined) {
    return '';
  }
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const diffSeconds = Math.round((now - timestamp) / 1000);
  if (diffSeconds < 45) {
    return 'только что';
  }
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${formatCount(diffMinutes, 'минуту', 'минуты', 'минут')} назад`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${formatCount(diffHours, 'час', 'часа', 'часов')} назад`;
  }
  return `в ${timeFormatter.format(timestamp)}`;
}

function pluralize(value: number, one: string, few: string, many: string): string {
  const lastTwo = Math.abs(value) % 100;
  const lastOne = lastTwo % 10;
  if (lastTwo >= 11 && lastTwo <= 14) {
    return many;
  }
  if (lastOne === 1) {
    return one;
  }
  if (lastOne >= 2 && lastOne <= 4) {
    return few;
  }
  return many;
}
