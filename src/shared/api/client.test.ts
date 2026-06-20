import { describe, expect, it } from 'vitest';
import { NetworkApiError, createCanonKeeperApiClient } from './index';
import { operationManifest } from './generated/operation-manifest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function streamResponse(chunks: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('OpenApiCanonKeeperClient', () => {
  it('sends JSON requests through the generated path manifest with credentials included', async () => {
    const calls: Request[] = [];
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async (request) => {
        calls.push(request);
        return jsonResponse({
          user: { id: 'user_1', displayName: 'Мира Волкова', email: 'mira@example.com' },
        });
      },
    });

    const sampleCredential = ['test', 'credential'].join('-');

    await api.login({ email: 'mira@example.com', password: sampleCredential, rememberMe: true });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) {
      throw new Error('Expected login request to be recorded.');
    }
    expect(call.url).toBe('https://api.example.test/api/v1/auth/login');
    expect(call.method).toBe('POST');
    expect(call.credentials).toBe('include');
    await expect(call.clone().json()).resolves.toEqual({
      email: 'mira@example.com',
      password: sampleCredential,
      rememberMe: true,
    });
  });

  it('maps OpenAPI problem responses separately from network failures', async () => {
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async () => jsonResponse({ type: 'about:blank', title: 'Forbidden', status: 403 }, 403),
    });

    await expect(api.listProjects()).rejects.toMatchObject({
      name: 'ApiStatusError',
      status: 403,
      problem: { title: 'Forbidden', status: 403 },
    });
  });

  it('maps thrown fetch failures to NetworkApiError', async () => {
    const api = createCanonKeeperApiClient({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(api.listProjects()).rejects.toBeInstanceOf(NetworkApiError);
  });

  it('streams POST SSE responses without EventSource', async () => {
    const calls: Request[] = [];
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async (request) => {
        calls.push(request);
        return streamResponse([
          'data: {"type":"text_delta","sequence":1,"delta":"Привет"}\n\n',
          ': keepalive\n\n',
          'data: {"type":"completed","sequence":2,"assistantMessageId":"msg_2","turnId":"turn_1","finishReason":"stop"}\n\n',
        ]);
      },
    });

    const events = [];
    for await (const event of api.sendChatMessage('chat_1', { content: 'Привет', stream: true })) {
      events.push(event);
    }

    const call = calls[0];
    if (!call) {
      throw new Error('Expected stream request to be recorded.');
    }
    expect(call.url).toBe('https://api.example.test/api/v1/chats/chat_1/messages');
    expect(call.credentials).toBe('include');
    expect(call.headers.get('accept')).toBe('text/event-stream');
    expect(events).toEqual([
      { type: 'text_delta', sequence: 1, delta: 'Привет' },
      { type: 'completed', sequence: 2, assistantMessageId: 'msg_2', turnId: 'turn_1', finishReason: 'stop' },
    ]);
  });

  it('keeps operation manifest paths mechanically checked against generated operations', () => {
    expect(operationManifest.loginUser).toMatchObject({ method: 'POST', path: '/auth/login' });
    expect(operationManifest.sendChatMessage).toMatchObject({ method: 'POST', path: '/chats/{chatId}/messages' });
    expect(operationManifest.requestAgentSuggestion).toMatchObject({ method: 'POST', path: '/chapters/{chapterId}/agent-suggestions' });
    expect(Object.keys(operationManifest)).toHaveLength(45);
  });
});
