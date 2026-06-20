import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  operationManifest,
  type OperationId,
  type OperationRoute,
} from '../src/shared/api/generated/operation-manifest';
import type { LlmStreamEvent, OperationRequest, SearchScope } from '../src/shared/api';
import { MockApiError } from '../src/api/mock/scenarios';
import { createMockApiClient, type MockRepository } from '../src/api/mock/repository';

const apiBasePath = '/api/v1';
const defaultHost = '127.0.0.1';
const defaultPort = 8787;
const sessionCookieName = 'ck_session';
const sessionCookieValue = 'mock-session';
const maxBodyBytes = 1_000_000;

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
  pathParams: Record<string, string>;
  query: URLSearchParams;
  repository: MockRepository;
}

interface OperationHandlerResult {
  body?: unknown;
  headers?: Record<string, string | string[]>;
  status?: number;
  stream?: AsyncIterable<LlmStreamEvent>;
}

type OperationHandler = (context: OperationContext) => Promise<OperationHandlerResult> | OperationHandlerResult;

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
  createBookExport: 202,
  createChapter: 201,
  createChapterAnnotation: 201,
  createChatSession: 201,
  requestAgentSuggestion: 201,
  logoutUser: 204,
  deleteProject: 204,
  deleteBook: 204,
  deleteChapter: 204,
  deleteReaderAnnotation: 204,
  deleteChatSession: 204,
};

const publicOperations = new Set<OperationId>(['registerUser', 'loginUser']);

const routes: CompiledRoute[] = (
  Object.entries(operationManifest) as Array<[OperationId, OperationRoute<OperationId>]>
).map(([operationId, route]) => ({
  operationId,
  method: route.method,
  pathParams: route.pathParams,
  pattern: new RegExp(`^${route.path.replace(/\{([^}]+)\}/g, '([^/]+)')}$`),
}));

const handlers = {
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
  getCurrentUser: async ({ repository }) => ({ body: await repository.getCurrentUser() }),
  listProjects: async ({ repository }) => ({ body: await repository.listProjects() }),
  createProject: async ({ body, repository }) => ({ body: await repository.createProject(bodyAs<'createProject'>(body)) }),
  getProject: async ({ pathParams, repository }) => ({ body: await repository.getProject(param(pathParams, 'projectId')) }),
  updateProject: async ({ body, pathParams, repository }) => ({
    body: await repository.updateProject(param(pathParams, 'projectId'), bodyAs<'updateProject'>(body)),
  }),
  deleteProject: async ({ pathParams, repository }) => {
    await repository.deleteProject(param(pathParams, 'projectId'));
    return {};
  },
  listBooks: async ({ pathParams, repository }) => ({ body: await repository.listBooks(param(pathParams, 'projectId')) }),
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
  importBookFile: async ({ body, pathParams, repository }) => ({
    body: await repository.importBookFile(param(pathParams, 'projectId'), bodyAs<'importBookFile'>(body)),
  }),
  listIndexingJobs: async ({ pathParams, repository }) => ({
    body: await repository.listIndexingJobs(param(pathParams, 'projectId')),
  }),
  getIndexingJob: async ({ pathParams, repository }) => ({ body: await repository.getIndexingJob(param(pathParams, 'jobId')) }),
  cancelIndexingJob: async ({ pathParams, repository }) => ({
    body: await repository.cancelIndexingJob(param(pathParams, 'jobId')),
  }),
  createBookExport: async ({ body, pathParams, repository }) => ({
    body: await repository.createBookExport(param(pathParams, 'bookId'), bodyAs<'createBookExport'>(body)),
  }),
  getExportJob: async ({ pathParams, repository }) => ({
    body: await repository.getExportJob(param(pathParams, 'exportJobId')),
  }),
  listChapters: async ({ pathParams, repository }) => ({ body: await repository.listChapters(param(pathParams, 'bookId')) }),
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
  listChapterAnnotations: async ({ pathParams, repository }) => ({
    body: await repository.listChapterAnnotations(param(pathParams, 'chapterId')),
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
  searchProject: async ({ pathParams, query, repository }) => ({
    body: await repository.searchProject(
      param(pathParams, 'projectId'),
      query.get('q') ?? '',
      (query.get('scope') as SearchScope | null) ?? undefined,
    ),
  }),
  listChatSessions: async ({ pathParams, repository }) => ({
    body: await repository.listChatSessions(param(pathParams, 'projectId')),
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
  listChatMessages: async ({ pathParams, repository }) => ({
    body: await repository.listChatMessages(param(pathParams, 'chatId')),
  }),
  sendChatMessage: ({ body, pathParams, repository }) => ({
    stream: repository.sendChatMessage(param(pathParams, 'chatId'), bodyAs<'sendChatMessage'>(body)),
  }),
  getChatArtifact: async ({ pathParams, repository }) => ({
    body: await repository.getChatArtifact(param(pathParams, 'artifactId')),
  }),
  listAgentSuggestions: async ({ pathParams, repository }) => ({
    body: await repository.listAgentSuggestions(param(pathParams, 'chapterId')),
  }),
  requestAgentSuggestion: async ({ body, pathParams, repository }) => ({
    body: await repository.requestAgentSuggestion(param(pathParams, 'chapterId'), bodyAs<'requestAgentSuggestion'>(body)),
  }),
  getAgentSuggestion: async ({ pathParams, repository }) => ({
    body: await repository.getAgentSuggestion(param(pathParams, 'suggestionId')),
  }),
  approveAgentSuggestion: async ({ body, pathParams, repository }) => ({
    body: await repository.approveAgentSuggestion(param(pathParams, 'suggestionId'), bodyAs<'approveAgentSuggestion'>(body)),
  }),
  rejectAgentSuggestion: async ({ pathParams, repository }) => ({
    body: await repository.rejectAgentSuggestion(param(pathParams, 'suggestionId')),
  }),
} satisfies Record<OperationId, OperationHandler>;
const operationHandlers: Record<OperationId, OperationHandler> = handlers;

export function createMockApiServer(options: MockApiServerOptions = {}): MockApiServerController {
  const host = options.host ?? defaultHost;
  const port = options.port ?? defaultPort;
  const repository = createMockApiClient();
  const activeSessions = new Set<string>();
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
          'access-control-allow-headers': 'content-type, mock_return_status, mock-return-status',
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
      const overrideStatus = readStatusOverride(request);
      if (overrideStatus !== undefined) {
        status = overrideStatus;
        sendProblem(response, status, titleForStatus(status), 'Mock status override.');
        return;
      }

      if (!publicOperations.has(operationId) && !hasActiveSession(request, activeSessions)) {
        status = 401;
        sendProblem(response, status, 'Unauthorized', 'Mock session is missing.');
        return;
      }

      const body = await readRequestBody(request, operationId);
      const handler = operationHandlers[operationId];
      const result = await handler({
        body,
        pathParams: match.pathParams,
        query: url.searchParams,
        repository,
      });
      status = result.status ?? successStatuses[operationId] ?? 200;

      if (operationId === 'registerUser' || operationId === 'loginUser') {
        activeSessions.add(sessionCookieValue);
      }
      if (operationId === 'logoutUser') {
        activeSessions.delete(sessionCookieValue);
      }

      if (result.stream) {
        await sendSse(response, result.stream);
        status = 200;
        return;
      }

      sendJson(response, status, result.body, result.headers);
    } catch (error) {
      const problem = problemFromError(error);
      status = problem.status;
      sendProblem(response, status, problem.title, problem.detail);
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
  const apiPath = pathname.startsWith(apiBasePath) ? pathname.slice(apiBasePath.length) || '/' : pathname;
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

function sessionHeaders() {
  return {
    'set-cookie': `${sessionCookieName}=${sessionCookieValue}; Path=/; HttpOnly; SameSite=Lax`,
  };
}

function clearSessionHeaders() {
  return {
    'set-cookie': `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
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

async function readRequestBody(request: IncomingMessage, operationId: OperationId) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  const raw = await readRawBody(request);
  if (!raw) {
    return undefined;
  }

  const contentType = singleHeader(request.headers['content-type']) ?? '';
  if (contentType.includes('application/json')) {
    return JSON.parse(raw) as unknown;
  }

  if (operationId === 'importBookFile' && contentType.includes('multipart/form-data')) {
    return { file: extractMultipartFileName(raw) ?? 'mock-upload.epub' };
  }

  return undefined;
}

async function readRawBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      throw new MockApiError(413, 'Request body is too large.', 'listProjects');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function extractMultipartFileName(raw: string) {
  return /filename="([^"]+)"/.exec(raw)?.[1];
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

function isAllowedLocalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
) {
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

function sendProblem(response: ServerResponse, status: number, title: string, detail?: string) {
  sendJson(response, status, {
    type: 'about:blank',
    title,
    status,
    detail,
  });
}

async function sendSse(response: ServerResponse, stream: AsyncIterable<LlmStreamEvent>) {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
  });
  response.write(': keepalive\n\n');
  for await (const event of stream) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
}

function problemFromError(error: unknown) {
  if (error instanceof MockApiError) {
    return { status: error.status, title: titleForStatus(error.status), detail: error.message };
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
    case 413:
      return 'Payload too large';
    case 422:
      return 'Unprocessable entity';
    default:
      return status >= 500 ? 'Internal server error' : 'Request failed';
  }
}

function singleHeader(header: string | string[] | undefined) {
  return Array.isArray(header) ? header[0] : header;
}
