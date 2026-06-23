import type { Chapter, ChapterListItem } from '../../../entities/manuscript/api';
import { draftMarkdownToBlocks, draftMarkdownToPlainText, normalizeDraftMarkdown } from './manuscript-draft-markdown';

export type DraftChapterListItem = ChapterListItem;
export type ChapterParagraph = Chapter['paragraphs'][number];
export type ChapterParagraphInput = {
  id?: string;
  order: number;
  kind: ChapterParagraph['kind'];
  text: string;
  markdown: string;
};
export type FormatAction = 'undo' | 'redo' | 'bold' | 'italic' | 'heading' | 'quote' | 'list' | 'link' | 'agent';

export function chapterToDraftText(chapter: Chapter) {
  const paragraphs = chapter.paragraphs
    .filter((paragraph, index) => !(index === 0 && paragraph.kind === 'heading'))
    .map((paragraph) => paragraph.markdown || paragraph.text);
  return paragraphs.length > 0 ? normalizeDraftMarkdown(paragraphs.join('\n\n')) : '';
}

/**
 * Builds the draft save payload while preserving existing server paragraph IDs.
 * Existing paragraphs reuse their `id` (matched by content, then position); genuinely
 * new paragraphs omit `id` until the backend assigns stable paragraph IDs.
 */
export function toParagraphInputs(
  text: string,
  chapterNumber: string,
  title: string,
  existing: readonly ChapterParagraph[] = [],
): ChapterParagraphInput[] {
  const body = draftMarkdownToBlocks(text);
  const existingHeading = existing[0]?.kind === 'heading' ? existing[0] : undefined;
  const existingBody = existing.filter((paragraph, index) => !(index === 0 && paragraph.kind === 'heading'));

  const available = [...existingBody];
  function takeMatch(markdown: string): ChapterParagraph | undefined {
    const exactIndex = available.findIndex((paragraph) => (paragraph.markdown || paragraph.text) === markdown);
    if (exactIndex !== -1) {
      return available.splice(exactIndex, 1)[0];
    }
    return available.shift();
  }

  const heading: ChapterParagraphInput = {
    order: 1,
    kind: 'heading',
    text: `Глава ${chapterNumber}. ${title}`,
    markdown: `## Глава ${chapterNumber}. ${title}`,
    ...(existingHeading ? { id: existingHeading.id } : {}),
  };

  const bodyInputs = body.map((paragraph, index): ChapterParagraphInput => {
    const matched = takeMatch(paragraph.markdown);
    return {
      order: index + 2,
      kind: paragraph.kind,
      text: paragraph.text,
      markdown: paragraph.markdown,
      ...(matched ? { id: matched.id } : {}),
    };
  });

  return [heading, ...bodyInputs];
}

export function formatDraftFragment(action: FormatAction, value: string) {
  if (action === 'bold') return `**${value}**`;
  if (action === 'italic') return `*${value}*`;
  if (action === 'heading') return `## ${value}`;
  if (action === 'quote') return `> ${value}`;
  if (action === 'list') return `- ${value}`;
  if (action === 'link') return `[${value}](canon://reference)`;
  return value;
}

export function countWords(text: string) {
  const matches = draftMarkdownToPlainText(text)
    .trim()
    .match(/[A-Za-zА-Яа-яЁё0-9]+(?:[-'][A-Za-zА-Яа-яЁё0-9]+)*/g);
  return matches?.length ?? 0;
}

export function countDraftParagraphs(text: string) {
  return draftMarkdownToBlocks(text).filter((paragraph) => paragraph.kind !== 'scene_break').length;
}

export function nextChapterNumber(chapters: DraftChapterListItem[]) {
  if (chapters.length === 0) {
    return '1';
  }
  return String(Math.max(0, ...chapters.map((chapter) => chapter.order)) + 1);
}
