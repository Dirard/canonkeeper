import { describe, expect, it } from 'vitest';
import type { ChatMessagePart } from '../../shared/api';
import { assistantVisibleText, partitionAssistantParts, reasoningDurationLabel, toolChipLabel } from './message-parts';

describe('chat message parts', () => {
  const parts: ChatMessagePart[] = [
    {
      type: 'reasoning',
      text: 'Проверяю раннюю сцену в порту.',
      sequence: 1,
      status: 'completed',
      label: 'Думал 12 сек',
    },
    {
      type: 'tool_result',
      text: 'Поиск по корпусу · 18',
      sequence: 2,
      status: 'completed',
      label: 'Поиск по корпусу · 18',
      toolName: 'search_corpus',
    },
    {
      type: 'text',
      text: 'По ранней записи первый дым заметила Мара.',
      sequence: 3,
      status: 'completed',
    },
  ];

  it('partitions assistant parts by semantic type', () => {
    const view = partitionAssistantParts(parts);
    expect(view.reasoningParts).toHaveLength(1);
    expect(view.toolParts).toHaveLength(1);
    expect(view.textParts).toHaveLength(1);
  });

  it('prefers API labels for reasoning and tool chips', () => {
    const view = partitionAssistantParts(parts);
    expect(reasoningDurationLabel(view.reasoningParts)).toBe('Думал 12 сек');
    expect(toolChipLabel(view.toolParts[0]!)).toBe('Поиск по корпусу · 18');
    expect(assistantVisibleText(view.textParts)).toBe('По ранней записи первый дым заметила Мара.');
  });
});
