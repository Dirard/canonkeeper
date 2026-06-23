import { describe, expect, it } from 'vitest';
import { getOperationManifestEntries, type OperationId } from '../../shared/api';
import { createAuthHandlers, createChatHandlers, mswApiBaseUrl } from './handlers';
import { mswServer } from './server';

const pathParams: Record<string, string> = {
  annotationId: 'annotation-1',
  artifactId: 'artifact-reader-references-1',
  bookId: 'book-02',
  chapterId: 'chapter-16',
  chatId: 'chat-white-port',
  invitationId: 'invitation-mira',
  jobId: 'index-job-1',
  memberId: 'member-collaborator',
  projectId: 'project-white-port',
  suggestionId: 'suggestion-punctuation-1',
  turnId: 'turn-1',
};

const locator = {
  projectId: 'project-white-port',
  bookId: 'book-02',
  chapterId: 'chapter-16',
  paragraphId: 'p-16-04',
  targetView: 'draft',
  revision: 9,
  range: null,
};

async function mswCsrfToken() {
  const response = await fetch(`${mswApiBaseUrl}/auth/csrf`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { csrfToken: string };
  return body.csrfToken;
}

function expectSessionCookieAttributes(setCookie: string) {
  expect(setCookie).toContain('ck_session=mock-session');
  expect(setCookie).toContain('Path=/');
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('SameSite=Lax');
  expect(setCookie).toContain('Max-Age=43200');
}

function rawMultipartImportBody(boundary: string, fileBody: Uint8Array) {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="white-port.epub"',
        'Content-Type: application/epub+zip',
        '',
      ].join('\r\n') + '\r\n',
    ),
    fileBody,
    encoder.encode(
      '\r\n' + [
        `--${boundary}`,
        'Content-Disposition: form-data; name="metadata"',
        'Content-Type: application/json',
        '',
        JSON.stringify({ sourceFileName: 'white-port.epub', title: 'White Port Append' }),
        `--${boundary}`,
        'Content-Disposition: form-data; name="options"',
        'Content-Type: application/json',
        '',
        JSON.stringify({ importMode: 'append' }),
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    ),
  ];
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

describe('MSW API handlers', () => {
  it('has an explicit handler for every generated operation route', async () => {
    for (const [operationId, route] of getOperationManifestEntries()) {
      mswServer.resetHandlers(...createAuthHandlers(), ...createChatHandlers());
      const path = await routePathForOperation(operationId, route.path);
      const response = await fetchWithOperationTimeout(
        `${mswApiBaseUrl}${path}`,
        requestInit(operationId, route.method),
        operationId,
      );

      await expectGeneratedOperationResponse(operationId, response);
    }
  }, 15000);

  it('enforces session, CSRF, strict local Origin, roles and no-store in the MSW harness', async () => {
    mswServer.use(...createChatHandlers());

    const missingSession = await fetch(`${mswApiBaseUrl}/projects/project-white-port`);
    expect(missingSession.status).toBe(401);
    expect(missingSession.headers.get('cache-control')).toBe('no-store');
    expect(missingSession.headers.get('content-type')).toContain('application/problem+json');

    const missingCsrf = await fetch(`${mswApiBaseUrl}/projects/project-white-port`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ title: 'No CSRF' }),
    });
    expect(missingCsrf.status).toBe(403);

    const crossSiteSearch = await fetch(`${mswApiBaseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'https://example.invalid',
      },
      body: JSON.stringify({ query: 'порт', scope: 'all' }),
    });
    expect(crossSiteSearch.status).toBe(403);
    const missingOriginSearch = await fetch(`${mswApiBaseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
      },
      body: JSON.stringify({ query: 'порт', scope: 'all' }),
    });
    expect(missingOriginSearch.status).toBe(403);
    const missingSearchCsrf = await fetch(`${mswApiBaseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ query: 'порт', scope: 'all' }),
    });
    expect(missingSearchCsrf.status).toBe(403);

    const viewerMutation = await fetch(`${mswApiBaseUrl}/projects/project-white-port`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        mock_actor_role: 'viewer',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
      body: JSON.stringify({ title: 'Viewer blocked' }),
    });
    expect(viewerMutation.status).toBe(403);

    const viewerMissingProjectMutation = await fetch(`${mswApiBaseUrl}/projects/project-missing`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        mock_actor_role: 'viewer',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
      body: JSON.stringify({ title: 'Missing project stays hidden' }),
    });
    expect(viewerMissingProjectMutation.status).toBe(404);

    const invalidProjectBody = await fetch(`${mswApiBaseUrl}/projects/project-white-port`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
      body: JSON.stringify({ id: 'project-hijack', title: 'Нельзя менять id' }),
    });
    expect(invalidProjectBody.status).toBe(400);

    const editorDeleteProject = await fetch(`${mswApiBaseUrl}/projects/project-white-port`, {
      method: 'DELETE',
      headers: {
        cookie: 'ck_session=mock-session',
        mock_actor_role: 'editor',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
    });
    expect(editorDeleteProject.status).toBe(403);

    const ownerDemotion = await fetch(`${mswApiBaseUrl}/projects/project-white-port/members/member-owner`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(ownerDemotion.status).toBe(409);

    const ownerRemoval = await fetch(`${mswApiBaseUrl}/projects/project-white-port/members/member-owner`, {
      method: 'DELETE',
      headers: {
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
    });
    expect(ownerRemoval.status).toBe(409);

    const invalidRoleUpdate = await fetch(`${mswApiBaseUrl}/projects/project-white-port/members/member-collaborator`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(invalidRoleUpdate.status).toBe(400);

    const collaboratorUpdate = await fetch(`${mswApiBaseUrl}/projects/project-white-port/members/member-collaborator`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(collaboratorUpdate.status).toBe(200);

    const collaboratorRemoval = await fetch(`${mswApiBaseUrl}/projects/project-white-port/members/member-collaborator`, {
      method: 'DELETE',
      headers: {
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
    });
    expect(collaboratorRemoval.status).toBe(204);

    const ownerProjects = await fetch(`${mswApiBaseUrl}/projects`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    expect(ownerProjects.status).toBe(200);
    expect(ownerProjects.headers.get('cache-control')).toBe('no-store');

    const firstBooksPage = await fetch(`${mswApiBaseUrl}/projects/project-white-port/books?limit=1`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    const firstBooksBody = (await firstBooksPage.json()) as { data: Array<{ id: string }>; meta: { nextCursor: string | null } };
    expect(firstBooksPage.status).toBe(200);
    expect(firstBooksBody.meta.nextCursor).toBeTruthy();
    const secondBooksPage = await fetch(`${mswApiBaseUrl}/projects/project-white-port/books?limit=1&cursor=${encodeURIComponent(firstBooksBody.meta.nextCursor ?? '')}`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    const secondBooksBody = (await secondBooksPage.json()) as { data: Array<{ id: string }> };
    expect(secondBooksPage.status).toBe(200);
    expect(secondBooksBody.data[0]?.id).not.toBe(firstBooksBody.data[0]?.id);

    const invalidAnnotationCursor = await fetch(`${mswApiBaseUrl}/chapters/chapter-12/annotations?limit=1&cursor=bad-cursor`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    expect(invalidAnnotationCursor.status).toBe(400);
    const staleAnnotation = await fetch(`${mswApiBaseUrl}/chapters/chapter-12/annotations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
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
    expect(staleAnnotation.status).toBe(409);

    const crossSiteProtectedGet = await fetch(`${mswApiBaseUrl}/projects/project-white-port`, {
      headers: { cookie: 'ck_session=mock-session', origin: 'https://example.invalid' },
    });
    expect(crossSiteProtectedGet.status).toBe(200);
    expect(crossSiteProtectedGet.headers.get('access-control-allow-origin')).toBeNull();

    const turnResponse = await fetch(`${mswApiBaseUrl}/chats/chat-white-port/turns`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        'idempotency-key': 'idem-msw-security-turn',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
      },
      body: JSON.stringify({ content: 'Проверь сцену', contextLocators: [] }),
    });
    const turn = (await turnResponse.json()) as { turnId: string; userMessageId: string };
    const stream = await fetch(`${mswApiBaseUrl}/chat-turns/${turn.turnId}/events`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('cache-control')).toBe('no-store');
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const reader = stream.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    const firstRead = await reader!.read();
    expect(firstRead.done).toBe(false);
    let streamText = decoder.decode(firstRead.value, { stream: true });
    expect(streamText).toContain('job.progress');

    const partialSnapshot = await fetch(`${mswApiBaseUrl}/chat-turns/${turn.turnId}`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    const partialSnapshotBody = (await partialSnapshot.json()) as { artifacts: unknown[]; messages: Array<{ id: string }>; suggestions: unknown[] };
    expect(partialSnapshot.status).toBe(200);
    expect(partialSnapshotBody.messages.map((message) => message.id)).toEqual([turn.userMessageId]);
    expect(partialSnapshotBody.suggestions).toEqual([]);

    for (;;) {
      const next = await reader!.read();
      if (next.done) {
        streamText += decoder.decode();
        break;
      }
      streamText += decoder.decode(next.value, { stream: true });
    }
    expect(streamText).toContain('turn.completed');

    const snapshot = await fetch(`${mswApiBaseUrl}/chat-turns/${turn.turnId}`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    const snapshotBody = (await snapshot.json()) as { artifacts: Array<{ id: string }>; messages: Array<{ id: string }>; suggestions: unknown[] };
    expect(snapshot.status).toBe(200);
    expect(snapshotBody.messages.map((message) => message.id)).toEqual([turn.userMessageId, `message-assistant-${turn.turnId}`]);
    expect(snapshotBody.artifacts.map((artifact) => artifact.id)).toEqual(['artifact-reader-references-1']);
    expect(snapshotBody.suggestions).toEqual([]);

    const resumedStream = await fetch(`${mswApiBaseUrl}/chat-turns/${turn.turnId}/events?afterEventId=evt_001`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    const resumedText = await resumedStream.text();
    expect(resumedStream.status).toBe(200);
    expect(resumedText).not.toContain('job.progress');
    expect(resumedText).toContain('assistant.delta');
    expect(resumedText).toContain('turn.completed');

    const chatJobs = await fetch(`${mswApiBaseUrl}/projects/project-white-port/jobs?kind=chat_turn&limit=1`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    const chatJobsBody = (await chatJobs.json()) as { data: Array<{ kind: string }>; meta: { hasMore: boolean; nextCursor: string | null } };
    expect(chatJobs.status).toBe(200);
    expect(chatJobsBody.data).toHaveLength(1);
    expect(chatJobsBody.data.every((job) => job.kind === 'chat_turn')).toBe(true);
    expect(chatJobsBody.meta).toHaveProperty('nextCursor');

    const nonChatJobSnapshot = await fetch(`${mswApiBaseUrl}/chat-turns/index-job-1`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    expect(nonChatJobSnapshot.status).toBe(404);
    const nonChatJobStream = await fetch(`${mswApiBaseUrl}/chat-turns/index-job-1/events`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    expect(nonChatJobStream.status).toBe(404);

    const crossSiteStream = await fetch(`${mswApiBaseUrl}/chat-turns/${turn.turnId}/events`, {
      headers: { cookie: 'ck_session=mock-session', origin: 'https://example.invalid' },
    });
    expect(crossSiteStream.status).toBe(200);
    expect(crossSiteStream.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns contract 415 Problem for non-multipart MSW imports', async () => {
    mswServer.use(...createChatHandlers());
    const response = await fetch(`${mswApiBaseUrl}/projects/project-white-port/imports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
        'idempotency-key': 'idem-msw-import-json-body',
      },
      body: JSON.stringify({ file: 'not-multipart' }),
    });
    expect(response.status).toBe(415);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    const problem = (await response.json()) as { code: string; status: number };
    expect(problem).toMatchObject({ code: 'unsupported_media_type', status: 415 });
  });

  it('rotates MSW CSRF tokens after login, session rotation and logout', async () => {
    mswServer.use(...createAuthHandlers());
    const bootstrapToken = await mswCsrfToken();
    const login = await fetch(`${mswApiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'x-csrf-token': bootstrapToken,
      },
      body: JSON.stringify({ email: 'mira@example.com', password: 'white-port-12', rememberMe: true }),
    });
    expect(login.status).toBe(200);
    const loginSetCookie = login.headers.get('set-cookie') ?? '';
    expectSessionCookieAttributes(loginSetCookie);
    const loginCookie = loginSetCookie.split(';')[0] ?? '';
    const sessionWithLoginCookie = await fetch(`${mswApiBaseUrl}/auth/session`, {
      headers: { cookie: loginCookie },
    });
    expect(sessionWithLoginCookie.status).toBe(200);
    const sessionWithLoginCookieBody = (await sessionWithLoginCookie.json()) as Record<string, unknown>;
    expect(sessionWithLoginCookieBody).toMatchObject({ email: 'mira@example.com' });
    expect(sessionWithLoginCookieBody).not.toHaveProperty('user');

    const staleAfterLogin = await fetch(`${mswApiBaseUrl}/auth/session/rotate`, {
      method: 'POST',
      headers: { cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': bootstrapToken },
    });
    expect(staleAfterLogin.status).toBe(403);

    const postLoginToken = await mswCsrfToken();
    const rotate = await fetch(`${mswApiBaseUrl}/auth/session/rotate`, {
      method: 'POST',
      headers: { cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': postLoginToken },
    });
    expect(rotate.status).toBe(200);
    expectSessionCookieAttributes(rotate.headers.get('set-cookie') ?? '');
    await expect(rotate.json()).resolves.toMatchObject({ user: { email: 'mira@example.com' } });

    const staleAfterRotate = await fetch(`${mswApiBaseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': postLoginToken },
    });
    expect(staleAfterRotate.status).toBe(403);

    const postRotateToken = await mswCsrfToken();
    const logout = await fetch(`${mswApiBaseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': postRotateToken },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');

    const postLogoutToken = await mswCsrfToken();
    const staleSessionRead = await fetch(`${mswApiBaseUrl}/auth/session`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    expect(staleSessionRead.status).toBe(401);
    const staleSessionRotate = await fetch(`${mswApiBaseUrl}/auth/session/rotate`, {
      method: 'POST',
      headers: { cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': postLogoutToken },
    });
    expect(staleSessionRotate.status).toBe(401);
  });

  it('rejects stale MSW repository sessions after logout on protected routes', async () => {
    mswServer.use(...createChatHandlers());
    const csrfToken = await mswCsrfToken();
    const logout = await fetch(`${mswApiBaseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': csrfToken },
    });
    expect(logout.status).toBe(204);

    const postLogoutToken = await mswCsrfToken();
    const projects = await fetch(`${mswApiBaseUrl}/projects`, {
      headers: { cookie: 'ck_session=mock-session' },
    });
    expect(projects.status).toBe(401);
    const createBook = await fetch(`${mswApiBaseUrl}/projects/project-white-port/books`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': postLogoutToken,
      },
      body: JSON.stringify({ title: 'После выхода' }),
    });
    expect(createBook.status).toBe(401);
  });

  it('runs MSW security checks before protected body parsing', async () => {
    mswServer.use(...createChatHandlers());
    const unauthenticatedImport = await fetch(`${mswApiBaseUrl}/projects/project-white-port/imports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'idempotency-key': 'idem-msw-import-no-session',
      },
      body: JSON.stringify({ file: 'not-multipart' }),
    });
    expect(unauthenticatedImport.status).toBe(401);

    const missingImportCsrf = await fetch(`${mswApiBaseUrl}/projects/project-white-port/imports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'idempotency-key': 'idem-msw-import-no-csrf',
      },
      body: JSON.stringify({ file: 'not-multipart' }),
    });
    expect(missingImportCsrf.status).toBe(403);

    const unauthenticatedSearch = await fetch(`${mswApiBaseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: 'not-json',
    });
    expect(unauthenticatedSearch.status).toBe(401);

    const missingTurnCsrf = await fetch(`${mswApiBaseUrl}/chats/chat-white-port/turns`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'idempotency-key': 'idem-msw-turn-no-csrf',
      },
      body: 'not-json',
    });
    expect(missingTurnCsrf.status).toBe(403);
  });

  it('keeps MSW auth failures non-enumerating with stable problem codes', async () => {
    mswServer.use(...createAuthHandlers());
    const headers = {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      'x-csrf-token': 'ck_msw_csrf_token_000000',
    };

    const unknownEmail = await fetch(`${mswApiBaseUrl}/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'unknown@example.test', password: 'wrong-password', rememberMe: true }),
    });
    const wrongPassword = await fetch(`${mswApiBaseUrl}/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'mira@example.com', password: 'wrong-password', rememberMe: true }),
    });
    const unknownEmailBody = (await unknownEmail.json()) as Record<string, unknown>;
    const wrongPasswordBody = (await wrongPassword.json()) as Record<string, unknown>;
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmailBody).toMatchObject({ code: 'auth_failed', detail: 'Authentication failed.', status: 401, title: 'Unauthorized' });
    expect(wrongPasswordBody).toMatchObject({ code: 'auth_failed', detail: 'Authentication failed.', status: 401, title: 'Unauthorized' });
    expect(JSON.stringify(unknownEmailBody)).not.toContain('unknown@example.test');
    expect(JSON.stringify(wrongPasswordBody)).not.toContain('mira@example.com');

    const falseTermsRegister = await fetch(`${mswApiBaseUrl}/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ acceptedTerms: false, displayName: 'Новый автор', email: 'new-author@example.test', password: 'white-port-12' }),
    });
    expect(falseTermsRegister.status).toBe(400);
    expect(falseTermsRegister.headers.get('set-cookie')).toBeNull();
    const missingTermsRegister = await fetch(`${mswApiBaseUrl}/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ displayName: 'Новый автор', email: 'new-author@example.test', password: 'white-port-12' }),
    });
    expect(missingTermsRegister.status).toBe(400);
    expect(missingTermsRegister.headers.get('set-cookie')).toBeNull();

    const existingEmailRegister = await fetch(`${mswApiBaseUrl}/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ acceptedTerms: true, displayName: 'Мира Волкова', email: 'mira@example.com', password: 'white-port-12' }),
    });
    const postExistingRegisterToken = await mswCsrfToken();
    const newEmailRegister = await fetch(`${mswApiBaseUrl}/auth/register`, {
      method: 'POST',
      headers: { ...headers, 'x-csrf-token': postExistingRegisterToken },
      body: JSON.stringify({ acceptedTerms: true, displayName: 'Новый автор', email: 'new-author@example.test', password: 'white-port-12' }),
    });
    expect(existingEmailRegister.status).toBe(409);
    expect(existingEmailRegister.headers.get('set-cookie')).toBeNull();
    expect(newEmailRegister.status).toBe(201);
    expectSessionCookieAttributes(newEmailRegister.headers.get('set-cookie') ?? '');
    const existingEmailRegisterBody = (await existingEmailRegister.json()) as Record<string, unknown>;
    expect(existingEmailRegisterBody).toMatchObject({ code: 'registration_conflict', detail: 'Registration cannot be completed.', status: 409, title: 'Conflict' });
    expect(JSON.stringify(existingEmailRegisterBody)).not.toContain('mira@example.com');
    await expect(newEmailRegister.json()).resolves.toMatchObject({ user: { email: 'new-author@example.test' } });
  });

  it('rotates shared CSRF state through createChatHandlers auth endpoints', async () => {
    mswServer.use(...createChatHandlers());
    const bootstrapToken = await mswCsrfToken();
    const rotate = await fetch(`${mswApiBaseUrl}/auth/session/rotate`, {
      method: 'POST',
      headers: { cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': bootstrapToken },
    });
    expect(rotate.status).toBe(200);
    expectSessionCookieAttributes(rotate.headers.get('set-cookie') ?? '');
    await expect(rotate.json()).resolves.toMatchObject({ user: { email: 'mira@example.com' } });

    const staleRename = await fetch(`${mswApiBaseUrl}/chats/chat-white-port`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': bootstrapToken },
      body: JSON.stringify({ title: 'Старый токен' }),
    });
    expect(staleRename.status).toBe(403);

    const postRotateToken = await mswCsrfToken();
    const freshRename = await fetch(`${mswApiBaseUrl}/chats/chat-white-port`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': postRotateToken },
      body: JSON.stringify({ title: 'Свежий токен' }),
    });
    expect(freshRename.status).toBe(200);

    const logout = await fetch(`${mswApiBaseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': postRotateToken },
    });
    expect(logout.status).toBe(204);

    const staleAfterLogout = await fetch(`${mswApiBaseUrl}/chats/chat-white-port`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'ck_session=mock-session', origin: 'http://localhost:3000', 'x-csrf-token': postRotateToken },
      body: JSON.stringify({ title: 'После выхода' }),
    });
    expect(staleAfterLogout.status).toBe(401);
  });

  it('binds MSW search cursors and invitation acceptance to request/security state', async () => {
    mswServer.use(...createChatHandlers());
    const headers = {
      'content-type': 'application/json',
      cookie: 'ck_session=mock-session',
      origin: 'http://localhost:3000',
      'x-csrf-token': 'ck_msw_csrf_token_000000',
    };
    const firstSearch = await fetch(`${mswApiBaseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 1, query: 'порт', scope: 'all' }),
    });
    const firstBody = (await firstSearch.json()) as { meta: { nextCursor: string | null } };
    expect(firstBody.meta.nextCursor).toBeTruthy();
    const mismatchSearch = await fetch(`${mswApiBaseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cursor: firstBody.meta.nextCursor, limit: 1, query: 'другой', scope: 'all' }),
    });
    expect(mismatchSearch.status).toBe(400);
    const invalidFilters = await fetch(`${mswApiBaseUrl}/projects/project-white-port/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filters: { unsupported: true }, limit: 1, query: 'порт', scope: 'all' }),
    });
    expect(invalidFilters.status).toBe(400);
    const invalidSearchBodies = [
      { body: { query: '', scope: 'all' }, detail: 'Search query must be a non-empty string.' },
      { body: { query: 'x'.repeat(501), scope: 'all' }, detail: 'Search query must be 500 characters or fewer.' },
      { body: { query: 'порт', scope: 'bad-scope' }, detail: 'Search scope is invalid.' },
      { body: { limit: 0, query: 'порт', scope: 'all' }, detail: 'Search limit must be an integer between 1 and 50.' },
      { body: { filters: { bookId: 123 }, query: 'порт', scope: 'all' }, detail: 'Search ID filters must be non-empty strings.' },
      { body: { filters: { chapterId: false }, query: 'порт', scope: 'all' }, detail: 'Search ID filters must be non-empty strings.' },
      { body: { filters: { resultKinds: ['chapter', 'chapter'] }, query: 'порт', scope: 'all' }, detail: 'Search resultKinds filter is invalid.' },
      {
        body: { filters: { resultKinds: ['chapter', 'annotation', 'unknown-kind'] }, query: 'порт', scope: 'all' },
        detail: 'Search resultKinds filter is invalid.',
      },
      { body: { extra: true, query: 'порт', scope: 'all' }, detail: 'Search request contains unsupported keys.' },
      { body: { query: 'порт', scope: 'all', signal: {} }, detail: 'Search request contains unsupported keys.' },
    ];
    for (const { body, detail } of invalidSearchBodies) {
      const invalidSearch = await fetch(`${mswApiBaseUrl}/projects/project-white-port/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      expect(invalidSearch.status).toBe(400);
      await expect(invalidSearch.json()).resolves.toMatchObject({ detail, status: 400 });
    }

    const existingMemberDeniedInvite = await fetch(`${mswApiBaseUrl}/project-invitations/invitation-mira/accept`, {
      method: 'POST',
      headers,
    });
    expect(existingMemberDeniedInvite.status).toBe(403);
    const mismatchInvite = await fetch(`${mswApiBaseUrl}/project-invitations/invitation-mira/accept`, {
      method: 'POST',
      headers: { ...headers, 'mock-actor-role': 'non_member', 'mock-verified-email': 'other@example.com' },
    });
    expect(mismatchInvite.status).toBe(404);
    const inviteeDiscovery = await fetch(`${mswApiBaseUrl}/project-invitations?limit=10`, {
      headers: { ...headers, 'mock-actor-role': 'non_member', 'mock-verified-email': 'mira@example.com' },
    });
    expect(inviteeDiscovery.status).toBe(200);
    await expect(inviteeDiscovery.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ email: 'mira@example.com', id: 'invitation-mira', status: 'pending' })],
    });
    const invitedNonMember = await fetch(`${mswApiBaseUrl}/project-invitations/invitation-mira/accept`, {
      method: 'POST',
      headers: { ...headers, 'mock-actor-role': 'non_member', 'mock-verified-email': 'mira@example.com' },
    });
    expect(invitedNonMember.status).toBe(200);
    await expect(invitedNonMember.json()).resolves.toMatchObject({
      email: 'mira@example.com',
      id: 'member-invitation-mira',
      role: 'editor',
      status: 'active',
      userId: 'user-mira',
    });
    const membersAfterInvite = await fetch(`${mswApiBaseUrl}/projects/project-white-port/members`, {
      headers,
    });
    await expect(membersAfterInvite.json()).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ email: 'mira@example.com', id: 'member-invitation-mira', role: 'editor', status: 'active', userId: 'user-mira' }),
      ]),
    });
    const replayedMiraInvite = await fetch(`${mswApiBaseUrl}/project-invitations/invitation-mira/accept`, {
      method: 'POST',
      headers: { ...headers, 'mock-actor-role': 'non_member', 'mock-verified-email': 'mira@example.com' },
    });
    expect(replayedMiraInvite.status).toBe(409);
    const unknownInvite = await fetch(`${mswApiBaseUrl}/project-invitations/invitation-missing/accept`, {
      method: 'POST',
      headers: { ...headers, 'mock-actor-role': 'non_member' },
    });
    expect(unknownInvite.status).toBe(404);
    const accepted = await fetch(`${mswApiBaseUrl}/project-invitations/invitation-1/accept`, {
      method: 'POST',
      headers: { ...headers, 'mock-actor-role': 'non_member' },
    });
    expect(accepted.status).toBe(404);
    const replayedInvite = await fetch(`${mswApiBaseUrl}/project-invitations/invitation-1/accept`, {
      method: 'POST',
      headers: { ...headers, 'mock-actor-role': 'non_member' },
    });
    expect(replayedInvite.status).toBe(404);
    const ownerInvite = await fetch(`${mswApiBaseUrl}/projects/project-white-port/invitations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'owner-invite@example.test', role: 'owner' }),
    });
    expect(ownerInvite.status).toBe(400);
    const missingProjectMembers = await fetch(`${mswApiBaseUrl}/projects/project-missing/members`, {
      headers,
    });
    expect(missingProjectMembers.status).toBe(404);
    const missingProjectInvite = await fetch(`${mswApiBaseUrl}/projects/project-missing/invitations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'new-collaborator@example.test', role: 'editor' }),
    });
    expect(missingProjectInvite.status).toBe(404);
    const missingMember = await fetch(`${mswApiBaseUrl}/projects/project-white-port/members/member-missing`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(missingMember.status).toBe(404);
    const missingMemberAsViewer = await fetch(`${mswApiBaseUrl}/projects/project-white-port/members/member-missing`, {
      method: 'PATCH',
      headers: { ...headers, 'mock-actor-role': 'viewer' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(missingMemberAsViewer.status).toBe(404);
  });

  it('enforces MSW idempotency, async 202 headers and raw multipart parsing', async () => {
    mswServer.use(...createChatHandlers());
    const headers = {
      'content-type': 'application/json',
      cookie: 'ck_session=mock-session',
      origin: 'http://localhost:3000',
      'x-csrf-token': 'ck_msw_csrf_token_000000',
    };
    const missingKey = await fetch(`${mswApiBaseUrl}/projects/project-white-port/indexing-runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ scope: 'project' }),
    });
    expect(missingKey.status).toBe(400);

    const shortKey = await fetch(`${mswApiBaseUrl}/chats/chat-white-port/turns`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'short' },
      body: JSON.stringify({ content: 'Короткий ключ', contextLocators: [] }),
    });
    expect(shortKey.status).toBe(400);
    const longKey = await fetch(`${mswApiBaseUrl}/chats/chat-white-port/turns`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'x'.repeat(129) },
      body: JSON.stringify({ content: 'Длинный ключ', contextLocators: [] }),
    });
    expect(longKey.status).toBe(400);

    const firstIndex = await fetch(`${mswApiBaseUrl}/projects/project-white-port/indexing-runs`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'idem-msw-index' },
      body: JSON.stringify({ scope: 'project' }),
    });
    expect(firstIndex.status).toBe(202);
    expect(firstIndex.headers.get('retry-after')).toBe('1');
    const firstBody = (await firstIndex.json()) as { jobId: string };
    expect(firstIndex.headers.get('location')).toBe(`/api/v1/jobs/${firstBody.jobId}`);

    const editorHeaders = { ...headers, mock_actor_role: 'editor' };
    const editorIndex = await fetch(`${mswApiBaseUrl}/projects/project-white-port/indexing-runs`, {
      method: 'POST',
      headers: { ...editorHeaders, 'idempotency-key': 'idem-msw-editor-index' },
      body: JSON.stringify({ scope: 'project' }),
    });
    expect(editorIndex.status).toBe(202);
    const editorIndexBody = (await editorIndex.json()) as { jobId: string };
    const editorCancel = await fetch(`${mswApiBaseUrl}/jobs/${editorIndexBody.jobId}/cancel`, {
      method: 'POST',
      headers: editorHeaders,
    });
    expect(editorCancel.status).toBe(200);
    await expect(editorCancel.json()).resolves.toMatchObject({ status: 'canceling' });

    const replayedIndex = await fetch(`${mswApiBaseUrl}/projects/project-white-port/indexing-runs`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'idem-msw-index' },
      body: JSON.stringify({ scope: 'project' }),
    });
    expect(replayedIndex.status).toBe(202);
    expect(replayedIndex.headers.get('location')).toBe(`/api/v1/jobs/${firstBody.jobId}`);
    await expect(replayedIndex.json()).resolves.toMatchObject({ jobId: firstBody.jobId });

    const mismatchIndex = await fetch(`${mswApiBaseUrl}/projects/project-white-port/indexing-runs`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'idem-msw-index' },
      body: JSON.stringify({ scope: 'changed_content' }),
    });
    expect(mismatchIndex.status).toBe(409);

    const chatTurn = await fetch(`${mswApiBaseUrl}/chats/chat-white-port/turns`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'idem-msw-empty-cursor-turn' },
      body: JSON.stringify({ content: 'Проверь курсор', contextLocators: [] }),
    });
    expect(chatTurn.status).toBe(202);
    const chatTurnBody = (await chatTurn.json()) as { turnId: string };
    const emptyAfterEventId = await fetch(`${mswApiBaseUrl}/chat-turns/${chatTurnBody.turnId}/events?afterEventId=`, {
      headers,
    });
    expect(emptyAfterEventId.status).toBe(400);
    const emptyLastEventId = await fetch(`${mswApiBaseUrl}/chat-turns/${chatTurnBody.turnId}/events`, {
      headers: { ...headers, 'Last-Event-ID': '' },
    });
    expect(emptyLastEventId.status).toBe(400);

    const boundary = 'ck-msw-raw-import';
    const multipartBody = rawMultipartImportBody(boundary, new Uint8Array([0xff]));
    const imported = await fetch(`${mswApiBaseUrl}/projects/project-white-port/imports`, {
      method: 'POST',
      headers: {
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'idempotency-key': 'idem-msw-import-raw',
      },
      body: multipartBody,
    });
    expect(imported.status).toBe(202);
    expect(imported.headers.get('location')).toBeTruthy();
    expect(imported.headers.get('retry-after')).toBe('1');
    const importedBody = (await imported.json()) as { job: { result: Record<string, unknown> } };
    expect(importedBody.job.result).toMatchObject({ sourceFileName: 'white-port.epub', importMode: 'append', title: 'White Port Append' });

    const changedMultipartBody = rawMultipartImportBody(boundary, new Uint8Array([0xfe]));
    const changedImport = await fetch(`${mswApiBaseUrl}/projects/project-white-port/imports`, {
      method: 'POST',
      headers: {
        cookie: 'ck_session=mock-session',
        origin: 'http://localhost:3000',
        'x-csrf-token': 'ck_msw_csrf_token_000000',
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'idempotency-key': 'idem-msw-import-raw',
      },
      body: changedMultipartBody,
    });
    expect(changedImport.status).toBe(409);
  });
});

async function fetchWithOperationTimeout(url: string, init: RequestInit, operationId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new Error(`MSW handler did not resolve for ${operationId}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function applyPathParams(path: string) {
  return path.replace(/\{([^}]+)\}/g, (_match, key: string) => pathParams[key] ?? key);
}

async function routePathForOperation(operationId: OperationId, path: string) {
  if (operationId !== 'getChatTurn' && operationId !== 'streamChatTurnEvents') {
    return applyPathParams(path);
  }

  const createdTurn = await fetchWithOperationTimeout(
    `${mswApiBaseUrl}/chats/chat-white-port/turns`,
    requestInit('createChatTurn', 'POST'),
    `${operationId}:setup`,
  );
  expect(createdTurn.status, `${operationId}:setup`).toBe(202);
  const body = (await createdTurn.json()) as { turnId: string };
  return path.replace('{turnId}', body.turnId);
}

function requestInit(operationId: OperationId, method: string): RequestInit {
  const headers = new Headers();
  headers.set('cookie', 'ck_session=mock-session');
  headers.set('origin', 'http://localhost:3000');
  headers.set('x-csrf-token', 'ck_msw_csrf_token_000000');
  headers.set('idempotency-key', `idem-msw-${operationId}`);
  if (operationId === 'acceptProjectInvitation' || operationId === 'listMyProjectInvitations') {
    headers.set('mock-actor-role', 'non_member');
    headers.set('mock-verified-email', 'mira@example.com');
  }

  if (method === 'GET' || method === 'DELETE') {
    return { method, headers };
  }
  if (operationId === 'acceptProjectInvitation') {
    return { method, headers };
  }

  if (operationId === 'importBookFile') {
    const boundary = 'ck-msw-parity';
    headers.set('content-type', `multipart/form-data; boundary=${boundary}`);
    return {
      method,
      headers,
      body: [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="white-port.epub"',
        'Content-Type: application/epub+zip',
        '',
        'epub-content',
        `--${boundary}`,
        'Content-Disposition: form-data; name="metadata"',
        '',
        JSON.stringify({ sourceFileName: 'white-port.epub', title: 'White Port' }),
        `--${boundary}`,
        'Content-Disposition: form-data; name="options"',
        '',
        JSON.stringify({ importMode: 'new_book' }),
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    };
  }

  headers.set('content-type', 'application/json');
  return { method, headers, body: JSON.stringify(bodyFor(operationId)) };
}

function bodyFor(operationId: OperationId): unknown {
  switch (operationId) {
    case 'approveAgentSuggestion':
      return { expectedChapterRevision: 9 };
    case 'rejectAgentSuggestion':
      return { expectedChapterRevision: 9 };
    case 'createBook':
      return { title: 'Новая книга' };
    case 'createBookExport':
      return { format: 'epub' };
    case 'createChapter':
      return { paragraphs: [{ kind: 'paragraph', markdown: 'Новая сцена', order: 1, text: 'Новая сцена' }], title: 'Новая глава' };
    case 'createChapterAnnotation':
      return { body: 'Заметка', kind: 'note', locator, quote: null, tags: [] };
    case 'createChatSession':
      return { title: 'Новый чат' };
    case 'createChatTurn':
      return { content: 'Проверь сцену', contextLocators: [] };
    case 'createProject':
      return { description: 'Черновой проект', title: 'Новый проект' };
    case 'createProjectInvitation':
      return { email: 'coauthor@example.test', role: 'editor' };
    case 'loginUser':
      return { email: 'mira@example.com', password: 'white-port-12', rememberMe: true };
    case 'publishChapter':
      return { expectedDraftRevision: 9 };
    case 'registerUser':
      return { acceptedTerms: true, displayName: 'Новый автор', email: 'new-author@example.test', password: 'white-port-12' };
    case 'renameChatSession':
      return { title: 'Переименованный чат' };
    case 'searchProject':
      return { limit: 10, query: 'порт', scope: 'all' };
    case 'startAgentRun':
      return { expectedChapterRevision: 9, prompt: 'Проверь сцену' };
    case 'startProjectIndexing':
      return { scope: 'project' };
    case 'updateBook':
      return { title: 'Обновленная книга' };
    case 'updateChapter':
      return { expectedRevision: 9, title: 'Обновленная глава' };
    case 'updateProject':
      return { description: 'Обновленный проект', title: 'Обновленный проект' };
    case 'updateProjectMemberRole':
      return { role: 'viewer' };
    case 'updateReaderAnnotation':
      return { body: 'Обновленная заметка' };
    default:
      return {};
  }
}

const expectedSuccessStatuses: Partial<Record<OperationId, number>> = {
  registerUser: 201,
  createProject: 201,
  createBook: 201,
  importBookFile: 202,
  startProjectIndexing: 202,
  createBookExport: 202,
  createChapter: 201,
  createChapterAnnotation: 201,
  createChatSession: 201,
  createChatTurn: 202,
  createProjectInvitation: 201,
  startAgentRun: 202,
  logoutUser: 204,
  deleteProject: 204,
  deleteBook: 204,
  deleteChapter: 204,
  removeProjectMember: 204,
  deleteReaderAnnotation: 204,
  deleteChatSession: 204,
};

function expectedSuccessStatus(operationId: OperationId) {
  return expectedSuccessStatuses[operationId] ?? 200;
}

async function expectGeneratedOperationResponse(operationId: OperationId, response: Response) {
  const expectedStatus = expectedSuccessStatus(operationId);
  expect(response.status, operationId).toBe(expectedStatus);
  expect(response.headers.get('cache-control'), operationId).toBe('no-store');
  if (expectedStatus === 204) {
    await expect(response.text(), operationId).resolves.toBe('');
    return;
  }
  if (operationId === 'streamChatTurnEvents') {
    expect(response.headers.get('content-type'), operationId).toContain('text/event-stream');
    await expect(response.text(), operationId).resolves.toContain('turn.completed');
    return;
  }
  expect(response.headers.get('content-type'), operationId).toContain('json');
  const body = (await response.json()) as unknown;
  expect(body, operationId).toBeTypeOf('object');
}
