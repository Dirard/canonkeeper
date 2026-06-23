import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiStatusError, createCanonKeeperApiClient } from '../src/shared/api';
import { parseSseStream, SseParseError } from '../src/shared/api/sse';
import { createMockApiServer, type MockApiLogEvent, type MockApiServerController } from './server';

type MockActorRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'non_member';

const loginPayload = { email: 'mira@example.com', password: 'white-port-12', rememberMe: true };
const localOrigin = 'http://localhost:3000';

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

async function csrfToken(baseUrl: string, headers?: HeadersInit) {
  const response = await fetch(`${baseUrl}/auth/csrf`, { headers });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { csrfToken: string };
  return body.csrfToken;
}

async function loginAndCookie(baseUrl: string, headers?: HeadersInit) {
  const token = await csrfToken(baseUrl, headers);
  const loginHeaders = new Headers(headers);
  if (!loginHeaders.has('origin')) {
    loginHeaders.set('origin', localOrigin);
  }
  loginHeaders.set('content-type', 'application/json');
  loginHeaders.set('x-csrf-token', token);
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: loginHeaders,
    body: JSON.stringify(loginPayload),
  });
  const rotatedToken = response.ok ? await csrfToken(baseUrl, headers) : token;
  return {
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    csrfToken: rotatedToken,
    response,
    staleCsrfToken: token,
  };
}

function authenticatedApi(baseUrl: string, cookie: string, actorRole?: MockActorRole) {
  return createCanonKeeperApiClient({
    baseUrl,
    fetch: async (request) => {
      const headers = new Headers(request.headers);
      headers.set('cookie', cookie);
      headers.set('origin', localOrigin);
      if (actorRole) {
        headers.set('mock_actor_role', actorRole);
      }
      return fetch(request, { headers });
    },
  });
}

function multipartPayload(
  parts: Array<{ body: string | Uint8Array; contentType?: string; filename?: string; name: string }>,
  boundary = 'ck-test-boundary',
) {
  const encoder = new TextEncoder();
  const chunks = parts.flatMap((part) => {
    const filename = part.filename ? `; filename="${part.filename}"` : '';
    const contentType = part.contentType ?? (part.filename ? 'application/octet-stream' : undefined);
    const headers = [`Content-Disposition: form-data; name="${part.name}"${filename}`];
    if (contentType) {
      headers.push(`Content-Type: ${contentType}`);
    }
    return [
      encoder.encode(`--${boundary}\r\n${headers.join('\r\n')}\r\n\r\n`),
      typeof part.body === 'string' ? encoder.encode(part.body) : part.body,
      encoder.encode('\r\n'),
    ];
  });
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function projectJobCount(baseUrl: string, cookie: string) {
  const response = await fetch(`${baseUrl}/projects/project-white-port/jobs`, { headers: { cookie } });
  const body = (await response.json()) as { data: unknown[] };
  return body.data.length;
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
    const login = await loginAndCookie(baseUrl);

    expect(login.response.status).toBe(200);
    expect(login.cookie).toBe('ck_session=mock-session');
    expect(login.response.headers.get('set-cookie')).toContain('Max-Age=43200');

    const projects = await fetch(`${baseUrl}/projects`, { headers: { cookie: login.cookie } });
    await expect(projects.json()).resolves.toMatchObject({
      data: [{ id: 'project-white-port', title: 'Хроники Белого порта' }],
    });
  });

  it('passes project job list query filters through the HTTP mock server', async () => {
    const login = await loginAndCookie(baseUrl);
    const api = authenticatedApi(baseUrl, login.cookie);
    await api.startProjectIndexing('project-white-port', { scope: 'project' }, { idempotencyKey: 'idem-server-jobs-index' });
    await api.createChatTurn('chat-white-port', { content: 'Проверь список задач', contextLocators: [] }, { idempotencyKey: 'idem-server-jobs-chat' });

    const response = await fetch(`${baseUrl}/projects/project-white-port/jobs?kind=chat_turn&limit=1`, {
      headers: { cookie: login.cookie },
    });
    const body = (await response.json()) as { data: Array<{ kind: string }>; meta: { hasMore: boolean; nextCursor: string | null } };

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data.every((job) => job.kind === 'chat_turn')).toBe(true);
    expect(body.meta).toHaveProperty('nextCursor');
  });

  it('requires a session cookie before honoring safe status overrides', async () => {
    const missingSession = await fetch(`${baseUrl}/projects`);
    await expect(missingSession.json()).resolves.toMatchObject({ status: 401, title: 'Unauthorized' });

    const blockedOverride = await fetch(`${baseUrl}/projects`, { headers: { mock_return_status: '500' } });
    await expect(blockedOverride.json()).resolves.toMatchObject({ status: 401, title: 'Unauthorized' });

    const { cookie } = await loginAndCookie(baseUrl);
    const overridden = await fetch(`${baseUrl}/projects`, { headers: { cookie, mock_return_status: '500' } });
    await expect(overridden.json()).resolves.toMatchObject({
      status: 500,
      title: 'Internal server error',
      detail: 'Mock status override.',
    });
  });

  it('requires valid CSRF tokens for auth, session and protected mutations', async () => {
    const missingLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: localOrigin },
      body: JSON.stringify(loginPayload),
    });
    await expect(missingLogin.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });

    const wrongLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: localOrigin, 'x-csrf-token': 'wrong' },
      body: JSON.stringify(loginPayload),
    });
    await expect(wrongLogin.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });

    const login = await loginAndCookie(baseUrl);
    expect(login.response.status).toBe(200);

    const staleAfterLogin = await fetch(`${baseUrl}/auth/session/rotate`, {
      method: 'POST',
      headers: { cookie: login.cookie, origin: localOrigin, 'x-csrf-token': login.staleCsrfToken },
    });
    await expect(staleAfterLogin.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });

    const rotateMissing = await fetch(`${baseUrl}/auth/session/rotate`, { method: 'POST', headers: { cookie: login.cookie, origin: localOrigin } });
    await expect(rotateMissing.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });

    const rotateWrong = await fetch(`${baseUrl}/auth/session/rotate`, {
      method: 'POST',
      headers: { cookie: login.cookie, origin: localOrigin, 'x-csrf-token': 'wrong' },
    });
    await expect(rotateWrong.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });

    const rotateGood = await fetch(`${baseUrl}/auth/session/rotate`, {
      method: 'POST',
      headers: { cookie: login.cookie, origin: localOrigin, 'x-csrf-token': login.csrfToken },
    });
    expect(rotateGood.status).toBe(200);
    await expect(rotateGood.json()).resolves.toMatchObject({ user: { email: 'mira@example.com' } });
    const postRotateToken = await csrfToken(baseUrl, { origin: localOrigin });

    const staleAfterRotate = await fetch(`${baseUrl}/chats/chat-white-port`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: login.cookie, origin: localOrigin, 'x-csrf-token': login.csrfToken },
      body: JSON.stringify({ title: 'Старый токен' }),
    });
    await expect(staleAfterRotate.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });

    const renameMissing = await fetch(`${baseUrl}/chats/chat-white-port`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: login.cookie, origin: localOrigin },
      body: JSON.stringify({ title: 'Новый заголовок' }),
    });
    await expect(renameMissing.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });

    const renameGood = await fetch(`${baseUrl}/chats/chat-white-port`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: login.cookie, origin: localOrigin, 'x-csrf-token': postRotateToken },
      body: JSON.stringify({ title: 'Новый заголовок' }),
    });
    expect(renameGood.status).toBe(200);

    const logoutMissing = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { cookie: login.cookie, origin: localOrigin } });
    await expect(logoutMissing.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });

    const logoutWrong = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: login.cookie, origin: localOrigin, 'x-csrf-token': 'wrong' },
    });
    await expect(logoutWrong.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });

    const logoutGood = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: login.cookie, origin: localOrigin, 'x-csrf-token': postRotateToken },
    });
    expect(logoutGood.status).toBe(204);
  });

  it('keeps auth failures non-enumerating with stable problem codes and limiter evidence', async () => {
    const token = await csrfToken(baseUrl, { origin: localOrigin });
    const loginHeaders = {
      'content-type': 'application/json',
      origin: localOrigin,
      'x-csrf-token': token,
    };

    const unknownEmail = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({ email: 'unknown@example.test', password: 'wrong-password', rememberMe: true }),
    });
    const wrongPassword = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({ email: 'mira@example.com', password: 'wrong-password', rememberMe: true }),
    });
    const unknownEmailBody = (await unknownEmail.json()) as Record<string, unknown>;
    const wrongPasswordBody = (await wrongPassword.json()) as Record<string, unknown>;

    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.headers.get('set-cookie')).toBeNull();
    expect(wrongPassword.headers.get('set-cookie')).toBeNull();
    expect(unknownEmailBody).toMatchObject({ code: 'auth_failed', detail: 'Authentication failed.', status: 401, title: 'Unauthorized' });
    expect(wrongPasswordBody).toMatchObject({ code: 'auth_failed', detail: 'Authentication failed.', status: 401, title: 'Unauthorized' });
    expect(JSON.stringify(unknownEmailBody)).not.toContain('unknown@example.test');
    expect(JSON.stringify(wrongPasswordBody)).not.toContain('mira@example.com');

    const falseTermsRegister = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({ acceptedTerms: false, displayName: 'Новый автор', email: 'new-author@example.test', password: 'white-port-12' }),
    });
    expect(falseTermsRegister.status).toBe(400);
    expect(falseTermsRegister.headers.get('set-cookie')).toBeNull();
    const missingTermsRegister = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({ displayName: 'Новый автор', email: 'new-author@example.test', password: 'white-port-12' }),
    });
    expect(missingTermsRegister.status).toBe(400);
    expect(missingTermsRegister.headers.get('set-cookie')).toBeNull();

    const existingEmailRegister = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: loginHeaders,
      body: JSON.stringify({ acceptedTerms: true, displayName: 'Мира Волкова', email: 'mira@example.com', password: 'white-port-12' }),
    });
    const existingEmailBody = (await existingEmailRegister.json()) as Record<string, unknown>;
    expect(existingEmailRegister.status).toBe(409);
    expect(existingEmailRegister.headers.get('set-cookie')).toBeNull();
    expect(existingEmailBody).toMatchObject({ code: 'registration_conflict', detail: 'Registration cannot be completed.', status: 409, title: 'Conflict' });
    expect(JSON.stringify(existingEmailBody)).not.toContain('mira@example.com');

    const postRegisterToken = await csrfToken(baseUrl, { origin: localOrigin });
    const rateLimited = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { ...loginHeaders, 'x-csrf-token': postRegisterToken, mock_return_status: '429' },
      body: JSON.stringify(loginPayload),
    });
    await expect(rateLimited.json()).resolves.toMatchObject({ code: 'rate_limited', status: 429, title: 'Rate limited' });
    expect(rateLimited.headers.get('retry-after')).toBe('60');
    expect(rateLimited.headers.get('set-cookie')).toBeNull();
  });

  it('streams deterministic chat turn SSE over GET fetch without EventSource', async () => {
    const { cookie } = await loginAndCookie(baseUrl);
    const api = authenticatedApi(baseUrl, cookie);

    const turn = await api.createChatTurn(
      'chat-white-port',
      { content: 'Привет', contextLocators: [] },
      { idempotencyKey: 'idem-sse-chat-turn' },
    );
    const events = [];
    for await (const event of api.streamChatTurnEvents(turn.turnId)) {
      events.push(event);
    }

    expect(events.map((event) => event.data.type)).toEqual([
      'job.progress',
      'assistant.delta',
      'artifact.ready',
      'turn.completed',
    ]);
    const replayedEvents = [];
    for await (const event of api.streamChatTurnEvents(turn.turnId)) {
      replayedEvents.push(event);
    }
    expect(replayedEvents.map((event) => event.data.type)).toEqual(events.map((event) => event.data.type));
    const assistantMessageId = (events.at(-1)?.data.data as { assistantMessageId?: string } | undefined)?.assistantMessageId;
    expect(assistantMessageId).toBeTruthy();
    const snapshot = await api.getChatTurn(turn.turnId);
    expect(snapshot.messages.map((message) => message.id)).toEqual([turn.userMessageId, assistantMessageId]);
    expect(snapshot.artifacts.map((artifact) => artifact.id)).toEqual(['artifact-reader-references-1']);
    expect(snapshot.suggestions).toEqual([]);
  });

  it('supports query and Last-Event-ID SSE resume cursors before streaming', async () => {
    const { cookie } = await loginAndCookie(baseUrl);
    const api = authenticatedApi(baseUrl, cookie);

    const turn = await api.createChatTurn(
      'chat-white-port',
      { content: 'Привет', contextLocators: [] },
      { idempotencyKey: 'idem-sse-resume-chat-turn' },
    );

    const resumedByQuery = [];
    for await (const event of api.streamChatTurnEvents(turn.turnId, { afterEventId: 'evt_002' })) {
      resumedByQuery.push(event);
    }
    expect(resumedByQuery.map((event) => event.data.eventId)).toEqual(['evt_003', 'evt_004']);

    const resumedByHeader = [];
    for await (const event of api.streamChatTurnEvents(turn.turnId, { lastEventId: 'evt_002' })) {
      resumedByHeader.push(event);
    }
    expect(resumedByHeader.map((event) => event.data.eventId)).toEqual(['evt_003', 'evt_004']);

    const queryWins = [];
    for await (const event of api.streamChatTurnEvents(turn.turnId, { afterEventId: 'evt_001', lastEventId: 'evt_002' })) {
      queryWins.push(event);
    }
    expect(queryWins.map((event) => event.data.eventId)).toEqual(['evt_002', 'evt_003', 'evt_004']);

    const emptyAfterEventId = await fetch(`${baseUrl}/chat-turns/${turn.turnId}/events?afterEventId=`, {
      headers: { cookie },
    });
    expect(emptyAfterEventId.status).toBe(400);
    const emptyLastEventId = await fetch(`${baseUrl}/chat-turns/${turn.turnId}/events`, {
      headers: { cookie, 'Last-Event-ID': '' },
    });
    expect(emptyLastEventId.status).toBe(400);

    await expect(api.streamChatTurnEvents(turn.turnId, { afterEventId: 'evt_missing' }).next()).rejects.toMatchObject({ status: 400 });
    await expect(api.streamChatTurnEvents('turn-expired').next()).rejects.toMatchObject({ status: 410 });
  });

  it('returns OpenAPI problem JSON before opening an overridden SSE stream', async () => {
    const { cookie } = await loginAndCookie(baseUrl);
    const response = await fetch(`${baseUrl}/chat-turns/turn-1/events`, {
      method: 'GET',
      headers: {
        cookie,
        mock_return_status: '403',
      },
    });

    expect(response.headers.get('content-type')).toContain('application/problem+json');
    await expect(response.json()).resolves.toMatchObject({ status: 403, title: 'Forbidden' });
  });

  it('applies MOCK_RETURN_STATUS to secondary search/import/indexing/export endpoints after auth gates', async () => {
    const { cookie, csrfToken } = await loginAndCookie(baseUrl);

    const secondaryRequests = [
      fetch(`${baseUrl}/projects/project-white-port/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: localOrigin, 'x-csrf-token': csrfToken, mock_return_status: '500' },
        body: JSON.stringify({ query: 'port', scope: 'all', limit: 10 }),
      }),
      fetch(`${baseUrl}/projects/project-white-port/import-constraints`, {
        headers: { cookie, mock_return_status: '403' },
      }),
      fetch(`${baseUrl}/projects/project-white-port/imports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: localOrigin, 'x-csrf-token': csrfToken, mock_return_status: '500' },
        body: JSON.stringify({ file: 'book.epub', metadata: { title: 'Book' } }),
      }),
      fetch(`${baseUrl}/jobs/index-job-1/cancel`, {
        method: 'POST',
        headers: { cookie, origin: localOrigin, 'x-csrf-token': csrfToken, mock_return_status: '409' },
      }),
      fetch(`${baseUrl}/books/book-02/exports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: localOrigin, 'x-csrf-token': csrfToken, mock_return_status: '500' },
        body: JSON.stringify({ format: 'epub' }),
      }),
    ];

    const responses = await Promise.all(secondaryRequests);

    expect(responses.map((response) => response.status)).toEqual([500, 403, 500, 409, 500]);
    for (const response of responses) {
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      await expect(response.json()).resolves.toMatchObject({ detail: 'Mock status override.' });
    }
  });

  it('enforces actor role restrictions for project-scoped mutations and direct IDs', async () => {
    const { cookie, csrfToken } = await loginAndCookie(baseUrl);
    const viewer = authenticatedApi(baseUrl, cookie, 'viewer');
    const editor = authenticatedApi(baseUrl, cookie, 'editor');
    const owner = authenticatedApi(baseUrl, cookie, 'owner');
    const admin = authenticatedApi(baseUrl, cookie, 'admin');
    const nonMember = authenticatedApi(baseUrl, cookie, 'non_member');

    await expect(
      viewer.createChatTurn('chat-white-port', { content: 'Нет доступа', contextLocators: [] }, { idempotencyKey: 'idem-role-viewer-chat' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      viewer.startAgentRun(
        'chapter-16',
        { prompt: 'Проверь сцену', expectedChapterRevision: 9 },
        { idempotencyKey: 'idem-role-viewer-agent' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(editor.createBookExport('book-02', { format: 'epub' }, { idempotencyKey: 'idem-role-editor-export' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(editor.deleteProject('project-white-port')).rejects.toMatchObject({ status: 403 });
    await expect(viewer.createBookExport('book-02', { format: 'epub' }, { idempotencyKey: 'idem-role-viewer-export' })).rejects.toMatchObject({
      status: 403,
    });
    const roleOverride = await fetch(`${baseUrl}/projects/project-white-port/members`, {
      headers: { cookie, mock_actor_role: 'viewer', mock_return_status: '200' },
    });
    expect(roleOverride.status).toBe(403);
    await expect(nonMember.getProject('project-white-port')).rejects.toMatchObject({ status: 404 });
    await expect(nonMember.listProjects()).resolves.toMatchObject({ data: [] });
    await expect(viewer.updateProject('project-white-port', { title: 'Viewer blocked' })).rejects.toMatchObject({ status: 403 });
    const viewerMissingProjectMutation = await fetch(`${baseUrl}/projects/project-missing`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie, mock_actor_role: 'viewer', origin: localOrigin, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ title: 'Missing project stays hidden' }),
    });
    expect(viewerMissingProjectMutation.status).toBe(404);
    const invalidProjectBody = await fetch(`${baseUrl}/projects/project-white-port`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie, origin: localOrigin, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ id: 'project-hijack', title: 'Нельзя менять id' }),
    });
    expect(invalidProjectBody.status).toBe(400);
    await expect(
      viewer.importBookFile(
        'project-white-port',
        {
          file: new File(['epub-content'], 'viewer-blocked.epub', { type: 'application/epub+zip' }),
          metadata: { title: 'Viewer blocked', sourceFileName: 'viewer-blocked.epub' },
          options: { importMode: 'new_book' },
        },
        { idempotencyKey: 'idem-role-viewer-import' },
      ),
    ).rejects.toMatchObject({ status: 403 });

    const editorIndexing = await editor.startProjectIndexing('project-white-port', { scope: 'project' }, { idempotencyKey: 'idem-role-editor-index' });
    expect(editorIndexing).toMatchObject({ job: { kind: 'indexing' } });
    await expect(editor.cancelJob(editorIndexing.jobId)).resolves.toMatchObject({ status: 'canceling' });
    await expect(owner.createBookExport('book-02', { format: 'epub' }, { idempotencyKey: 'idem-role-owner-export' })).resolves.toMatchObject({
      job: { kind: 'export' },
    });
    await expect(admin.createBookExport('book-02', { format: 'fb2' }, { idempotencyKey: 'idem-role-admin-export' })).resolves.toMatchObject({
      job: { kind: 'export' },
    });
    await expect(nonMember.getJob('index-job-1')).rejects.toMatchObject({ status: 404 });
    await expect(owner.getBook('book-foreign')).rejects.toMatchObject({ status: 404 });
    await expect(owner.getChatSession('chat-foreign')).rejects.toMatchObject({ status: 404 });
    await expect(owner.getJob('foreign-job-1')).rejects.toMatchObject({ status: 404 });
    const missingMember = await fetch(`${baseUrl}/projects/project-white-port/members/member-missing`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie, origin: localOrigin, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(missingMember.status).toBe(404);
    const missingMemberAsViewer = await fetch(`${baseUrl}/projects/project-white-port/members/member-missing`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie, mock_actor_role: 'viewer', origin: localOrigin, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(missingMemberAsViewer.status).toBe(404);
    const ownerDemotion = await fetch(`${baseUrl}/projects/project-white-port/members/member-owner`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie, origin: localOrigin, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(ownerDemotion.status).toBe(409);
    const ownerRemoval = await fetch(`${baseUrl}/projects/project-white-port/members/member-owner`, {
      method: 'DELETE',
      headers: { cookie, origin: localOrigin, 'x-csrf-token': csrfToken },
    });
    expect(ownerRemoval.status).toBe(409);
    const invalidRoleUpdate = await fetch(`${baseUrl}/projects/project-white-port/members/member-collaborator`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie, origin: localOrigin, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(invalidRoleUpdate.status).toBe(400);
    const collaboratorRoleUpdate = await fetch(`${baseUrl}/projects/project-white-port/members/member-collaborator`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie, origin: localOrigin, 'x-csrf-token': csrfToken },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(collaboratorRoleUpdate.status).toBe(200);
    const collaboratorRemoval = await fetch(`${baseUrl}/projects/project-white-port/members/member-collaborator`, {
      method: 'DELETE',
      headers: { cookie, origin: localOrigin, 'x-csrf-token': csrfToken },
    });
    expect(collaboratorRemoval.status).toBe(204);
  });

  it('accepts invitations only for the authenticated verified matching email', async () => {
    const { cookie, csrfToken } = await loginAndCookie(baseUrl);
    const baseHeaders = {
      'content-type': 'application/json',
      cookie,
      origin: localOrigin,
      'x-csrf-token': csrfToken,
    };

    const existingMemberDenied = await fetch(`${baseUrl}/project-invitations/invitation-mira/accept`, {
      method: 'POST',
      headers: baseHeaders,
    });
    expect(existingMemberDenied.status).toBe(403);

    const mismatch = await fetch(`${baseUrl}/project-invitations/invitation-mira/accept`, {
      method: 'POST',
      headers: { ...baseHeaders, 'mock-actor-role': 'non_member', 'mock-verified-email': 'other@example.com' },
    });
    expect(mismatch.status).toBe(404);

    const inviteeDiscovery = await fetch(`${baseUrl}/project-invitations?limit=10`, {
      headers: { cookie, 'mock-actor-role': 'non_member', 'mock-verified-email': 'mira@example.com' },
    });
    expect(inviteeDiscovery.status).toBe(200);
    await expect(inviteeDiscovery.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ email: 'mira@example.com', id: 'invitation-mira', status: 'pending' })],
    });

    const invitedNonMember = await fetch(`${baseUrl}/project-invitations/invitation-mira/accept`, {
      method: 'POST',
      headers: { ...baseHeaders, 'mock-actor-role': 'non_member', 'mock-verified-email': 'mira@example.com' },
    });
    expect(invitedNonMember.status).toBe(200);
    await expect(invitedNonMember.json()).resolves.toMatchObject({
      email: 'mira@example.com',
      id: 'member-invitation-mira',
      role: 'editor',
      status: 'active',
      userId: 'user-mira',
    });
    const membersAfterInvite = await fetch(`${baseUrl}/projects/project-white-port/members`, {
      headers: baseHeaders,
    });
    await expect(membersAfterInvite.json()).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ email: 'mira@example.com', id: 'member-invitation-mira', role: 'editor', status: 'active', userId: 'user-mira' }),
      ]),
    });
    const replayedMiraInvite = await fetch(`${baseUrl}/project-invitations/invitation-mira/accept`, {
      method: 'POST',
      headers: { ...baseHeaders, 'mock-actor-role': 'non_member', 'mock-verified-email': 'mira@example.com' },
    });
    expect(replayedMiraInvite.status).toBe(409);

    const unverified = await fetch(`${baseUrl}/project-invitations/invitation-1/accept`, {
      method: 'POST',
      headers: { ...baseHeaders, 'mock-actor-role': 'non_member', 'mock-email-verified': 'false' },
    });
    expect(unverified.status).toBe(404);

    const unknown = await fetch(`${baseUrl}/project-invitations/invitation-missing/accept`, {
      method: 'POST',
      headers: { ...baseHeaders, 'mock-actor-role': 'non_member' },
    });
    expect(unknown.status).toBe(404);
    const unknownCancel = await fetch(`${baseUrl}/project-invitations/invitation-missing/cancel`, {
      method: 'POST',
      headers: baseHeaders,
    });
    expect(unknownCancel.status).toBe(404);
    const unknownProjectMembers = await fetch(`${baseUrl}/projects/project-missing/members`, {
      headers: baseHeaders,
    });
    expect(unknownProjectMembers.status).toBe(404);
    await expect(unknownProjectMembers.json()).resolves.toMatchObject({ detail: 'Resource not found.', status: 404, title: 'Not found' });
    const unknownProjectInvite = await fetch(`${baseUrl}/projects/project-missing/invitations`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ email: 'new-collaborator@example.test', role: 'editor' }),
    });
    expect(unknownProjectInvite.status).toBe(404);
    const unknownProjectInviteBody = await unknownProjectInvite.text();
    expect(unknownProjectInviteBody).not.toContain('project-missing');

    const accepted = await fetch(`${baseUrl}/project-invitations/invitation-1/accept`, {
      method: 'POST',
      headers: { ...baseHeaders, 'mock-actor-role': 'non_member' },
    });
    expect(accepted.status).toBe(404);

    const replayed = await fetch(`${baseUrl}/project-invitations/invitation-1/accept`, {
      method: 'POST',
      headers: { ...baseHeaders, 'mock-actor-role': 'non_member' },
    });
    expect(replayed.status).toBe(404);

    const ownerInvite = await fetch(`${baseUrl}/projects/project-white-port/invitations`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ email: 'owner-invite@example.test', role: 'owner' }),
    });
    expect(ownerInvite.status).toBe(400);
  });

  it('binds search cursors to the full normalized request fingerprint', async () => {
    const { cookie, csrfToken } = await loginAndCookie(baseUrl);
    const api = authenticatedApi(baseUrl, cookie);

    const firstPage = await api.searchProject('project-white-port', 'port', 'all', { limit: 1 });
    expect(firstPage.meta.nextCursor).toBeTruthy();
    const secondPage = await api.searchProject('project-white-port', 'port', 'all', { cursor: firstPage.meta.nextCursor, limit: 1 });
    expect(secondPage.data[0]?.id).not.toBe(firstPage.data[0]?.id);
    await expect(api.searchProject('project-white-port', 'changed', 'all', { cursor: firstPage.meta.nextCursor, limit: 1 })).rejects.toMatchObject({
      status: 400,
    });
    const missingSearchCsrf = await fetch(`${baseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: localOrigin,
      },
      body: JSON.stringify({ limit: 1, query: 'port', scope: 'all' }),
    });
    expect(missingSearchCsrf.status).toBe(403);
    const invalidFilters = await fetch(`${baseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: localOrigin,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ filters: { unsupported: true }, limit: 1, query: 'port', scope: 'all' }),
    });
    await expect(invalidFilters.json()).resolves.toMatchObject({
      detail: 'Search filters contain unsupported keys.',
      status: 400,
    });
    const invalidSearchBodies = [
      { body: { query: '', scope: 'all' }, detail: 'Search query must be a non-empty string.' },
      { body: { query: 'x'.repeat(501), scope: 'all' }, detail: 'Search query must be 500 characters or fewer.' },
      { body: { query: 'port', scope: 'bad-scope' }, detail: 'Search scope is invalid.' },
      { body: { limit: 0, query: 'port', scope: 'all' }, detail: 'Search limit must be an integer between 1 and 50.' },
      { body: { filters: { bookId: 123 }, query: 'port', scope: 'all' }, detail: 'Search ID filters must be non-empty strings.' },
      { body: { filters: { chapterId: false }, query: 'port', scope: 'all' }, detail: 'Search ID filters must be non-empty strings.' },
      { body: { filters: { resultKinds: ['chapter', 'chapter'] }, query: 'port', scope: 'all' }, detail: 'Search resultKinds filter is invalid.' },
      {
        body: { filters: { resultKinds: ['chapter', 'annotation', 'unknown-kind'] }, query: 'port', scope: 'all' },
        detail: 'Search resultKinds filter is invalid.',
      },
      { body: { extra: true, query: 'port', scope: 'all' }, detail: 'Search request contains unsupported keys.' },
      { body: { query: 'port', scope: 'all', signal: {} }, detail: 'Search request contains unsupported keys.' },
    ];
    for (const { body, detail } of invalidSearchBodies) {
      const invalidSearch = await fetch(`${baseUrl}/projects/project-white-port/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin: localOrigin,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(body),
      });
      await expect(invalidSearch.json()).resolves.toMatchObject({ detail, status: 400 });
    }

    const firstBooksPage = await fetch(`${baseUrl}/projects/project-white-port/books?limit=1`, {
      headers: { cookie },
    });
    const firstBooksBody = (await firstBooksPage.json()) as { data: Array<{ id: string }>; meta: { nextCursor: string | null } };
    expect(firstBooksPage.status).toBe(200);
    expect(firstBooksBody.meta.nextCursor).toBeTruthy();
    const secondBooksPage = await fetch(`${baseUrl}/projects/project-white-port/books?limit=1&cursor=${encodeURIComponent(firstBooksBody.meta.nextCursor ?? '')}`, {
      headers: { cookie },
    });
    const secondBooksBody = (await secondBooksPage.json()) as { data: Array<{ id: string }> };
    expect(secondBooksPage.status).toBe(200);
    expect(secondBooksBody.data[0]?.id).not.toBe(firstBooksBody.data[0]?.id);

    const invalidAnnotationCursor = await fetch(`${baseUrl}/chapters/chapter-12/annotations?limit=1&cursor=bad-cursor`, {
      headers: { cookie },
    });
    await expect(invalidAnnotationCursor.json()).resolves.toMatchObject({ status: 400 });
    const staleAnnotation = await fetch(`${baseUrl}/chapters/chapter-12/annotations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: localOrigin,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        body: 'Старая привязка',
        kind: 'note',
        locator: {
          bookId: 'book-02',
          chapterId: 'chapter-12',
          paragraphId: 'p-12-03',
          projectId: 'project-white-port',
          range: null,
          revision: 0,
          targetView: 'published',
        },
        quote: null,
        tags: [],
      }),
    });
    await expect(staleAnnotation.json()).resolves.toMatchObject({
      detail: 'Annotation locator revision is stale.',
      status: 409,
    });
  });

  it('accepts real multipart imports and enforces export idempotency replay versus mismatched payloads', async () => {
    const { cookie, csrfToken } = await loginAndCookie(baseUrl);
    const api = authenticatedApi(baseUrl, cookie);

    const imported = await api.importBookFile(
      'project-white-port',
      {
        file: new File(['epub-content'], 'white-port.epub', { type: 'application/epub+zip' }),
        metadata: { title: 'White Port', sourceFileName: 'white-port.epub' },
        options: { importMode: 'new_book' },
      },
      { idempotencyKey: 'idem-import-server-test' },
    );
    expect(imported.job.result).toMatchObject({ sourceFileName: 'white-port.epub', importMode: 'new_book' });

    const replayedImport = await api.importBookFile(
      'project-white-port',
      {
        file: new File(['epub-content'], 'white-port.epub', { type: 'application/epub+zip' }),
        metadata: { title: 'White Port', sourceFileName: 'white-port.epub' },
        options: { importMode: 'new_book' },
      },
      { idempotencyKey: 'idem-import-server-test' },
    );
    expect(replayedImport.jobId).toBe(imported.jobId);

    const rawImport = multipartPayload([
      { name: 'file', filename: 'white-port.epub', contentType: 'application/epub+zip', body: new Uint8Array([0xff]) },
      { name: 'metadata', contentType: 'application/json', body: JSON.stringify({ title: 'White Port Append', sourceFileName: 'white-port.epub' }) },
      { name: 'options', contentType: 'application/json', body: JSON.stringify({ importMode: 'append' }) },
    ]);
    const rawImportReplay = await fetch(`${baseUrl}/projects/project-white-port/imports`, {
      method: 'POST',
      headers: { cookie, origin: localOrigin, 'x-csrf-token': csrfToken, 'content-type': rawImport.contentType, 'idempotency-key': 'idem-import-raw-byte-test' },
      body: rawImport.body,
    });
    expect(rawImportReplay.status).toBe(202);
    expect(rawImportReplay.headers.get('location')).toMatch(/^\/api\/v1\/jobs\/[^/]+$/);
    expect(rawImportReplay.headers.get('retry-after')).toBe('1');
    const rawImportBody = (await rawImportReplay.json()) as { job: { result: Record<string, unknown> } };
    expect(rawImportBody.job.result).toMatchObject({ sourceFileName: 'white-port.epub', importMode: 'append', title: 'White Port Append' });

    const unsupportedImport = multipartPayload([
      { name: 'file', filename: 'draft.exe', contentType: 'application/octet-stream', body: 'binary' },
    ]);
    const unsupportedImportResponse = await fetch(`${baseUrl}/projects/project-white-port/imports`, {
      method: 'POST',
      headers: {
        cookie,
        origin: localOrigin,
        'x-csrf-token': csrfToken,
        'content-type': unsupportedImport.contentType,
        'idempotency-key': 'idem-import-unsupported-type',
      },
      body: unsupportedImport.body,
    });
    expect(unsupportedImportResponse.status).toBe(415);
    await expect(unsupportedImportResponse.json()).resolves.toMatchObject({
      detail: 'Import file type is not supported.',
      status: 415,
    });

    const asyncStartChecks = [
      fetch(`${baseUrl}/projects/project-white-port/indexing-runs`, {
        method: 'POST',
        headers: { cookie, origin: localOrigin, 'x-csrf-token': csrfToken, 'content-type': 'application/json', 'idempotency-key': 'idem-header-index' },
        body: JSON.stringify({ scope: 'project' }),
      }),
      fetch(`${baseUrl}/books/book-02/exports`, {
        method: 'POST',
        headers: { cookie, origin: localOrigin, 'x-csrf-token': csrfToken, 'content-type': 'application/json', 'idempotency-key': 'idem-header-export' },
        body: JSON.stringify({ format: 'epub' }),
      }),
      fetch(`${baseUrl}/chats/chat-white-port/turns`, {
        method: 'POST',
        headers: { cookie, origin: localOrigin, 'x-csrf-token': csrfToken, 'content-type': 'application/json', 'idempotency-key': 'idem-header-turn' },
        body: JSON.stringify({ content: 'Проверь сцену', contextLocators: [] }),
      }),
      fetch(`${baseUrl}/chapters/chapter-16/agent-runs`, {
        method: 'POST',
        headers: { cookie, origin: localOrigin, 'x-csrf-token': csrfToken, 'content-type': 'application/json', 'idempotency-key': 'idem-header-agent' },
        body: JSON.stringify({ expectedChapterRevision: 9, prompt: 'Проверь диалог' }),
      }),
    ];
    for (const response of await Promise.all(asyncStartChecks)) {
      expect(response.status).toBe(202);
      expect(response.headers.get('location')).toMatch(/^\/api\/v1\/jobs\/[^/]+$/);
      expect(response.headers.get('retry-after')).toBe('1');
    }
    const unprefixedCancel = await fetch(`${baseUrl.replace(/\/api\/v1$/, '')}/jobs/index-job-1/cancel`, {
      method: 'POST',
      headers: { cookie, origin: localOrigin, 'x-csrf-token': csrfToken },
    });
    expect(unprefixedCancel.status).toBe(404);
    const changedRawImport = multipartPayload([
      { name: 'file', filename: 'white-port.epub', contentType: 'application/epub+zip', body: new Uint8Array([0xfe]) },
      { name: 'metadata', contentType: 'application/json', body: JSON.stringify({ title: 'White Port Append', sourceFileName: 'white-port.epub' }) },
      { name: 'options', contentType: 'application/json', body: JSON.stringify({ importMode: 'append' }) },
    ]);
    const changedRawImportResponse = await fetch(`${baseUrl}/projects/project-white-port/imports`, {
      method: 'POST',
      headers: {
        cookie,
        origin: localOrigin,
        'x-csrf-token': csrfToken,
        'content-type': changedRawImport.contentType,
        'idempotency-key': 'idem-import-raw-byte-test',
      },
      body: changedRawImport.body,
    });
    expect(changedRawImportResponse.status).toBe(409);

    const firstExport = await api.createBookExport('book-02', { format: 'epub' }, { idempotencyKey: 'idem-export-server-test' });
    const replayedExport = await api.createBookExport('book-02', { format: 'epub' }, { idempotencyKey: 'idem-export-server-test' });
    expect(replayedExport.jobId).toBe(firstExport.jobId);
    await expect(api.getJob(firstExport.jobId)).resolves.toMatchObject({ status: 'succeeded', canCancel: false });
    await expect(authenticatedApi(baseUrl, cookie, 'viewer').getJob(firstExport.jobId)).resolves.toMatchObject({
      kind: 'export',
      result: { downloadUrl: null },
    });
    await expect(authenticatedApi(baseUrl, cookie, 'editor').cancelJob(firstExport.jobId)).rejects.toMatchObject({ status: 403 });
    await expect(api.cancelJob(firstExport.jobId)).resolves.toMatchObject({ status: 'succeeded', canCancel: false });

    await expect(api.createBookExport('book-02', { format: 'fb2' }, { idempotencyKey: 'idem-export-server-test' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('rejects malformed multipart imports without creating jobs', async () => {
    const { cookie, csrfToken } = await loginAndCookie(baseUrl);
    const beforeCount = await projectJobCount(baseUrl, cookie);
    const importUrl = `${baseUrl}/projects/project-white-port/imports`;
    const baseHeaders = {
      cookie,
      origin: localOrigin,
      'x-csrf-token': csrfToken,
    };

    const wrongMedia = await fetch(importUrl, {
      method: 'POST',
      headers: { ...baseHeaders, 'content-type': 'application/json', 'idempotency-key': 'idem-import-wrong-media' },
      body: JSON.stringify({ file: 'white-port.epub' }),
    });
    expect(wrongMedia.status).toBe(415);

    const missingFile = multipartPayload([{ name: 'metadata', body: JSON.stringify({ title: 'White Port' }) }]);
    const missingFileResponse = await fetch(importUrl, {
      method: 'POST',
      headers: { ...baseHeaders, 'content-type': missingFile.contentType, 'idempotency-key': 'idem-import-missing-file' },
      body: missingFile.body,
    });
    expect(missingFileResponse.status).toBe(422);

    const malformedMetadata = multipartPayload([
      { name: 'file', filename: 'white-port.epub', contentType: 'application/epub+zip', body: 'epub-content' },
      { name: 'metadata', body: '{bad json' },
    ]);
    const malformedMetadataResponse = await fetch(importUrl, {
      method: 'POST',
      headers: { ...baseHeaders, 'content-type': malformedMetadata.contentType, 'idempotency-key': 'idem-import-bad-metadata' },
      body: malformedMetadata.body,
    });
    expect(malformedMetadataResponse.status).toBe(400);

    const malformedOptions = multipartPayload([
      { name: 'file', filename: 'white-port.epub', contentType: 'application/epub+zip', body: 'epub-content' },
      { name: 'metadata', body: JSON.stringify({ title: 'White Port' }) },
      { name: 'options', body: '{bad json' },
    ]);
    const malformedOptionsResponse = await fetch(importUrl, {
      method: 'POST',
      headers: { ...baseHeaders, 'content-type': malformedOptions.contentType, 'idempotency-key': 'idem-import-bad-options' },
      body: malformedOptions.body,
    });
    expect(malformedOptionsResponse.status).toBe(400);

    const oversizedResponse = await fetch(importUrl, {
      method: 'POST',
      headers: { ...baseHeaders, 'content-type': 'multipart/form-data; boundary=ck-oversize', 'idempotency-key': 'idem-import-oversize' },
      body: new Uint8Array(50 * 1024 * 1024 + 1),
    });
    expect(oversizedResponse.status).toBe(413);

    await expect(projectJobCount(baseUrl, cookie)).resolves.toBe(beforeCount);
  });

  it('replays or rejects idempotent indexing, chat and agent commands by key and payload', async () => {
    const { cookie } = await loginAndCookie(baseUrl);
    const api = authenticatedApi(baseUrl, cookie);

    await expect(api.createChatTurn('chat-white-port', { content: 'Короткий ключ', contextLocators: [] }, { idempotencyKey: 'short' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      api.createChatTurn('chat-white-port', { content: 'Длинный ключ', contextLocators: [] }, { idempotencyKey: 'x'.repeat(129) }),
    ).rejects.toMatchObject({ status: 400 });

    const firstIndex = await api.startProjectIndexing('project-white-port', { scope: 'project' }, { idempotencyKey: 'idem-index-same' });
    const replayedIndex = await api.startProjectIndexing('project-white-port', { scope: 'project' }, { idempotencyKey: 'idem-index-same' });
    expect(replayedIndex.jobId).toBe(firstIndex.jobId);
    await expect(api.startProjectIndexing('project-white-port', { scope: 'changed_content' }, { idempotencyKey: 'idem-index-same' })).rejects.toMatchObject({
      status: 409,
    });

    const firstTurn = await api.createChatTurn(
      'chat-white-port',
      { content: 'Один запрос', contextLocators: [] },
      { idempotencyKey: 'idem-chat-same' },
    );
    const replayedTurn = await api.createChatTurn(
      'chat-white-port',
      { content: 'Один запрос', contextLocators: [] },
      { idempotencyKey: 'idem-chat-same' },
    );
    expect(replayedTurn.turnId).toBe(firstTurn.turnId);
    await expect(
      api.createChatTurn('chat-white-port', { content: 'Другой запрос', contextLocators: [] }, { idempotencyKey: 'idem-chat-same' }),
    ).rejects.toMatchObject({ status: 409 });

    const firstAgent = await api.startAgentRun(
      'chapter-16',
      { prompt: 'Проверь сцену', expectedChapterRevision: 9 },
      { idempotencyKey: 'idem-agent-same' },
    );
    const replayedAgent = await api.startAgentRun(
      'chapter-16',
      { prompt: 'Проверь сцену', expectedChapterRevision: 9 },
      { idempotencyKey: 'idem-agent-same' },
    );
    expect(replayedAgent.runId).toBe(firstAgent.runId);
    await expect(
      api.startAgentRun('chapter-16', { prompt: 'Проверь диалог', expectedChapterRevision: 9 }, { idempotencyKey: 'idem-agent-same' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('keeps CORS local-only and logs only sanitized request metadata', async () => {
    const local = await loginAndCookie(baseUrl, { origin: 'http://localhost:3000' });
    expect(local.response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(local.response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(local.response.headers.get('vary')).toBe('Origin');

    const viteLocal = await loginAndCookie(baseUrl, { origin: 'http://127.0.0.1:5173' });
    expect(viteLocal.response.status).toBe(200);
    expect(viteLocal.response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
    expect(viteLocal.response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(viteLocal.response.headers.get('vary')).toBe('Origin');

    const externalToken = await csrfToken(baseUrl, { origin: 'https://example.invalid' });
    const external = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.invalid', 'x-csrf-token': externalToken },
      body: JSON.stringify(loginPayload),
    });
    expect(external.headers.get('access-control-allow-origin')).toBeNull();
    expect(external.headers.get('set-cookie')).toBeNull();
    expect(external.status).toBe(403);

    const crossSiteProject = await fetch(`${baseUrl}/projects/project-white-port`, {
      headers: { cookie: local.cookie, origin: 'https://example.invalid' },
    });
    expect(crossSiteProject.status).toBe(200);
    expect(crossSiteProject.headers.get('access-control-allow-origin')).toBeNull();

    const crossSiteSearch = await fetch(`${baseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: local.cookie,
        origin: 'https://example.invalid',
      },
      body: JSON.stringify({ query: 'port', scope: 'all', limit: 10 }),
    });
    expect(crossSiteSearch.status).toBe(403);
    const missingOriginSearch = await fetch(`${baseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: local.cookie,
      },
      body: JSON.stringify({ query: 'port', scope: 'all', limit: 10 }),
    });
    expect(missingOriginSearch.status).toBe(403);

    const streamToken = await csrfToken(baseUrl, { origin: localOrigin });
    const turnResponse = await fetch(`${baseUrl}/chats/chat-white-port/turns`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: local.cookie,
        'idempotency-key': 'idem-cors-stream-turn',
        origin: localOrigin,
        'x-csrf-token': streamToken,
      },
      body: JSON.stringify({ content: 'Проверь сцену', contextLocators: [] }),
    });
    expect(turnResponse.status).toBe(202);
    const turn = (await turnResponse.json()) as { turnId: string };
    const crossSiteStream = await fetch(`${baseUrl}/chat-turns/${turn.turnId}/events`, {
      headers: { cookie: local.cookie, origin: 'https://example.invalid' },
    });
    expect(crossSiteStream.status).toBe(200);
    expect(crossSiteStream.headers.get('access-control-allow-origin')).toBeNull();
    expect(JSON.stringify(logs)).not.toContain('white-port-12');
    expect(JSON.stringify(logs)).not.toContain('Привет');
  });
});

describe('SSE parser proof', () => {
  it('handles chunk boundaries, comments, keepalive frames and blank-line frames', async () => {
    const stream = bodyStream([
      ': keepalive\n\n',
      'data: {"eventId":"evt_1","sequence":1,"turnId":"t","jobId":"j","type":"assistant.delta","data":{"text":"A"}}\n\n\n',
      'data: {"eventId":"evt_2","sequence":2,"turnId":"t","jobId":"j","type":"turn.completed","data":{"assistantMessageId":"m","finishReason":"stop"}}\n\n',
    ]);

    await expect(collectEvents(stream)).resolves.toEqual([
      { eventId: 'evt_1', sequence: 1, turnId: 't', jobId: 'j', type: 'assistant.delta', data: { text: 'A' } },
      { eventId: 'evt_2', sequence: 2, turnId: 't', jobId: 'j', type: 'turn.completed', data: { assistantMessageId: 'm', finishReason: 'stop' } },
    ]);
  });

  it('surfaces malformed JSON and mid-stream disconnects', async () => {
    await expect(collectEvents(bodyStream(['data: {bad}\n\n']))).rejects.toBeInstanceOf(SseParseError);
    await expect(collectEvents(bodyStream(['data: {"type":"assistant.delta"']))).rejects.toBeInstanceOf(SseParseError);
  });

  it('maps SSE error-before-stream responses as API status errors', async () => {
    const controller = createMockApiServer({ port: 0 });
    const started = await controller.start();
    const baseUrl = `${started.url}/api/v1`;
    const { cookie } = await loginAndCookie(baseUrl);
    const api = createCanonKeeperApiClient({
      baseUrl,
      fetch: async (request) => {
        const headers = new Headers(request.headers);
        headers.set('cookie', cookie);
        headers.set('origin', localOrigin);
        headers.set('mock_return_status', '500');
        return fetch(request, { headers });
      },
    });

    try {
      await expect(api.streamChatTurnEvents('turn-1').next()).rejects.toBeInstanceOf(ApiStatusError);
    } finally {
      await controller.stop();
    }
  });
});
