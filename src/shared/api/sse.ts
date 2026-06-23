export class SseParseError extends Error {
  constructor(
    message: string,
    readonly frameLength: number,
  ) {
    super(message);
    this.name = 'SseParseError';
  }
}

export interface SseMessage<TEvent> {
  data: TEvent;
  event?: string;
  id?: string;
  retry?: number;
}

export async function* parseSseStream<TEvent>(stream: ReadableStream<Uint8Array>): AsyncIterable<TEvent> {
  for await (const message of parseSseMessages<TEvent>(stream)) {
    yield message.data;
  }
}

export async function* parseSseMessages<TEvent>(stream: ReadableStream<Uint8Array>): AsyncIterable<SseMessage<TEvent>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const message = parseSseFrame<TEvent>(frame);
      if (message !== undefined) {
        yield message;
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const message = parseSseFrame<TEvent>(buffer);
    if (message !== undefined) {
      yield message;
    }
  }
}

function parseSseFrame<TEvent>(frame: string) {
  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    const separatorIndex = line.indexOf(':');
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'data') dataLines.push(value);
    if (field === 'event') event = value;
    if (field === 'id' && !value.includes('\r') && !value.includes('\n') && !value.includes(String.fromCharCode(0))) id = value;
    if (field === 'retry') {
      const parsedRetry = Number.parseInt(value, 10);
      if (Number.isFinite(parsedRetry) && parsedRetry >= 0) retry = parsedRetry;
    }
  }

  const data = dataLines.join('\n');

  if (!data) {
    return undefined;
  }

  try {
    return { data: JSON.parse(data) as TEvent, event, id, retry };
  } catch (error) {
    throw new SseParseError(error instanceof Error ? error.message : 'Invalid SSE frame', frame.length);
  }
}
