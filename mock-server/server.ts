import { createHash } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  operationManifest,
  type OperationId,
  type OperationRoute,
} from '../src/shared/api/generated/operation-manifest';
import type { ChatTurnEventMessage, OperationParameters, OperationRequest } from '../src/shared/api';
import { MockApiError, type MockActorRole, type MockScenarioControl } from '../src/api/mock/scenarios';
import { createMockApiClient, type MockRepository } from '../src/api/mock/repository';

const apiBasePath = '/api/v1';
const defaultHost = '127.0.0.1';
const defaultPort = 8787;
const sessionCookieName = 'ck_session';
const sessionCookieValue = 'mock-session';
const csrfTokenPrefix = 'ck_mock_csrf_token_';
const sessionCookieMaxAgeSeconds = 43_200;
const maxBodyBytes = 50 * 1024 * 1024;
const minIdempotencyKeyLength = 8;
const maxIdempotencyKeyLength = 128;
const allowedCorsOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
]);

export interface MockApiLogEvent {
  requestId: string;
  method: string;
  path: string;
  operationId?: OperationId;
  status: number;
  durationMs: number;
}

export interface MockApiServerOptions {
  host?: string;
  port?: number;
  logger?: (event: MockApiLogEvent) => void;
}

export interface MockApiServerController {
  readonly server: HttpServer;
  start(): Promise<{ host: string; port: number; url: string }>;
  stop(): Promise<void>;
}

interface OperationContext {
  body: unknown;
  csrfState: CsrfState;
  headers: IncomingHttpHeaders;
  idempotencyKey?: string;
  pathParams: Record<string, string>;
  query: URLSearchParams;
  repository: MockRepository;
}

interface OperationHandlerResult {
  body?: unknown;
  headers?: Record<string, string | string[]>;
  status?: number;
  stream?: AsyncIterable<ChatTurnEventMessage>;
}

type OperationHandler = (context: OperationContext) => Promise<OperationHandlerResult> | OperationHandlerResult;
interface IdempotencyRecord {
  body: unknown;
  fingerprint: string;
  headers?: Record<string, string | string[]>;
  status: number;
}
interface CsrfState {
  tokenVersion: number;
}
type ProjectJobsQuery = NonNullable<OperationParameters<'listProjectJobs'>['query']>;
type CursorListQuery = {
  cursor?: string;
  limit?: number;
};
type AgentSuggestionsQuery = NonNullable<OperationParameters<'listAgentSuggestions'>['query']>;

interface CompiledRoute {
  operationId: OperationId;
  method: string;
  pattern: RegExp;
  pathParams: readonly string[];
}

interface MatchedRoute {
  operationId: OperationId;
  pathParams: Record<string, string>;
}

const successStatuses: Partial<Record<OperationId, number>> = {
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

const publicOperations = new Set<OperationId>(['getCsrfToken', 'registerUser', 'loginUser']);
const idempotentOperations = new Set<OperationId>(['importBookFile', 'createBookExport', 'startProjectIndexing', 'createChatTurn', 'startAgentRun']);

function currentCsrfTokenValue(state: CsrfState) {
  return `${csrfTokenPrefix}${String(state.tokenVersion).padStart(6, '0')}`;
}

function rotateCsrfToken(state: CsrfState) {
  state.tokenVersion += 1;
}

const routes: CompiledRoute[] = (
  Object.entries(operationManifest) as Array<[OperationId, OperationRoute<OperationId>]>
).map(([operationId, route]) => ({
  operationId,
  method: route.method,
  pathParams: route.pathParams,
  pattern: new RegExp(`^${route.path.replace(/\{([^}]+)\}/g, '([^/]+)')}$`),
}));

const handlers = {
  getCsrfToken: ({ csrfState }) => ({
    body: {
      csrfToken: currentCsrfTokenValue(csrfState),
      expiresAt: futureTimestamp(10),
      rotation: 'refreshed',
    },
  }),
  registerUser: async ({ body, repository }) => ({
    body: await repository.register(bodyAs<'registerUser'>(body)),
    headers: sessionHeaders(),
  }),
  loginUser: async ({ body, repository }) => ({
    body: await repository.login(bodyAs<'loginUser'>(body)),
    headers: sessionHeaders(),
  }),
  logoutUser: async ({ repository }) => {
    await repository.logout();
    return { headers: clearSessionHeaders() };
  },
  rotateSession: async ({ repository }) => ({
    body: await repository.rotateSession(),
    headers: sessionHeaders(),
  }),
  getCurrentUser: async ({ repository }) => ({ body: await repository.getCurrentUser() }),
  listProjects: async ({ query, repository }) => ({ body: await repository.listProjects(cursorListQuery(query)) }),
  createProject: async ({ body, repository }) => ({ body: await repository.createProject(bodyAs<'createProject'>(body)) }),
  getProject: async ({ pathParams, repository }) => ({ body: await repository.getProject(param(pathParams, 'projectId')) }),
  updateProject: async ({ body, pathParams, repository }) => ({
    body: await repository.updateProject(param(pathParams, 'projectId'), bodyAs<'updateProject'>(body)),
  }),
  deleteProject: async ({ pathParams, repository }) => {
    await repository.deleteProject(param(pathParams, 'projectId'));
    return {};
  },
  listProjectMembers: async ({ pathParams, query, repository }) => ({
    body: await repository.listProjectMembers(param(pathParams, 'projectId'), cursorListQuery(query)),
  }),
  updateProjectMemberRole: async ({ body, pathParams, repository }) => {
    const projectId = param(pathParams, 'projectId');
    return { body: await repository.updateProjectMemberRole(projectId, param(pathParams, 'memberId'), bodyAs<'updateProjectMemberRole'>(body)) };
  },
  removeProjectMember: async ({ pathParams, repository }) => {
    await repository.removeProjectMember(param(pathParams, 'projectId'), param(pathParams, 'memberId'));
    return {};
  },
  listProjectInvitations: async ({ pathParams, query, repository }) => ({
    body: await repository.listProjectInvitations(param(pathParams, 'projectId'), cursorListQuery(query)),
  }),
  listMyProjectInvitations: async ({ query, repository }) => ({
    body: await repository.listMyProjectInvitations(cursorListQuery(query)),
  }),
  createProjectInvitation: async ({ body, pathParams, repository }) => {
    return { body: await repository.createProjectInvitation(param(pathParams, 'projectId'), bodyAs<'createProjectInvitation'>(body)) };
  },
  cancelProjectInvitation: async ({ pathParams, repository }) => ({ body: await repository.cancelProjectInvitation(param(pathParams, 'invitationId')) }),
  acceptProjectInvitation: async ({ pathParams, repository }) => ({
    body: await repository.acceptProjectInvitation(param(pathParams, 'invitationId')),
  }),
  listBooks: async ({ pathParams, query, repository }) => ({
    body: await repository.listBooks(param(pathParams, 'projectId'), cursorListQuery(query)),
  }),
  createBook: async ({ body, pathParams, repository }) => ({
    body: await repository.createBook(param(pathParams, 'projectId'), bodyAs<'createBook'>(body)),
  }),
  getBook: async ({ pathParams, repository }) => ({ body: await repository.getBook(param(pathParams, 'bookId')) }),
  updateBook: async ({ body, pathParams, repository }) => ({
    body: await repository.updateBook(param(pathParams, 'bookId'), bodyAs<'updateBook'>(body)),
  }),
  deleteBook: async ({ pathParams, repository }) => {
    await repository.deleteBook(param(pathParams, 'bookId'));
    return {};
  },
  getImportConstraints: async ({ pathParams, repository }) => ({
    body: await repository.getImportConstraints(param(pathParams, 'projectId')),
  }),
  importBookFile: async ({ body, idempotencyKey, pathParams, repository }) => {
    const responseBody = await repository.importBookFile(param(pathParams, 'projectId'), bodyAs<'importBookFile'>(body), { idempotencyKey: idempotencyKey ?? '' });
    return { body: responseBody, headers: asyncStartHeaders(responseBody) };
  },
  listProjectJobs: async ({ pathParams, query, repository }) => ({
    body: await repository.listProjectJobs(param(pathParams, 'projectId'), projectJobsQuery(query)),
  }),
  startProjectIndexing: async ({ body, idempotencyKey, pathParams, repository }) => {
    const responseBody = await repository.startProjectIndexing(param(pathParams, 'projectId'), bodyAs<'startProjectIndexing'>(body), { idempotencyKey: idempotencyKey ?? '' });
    return { body: responseBody, headers: asyncStartHeaders(responseBody) };
  },
  getJob: async ({ pathParams, repository }) => ({ body: await repository.getJob(param(pathParams, 'jobId')) }),
  cancelJob: async ({ pathParams, repository }) => ({
    body: await repository.cancelJob(param(pathParams, 'jobId')),
  }),
  createBookExport: async ({ body, idempotencyKey, pathParams, repository }) => {
    const responseBody = await repository.createBookExport(param(pathParams, 'bookId'), bodyAs<'createBookExport'>(body), { idempotencyKey: idempotencyKey ?? '' });
    return { body: responseBody, headers: asyncStartHeaders(responseBody) };
  },
  listChapters: async ({ pathParams, query, repository }) => ({
    body: await repository.listChapters(param(pathParams, 'bookId'), cursorListQuery(query)),
  }),
  createChapter: async ({ body, pathParams, repository }) => ({
    body: await repository.createChapter(param(pathParams, 'bookId'), bodyAs<'createChapter'>(body)),
  }),
  getChapter: async ({ pathParams, repository }) => ({ body: await repository.getChapter(param(pathParams, 'chapterId')) }),
  updateChapter: async ({ body, pathParams, repository }) => ({
    body: await repository.updateChapter(param(pathParams, 'chapterId'), bodyAs<'updateChapter'>(body)),
  }),
  publishChapter: async ({ body, pathParams, repository }) => ({
    body: await repository.publishChapter(param(pathParams, 'chapterId'), bodyAs<'publishChapter'>(body)),
  }),
  deleteChapter: async ({ pathParams, repository }) => {
    await repository.deleteChapter(param(pathParams, 'chapterId'));
    return {};
  },
  listChapterAnnotations: async ({ pathParams, query, repository }) => ({
    body: await repository.listChapterAnnotations(param(pathParams, 'chapterId'), cursorListQuery(query)),
  }),
  createChapterAnnotation: async ({ body, pathParams, repository }) => ({
    body: await repository.createChapterAnnotation(param(pathParams, 'chapterId'), bodyAs<'createChapterAnnotation'>(body)),
  }),
  updateReaderAnnotation: async ({ body, pathParams, repository }) => ({
    body: await repository.updateReaderAnnotation(param(pathParams, 'annotationId'), bodyAs<'updateReaderAnnotation'>(body)),
  }),
  deleteReaderAnnotation: async ({ pathParams, repository }) => {
    await repository.deleteReaderAnnotation(param(pathParams, 'annotationId'));
    return {};
  },
  searchProject: async ({ body, pathParams, repository }) => {
    const search = bodyAs<'searchProject'>(body);
    const { query, scope, ...options } = search as OperationRequest<'searchProject'> & Record<string, unknown>;
    return {
      body: await repository.searchProject(param(pathParams, 'projectId'), query, scope, options, { allowSignal: false }),
    };
  },
  listChatSessions: async ({ pathParams, query, repository }) => ({
    body: await repository.listChatSessions(param(pathParams, 'projectId'), cursorListQuery(query)),
  }),
  createChatSession: async ({ body, pathParams, repository }) => ({
    body: await repository.createChatSession(param(pathParams, 'projectId'), bodyAs<'createChatSession'>(body)),
  }),
  getChatSession: async ({ pathParams, repository }) => ({ body: await repository.getChatSession(param(pathParams, 'chatId')) }),
  renameChatSession: async ({ body, pathParams, repository }) => ({
    body: await repository.renameChatSession(param(pathParams, 'chatId'), bodyAs<'renameChatSession'>(body)),
  }),
  deleteChatSession: async ({ pathParams, repository }) => {
    await repository.deleteChatSession(param(pathParams, 'chatId'));
    return {};
  },
  listChatMessages: async ({ pathParams, query, repository }) => ({
    body: await repository.listChatMessages(param(pathParams, 'chatId'), cursorListQuery(query)),
  }),
  createChatTurn: async ({ body, idempotencyKey, pathParams, repository }) => {
    const responseBody = await repository.createChatTurn(param(pathParams, 'chatId'), bodyAs<'createChatTurn'>(body), { idempotencyKey: idempotencyKey ?? '' });
    return { body: responseBody, headers: asyncStartHeaders(responseBody) };
  },
  getChatTurn: async ({ pathParams, repository }) => ({
    body: await repository.getChatTurn(param(pathParams, 'turnId')),
  }),
  streamChatTurnEvents: ({ headers, pathParams, query, repository }) => ({
    stream: repository.streamChatTurnEvents(param(pathParams, 'turnId'), {
      afterEventId: query.get('afterEventId') ?? undefined,
      lastEventId: singleHeader(headers['last-event-id']),
    }),
  }),
  getChatArtifact: async ({ pathParams, repository }) => ({
    body: await repository.getChatArtifact(param(pathParams, 'artifactId')),
  }),
  startAgentRun: async ({ body, idempotencyKey, pathParams, repository }) => {
    const responseBody = await repository.startAgentRun(param(pathParams, 'chapterId'), bodyAs<'startAgentRun'>(body), { idempotencyKey: idempotencyKey ?? '' });
    return { body: responseBody, headers: asyncStartHeaders(responseBody) };
  },
  listAgentSuggestions: async ({ pathParams, query, repository }) => ({
    body: await repository.listAgentSuggestions(param(pathParams, 'chapterId'), agentSuggestionsQuery(query)),
  }),
  getAgentSuggestion: async ({ pathParams, repository }) => ({
    body: await repository.getAgentSuggestion(param(pathParams, 'suggestionId')),
  }),
  approveAgentSuggestion: async ({ body, pathParams, repository }) => ({
    body: await repository.approveAgentSuggestion(param(pathParams, 'suggestionId'), bodyAs<'approveAgentSuggestion'>(body)),
  }),
  rejectAgentSuggestion: async ({ body, pathParams, repository }) => ({
    body: await repository.rejectAgentSuggestion(param(pathParams, 'suggestionId'), bodyAs<'rejectAgentSuggestion'>(body)),
  }),
} satisfies Partial<Record<OperationId, OperationHandler>>;
const operationHandlers: Partial<Record<OperationId, OperationHandler>> = handlers;

export function createMockApiServer(options: MockApiServerOptions = {}): MockApiServerController {
  const host = options.host ?? defaultHost;
  const port = options.port ?? defaultPort;
  const repository = createMockApiClient();
  const activeSessions = new Set<string>();
  const idempotencyStore = new Map<string, IdempotencyRecord>();
  const csrfState: CsrfState = { tokenVersion: 0 };
  let requestSequence = 0;

  const server = createServer(async (request, response) => {
    const started = performance.now();
    const requestId = `mock-${++requestSequence}`;
    const pathname = request.url ? new URL(request.url, `http://${host}`).pathname : '/';
    let status = 500;
    let operationId: OperationId | undefined;

    try {
      appendCorsHeaders(request, response);

      if (request.method === 'OPTIONS') {
        status = 204;
        response.writeHead(status, {
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers':
            'content-type, x-csrf-token, idempotency-key, last-event-id, mock_return_status, mock-return-status, mock_actor_role, mock-actor-role, mock_verified_email, mock-verified-email, mock_email_verified, mock-email-verified',
        });
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', `http://${host}`);
      const match = matchRequest(request.method ?? 'GET', url.pathname);
      if (!match) {
        status = 404;
        sendProblem(response, status, 'Not found');
        return;
      }

      operationId = match.operationId;
      if (requiresStrictOrigin(request.method ?? 'GET', operationId) && !hasAllowedRequestOrigin(request)) {
        status = 403;
        sendProblem(response, status, 'Forbidden', 'Strict local Origin is required.');
        return;
      }

      if (!publicOperations.has(operationId) && !hasActiveSession(request, activeSessions)) {
        status = 401;
        sendProblem(response, status, 'Unauthorized', 'Mock session is missing.');
        return;
      }

      if (requiresCsrf(request.method ?? 'GET') && !hasValidCsrf(request, csrfState)) {
        status = 403;
        sendProblem(response, status, 'Forbidden', 'Valid CSRF token or strict local Origin is required.');
        return;
      }

      const previousScenario = repository.getScenario();
      const scenarioOverride = readScenarioOverride(request);
      const overrideStatus = readStatusOverride(request);
      if (overrideStatus !== undefined && scenarioOverride.actorRole === undefined) {
        status = overrideStatus;
        sendProblem(response, status, titleForStatus(status), 'Mock status override.');
        return;
      }
      const body = await readRequestBody(request, operationId);
      const idempotency = idempotencyContext(request, operationId, url.pathname, body);
      if (idempotency) {
        const existing = idempotencyStore.get(idempotency.key);
        if (existing && existing.fingerprint !== idempotency.fingerprint) {
          status = 409;
          sendProblem(response, status, 'Conflict', 'Idempotency-Key was reused with a different request payload.');
          return;
        }
        if (existing) {
          status = existing.status;
          sendJson(response, status, existing.body, existing.headers);
          return;
        }
      }
      const handler = operationHandlers[operationId];
      if (!handler) {
        status = 501;
        sendProblem(response, status, 'Not implemented', `Mock handler is not implemented for ${operationId}.`);
        return;
      }
      const hasScenarioOverride = Object.keys(scenarioOverride).length > 0;
      if (hasScenarioOverride) {
        repository.setScenario({ ...previousScenario, ...scenarioOverride });
      }
      const result = await (async () => {
        try {
          return await handler({
            body,
            csrfState,
            pathParams: match.pathParams,
            query: url.searchParams,
            headers: request.headers,
            idempotencyKey: idempotency?.idempotencyKey,
            repository,
          });
        } finally {
          if (hasScenarioOverride) {
            repository.setScenario(previousScenario);
          }
        }
      })();
      status = result.status ?? successStatuses[operationId] ?? 200;
      if (idempotency && !result.stream) {
        idempotencyStore.set(idempotency.key, {
          body: result.body,
          fingerprint: idempotency.fingerprint,
          headers: result.headers,
          status,
        });
      }

      if (operationId === 'registerUser' || operationId === 'loginUser') {
        activeSessions.add(sessionCookieValue);
        rotateCsrfToken(csrfState);
      }
      if (operationId === 'logoutUser') {
        activeSessions.delete(sessionCookieValue);
        rotateCsrfToken(csrfState);
      }
      if (operationId === 'rotateSession') {
        rotateCsrfToken(csrfState);
      }

      if (result.stream) {
        await sendSse(response, result.stream);
        status = 200;
        return;
      }

      sendJson(response, status, result.body, result.headers);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const problem = problemFromError(error);
      status = problem.status;
      sendProblem(response, status, problem.title, problem.detail, problem.code);
    } finally {
      options.logger?.({
        requestId,
        method: request.method ?? 'GET',
        path: pathname,
        operationId,
        status,
        durationMs: Math.round(performance.now() - started),
      });
    }
  });

  return {
    server,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address() as AddressInfo;
          resolve({ host, port: address.port, url: `http://${host}:${address.port}` });
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function matchRequest(method: string, pathname: string): MatchedRoute | null {
  if (!pathname.startsWith(apiBasePath)) {
    return null;
  }
  const apiPath = pathname.slice(apiBasePath.length) || '/';
  for (const route of routes) {
    if (route.method !== method.toUpperCase()) {
      continue;
    }
    const match = route.pattern.exec(apiPath);
    if (!match) {
      continue;
    }
    const pathParams: Record<string, string> = {};
    for (const [index, key] of route.pathParams.entries()) {
      pathParams[key] = decodeURIComponent(match[index + 1] ?? '');
    }
    return { operationId: route.operationId, pathParams };
  }
  return null;
}

function cursorListQuery(query: URLSearchParams): CursorListQuery {
  const result: CursorListQuery = {};
  const limit = query.get('limit');
  const cursor = query.get('cursor');
  if (limit) {
    result.limit = Number(limit);
  }
  if (cursor) {
    result.cursor = cursor;
  }
  return result;
}

function agentSuggestionsQuery(query: URLSearchParams): AgentSuggestionsQuery {
  const result = cursorListQuery(query) as AgentSuggestionsQuery;
  const status = query.get('status');
  const sourceMessageId = query.get('sourceMessageId');
  const batchId = query.get('batchId');
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

function projectJobsQuery(query: URLSearchParams): ProjectJobsQuery {
  const result: ProjectJobsQuery = {};
  const kind = query.get('kind');
  const limit = query.get('limit');
  const cursor = query.get('cursor');
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

function bodyAs<TOperation extends OperationId>(body: unknown): OperationRequest<TOperation> {
  return body as OperationRequest<TOperation>;
}

function param(pathParams: Record<string, string>, key: string) {
  const value = pathParams[key];
  if (!value) {
    throw new MockApiError(400, `Missing path parameter: ${key}`, 'listProjects');
  }
  return value;
}

function futureTimestamp(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function asyncStartHeaders(body: unknown): Record<string, string> {
  const jobId = body && typeof body === 'object' && 'jobId' in body ? (body as { jobId?: unknown }).jobId : undefined;
  return {
    Location: typeof jobId === 'string' ? `${apiBasePath}/jobs/${jobId}` : `${apiBasePath}/jobs`,
    'Retry-After': '1',
  };
}

function sessionHeaders() {
  return {
    'set-cookie': `${sessionCookieName}=${sessionCookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionCookieMaxAgeSeconds}`,
    'cache-control': 'no-store',
  };
}

function clearSessionHeaders() {
  return {
    'set-cookie': `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    'cache-control': 'no-store',
  };
}

function hasActiveSession(request: IncomingMessage, activeSessions: Set<string>) {
  const cookies = parseCookies(singleHeader(request.headers.cookie));
  const value = cookies[sessionCookieName];
  return typeof value === 'string' && activeSessions.has(value);
}

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  for (const segment of header?.split(';') ?? []) {
    const [rawKey, ...rawValue] = segment.trim().split('=');
    if (!rawKey || rawValue.length === 0) {
      continue;
    }
    cookies[rawKey] = rawValue.join('=');
  }
  return cookies;
}

function readStatusOverride(request: IncomingMessage) {
  const raw = singleHeader(request.headers.mock_return_status) ?? singleHeader(request.headers['mock-return-status']);
  if (raw === undefined) {
    return undefined;
  }
  const status = Number(raw);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new MockApiError(400, 'Invalid MOCK_RETURN_STATUS value.', 'listProjects');
  }
  return status;
}

function readActorRole(request: IncomingMessage): MockActorRole | undefined {
  const raw = singleHeader(request.headers.mock_actor_role) ?? singleHeader(request.headers['mock-actor-role']);
  if (raw === undefined) {
    return undefined;
  }
  if (raw === 'owner' || raw === 'admin' || raw === 'editor' || raw === 'viewer' || raw === 'non_member') {
    return raw;
  }
  throw new MockApiError(400, 'Invalid mock actor role.', 'listProjects');
}

function readScenarioOverride(request: IncomingMessage): Partial<Pick<MockScenarioControl, 'actorRole' | 'emailVerified' | 'verifiedEmail'>> {
  const actorRole = readActorRole(request);
  const verifiedEmail = singleHeader(request.headers.mock_verified_email) ?? singleHeader(request.headers['mock-verified-email']);
  const emailVerified = singleHeader(request.headers.mock_email_verified) ?? singleHeader(request.headers['mock-email-verified']);
  return {
    ...(actorRole ? { actorRole } : {}),
    ...(emailVerified !== undefined ? { emailVerified: emailVerified !== 'false' } : {}),
    ...(verifiedEmail ? { verifiedEmail } : {}),
  };
}

function requiresCsrf(method: string) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
    return false;
  }
  return true;
}

function requiresStrictOrigin(method: string, operationId: OperationId) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()) || operationId === 'searchProject';
}

function hasValidCsrf(request: IncomingMessage, state: CsrfState) {
  return singleHeader(request.headers['x-csrf-token']) === currentCsrfTokenValue(state);
}

async function readRequestBody(request: IncomingMessage, operationId: OperationId) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  const raw = await readRawBody(request, operationId);
  if (raw.byteLength === 0) {
    if (operationId === 'importBookFile') {
      throw new MockApiError(422, 'Multipart import requires a file part.', operationId);
    }
    return undefined;
  }

  const contentType = singleHeader(request.headers['content-type']) ?? '';
  if (operationId === 'importBookFile' && !contentType.includes('multipart/form-data')) {
    throw new MockApiError(415, 'Multipart import requires multipart/form-data.', operationId);
  }
  if (contentType.includes('application/json')) {
    return JSON.parse(raw.toString('utf8')) as unknown;
  }

  if (operationId === 'importBookFile' && contentType.includes('multipart/form-data')) {
    const file = extractMultipartFilePart(raw);
    if (!file) {
      throw new MockApiError(422, 'Multipart import requires a file part.', operationId);
    }
    return {
      file,
      metadata: extractMultipartJsonPart(raw, 'metadata', operationId),
      options: extractMultipartJsonPart(raw, 'options', operationId),
    };
  }

  return undefined;
}

async function readRawBody(request: IncomingMessage, operationId: OperationId) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      throw new MockApiError(413, 'Request body is too large.', operationId);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function idempotencyContext(request: IncomingMessage, operationId: OperationId, pathname: string, body: unknown) {
  if (!idempotentOperations.has(operationId)) {
    return null;
  }
  const header = singleHeader(request.headers['idempotency-key']);
  if (!header) {
    throw new MockApiError(400, 'Idempotency-Key header is required.', operationId);
  }
  validateIdempotencyKey(operationId, header);
  const principal = hashString(parseCookies(singleHeader(request.headers.cookie))[sessionCookieName] ?? 'anonymous');
  return {
    idempotencyKey: header,
    key: `${principal}:${request.method ?? 'GET'}:${pathname}:${operationId}:${header}`,
    fingerprint: stableStringify(body),
  };
}

function validateIdempotencyKey(operationId: OperationId, idempotencyKey: string) {
  if (idempotencyKey.length < minIdempotencyKeyLength || idempotencyKey.length > maxIdempotencyKeyLength) {
    throw new MockApiError(400, 'Idempotency-Key must be between 8 and 128 characters.', operationId);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function extractMultipartFilePart(raw: Buffer) {
  const text = raw.toString('latin1');
  const match = /Content-Disposition:[^\r\n]*name="file"[^\r\n]*filename="([^"]+)"[^\r\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*?)(?=\r?\n--)/i.exec(text);
  if (!match) {
    return undefined;
  }
  const headers = match[2] ?? '';
  const content = Buffer.from(match[3] ?? '', 'latin1');
  const contentType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? null;
  return {
    name: match[1],
    contentType,
    sizeBytes: content.byteLength,
    sha256: hashBuffer(content),
  };
}

function extractMultipartJsonPart(raw: Buffer, name: string, operationId: OperationId) {
  const text = raw.toString('latin1');
  const match = new RegExp(`Content-Disposition:[^\\r\\n]*name="${name}"[^\\r\\n]*(?:\\r?\\n(?!\\r?\\n)[^\\r\\n]*)*\\r?\\n\\r?\\n([\\s\\S]*?)(?=\\r?\\n--)`, 'i').exec(text);
  if (!match) {
    return undefined;
  }
  const part = match[1] ?? '';
  try {
    return JSON.parse(Buffer.from(part, 'latin1').toString('utf8').trim()) as unknown;
  } catch {
    throw new MockApiError(400, `Malformed multipart JSON part: ${name}.`, operationId);
  }
}

function appendCorsHeaders(request: IncomingMessage, response: ServerResponse) {
  const origin = singleHeader(request.headers.origin);
  if (!origin || !isAllowedLocalOrigin(origin)) {
    return;
  }
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('vary', 'Origin');
}

function hasAllowedRequestOrigin(request: IncomingMessage) {
  const fetchSite = singleHeader(request.headers['sec-fetch-site']);
  if (fetchSite === 'cross-site') {
    return false;
  }
  const origin = singleHeader(request.headers.origin);
  if (origin) {
    return isAllowedLocalOrigin(origin);
  }
  const referer = singleHeader(request.headers.referer);
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

function hashString(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hashBuffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
) {
  response.setHeader('cache-control', 'no-store');
  for (const [key, value] of Object.entries(headers)) {
    response.setHeader(key, value);
  }
  if (status === 204) {
    response.writeHead(status);
    response.end();
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sendProblem(response: ServerResponse, status: number, title: string, detail?: string, code?: string) {
  response.setHeader('cache-control', 'no-store');
  if (status === 429) {
    response.setHeader('retry-after', '60');
  }
  response.writeHead(status, { 'content-type': 'application/problem+json; charset=utf-8' });
  response.end(JSON.stringify({
    type: 'about:blank',
    title,
    status,
    detail,
    code: code ?? problemCode(title),
    requestId: 'req_mock',
  }));
}

async function sendSse(response: ServerResponse, stream: AsyncIterable<ChatTurnEventMessage>) {
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  response.writeHead(200, {
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
  });
  response.write(': keepalive\n\n');

  if (!first.done) {
    writeSseMessage(response, first.value);
  }

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      break;
    }
    writeSseMessage(response, next.value);
  }
  response.end();
}

function writeSseMessage(response: ServerResponse, message: ChatTurnEventMessage) {
  if (message.id) {
    response.write(`id: ${message.id}\n`);
  }
  if (message.event) {
    response.write(`event: ${message.event}\n`);
  }
  if (message.retry !== undefined) {
    response.write(`retry: ${message.retry}\n`);
  }
  response.write(`data: ${JSON.stringify(message.data)}\n\n`);
}

function problemCode(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'mock_error';
}

function problemFromError(error: unknown) {
  if (error instanceof MockApiError) {
    return {
      code: error.code,
      detail: error.status === 404 ? 'Resource not found.' : error.message,
      status: error.status,
      title: titleForStatus(error.status),
    };
  }
  if (error instanceof SyntaxError) {
    return { status: 400, title: 'Bad request', detail: 'Invalid JSON body.' };
  }
  return { status: 500, title: 'Internal server error', detail: 'Mock API failed.' };
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

function singleHeader(header: string | string[] | undefined) {
  return Array.isArray(header) ? header[0] : header;
}
