import { Buffer } from 'node:buffer';
import { http, HttpResponse } from 'msw';
import { MockRepository } from '../../api/mock/repository';
import { MockApiError, type MockActorRole, type MockScenarioControl, type MockScenarioPreset } from '../../api/mock/scenarios';
import {
  getOperationManifestEntries,
  type ChatTurnEventMessage,
  type ImportBookInput,
  type OperationId,
  type OperationManifestRoute,
  type OperationParameters,
  type OperationRequest,
} from '../../shared/api';
import { createAuthSession, mswUser } from './fixtures';

export const mswApiBaseUrl = 'http://localhost/api/v1';

type JsonObject = Record<string, unknown>;
type MswSecurityContext = {
  csrfState?: MswCsrfState;
  hasActiveSession?: () => boolean;
  operationId: OperationId;
  request: Request;
  repository?: MockRepository;
};
type MswCsrfState = {
  tokenVersion: number;
};
type MswIdempotencyRecord = {
  body: unknown;
  fingerprint: string;
  headers?: Record<string, string>;
  status: number;
};
type FileWithMockContent = File & { mockContent?: string };
type ProjectJobsQuery = NonNullable<OperationParameters<'listProjectJobs'>['query']>;
type CursorListQuery = {
  cursor?: string;
  limit?: number;
};
type AgentSuggestionsQuery = NonNullable<OperationParameters<'listAgentSuggestions'>['query']>;

const sessionCookieName = 'ck_session';
const sessionCookieValue = 'mock-session';
const sessionCookieMaxAgeSeconds = 43_200;
const csrfTokenPrefix = 'ck_msw_csrf_token_';
const mockPassword = 'white-port-12';
const minIdempotencyKeyLength = 8;
const maxIdempotencyKeyLength = 128;
const repositoryCsrfStates = new WeakMap<MockRepository, MswCsrfState>();
const allowedCorsOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
]);
const idempotentOperations = new Set<OperationId>(['importBookFile', 'createBookExport', 'startProjectIndexing', 'createChatTurn', 'startAgentRun']);
const operationManifestById = new Map<OperationId, OperationManifestRoute>(getOperationManifestEntries());

function mswPath(operationId: OperationId) {
  const route = operationManifestById.get(operationId);
  if (!route) {
    throw new Error(`Missing generated operation route for ${operationId}`);
  }
  return `${mswApiBaseUrl}${route.path.replace(/\{([^}]+)\}/g, ':$1')}`;
}

function createMswCsrfState(): MswCsrfState {
  return { tokenVersion: 0 };
}

function currentMswCsrfTokenValue(state: MswCsrfState) {
  return `${csrfTokenPrefix}${String(state.tokenVersion).padStart(6, '0')}`;
}

function rotateMswCsrfToken(state: MswCsrfState) {
  state.tokenVersion += 1;
}

function validateRegisterBody(body: JsonObject) {
  const allowed = new Set(['acceptedTerms', 'displayName', 'email', 'password']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new MockApiError(400, 'Request body contains unsupported keys.', 'registerUser', 'validation_failed');
    }
  }
  if (body.acceptedTerms !== true) {
    throw new MockApiError(400, 'Registration requires accepted terms.', 'registerUser', 'validation_failed');
  }
  if (typeof body.displayName !== 'string' || body.displayName.trim().length === 0 || body.displayName.length > 120) {
    throw new MockApiError(400, 'Registration displayName is invalid.', 'registerUser', 'validation_failed');
  }
  if (typeof body.email !== 'string' || body.email.trim().length === 0) {
    throw new MockApiError(400, 'Registration email is invalid.', 'registerUser', 'validation_failed');
  }
  if (typeof body.password !== 'string' || body.password.length < 8) {
    throw new MockApiError(400, 'Registration password is invalid.', 'registerUser', 'validation_failed');
  }
}

interface AuthHandlersOptions {
  onLogin?: (body: { rememberMe?: unknown }) => void;
  onRegister?: (body: { acceptedTerms?: unknown; displayName?: unknown }) => void;
}

interface ChatHandlersOptions {
  preset?: MockScenarioPreset;
  scenario?: MockScenarioControl;
}

async function readJson(request: Request): Promise<JsonObject> {
  const body = await request.json();
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as JsonObject) : {};
}

async function readImportForm(request: Request): Promise<ImportBookInput> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const raw = Buffer.from(await request.arrayBuffer());
    const file = extractMultipartFilePart(raw);
    if (!file) {
      throw new MockApiError(422, 'Multipart import requires a file part.', 'importBookFile');
    }
    const upload = Object.assign(new File([new Uint8Array(file.body)], file.name, { type: file.contentType ?? 'application/octet-stream' }), {
      mockContent: file.body.toString('latin1'),
    }) as FileWithMockContent;
    return {
      file: upload,
      metadata: extractMultipartJsonPart(raw, 'metadata') as ImportBookInput['metadata'],
      options: extractMultipartJsonPart(raw, 'options') as ImportBookInput['options'],
    };
  }

  throw new MockApiError(415, 'Import expects multipart/form-data.', 'importBookFile');
}

function projectJobsQuery(request: Request): ProjectJobsQuery {
  const searchParams = new URL(request.url).searchParams;
  const result: ProjectJobsQuery = {};
  const kind = searchParams.get('kind');
  const limit = searchParams.get('limit');
  const cursor = searchParams.get('cursor');
  if (kind) {
    result.kind = kind as ProjectJobsQuery['kind'];
  }
  if (limit) {
    result.limit = Number(limit);
  }
  if (cursor) {
    result.cursor = cursor;
  }
  return result;
}

function cursorListQuery(request: Request): CursorListQuery {
  const searchParams = new URL(request.url).searchParams;
  const result: CursorListQuery = {};
  const limit = searchParams.get('limit');
  const cursor = searchParams.get('cursor');
  if (limit) {
    result.limit = Number(limit);
  }
  if (cursor) {
    result.cursor = cursor;
  }
  return result;
}

function agentSuggestionsQuery(request: Request): AgentSuggestionsQuery {
  const searchParams = new URL(request.url).searchParams;
  const result = cursorListQuery(request) as AgentSuggestionsQuery;
  const status = searchParams.get('status');
  const sourceMessageId = searchParams.get('sourceMessageId');
  const batchId = searchParams.get('batchId');
  if (status) {
    result.status = status as AgentSuggestionsQuery['status'];
  }
  if (sourceMessageId) {
    result.sourceMessageId = sourceMessageId;
  }
  if (batchId) {
    result.batchId = batchId;
  }
  return result;
}

function extractMultipartFilePart(raw: Buffer) {
  const text = raw.toString('latin1');
  const match = /Content-Disposition:[^\r\n]*name="file"[^\r\n]*filename="([^"]+)"[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*?)(?=\r?\n--)/i.exec(text);
  if (!match) {
    return null;
  }
  const headers = match[2] ?? '';
  return {
    body: Buffer.from(match[3] ?? '', 'latin1'),
    contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? null,
    name: match[1] ?? 'upload.bin',
  };
}

function extractMultipartJsonPart(raw: Buffer, name: string) {
  const text = raw.toString('latin1');
  const match = new RegExp(`Content-Disposition:[^\\r\\n]*name="${name}"[^\\r\\n]*(?:\\r?\\n(?!\\r?\\n)[^\\r\\n]*)*\\r?\\n\\r?\\n([\\s\\S]*?)(?=\\r?\\n--)`, 'i').exec(text);
  if (!match) {
    return undefined;
  }
  const part = match[1] ?? '';
  try {
    return JSON.parse(Buffer.from(part, 'latin1').toString('utf8').trim()) as unknown;
  } catch {
    throw new MockApiError(400, `Malformed multipart JSON part: ${name}.`, 'importBookFile');
  }
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

export function createAuthHandlers(options: AuthHandlersOptions = {}) {
  const csrfState = createMswCsrfState();
  let sessionActive = true;
  const authSecurity = (operationId: OperationId, request: Request): MswSecurityContext => ({
    csrfState,
    hasActiveSession: () => sessionActive,
    operationId,
    request,
  });
  return [
    csrfHandler(csrfState),
    http.get(mswPath('getCurrentUser'), ({ request }) =>
      jsonResponse(() => mswUser, undefined, authSecurity('getCurrentUser', request)),
    ),
    http.post(mswPath('loginUser'), async ({ request }) => {
      const body = await readJson(request);
      return jsonResponse(
        () => {
          options.onLogin?.({ rememberMe: body.rememberMe });
          if (typeof body.email !== 'string' || typeof body.password !== 'string' || normalizedEmail(body.email) !== normalizedEmail(mswUser.email) || body.password !== mockPassword) {
            throw new MockApiError(401, 'Authentication failed.', 'loginUser', 'auth_failed');
          }
          sessionActive = true;
          return createAuthSession();
        },
        { headers: sessionHeaders() },
        { csrfState, operationId: 'loginUser', request },
      );
    }),
    http.post(mswPath('rotateSession'), ({ request }) =>
      jsonResponse(() => createAuthSession(), { headers: sessionHeaders() }, authSecurity('rotateSession', request)),
    ),
    http.post(mswPath('logoutUser'), ({ request }) =>
      emptyResponse(() => {
        sessionActive = false;
      }, authSecurity('logoutUser', request), { headers: clearSessionHeaders() }),
    ),
    http.post(mswPath('registerUser'), async ({ request }) => {
      const body = await readJson(request);
      return jsonResponse(
        () => {
          validateRegisterBody(body);
          options.onRegister?.({ acceptedTerms: body.acceptedTerms, displayName: body.displayName });
          const email = normalizedEmail(body.email as string);
          if (normalizedEmail(email) === normalizedEmail(mswUser.email)) {
            throw new MockApiError(409, 'Registration cannot be completed.', 'registerUser', 'registration_conflict');
          }
          const displayName = body.displayName as string;
          sessionActive = true;
          return createAuthSession({ ...mswUser, displayName, email });
        },
        { status: 201, headers: sessionHeaders() },
        { csrfState, operationId: 'registerUser', request },
      );
    }),
  ];
}

export function createChatHandlers(options: ChatHandlersOptions = {}) {
  const csrfState = createMswCsrfState();
  const repository = new MockRepository();
  const idempotencyStore = new Map<string, MswIdempotencyRecord>();
  repository.setScenario(options.scenario ?? { preset: options.preset ?? 'normal' });
  repositoryCsrfStates.set(repository, csrfState);

  return [
    csrfHandler(csrfState),
    http.get(mswPath('getCurrentUser'), ({ request }) =>
      jsonResponse(() => repository.getCurrentUser(), undefined, { csrfState, operationId: 'getCurrentUser', request, repository }),
    ),
    http.post(mswPath('rotateSession'), ({ request }) =>
      jsonResponse(() => repository.rotateSession(), { headers: sessionHeaders() }, { csrfState, operationId: 'rotateSession', request, repository }),
    ),
    http.post(mswPath('logoutUser'), ({ request }) =>
      emptyResponse(() => repository.logout(), { csrfState, operationId: 'logoutUser', request, repository }, { headers: clearSessionHeaders() }),
    ),
    http.get(mswPath('listProjects'), ({ request }) =>
      jsonResponse(() => repository.listProjects(cursorListQuery(request)), undefined, { operationId: 'listProjects', request, repository }),
    ),
    http.post(mswPath('createProject'), async ({ request }) =>
      jsonResponse(async () => repository.createProject((await readJson(request)) as OperationRequest<'createProject'>), { status: 201 }, {
        operationId: 'createProject',
        request,
        repository,
      }),
    ),
    http.get(mswPath('getProject'), ({ params, request }) =>
      jsonResponse(() => repository.getProject(oneParam(params.projectId)), undefined, { operationId: 'getProject', request, repository }),
    ),
    http.patch(mswPath('updateProject'), async ({ params, request }) =>
      jsonResponse(
        async () => repository.updateProject(oneParam(params.projectId), (await readJson(request)) as OperationRequest<'updateProject'>),
        undefined,
        { operationId: 'updateProject', request, repository },
      ),
    ),
    http.delete(mswPath('deleteProject'), ({ params, request }) =>
      emptyResponse(() => repository.deleteProject(oneParam(params.projectId)), { operationId: 'deleteProject', request, repository }),
    ),
    http.get(mswPath('listBooks'), ({ params, request }) =>
      jsonResponse(() => repository.listBooks(oneParam(params.projectId), cursorListQuery(request)), undefined, { operationId: 'listBooks', request, repository }),
    ),
    http.post(mswPath('createBook'), async ({ params, request }) =>
      jsonResponse(async () => repository.createBook(oneParam(params.projectId), (await readJson(request)) as OperationRequest<'createBook'>), {
        status: 201,
      }, { operationId: 'createBook', request, repository }),
    ),
    http.get(mswPath('getImportConstraints'), ({ params, request }) =>
      jsonResponse(() => repository.getImportConstraints(oneParam(params.projectId)), undefined, {
        operationId: 'getImportConstraints',
        request,
        repository,
      }),
    ),
    http.post(mswPath('importBookFile'), async ({ params, request }) => {
      return idempotentJsonResponse((options, importBody) => repository.importBookFile(oneParam(params.projectId), importBody as ImportBookInput, options), { status: 202 }, {
        operationId: 'importBookFile',
        request,
        repository,
      }, () => readImportForm(request), idempotencyStore);
    }),
    http.get(mswPath('listProjectJobs'), ({ params, request }) =>
      jsonResponse(() => repository.listProjectJobs(oneParam(params.projectId), projectJobsQuery(request)), undefined, {
        operationId: 'listProjectJobs',
        request,
        repository,
      }),
    ),
    http.post(mswPath('startProjectIndexing'), async ({ params, request }) => {
      return idempotentJsonResponse((options, body) => repository.startProjectIndexing(oneParam(params.projectId), body as OperationRequest<'startProjectIndexing'>, options), {
        status: 202,
      }, { operationId: 'startProjectIndexing', request, repository }, () => readJson(request), idempotencyStore);
    }),
    http.get(mswPath('getJob'), ({ params, request }) =>
      jsonResponse(() => repository.getJob(oneParam(params.jobId)), undefined, { operationId: 'getJob', request, repository }),
    ),
    http.post(mswPath('cancelJob'), ({ params, request }) =>
      jsonResponse(() => repository.cancelJob(oneParam(params.jobId)), undefined, { operationId: 'cancelJob', request, repository }),
    ),
    http.post(mswPath('createBookExport'), async ({ params, request }) => {
      return idempotentJsonResponse((options, body) => repository.createBookExport(oneParam(params.bookId), body as OperationRequest<'createBookExport'>, options), {
        status: 202,
      }, { operationId: 'createBookExport', request, repository }, () => readJson(request), idempotencyStore);
    }),
    http.get(mswPath('getBook'), ({ params, request }) =>
      jsonResponse(() => repository.getBook(oneParam(params.bookId)), undefined, { operationId: 'getBook', request, repository }),
    ),
    http.patch(mswPath('updateBook'), async ({ params, request }) =>
      jsonResponse(async () => repository.updateBook(oneParam(params.bookId), (await readJson(request)) as OperationRequest<'updateBook'>), undefined, {
        operationId: 'updateBook',
        request,
        repository,
      }),
    ),
    http.delete(mswPath('deleteBook'), ({ params, request }) =>
      emptyResponse(() => repository.deleteBook(oneParam(params.bookId)), { operationId: 'deleteBook', request, repository }),
    ),
    http.get(mswPath('listChapters'), ({ params, request }) =>
      jsonResponse(() => repository.listChapters(oneParam(params.bookId), cursorListQuery(request)), undefined, { operationId: 'listChapters', request, repository }),
    ),
    http.post(mswPath('createChapter'), async ({ params, request }) =>
      jsonResponse(async () => repository.createChapter(oneParam(params.bookId), (await readJson(request)) as OperationRequest<'createChapter'>), {
        status: 201,
      }, { operationId: 'createChapter', request, repository }),
    ),
    http.get(mswPath('getChapter'), ({ params, request }) =>
      jsonResponse(() => repository.getChapter(oneParam(params.chapterId)), undefined, { operationId: 'getChapter', request, repository }),
    ),
    http.patch(mswPath('updateChapter'), async ({ params, request }) =>
      jsonResponse(async () => repository.updateChapter(oneParam(params.chapterId), (await readJson(request)) as OperationRequest<'updateChapter'>), undefined, {
        operationId: 'updateChapter',
        request,
        repository,
      }),
    ),
    http.post(mswPath('publishChapter'), async ({ params, request }) =>
      jsonResponse(async () => repository.publishChapter(oneParam(params.chapterId), (await readJson(request)) as OperationRequest<'publishChapter'>), undefined, {
        operationId: 'publishChapter',
        request,
        repository,
      }),
    ),
    http.delete(mswPath('deleteChapter'), ({ params, request }) =>
      emptyResponse(() => repository.deleteChapter(oneParam(params.chapterId)), { operationId: 'deleteChapter', request, repository }),
    ),
    http.get(mswPath('listChapterAnnotations'), ({ params, request }) =>
      jsonResponse(() => repository.listChapterAnnotations(oneParam(params.chapterId), cursorListQuery(request)), undefined, {
        operationId: 'listChapterAnnotations',
        request,
        repository,
      }),
    ),
    http.post(mswPath('createChapterAnnotation'), async ({ params, request }) =>
      jsonResponse(async () =>
        repository.createChapterAnnotation(oneParam(params.chapterId), (await readJson(request)) as OperationRequest<'createChapterAnnotation'>), {
        status: 201,
      }, { operationId: 'createChapterAnnotation', request, repository }),
    ),
    http.patch(mswPath('updateReaderAnnotation'), async ({ params, request }) =>
      jsonResponse(async () =>
        repository.updateReaderAnnotation(oneParam(params.annotationId), (await readJson(request)) as OperationRequest<'updateReaderAnnotation'>),
        undefined,
        { operationId: 'updateReaderAnnotation', request, repository },
      ),
    ),
    http.delete(mswPath('deleteReaderAnnotation'), ({ params, request }) =>
      emptyResponse(() => repository.deleteReaderAnnotation(oneParam(params.annotationId)), {
        operationId: 'deleteReaderAnnotation',
        request,
        repository,
      }),
    ),
    http.get(mswPath('listProjectMembers'), ({ params, request }) =>
      jsonResponse(() => repository.listProjectMembers(oneParam(params.projectId), cursorListQuery(request)), undefined, {
        operationId: 'listProjectMembers',
        request,
        repository,
      }),
    ),
    http.patch(mswPath('updateProjectMemberRole'), async ({ params, request }) => {
      const body = (await readJson(request)) as OperationRequest<'updateProjectMemberRole'>;
      return jsonResponse(() => repository.updateProjectMemberRole(oneParam(params.projectId), oneParam(params.memberId), body), undefined, {
        operationId: 'updateProjectMemberRole',
        request,
        repository,
      });
    }),
    http.delete(mswPath('removeProjectMember'), ({ params, request }) =>
      emptyResponse(async () => {
        await repository.removeProjectMember(oneParam(params.projectId), oneParam(params.memberId));
      }, { operationId: 'removeProjectMember', request, repository }),
    ),
    http.get(mswPath('listProjectInvitations'), ({ params, request }) =>
      jsonResponse(() => repository.listProjectInvitations(oneParam(params.projectId), cursorListQuery(request)), undefined, {
        operationId: 'listProjectInvitations',
        request,
        repository,
      }),
    ),
    http.get(mswPath('listMyProjectInvitations'), ({ request }) =>
      jsonResponse(() => repository.listMyProjectInvitations(cursorListQuery(request)), undefined, {
        operationId: 'listMyProjectInvitations',
        request,
        repository,
      }),
    ),
    http.post(mswPath('createProjectInvitation'), async ({ params, request }) => {
      const body = (await readJson(request)) as OperationRequest<'createProjectInvitation'>;
      return jsonResponse(() => repository.createProjectInvitation(oneParam(params.projectId), body), { status: 201 }, {
        operationId: 'createProjectInvitation',
        request,
        repository,
      });
    }),
    http.post(mswPath('cancelProjectInvitation'), ({ params, request }) =>
      jsonResponse(() => repository.cancelProjectInvitation(oneParam(params.invitationId)), undefined, {
        operationId: 'cancelProjectInvitation',
        request,
        repository,
      }),
    ),
    http.post(mswPath('acceptProjectInvitation'), ({ params, request }) =>
      jsonResponse(() => repository.acceptProjectInvitation(oneParam(params.invitationId)), undefined, {
        operationId: 'acceptProjectInvitation',
        request,
        repository,
      }),
    ),
    http.get(mswPath('listChatSessions'), ({ params, request }) =>
      jsonResponse(() => repository.listChatSessions(oneParam(params.projectId), cursorListQuery(request)), undefined, {
        operationId: 'listChatSessions',
        request,
        repository,
      }),
    ),
    http.post(mswPath('createChatSession'), async ({ params, request }) =>
      jsonResponse(async () => repository.createChatSession(oneParam(params.projectId), (await readJson(request)) as OperationRequest<'createChatSession'>), {
        status: 201,
      }, { operationId: 'createChatSession', request, repository }),
    ),
    http.get(mswPath('getChatSession'), ({ params, request }) =>
      jsonResponse(() => repository.getChatSession(oneParam(params.chatId)), undefined, { operationId: 'getChatSession', request, repository }),
    ),
    http.patch(mswPath('renameChatSession'), async ({ params, request }) =>
      jsonResponse(async () => repository.renameChatSession(oneParam(params.chatId), (await readJson(request)) as OperationRequest<'renameChatSession'>), undefined, {
        operationId: 'renameChatSession',
        request,
        repository,
      }),
    ),
    http.delete(mswPath('deleteChatSession'), ({ params, request }) =>
      emptyResponse(() => repository.deleteChatSession(oneParam(params.chatId)), { operationId: 'deleteChatSession', request, repository }),
    ),
    http.get(mswPath('listChatMessages'), ({ params, request }) =>
      jsonResponse(() => repository.listChatMessages(oneParam(params.chatId), cursorListQuery(request)), undefined, { operationId: 'listChatMessages', request, repository }),
    ),
    http.post(mswPath('createChatTurn'), async ({ params, request }) => {
      return idempotentJsonResponse((options, body) => repository.createChatTurn(oneParam(params.chatId), body as OperationRequest<'createChatTurn'>, options), {
        status: 202,
      }, { operationId: 'createChatTurn', request, repository }, () => readJson(request), idempotencyStore);
    }),
    http.get(mswPath('streamChatTurnEvents'), ({ params, request }) =>
      streamResponse(async () => {
        const url = new URL(request.url);
        return repository.streamChatTurnEvents(oneParam(params.turnId), {
          afterEventId: url.searchParams.get('afterEventId') ?? undefined,
          lastEventId: request.headers.get('Last-Event-ID') ?? undefined,
        });
      }, { operationId: 'streamChatTurnEvents', request, repository }),
    ),
    http.get(mswPath('getChatTurn'), ({ params, request }) =>
      jsonResponse(() => repository.getChatTurn(oneParam(params.turnId)), undefined, { operationId: 'getChatTurn', request, repository }),
    ),
    http.get(mswPath('getChatArtifact'), ({ params, request }) =>
      jsonResponse(() => repository.getChatArtifact(oneParam(params.artifactId)), undefined, { operationId: 'getChatArtifact', request, repository }),
    ),
    http.post(mswPath('searchProject'), async ({ params, request }) => {
      return jsonResponse(async () => {
        const body = (await readJson(request)) as OperationRequest<'searchProject'>;
        const { query, scope, ...options } = body as OperationRequest<'searchProject'> & Record<string, unknown>;
        return repository.searchProject(oneParam(params.projectId), query, scope, options, { allowSignal: false });
      }, undefined, {
        operationId: 'searchProject',
        request,
        repository,
      });
    }),
    http.get(mswPath('listAgentSuggestions'), ({ params, request }) =>
      jsonResponse(() => repository.listAgentSuggestions(oneParam(params.chapterId), agentSuggestionsQuery(request)), undefined, {
        operationId: 'listAgentSuggestions',
        request,
        repository,
      }),
    ),
    http.post(mswPath('startAgentRun'), async ({ params, request }) => {
      return idempotentJsonResponse((options, body) => repository.startAgentRun(oneParam(params.chapterId), body as OperationRequest<'startAgentRun'>, options), {
        status: 202,
      }, { operationId: 'startAgentRun', request, repository }, () => readJson(request), idempotencyStore);
    }),
    http.get(mswPath('getAgentSuggestion'), ({ params, request }) =>
      jsonResponse(() => repository.getAgentSuggestion(oneParam(params.suggestionId)), undefined, {
        operationId: 'getAgentSuggestion',
        request,
        repository,
      }),
    ),
    http.post(mswPath('approveAgentSuggestion'), async ({ params, request }) =>
      jsonResponse(async () =>
        repository.approveAgentSuggestion(oneParam(params.suggestionId), (await readJson(request)) as OperationRequest<'approveAgentSuggestion'>),
        undefined,
        { operationId: 'approveAgentSuggestion', request, repository },
      ),
    ),
    http.post(mswPath('rejectAgentSuggestion'), async ({ params, request }) =>
      jsonResponse(async () => repository.rejectAgentSuggestion(oneParam(params.suggestionId), (await readJson(request)) as OperationRequest<'rejectAgentSuggestion'>), undefined, {
        operationId: 'rejectAgentSuggestion',
        request,
        repository,
      }),
    ),
  ];
}

function csrfHandler(csrfState: MswCsrfState) {
  return http.get(mswPath('getCsrfToken'), () =>
    HttpResponse.json({
      csrfToken: currentMswCsrfTokenValue(csrfState),
      expiresAt: '2026-06-21T18:00:00.000Z',
      rotation: 'refreshed',
    }, { headers: noStoreHeaders() }),
  );
}

function oneParam(value: string | readonly string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

async function jsonResponse<T>(load: () => Promise<T> | T, init?: ResponseInit, security?: MswSecurityContext) {
  try {
    const headers = noStoreHeaders(init?.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(await withMswSecurity(load, security)), { ...init, headers });
  } catch (error) {
    return problemResponse(error);
  }
}

async function idempotentJsonResponse<T>(
  load: (options: { idempotencyKey: string }, requestBody: unknown) => Promise<T> | T,
  init: ResponseInit,
  security: MswSecurityContext,
  requestBody: unknown | (() => Promise<unknown> | unknown),
  store: Map<string, MswIdempotencyRecord>,
) {
  try {
    const cleanup = enterMswSecurity(security);
    try {
      const resolvedRequestBody = typeof requestBody === 'function' ? await requestBody() : requestBody;
      const idempotency = await mswIdempotencyContext(security.request, security.operationId, resolvedRequestBody);
      const existing = store.get(idempotency.key);
      if (existing && existing.fingerprint !== idempotency.fingerprint) {
        throw new MockApiError(409, 'Idempotency-Key was reused with a different request payload.', security.operationId);
      }
      if (existing) {
        const headers = noStoreHeaders(existing.headers);
        headers.set('content-type', 'application/json');
        return new Response(JSON.stringify(existing.body), { status: existing.status, headers });
      }

      const body = await load({ idempotencyKey: idempotency.idempotencyKey }, resolvedRequestBody);
      const status = init.status ?? 200;
      const headers = asyncStartHeaders(body, init.headers);
      store.set(idempotency.key, {
        body,
        fingerprint: idempotency.fingerprint,
        headers: Object.fromEntries(headers.entries()),
        status,
      });
      headers.set('content-type', 'application/json');
      return new Response(JSON.stringify(body), { ...init, headers });
    } finally {
      cleanup();
    }
  } catch (error) {
    return problemResponse(error);
  }
}

async function emptyResponse(load: () => Promise<void> | void, security?: MswSecurityContext, init?: ResponseInit) {
  try {
    await withMswSecurity(load, security);
    return new Response(null, { ...init, status: init?.status ?? 204, headers: noStoreHeaders(init?.headers) });
  } catch (error) {
    return problemResponse(error);
  }
}

async function streamResponse(load: () => Promise<AsyncIterable<ChatTurnEventMessage>>, security?: MswSecurityContext) {
  try {
    const encoder = new TextEncoder();
    const iterator = (await withMswSecurity(load, security))[Symbol.asyncIterator]();
    let pending: IteratorResult<ChatTurnEventMessage> | null = await iterator.next();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = pending ?? await iterator.next();
          pending = null;
          if (next.done) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(sseFrame(next.value)));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    });
    const headers = noStoreHeaders();
    headers.set('content-type', 'text/event-stream');
    return new Response(body, { headers });
  } catch (error) {
    return problemResponse(error);
  }
}

function sseFrame(message: ChatTurnEventMessage) {
  const frames: string[] = [];
  if (message.id) {
    frames.push(`id: ${message.id}\n`);
  }
  if (message.event) {
    frames.push(`event: ${message.event}\n`);
  }
  if (message.retry !== undefined) {
    frames.push(`retry: ${message.retry}\n`);
  }
  frames.push(`data: ${JSON.stringify(message.data)}\n\n`);
  return frames.join('');
}

async function withMswSecurity<T>(load: () => Promise<T> | T, security?: MswSecurityContext) {
  if (!security) {
    return await load();
  }
  const csrfState = csrfStateForSecurity(security);
  const cleanup = enterMswSecurity(security);
  try {
    const result = await load();
    if (rotatesCsrfAfterSuccess(security.operationId) && csrfState) {
      rotateMswCsrfToken(csrfState);
    }
    return result;
  } finally {
    cleanup();
  }
}

function enterMswSecurity(security: MswSecurityContext) {
  const repository = security.repository;
  const previousScenario = repository?.getScenario();
  const sessionActive = security.hasActiveSession?.() ?? repository?.hasActiveSession() ?? true;
  const actorRole = enforceMswRequest(security.operationId, security.request, csrfStateForSecurity(security), sessionActive, previousScenario?.actorRole ?? 'owner');
  if (!security.repository) {
    return () => undefined;
  }
  if (!repository || !previousScenario) {
    return () => undefined;
  }
  repository.setScenario({
    ...previousScenario,
    actorRole,
    ...verifiedEmailScenario(security.request),
  });
  return () => {
    repository.setScenario(previousScenario);
  };
}

function csrfStateForSecurity(security: MswSecurityContext) {
  return security.csrfState ?? (security.repository ? repositoryCsrfStates.get(security.repository) : undefined);
}

function enforceMswRequest(
  operationId: OperationId,
  request: Request,
  csrfState: MswCsrfState | undefined,
  sessionActive: boolean,
  fallbackActorRole: MockActorRole = 'owner',
): MockActorRole {
  if (requiresStrictOrigin(request.method, operationId) && !hasAllowedRequestOrigin(request)) {
    throw new MockApiError(403, 'Strict local Origin is required.', operationId);
  }
  if (!isPublicOperation(operationId) && (!hasSessionCookie(request) || !sessionActive)) {
    throw new MockApiError(401, 'Сессия истекла. Войдите снова.', operationId);
  }
  if (requiresCsrf(request.method)) {
    if (!csrfState || request.headers.get('x-csrf-token') !== currentMswCsrfTokenValue(csrfState)) {
      throw new MockApiError(403, 'CSRF token is missing or invalid.', operationId);
    }
  }
  return readActorRole(request) ?? fallbackActorRole;
}

function isPublicOperation(operationId: OperationId) {
  return operationId === 'getCsrfToken' || operationId === 'registerUser' || operationId === 'loginUser';
}

function requiresCsrf(method: string) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

function requiresStrictOrigin(method: string, operationId: OperationId) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()) || operationId === 'searchProject';
}

function rotatesCsrfAfterSuccess(operationId: OperationId) {
  return operationId === 'registerUser' || operationId === 'loginUser' || operationId === 'logoutUser' || operationId === 'rotateSession';
}

function hasSessionCookie(request: Request) {
  return parseCookies(request.headers.get('cookie'))[sessionCookieName] === sessionCookieValue;
}

function parseCookies(header: string | null) {
  const cookies: Record<string, string> = {};
  for (const segment of header?.split(';') ?? []) {
    const [rawKey, ...rawValue] = segment.trim().split('=');
    if (rawKey && rawValue.length > 0) {
      cookies[rawKey] = rawValue.join('=');
    }
  }
  return cookies;
}

function readActorRole(request: Request): MockActorRole | undefined {
  const raw = request.headers.get('mock_actor_role') ?? request.headers.get('mock-actor-role');
  if (raw === null) {
    return undefined;
  }
  if (raw === 'owner' || raw === 'admin' || raw === 'editor' || raw === 'viewer' || raw === 'non_member') {
    return raw;
  }
  throw new MockApiError(400, 'Invalid mock actor role.', 'listProjects');
}

function verifiedEmailScenario(request: Request): Partial<Pick<MockScenarioControl, 'emailVerified' | 'verifiedEmail'>> {
  const verifiedEmail = request.headers.get('mock-verified-email');
  const emailVerified = request.headers.get('mock-email-verified');
  if (!verifiedEmail && emailVerified === null) {
    return {};
  }
  return {
    ...(emailVerified !== null ? { emailVerified: emailVerified !== 'false' } : {}),
    ...(verifiedEmail ? { verifiedEmail } : {}),
  };
}

function hasAllowedRequestOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return false;
  }
  const origin = request.headers.get('origin');
  if (origin) {
    return isAllowedLocalOrigin(origin);
  }
  const referer = request.headers.get('referer');
  if (referer) {
    return isAllowedLocalOrigin(referer);
  }
  return false;
}

function isAllowedLocalOrigin(origin: string) {
  try {
    return allowedCorsOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function noStoreHeaders(init?: HeadersInit) {
  const headers = new Headers(init);
  headers.set('cache-control', 'no-store');
  return headers;
}

function sessionHeaders(init?: HeadersInit) {
  const headers = noStoreHeaders(init);
  headers.set('set-cookie', `${sessionCookieName}=${sessionCookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionCookieMaxAgeSeconds}`);
  return headers;
}

function clearSessionHeaders(init?: HeadersInit) {
  const headers = noStoreHeaders(init);
  headers.set('set-cookie', `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return headers;
}

function asyncStartHeaders(body: unknown, init?: HeadersInit) {
  const headers = noStoreHeaders(init);
  const jobId = body && typeof body === 'object' && 'jobId' in body ? (body as { jobId?: unknown }).jobId : undefined;
  headers.set('Location', typeof jobId === 'string' ? `/api/v1/jobs/${jobId}` : '/api/v1/jobs');
  headers.set('Retry-After', '1');
  return headers;
}

async function mswIdempotencyContext(request: Request, operationId: OperationId, body: unknown) {
  if (!idempotentOperations.has(operationId)) {
    throw new MockApiError(500, 'MSW idempotency guard used for a non-idempotent operation.', operationId);
  }
  const header = request.headers.get('idempotency-key');
  if (!header) {
    throw new MockApiError(400, 'Idempotency-Key header is required.', operationId);
  }
  validateIdempotencyKey(operationId, header);
  const principal = parseCookies(request.headers.get('cookie'))[sessionCookieName] ?? 'anonymous';
  const pathname = new URL(request.url).pathname;
  return {
    idempotencyKey: header,
    key: `${principal}:${request.method}:${pathname}:${operationId}:${header}`,
    fingerprint: await stableStringify(body),
  };
}

function validateIdempotencyKey(operationId: OperationId, idempotencyKey: string) {
  if (idempotencyKey.length < minIdempotencyKeyLength || idempotencyKey.length > maxIdempotencyKeyLength) {
    throw new MockApiError(400, 'Idempotency-Key must be between 8 and 128 characters.', operationId);
  }
}

async function stableStringify(value: unknown): Promise<string> {
  if (typeof File !== 'undefined' && value instanceof File) {
    return JSON.stringify({ content: await fileContentForFingerprint(value), name: value.name, size: value.size, type: value.type });
  }
  if (Array.isArray(value)) {
    return `[${(await Promise.all(value.map(stableStringify))).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([key, entry]) => `${JSON.stringify(key)}:${await stableStringify(entry)}`));
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

async function fileContentForFingerprint(file: File): Promise<string> {
  const mockContent = (file as FileWithMockContent).mockContent;
  if (typeof mockContent === 'string') {
    return mockContent;
  }
  if ('text' in file && typeof file.text === 'function') {
    return await file.text();
  }
  if ('arrayBuffer' in file && typeof file.arrayBuffer === 'function') {
    return Buffer.from(await file.arrayBuffer()).toString('latin1');
  }
  return '';
}

function problemResponse(error: unknown) {
  const headers = noStoreHeaders({ 'content-type': 'application/problem+json' });
  if (error instanceof MockApiError) {
    if (error.status === 429) {
      headers.set('retry-after', '60');
    }
    const title = titleForStatus(error.status);
    return HttpResponse.json(
      {
        code: error.code ?? problemCode(title),
        detail: error.status === 404 ? 'Resource not found.' : error.message,
        requestId: 'req_msw',
        status: error.status,
        title,
        type: 'about:blank',
      },
      { status: error.status, headers },
    );
  }

  return HttpResponse.json(
    {
      code: 'mock_error',
      detail: error instanceof Error ? error.message : 'Request failed',
      requestId: 'req_msw',
      status: 500,
      title: 'Request failed',
      type: 'about:blank',
    },
    { status: 500, headers },
  );
}

function problemCode(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'mock_error';
}

function titleForStatus(status: number) {
  switch (status) {
    case 400:
      return 'Bad request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not found';
    case 409:
      return 'Conflict';
    case 410:
      return 'Gone';
    case 429:
      return 'Rate limited';
    case 413:
      return 'Payload too large';
    case 415:
      return 'Unsupported media type';
    case 422:
      return 'Unprocessable entity';
    default:
      return status >= 500 ? 'Internal server error' : 'Request failed';
  }
}
