import type { LlmStreamEvent } from '../../shared/api';

export function parseSseDataPayload(line: string): LlmStreamEvent {
  const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
  return JSON.parse(payload) as LlmStreamEvent;
}

export async function* streamSsePayloads(lines: string[]): AsyncIterable<LlmStreamEvent> {
  for (const line of lines) {
    yield parseSseDataPayload(line);
  }
}
