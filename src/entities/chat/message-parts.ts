import type { ChatMessage, ChatMessagePart } from '../../shared/api';

export interface AssistantMessageView {
  reasoningParts: ChatMessagePart[];
  textParts: ChatMessagePart[];
  toolParts: ChatMessagePart[];
}

export function partitionAssistantParts(parts: ChatMessagePart[]): AssistantMessageView {
  const reasoningParts: ChatMessagePart[] = [];
  const textParts: ChatMessagePart[] = [];
  const toolParts: ChatMessagePart[] = [];

  for (const part of parts) {
    if (part.type === 'text') {
      textParts.push(part);
    }
  }

  return { reasoningParts, textParts, toolParts };
}

export function reasoningDurationLabel(parts: ChatMessagePart[]) {
  const startedAt = parts.map((part) => part.startedAt).find(Boolean);
  const completedAt = parts.map((part) => part.completedAt).find(Boolean);
  if (startedAt && completedAt) {
    const seconds = Math.max(1, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000));
    return `Думал ${seconds} сек`;
  }

  return parts.length > 0 ? 'Думал' : null;
}

export function assistantVisibleText(parts: ChatMessagePart[]) {
  return parts
    .map((part) => part.text.trimEnd())
    .filter(Boolean)
    .join('\n\n');
}

export function toolChipLabel(part: ChatMessagePart) {
  return part.text.trim();
}

export function hasAssistantContent(message: ChatMessage) {
  return message.parts.some((part) => part.text.trim().length > 0);
}
