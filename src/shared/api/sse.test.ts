import { describe, expect, it } from 'vitest';
import { SseParseError, parseSseStream } from './sse';

type TestEvent = { type: string; sequence: number; delta?: string };

function streamFromChunks(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events: TestEvent[] = [];
  for await (const event of parseSseStream<TestEvent>(stream)) {
    events.push(event);
  }
  return events;
}

describe('parseSseStream', () => {
  it('parses JSON frames split across arbitrary chunk boundaries', async () => {
    await expect(
      collect(
        streamFromChunks([
          'data: {"type":"reasoning_delta",',
          '"sequence":1,"delta":"step"}\n\n',
          'data: {"type":"completed","sequence":2}\n\n',
        ]),
      ),
    ).resolves.toEqual([
      { type: 'reasoning_delta', sequence: 1, delta: 'step' },
      { type: 'completed', sequence: 2 },
    ]);
  });

  it('ignores blank frames, comments and keepalive frames', async () => {
    await expect(
      collect(
        streamFromChunks([
          ': keepalive\n\n',
          '\n\n',
          'data: {"type":"text_delta","sequence":1,"delta":"ok"}\n\n',
          ': another keepalive\n\n',
        ]),
      ),
    ).resolves.toEqual([{ type: 'text_delta', sequence: 1, delta: 'ok' }]);
  });

  it('rejects untyped terminal marker frames', async () => {
    const marker = `[${'DONE'}]`;
    await expect(collect(streamFromChunks([`data: ${marker}\n\n`]))).rejects.toBeInstanceOf(SseParseError);
  });

  it('reports malformed JSON frames without retaining raw frame contents', async () => {
    await expect(collect(streamFromChunks(['data: {"type":"text_delta"\n\n']))).rejects.toBeInstanceOf(SseParseError);
    await expect(collect(streamFromChunks(['data: {"type":"text_delta"\n\n']))).rejects.toMatchObject({
      frameLength: 26,
    });
  });

  it('surfaces mid-stream disconnects after yielding prior complete frames', async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (reads === 0) {
          reads += 1;
          controller.enqueue(encoder.encode('data: {"type":"text_delta","sequence":1,"delta":"ok"}\n\n'));
          return;
        }
        controller.error(new Error('connection closed'));
      },
    });

    const iterator = parseSseStream<TestEvent>(stream)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'text_delta', sequence: 1, delta: 'ok' },
    });
    await expect(iterator.next()).rejects.toThrow('connection closed');
  });
});
