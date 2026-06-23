import { describe, expect, it } from 'vitest';
import type { Chapter } from '../../../entities/manuscript/api';
import {
  chapterToDraftText,
  countDraftParagraphs,
  countWords,
  formatDraftFragment,
  nextChapterNumber,
  toParagraphInputs,
  type DraftChapterListItem,
} from './manuscript-draft-model';

describe('draft model', () => {
  it('maps API chapter paragraphs into editable draft text', () => {
    const chapter = {
      paragraphs: [
        { kind: 'heading', text: 'Глава 16. Черновик' },
        { kind: 'paragraph', text: 'Первый абзац.' },
        { kind: 'paragraph', text: 'Второй абзац.' },
      ],
    } as unknown as Chapter;

    expect(chapterToDraftText(chapter)).toBe('Первый абзац.\n\nВторой абзац.');
  });

  it('omits ids for brand-new paragraphs without fabricating server ids', () => {
    expect(toParagraphInputs('Первый\n\n\nВторой ', '17', 'Северный суд')).toEqual([
      {
        order: 1,
        kind: 'heading',
        text: 'Глава 17. Северный суд',
        markdown: '## Глава 17. Северный суд',
      },
      {
        order: 2,
        kind: 'paragraph',
        text: 'Первый',
        markdown: 'Первый',
      },
      {
        order: 3,
        kind: 'paragraph',
        text: 'Второй',
        markdown: 'Второй',
      },
    ]);
  });

  it('preserves existing server paragraph ids when reconciling an edited chapter', () => {
    const existing = [
      { id: 'srv-head', order: 1, kind: 'heading', text: 'Глава 17. Старое', markdown: '## Глава 17. Старое' },
      { id: 'srv-1', order: 2, kind: 'paragraph', text: 'Первый', markdown: 'Первый' },
      { id: 'srv-2', order: 3, kind: 'paragraph', text: 'Второй', markdown: 'Второй' },
    ] as Chapter['paragraphs'];

    const inputs = toParagraphInputs('Первый\n\nВторой\n\nТретий', '17', 'Северный суд', existing);

    expect(inputs[0]?.id).toBe('srv-head');
    expect(inputs[1]?.id).toBe('srv-1');
    expect(inputs[2]?.id).toBe('srv-2');
    expect(inputs[3]?.id).toBeUndefined();
  });

  it('keeps formatting, metrics and next chapter numbering deterministic', () => {
    const chapters = [{ order: 12 }, { order: 16 }] as DraftChapterListItem[];

    expect(formatDraftFragment('quote', 'строка')).toBe('> строка');
    expect(formatDraftFragment('agent', 'строка')).toBe('строка');
    expect(countWords('Белый порт и beta-reader')).toBe(4);
    expect(countDraftParagraphs('A\n\n \n\nB')).toBe(2);
    expect(nextChapterNumber(chapters)).toBe('17');
    expect(nextChapterNumber([])).toBe('1');
  });
});
