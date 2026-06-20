export class SseParseError extends Error {
  constructor(
    message: string,
    readonly frameLength: number,
  ) {
    super(message);
    this.name = 'SseParseError';
  }
}

export async function* parseSseStream<TEvent>(stream: ReadableStream<Uint8Array>): AsyncIterable<TEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const event = parseSseFrame<TEvent>(frame);
      if (event !== undefined) {
        yield event;
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const event = parseSseFrame<TEvent>(buffer);
    if (event !== undefined) {
      yield event;
    }
  }
}

function parseSseFrame<TEvent>(frame: string) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data || data === '[DONE]') {
    return undefined;
  }

  try {
    return JSON.parse(data) as TEvent;
  } catch (error) {
    throw new SseParseError(error instanceof Error ? error.message : 'Invalid SSE frame', frame.length);
  }
}
