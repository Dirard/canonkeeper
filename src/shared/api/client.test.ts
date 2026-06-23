import { describe, expect, it } from 'vitest';
import { NetworkApiError, createCanonKeeperApiClient } from './index';
import type { CanonKeeperApiClient } from './index';
import { operationManifest } from './generated/operation-manifest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function csrfResponse() {
  return jsonResponse({ csrfToken: 'csrf_test_token_12345', expiresAt: '2026-06-16T05:10:00.000Z', rotation: 'refreshed' });
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
  function assertRequiredIdempotencyTypes(api: CanonKeeperApiClient) {
    if (Date.now() < 0) {
      // @ts-expect-error Idempotent command helpers require an options argument with idempotencyKey.
      void api.createChatTurn('chat_1', { content: 'Привет', contextLocators: [] });
      // @ts-expect-error Idempotent command helpers require an options argument with idempotencyKey.
      void api.startAgentRun('chapter_1', { expectedChapterRevision: 1, prompt: 'Проверь сцену' });
      // @ts-expect-error Idempotent command helpers require an options argument with idempotencyKey.
      void api.createBookExport('book_1', { format: 'epub' });
    }
  }

  void assertRequiredIdempotencyTypes;

  it('sends JSON requests through the generated path manifest with credentials included', async () => {
    const calls: Request[] = [];
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async (request) => {
        calls.push(request);
        if (request.url.endsWith('/auth/csrf')) {
          return csrfResponse();
        }
        return jsonResponse({
          user: { id: 'user_1', displayName: 'Мира Волкова', email: 'mira@example.com', emailVerified: true },
        });
      },
    });

    const sampleCredential = ['test', 'credential'].join('-');

    await api.login({ email: 'mira@example.com', password: sampleCredential, rememberMe: true });

    expect(calls).toHaveLength(2);
    const csrfCall = calls[0];
    const call = calls[1];
    expect(csrfCall?.url).toBe('https://api.example.test/api/v1/auth/csrf');
    expect(csrfCall?.method).toBe('GET');
    if (!call) {
      throw new Error('Expected login request to be recorded.');
    }
    expect(call.url).toBe('https://api.example.test/api/v1/auth/login');
    expect(call.method).toBe('POST');
    expect(call.credentials).toBe('include');
    expect(call.headers.get('X-CSRF-Token')).toBe('csrf_test_token_12345');
    await expect(call.clone().json()).resolves.toEqual({
      email: 'mira@example.com',
      password: sampleCredential,
      rememberMe: true,
    });
  });

  it('routes session, member and invitation convenience methods through generated operations', async () => {
    const calls: Request[] = [];
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async (request) => {
        calls.push(request);
        if (request.url.endsWith('/auth/csrf')) {
          return csrfResponse();
        }
        if (request.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        if (request.url.endsWith('/projects/project_1/invitations') && request.method === 'POST') {
          return jsonResponse({ id: 'invitation_1', projectId: 'project_1', email: 'coauthor@example.test', role: 'editor', status: 'pending' }, 201);
        }
        if (request.url.endsWith('/members/member_1')) {
          return jsonResponse({ id: 'member_1', projectId: 'project_1', role: 'viewer' });
        }
        if (request.url.endsWith('/accept')) {
          return jsonResponse({ id: 'member_invitation_1', projectId: 'project_1', role: 'editor' });
        }
        if (request.url.endsWith('/cancel')) {
          return jsonResponse({ id: 'invitation_1', projectId: 'project_1', status: 'canceled' });
        }
        if (request.url.endsWith('/auth/session/rotate')) {
          return jsonResponse({ user: { id: 'user_1', displayName: 'Мира Волкова', email: 'mira@example.com', emailVerified: true } });
        }
        return jsonResponse({ data: [] });
      },
    });

    await api.rotateSession();
    await api.listProjectMembers('project_1');
    await api.createProjectInvitation('project_1', { email: 'coauthor@example.test', role: 'editor' });
    await api.listProjectInvitations('project_1');
    await api.listMyProjectInvitations();
    await api.updateProjectMemberRole('project_1', 'member_1', { role: 'viewer' });
    await api.removeProjectMember('project_1', 'member_1');
    await api.cancelProjectInvitation('invitation_1');
    await api.acceptProjectInvitation('invitation_1');

    const operationCalls = calls.filter((call) => !call.url.endsWith('/auth/csrf'));
    expect(operationCalls.map((call) => [call.method, call.url])).toEqual([
      ['POST', 'https://api.example.test/api/v1/auth/session/rotate'],
      ['GET', 'https://api.example.test/api/v1/projects/project_1/members'],
      ['POST', 'https://api.example.test/api/v1/projects/project_1/invitations'],
      ['GET', 'https://api.example.test/api/v1/projects/project_1/invitations'],
      ['GET', 'https://api.example.test/api/v1/project-invitations'],
      ['PATCH', 'https://api.example.test/api/v1/projects/project_1/members/member_1'],
      ['DELETE', 'https://api.example.test/api/v1/projects/project_1/members/member_1'],
      ['POST', 'https://api.example.test/api/v1/project-invitations/invitation_1/cancel'],
      ['POST', 'https://api.example.test/api/v1/project-invitations/invitation_1/accept'],
    ]);
    expect(operationCalls.every((call) => call.credentials === 'include')).toBe(true);
    const createInvitationCall = operationCalls[2];
    const updateMemberCall = operationCalls[5];
    const acceptInvitationCall = operationCalls[8];
    if (!createInvitationCall || !updateMemberCall || !acceptInvitationCall) {
      throw new Error('Expected member and invitation wrapper requests to be recorded.');
    }
    await expect(createInvitationCall.clone().json()).resolves.toEqual({ email: 'coauthor@example.test', role: 'editor' });
    await expect(updateMemberCall.clone().json()).resolves.toEqual({ role: 'viewer' });
    await expect(acceptInvitationCall.clone().text()).resolves.toBe('');
  });

  it('passes project job list query options through the generated operation', async () => {
    const calls: Request[] = [];
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async (request) => {
        calls.push(request);
        return jsonResponse({ data: [], meta: { hasMore: false, nextCursor: null } });
      },
    });

    await api.listProjectJobs('project_1', { cursor: 'jobs:abcd1234:1', kind: 'indexing', limit: 1 });

    const call = calls[0];
    if (!call) {
      throw new Error('Expected listProjectJobs request to be recorded.');
    }
    const url = new URL(call.url);
    expect(call.method).toBe('GET');
    expect(url.pathname).toBe('/api/v1/projects/project_1/jobs');
    expect(url.searchParams.get('kind')).toBe('indexing');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('cursor')).toBe('jobs:abcd1234:1');
  });

  it('passes cursor list query options through wrappers and protects searchProject with CSRF', async () => {
    const calls: Request[] = [];
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async (request) => {
        calls.push(request);
        if (request.url.endsWith('/auth/csrf')) {
          return csrfResponse();
        }
        return jsonResponse({ data: [], meta: { hasMore: false, nextCursor: null } });
      },
    });

    await api.listBooks('project_1', { cursor: 'list:listBooks:abcd1234:1', limit: 1 });
    await api.listChatMessages('chat_1', { limit: 2 });
    await api.listAgentSuggestions('chapter_1', { batchId: 'batch_1', limit: 3, sourceMessageId: 'message_1', status: 'pending' });
    await api.searchProject('project_1', 'port', 'all', { limit: 1 });

    const booksCall = calls[0];
    const messagesCall = calls[1];
    const suggestionsCall = calls[2];
    const csrfCall = calls[3];
    const searchCall = calls[4];
    if (!booksCall || !messagesCall || !suggestionsCall || !csrfCall || !searchCall) {
      throw new Error('Expected list/search wrapper requests to be recorded.');
    }
    const booksUrl = new URL(booksCall.url);
    expect(booksCall.method).toBe('GET');
    expect(booksUrl.pathname).toBe('/api/v1/projects/project_1/books');
    expect(booksUrl.searchParams.get('limit')).toBe('1');
    expect(booksUrl.searchParams.get('cursor')).toBe('list:listBooks:abcd1234:1');

    const messagesUrl = new URL(messagesCall.url);
    expect(messagesUrl.pathname).toBe('/api/v1/chats/chat_1/messages');
    expect(messagesUrl.searchParams.get('limit')).toBe('2');

    const suggestionsUrl = new URL(suggestionsCall.url);
    expect(suggestionsUrl.pathname).toBe('/api/v1/chapters/chapter_1/agent-suggestions');
    expect(suggestionsUrl.searchParams.get('batchId')).toBe('batch_1');
    expect(suggestionsUrl.searchParams.get('limit')).toBe('3');
    expect(suggestionsUrl.searchParams.get('sourceMessageId')).toBe('message_1');
    expect(suggestionsUrl.searchParams.get('status')).toBe('pending');

    expect(csrfCall.url).toBe('https://api.example.test/api/v1/auth/csrf');
    expect(searchCall.method).toBe('POST');
    expect(searchCall.url).toBe('https://api.example.test/api/v1/projects/project_1/search');
    expect(searchCall.headers.get('X-CSRF-Token')).toBe('csrf_test_token_12345');
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

  it('streams resumable chat turn SSE responses without EventSource', async () => {
    const calls: Request[] = [];
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async (request) => {
        calls.push(request);
        if (request.url.endsWith('/auth/csrf')) {
          return csrfResponse();
        }
        if (request.url.endsWith('/chats/chat_1/turns')) {
          return jsonResponse({
            turnId: 'turn_1',
            jobId: 'job_1',
            status: 'running',
            userMessageId: 'msg_1',
            assistantMessageId: null,
            links: { job: '/api/v1/jobs/job_1', events: '/api/v1/chat-turns/turn_1/events', poll: '/api/v1/chat-turns/turn_1' },
          }, 202);
        }
        return streamResponse([
          'id: evt_1\n',
          'event: assistant.delta\n',
          'retry: 1000\n',
          'data: {"eventId":"evt_1","sequence":1,"turnId":"turn_1","jobId":"job_1","type":"assistant.delta","data":{"text":"Привет"}}\n\n',
          ': keepalive\n\n',
          'id: evt_2\n',
          'event: turn.completed\n',
          'data: {"eventId":"evt_2","sequence":2,"turnId":"turn_1","jobId":"job_1","type":"turn.completed","data":{"assistantMessageId":"msg_2","finishReason":"stop"}}\n\n',
        ]);
      },
    });

    const turn = await api.createChatTurn(
      'chat_1',
      { content: 'Привет', contextLocators: [] },
      { idempotencyKey: 'idem-chat-turn-fixed' },
    );
    const events = [];
    for await (const event of api.streamChatTurnEvents(turn.turnId)) {
      events.push(event);
    }

    const commandCall = calls[1];
    const streamCall = calls[2];
    if (!commandCall || !streamCall) {
      throw new Error('Expected stream request to be recorded.');
    }
    expect(commandCall.url).toBe('https://api.example.test/api/v1/chats/chat_1/turns');
    expect(commandCall.method).toBe('POST');
    expect(commandCall.headers.get('X-CSRF-Token')).toBe('csrf_test_token_12345');
    expect(commandCall.headers.get('Idempotency-Key')).toBe('idem-chat-turn-fixed');
    expect(streamCall.url).toBe('https://api.example.test/api/v1/chat-turns/turn_1/events');
    expect(streamCall.credentials).toBe('include');
    expect(streamCall.headers.get('accept')).toBe('text/event-stream');
    expect(events).toEqual([
      {
        id: 'evt_1',
        event: 'assistant.delta',
        retry: 1000,
        data: { eventId: 'evt_1', sequence: 1, turnId: 'turn_1', jobId: 'job_1', type: 'assistant.delta', data: { text: 'Привет' } },
      },
      {
        id: 'evt_2',
        event: 'turn.completed',
        data: { eventId: 'evt_2', sequence: 2, turnId: 'turn_1', jobId: 'job_1', type: 'turn.completed', data: { assistantMessageId: 'msg_2', finishReason: 'stop' } },
      },
    ]);
  });

  it('sends multipart imports with stable idempotency and JSON metadata/options parts', async () => {
    const calls: Request[] = [];
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async (request) => {
        calls.push(request);
        if (request.url.endsWith('/auth/csrf')) {
          return csrfResponse();
        }
        return jsonResponse({
          jobId: 'import-job-1',
          job: {
            id: 'import-job-1',
            kind: 'import',
            status: 'queued',
            progress: 0,
            subject: { type: 'project', id: 'project_1', projectId: 'project_1' },
            result: null,
            error: null,
            canCancel: true,
            expiresAt: null,
            createdAt: '2026-06-16T05:00:00.000Z',
            updatedAt: '2026-06-16T05:00:00.000Z',
            links: { self: '/api/v1/jobs/import-job-1', cancel: '/api/v1/jobs/import-job-1/cancel', result: null },
          },
          links: { job: '/api/v1/jobs/import-job-1', events: null, poll: '/api/v1/jobs/import-job-1' },
        }, 202);
      },
    });

    const file = new File(['chapter'], 'draft.epub', { type: 'application/epub+zip' });
    await api.importBookFile(
      'project_1',
      { file, metadata: { title: 'Draft', sourceFileName: 'draft.epub' }, options: { importMode: 'new_book' } },
      { idempotencyKey: 'idem-import-fixed' },
    );

    const importCall = calls[1];
    if (!importCall) {
      throw new Error('Expected multipart import request to be recorded.');
    }
    expect(importCall.url).toBe('https://api.example.test/api/v1/projects/project_1/imports');
    expect(importCall.method).toBe('POST');
    expect(importCall.headers.get('content-type')).toContain('multipart/form-data; boundary=');
    expect(importCall.headers.get('X-CSRF-Token')).toBe('csrf_test_token_12345');
    expect(importCall.headers.get('Idempotency-Key')).toBe('idem-import-fixed');
    const multipartBody = await importCall.clone().text();
    expect(multipartBody).toContain('name="file"; filename="draft.epub"');
    expect(multipartBody).toContain('name="metadata"');
    expect(multipartBody).toContain(JSON.stringify({ title: 'Draft', sourceFileName: 'draft.epub' }));
    expect(multipartBody).toContain('name="options"');
    expect(multipartBody).toContain(JSON.stringify({ importMode: 'new_book' }));
  });

  it('rejects missing idempotency keys before idempotent helper requests reach fetch', async () => {
    const calls: Request[] = [];
    const api = createCanonKeeperApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetch: async (request) => {
        calls.push(request);
        return jsonResponse({}, 500);
      },
    });

    expect(() =>
      api.createChatTurn('chat_1', { content: 'Привет', contextLocators: [] }, undefined as never),
    ).toThrow('createChatTurn requires an Idempotency-Key.');
    expect(() =>
      api.startAgentRun('chapter_1', { expectedChapterRevision: 1, prompt: 'Проверь сцену' }, undefined as never),
    ).toThrow('startAgentRun requires an Idempotency-Key.');
    expect(() => api.createBookExport('book_1', { format: 'epub' }, undefined as never)).toThrow(
      'createBookExport requires an Idempotency-Key.',
    );
    expect(() => api.startProjectIndexing('project_1', { scope: 'project' }, undefined as never)).toThrow(
      'startProjectIndexing requires an Idempotency-Key.',
    );
    await expect(
      api.importBookFile('project_1', { file: new File(['chapter'], 'draft.epub') }, undefined as never),
    ).rejects.toThrow('importBookFile requires an Idempotency-Key.');
    expect(calls).toHaveLength(0);
  });

  it('keeps operation manifest paths mechanically checked against generated operations', () => {
    expect(operationManifest.loginUser).toMatchObject({ method: 'POST', path: '/auth/login' });
    expect(operationManifest.getCurrentUser).toMatchObject({ method: 'GET', path: '/auth/session' });
    expect(operationManifest.searchProject).toMatchObject({ method: 'POST', path: '/projects/{projectId}/search' });
    expect(operationManifest.createChatTurn).toMatchObject({ method: 'POST', path: '/chats/{chatId}/turns' });
    expect(operationManifest.streamChatTurnEvents).toMatchObject({ method: 'GET', path: '/chat-turns/{turnId}/events' });
    expect(operationManifest.startAgentRun).toMatchObject({ method: 'POST', path: '/chapters/{chapterId}/agent-runs' });
    expect(Object.values(operationManifest).every((route) => route.method.length > 0 && route.path.startsWith('/'))).toBe(true);
  });
});
