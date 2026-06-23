import type { ChatTurnEventEnvelope } from '../../shared/api';

export function parseSseDataPayload(line: string): ChatTurnEventEnvelope {
  const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
  return JSON.parse(payload) as ChatTurnEventEnvelope;
}

export async function* streamSsePayloads(lines: string[]): AsyncIterable<ChatTurnEventEnvelope> {
  for (const line of lines) {
    yield parseSseDataPayload(line);
  }
}
