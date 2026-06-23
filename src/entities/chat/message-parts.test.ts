import { describe, expect, it } from 'vitest';
import type { ChatMessagePart } from '../../shared/api';
import { assistantVisibleText, partitionAssistantParts, reasoningDurationLabel, toolChipLabel } from './message-parts';

describe('chat message parts', () => {
  const parts: ChatMessagePart[] = [
    {
      type: 'text',
      text: 'Проверка завершена.',
      sequence: 1,
      status: 'completed',
    },
    {
      type: 'text',
      text: 'По ранней записи первый дым заметила Мара.',
      sequence: 2,
      status: 'completed',
    },
  ];

  it('keeps public assistant history as visible text parts', () => {
    const view = partitionAssistantParts(parts);
    expect(view.reasoningParts).toHaveLength(0);
    expect(view.toolParts).toHaveLength(0);
    expect(view.textParts).toHaveLength(2);
  });

  it('formats public text parts without internal runtime categories', () => {
    const view = partitionAssistantParts(parts);
    expect(reasoningDurationLabel(view.reasoningParts)).toBeNull();
    expect(toolChipLabel(view.textParts[0]!)).toBe('Проверка завершена.');
    expect(assistantVisibleText(view.textParts)).toBe('Проверка завершена.\n\nПо ранней записи первый дым заметила Мара.');
  });
});
