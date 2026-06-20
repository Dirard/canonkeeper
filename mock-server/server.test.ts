import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiStatusError, createCanonKeeperApiClient } from '../src/shared/api';
import { parseSseStream, SseParseError } from '../src/shared/api/sse';
import { createMockApiServer, type MockApiLogEvent, type MockApiServerController } from './server';

function bodyStream(chunks: string[]) {
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

async function collectEvents<T>(stream: ReadableStream<Uint8Array>) {
  const events: T[] = [];
  for await (const event of parseSseStream<T>(stream)) {
    events.push(event);
  }
  return events;
}

describe('mock API server', () => {
  let controller: MockApiServerController;
  let baseUrl: string;
  let logs: MockApiLogEvent[];

  beforeEach(async () => {
    logs = [];
    controller = createMockApiServer({
      port: 0,
      logger(event) {
        logs.push(event);
      },
    });
    const started = await controller.start();
    baseUrl = `${started.url}/api/v1`;
  });

  afterEach(async () => {
    await controller.stop();
  });

  it('serves OpenAPI-shaped JSON endpoints from a connected authenticated dataset', async () => {
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'mira@example.com', password: 'white-port-12', rememberMe: true }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    expect(login.status).toBe(200);
    expect(cookie).toBe('ck_session=mock-session');

    const projects = await fetch(`${baseUrl}/projects`, { headers: { cookie: cookie ?? '' } });
    await expect(projects.json()).resolves.toMatchObject({
      data: [{ id: 'project-white-port', title: 'Хроники Белого порта' }],
    });
  });

  it('requires a session cookie for protected endpoints and supports safe status overrides', async () => {
    const missingSession = await fetch(`${baseUrl}/projects`);
    await expect(missingSession.json()).resolves.toMatchObject({ status: 401, title: 'Unauthorized' });

    const overridden = await fetch(`${baseUrl}/projects`, { headers: { mock_return_status: '500' } });
    await expect(overridden.json()).resolves.toMatchObject({
      status: 500,
      title: 'Internal server error',
      detail: 'Mock status override.',
    });
  });

  it('streams deterministic chat SSE over POST fetch without EventSource', async () => {
    const api = createCanonKeeperApiClient({
      baseUrl,
      fetch: async (request) => {
        const headers = new Headers(request.headers);
        headers.set('cookie', 'ck_session=mock-session');
        return fetch(request, { headers });
      },
    });

    await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'mira@example.com', password: 'white-port-12', rememberMe: true }),
    });

    const events = [];
    for await (const event of api.sendChatMessage('chat-white-port', { content: 'Привет', stream: true })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'reasoning_delta',
      'text_delta',
      'tool_call',
      'tool_result',
      'completed',
    ]);
  });

  it('returns OpenAPI problem JSON before opening an overridden SSE stream', async () => {
    const response = await fetch(`${baseUrl}/chats/chat-white-port/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        mock_return_status: '403',
      },
      body: JSON.stringify({ content: 'Привет', stream: true }),
    });

    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });
  });

  it('applies MOCK_RETURN_STATUS to secondary search/import/indexing/export endpoints', async () => {
    await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'mira@example.com', password: 'white-port-12', rememberMe: true }),
    });

    const secondaryRequests = [
      fetch(`${baseUrl}/projects/project-white-port/search?q=port`, {
        headers: { cookie: 'ck_session=mock-session', mock_return_status: '500' },
      }),
      fetch(`${baseUrl}/projects/project-white-port/import-constraints`, {
        headers: { cookie: 'ck_session=mock-session', mock_return_status: '403' },
      }),
      fetch(`${baseUrl}/projects/project-white-port/imports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'ck_session=mock-session', mock_return_status: '500' },
        body: JSON.stringify({ file: 'book.epub', title: 'Book' }),
      }),
      fetch(`${baseUrl}/indexing-jobs/index-job-1/cancel`, {
        method: 'POST',
        headers: { cookie: 'ck_session=mock-session', mock_return_status: '409' },
      }),
      fetch(`${baseUrl}/books/book-02/exports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'ck_session=mock-session', mock_return_status: '500' },
        body: JSON.stringify({ format: 'epub' }),
      }),
    ];

    const responses = await Promise.all(secondaryRequests);

    expect(responses.map((response) => response.status)).toEqual([500, 403, 500, 409, 500]);
    for (const response of responses) {
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toMatchObject({ detail: 'Mock status override.' });
    }
  });

  it('keeps CORS local-only and logs only sanitized request metadata', async () => {
    const local = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'mira@example.com', password: 'white-port-12', rememberMe: true }),
    });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');

    const external = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.invalid' },
      body: JSON.stringify({ email: 'mira@example.com', password: 'white-port-12', rememberMe: true }),
    });
    expect(external.headers.get('access-control-allow-origin')).toBeNull();
    expect(JSON.stringify(logs)).not.toContain('white-port-12');
    expect(JSON.stringify(logs)).not.toContain('Привет');
  });
});

describe('SSE parser proof', () => {
  it('handles chunk boundaries, comments, keepalive frames and blank-line frames', async () => {
    const stream = bodyStream([
      ': keepalive\n\n',
      'data: {"type":"text_delta","sequence":1',
      ',"delta":"A"}\n\n\n',
      'data: {"type":"completed","sequence":2,"assistantMessageId":"m","turnId":"t","finishReason":"stop"}\n\n',
    ]);

    await expect(collectEvents(stream)).resolves.toEqual([
      { type: 'text_delta', sequence: 1, delta: 'A' },
      { type: 'completed', sequence: 2, assistantMessageId: 'm', turnId: 't', finishReason: 'stop' },
    ]);
  });

  it('surfaces malformed JSON and mid-stream disconnects', async () => {
    await expect(collectEvents(bodyStream(['data: {bad}\n\n']))).rejects.toBeInstanceOf(SseParseError);
    await expect(collectEvents(bodyStream(['data: {"type":"text_delta"']))).rejects.toBeInstanceOf(SseParseError);
  });

  it('maps SSE error-before-stream responses as API status errors', async () => {
    const controller = createMockApiServer({ port: 0 });
    const started = await controller.start();
    const api = createCanonKeeperApiClient({
      baseUrl: `${started.url}/api/v1`,
      fetch: async (request) => {
        const headers = new Headers(request.headers);
        headers.set('cookie', 'ck_session=mock-session');
        headers.set('mock_return_status', '500');
        return fetch(request, { headers });
      },
    });

    try {
      await expect(api.sendChatMessage('chat-white-port', { content: 'Привет', stream: true }).next()).rejects.toBeInstanceOf(
        ApiStatusError,
      );
    } finally {
      await controller.stop();
    }
  });
});
