import createClient, { type Client } from 'openapi-fetch';
import type { components, operations, paths } from './generated/openapi';
import { operationManifest, type OperationId } from './generated/operation-manifest';
import { parseSseMessages, type SseMessage } from './sse';

export type { OperationId };
export type OperationManifestRoute = (typeof operationManifest)[OperationId];

export function getOperationManifestEntries(): ReadonlyArray<readonly [OperationId, OperationManifestRoute]> {
  return Object.entries(operationManifest) as Array<[OperationId, OperationManifestRoute]>;
}

type ResponseMap<TOperation extends OperationId> = operations[TOperation]['responses'];
type NumericStatus<TStatus> = TStatus extends `${infer TNumber extends number}` ? TNumber : TStatus;
type ResponseStatus<TOperation extends OperationId, TStatus> =
  NumericStatus<TStatus> extends keyof ResponseMap<TOperation> ? NumericStatus<TStatus> : never;
type ResponseContent<TResponse> = TResponse extends { content: infer TContent }
  ? TContent extends { 'application/json': infer TJson }
    ? TJson
    : TContent extends { 'text/event-stream': infer TStream }
      ? TStream
      : undefined
  : undefined;
type RequestContent<TRequestBody> = TRequestBody extends { content: infer TContent }
  ? TContent extends { 'application/json': infer TJson }
    ? TJson
    : TContent extends { 'multipart/form-data': infer TForm }
      ? TForm
      : undefined
  : undefined;
type RequestBodyContent<TRequestBody> = [TRequestBody] extends [never]
  ? undefined
  : RequestContent<NonNullable<TRequestBody>>;

export type OperationResponses<TOperation extends OperationId> = {
  [TStatus in keyof ResponseMap<TOperation> as TStatus extends string | number ? TStatus : never]: ResponseContent<
    ResponseMap<TOperation>[TStatus]
  >;
} & {
  [TStatus in keyof ResponseMap<TOperation> as TStatus extends string | number ? `${TStatus}` : never]: ResponseContent<
    ResponseMap<TOperation>[TStatus]
  >;
};
export type OperationResponse<TOperation extends OperationId, TStatus extends string | number> = ResponseContent<
  ResponseMap<TOperation>[ResponseStatus<TOperation, TStatus>]
>;
export type OperationRequest<TOperation extends OperationId> = operations[TOperation] extends {
  requestBody?: infer TRequestBody;
}
  ? RequestBodyContent<TRequestBody>
  : undefined;
export type OperationParameters<TOperation extends OperationId> = operations[TOperation] extends {
  parameters: infer TParameters;
}
  ? TParameters
  : never;

export type SchemaName = keyof components['schemas'];
export type Schema<TName extends SchemaName> = components['schemas'][TName];
export type Project = Schema<'Project'>;
export type ProjectMembership = Schema<'ProjectMembership'>;
export type Book = Schema<'Book'>;
export type Chapter = Schema<'Chapter'>;
export type ReaderLocator = Schema<'ReaderLocator'>;
export type ReaderReferenceLocator = Schema<'ReaderReferenceLocator'>;
export type ReaderAnnotation = Schema<'ReaderAnnotation'>;
export type ChatSession = Schema<'ChatSession'>;
export type ChatMessage = Schema<'ChatMessage'>;
export type ChatArtifact = Schema<'ChatArtifact'>;
export type AgentSuggestion = Schema<'AgentSuggestion'>;
export type ApiProblem = Schema<'Problem'>;
export type ChatMessagePart = Schema<'ChatMessagePart'>;
export type SearchScope = Schema<'SearchScope'>;
export type Job = Schema<'Job'>;
export type JobStartResponse = Schema<'JobStartResponse'>;
export type AgentRunStartResponse = Schema<'AgentRunStartResponse'>;
export type ChatTurnEventEnvelope = Schema<'ChatTurnEventEnvelope'>;
export type ChatTurnEventMessage = SseMessage<ChatTurnEventEnvelope>;

type ApiFetch = (request: Request) => Promise<Response>;
type OpenApiFetchResult = {
  data?: unknown;
  error?: unknown;
  response: Response;
};
type OpenApiFetchRequest = (
  method: Lowercase<(typeof operationManifest)[OperationId]['method']>,
  path: keyof paths,
  init?: { params?: unknown; body?: unknown; signal?: AbortSignal },
) => Promise<OpenApiFetchResult>;
type OperationInit<TOperation extends OperationId> = {
  params?: unknown;
  body?: OperationRequest<TOperation>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};
type MultipartFileLike = {
  arrayBuffer?: () => Promise<ArrayBuffer>;
  name?: string;
  stream?: () => ReadableStream<Uint8Array>;
  text?: () => Promise<string>;
  type?: string;
};

export interface ApiRequestOptions {
  signal?: AbortSignal;
  afterEventId?: string;
  idempotencyKey?: string;
  lastEventId?: string;
}

export type RequiredIdempotencyOptions = ApiRequestOptions & {
  idempotencyKey: string;
};

/** Real file upload input for `importBookFile`; serialized as multipart/form-data per the contract. */
export interface ImportBookInput {
  file: File;
  metadata?: NonNullable<OperationRequest<'importBookFile'>>['metadata'];
  options?: NonNullable<OperationRequest<'importBookFile'>>['options'];
}

export type SearchProjectOptions = Partial<Pick<NonNullable<OperationRequest<'searchProject'>>, 'cursor' | 'filters' | 'limit'>> &
  Pick<ApiRequestOptions, 'signal'>;
type OperationQueryParameters<TOperation extends OperationId> = OperationParameters<TOperation> extends { query?: infer TQuery }
  ? NonNullable<TQuery>
  : never;
export type CursorListOptions<TOperation extends OperationId> = OperationQueryParameters<TOperation> &
  Pick<ApiRequestOptions, 'signal'>;
export type ListOptions = {
  cursor?: string | null;
  limit?: number;
} & Pick<ApiRequestOptions, 'signal'>;
export type ListAgentSuggestionsOptions = CursorListOptions<'listAgentSuggestions'>;
export type ListProjectJobsOptions = OperationQueryParameters<'listProjectJobs'> & Pick<ApiRequestOptions, 'signal'>;

export interface ApiClient {
  request<TOperation extends OperationId, TStatus extends keyof OperationResponses<TOperation>>(
    operationId: TOperation,
    init?: OperationInit<TOperation>,
  ): Promise<OperationResponses<TOperation>[TStatus]>;
}

export interface CanonKeeperApiClient {
  register(body: OperationRequest<'registerUser'>): Promise<OperationResponse<'registerUser', '201'>>;
  login(body: OperationRequest<'loginUser'>): Promise<OperationResponse<'loginUser', '200'>>;
  logout(): Promise<void>;
  rotateSession(): Promise<OperationResponse<'rotateSession', '200'>>;
  getCurrentUser(options?: ApiRequestOptions): Promise<OperationResponse<'getCurrentUser', '200'>>;
  listProjects(options?: CursorListOptions<'listProjects'>): Promise<OperationResponse<'listProjects', '200'>>;
  createProject(body: OperationRequest<'createProject'>): Promise<OperationResponse<'createProject', '201'>>;
  getProject(projectId: string): Promise<OperationResponse<'getProject', '200'>>;
  updateProject(projectId: string, body: OperationRequest<'updateProject'>): Promise<OperationResponse<'updateProject', '200'>>;
  deleteProject(projectId: string): Promise<void>;
  listProjectMembers(projectId: string, options?: CursorListOptions<'listProjectMembers'>): Promise<OperationResponse<'listProjectMembers', '200'>>;
  updateProjectMemberRole(projectId: string, memberId: string, body: OperationRequest<'updateProjectMemberRole'>): Promise<OperationResponse<'updateProjectMemberRole', '200'>>;
  removeProjectMember(projectId: string, memberId: string): Promise<void>;
  listProjectInvitations(projectId: string, options?: CursorListOptions<'listProjectInvitations'>): Promise<OperationResponse<'listProjectInvitations', '200'>>;
  listMyProjectInvitations(options?: CursorListOptions<'listMyProjectInvitations'>): Promise<OperationResponse<'listMyProjectInvitations', '200'>>;
  createProjectInvitation(projectId: string, body: OperationRequest<'createProjectInvitation'>): Promise<OperationResponse<'createProjectInvitation', '201'>>;
  cancelProjectInvitation(invitationId: string): Promise<OperationResponse<'cancelProjectInvitation', '200'>>;
  acceptProjectInvitation(invitationId: string): Promise<OperationResponse<'acceptProjectInvitation', '200'>>;
  listBooks(projectId: string, options?: CursorListOptions<'listBooks'>): Promise<OperationResponse<'listBooks', '200'>>;
  createBook(projectId: string, body: OperationRequest<'createBook'>): Promise<OperationResponse<'createBook', '201'>>;
  getBook(bookId: string): Promise<OperationResponse<'getBook', '200'>>;
  updateBook(bookId: string, body: OperationRequest<'updateBook'>): Promise<OperationResponse<'updateBook', '200'>>;
  deleteBook(bookId: string): Promise<void>;
  getImportConstraints(projectId: string): Promise<OperationResponse<'getImportConstraints', '200'>>;
  importBookFile(projectId: string, input: ImportBookInput, options: RequiredIdempotencyOptions): Promise<OperationResponse<'importBookFile', '202'>>;
  listProjectJobs(projectId: string, options?: ListProjectJobsOptions): Promise<OperationResponse<'listProjectJobs', '200'>>;
  startProjectIndexing(projectId: string, body: OperationRequest<'startProjectIndexing'>, options: RequiredIdempotencyOptions): Promise<OperationResponse<'startProjectIndexing', '202'>>;
  getJob(jobId: string): Promise<OperationResponse<'getJob', '200'>>;
  cancelJob(jobId: string): Promise<OperationResponse<'cancelJob', '200'>>;
  createBookExport(bookId: string, body: OperationRequest<'createBookExport'>, options: RequiredIdempotencyOptions): Promise<OperationResponse<'createBookExport', '202'>>;
  listChapters(bookId: string, options?: CursorListOptions<'listChapters'>): Promise<OperationResponse<'listChapters', '200'>>;
  createChapter(bookId: string, body: OperationRequest<'createChapter'>): Promise<OperationResponse<'createChapter', '201'>>;
  getChapter(chapterId: string): Promise<OperationResponse<'getChapter', '200'>>;
  updateChapter(chapterId: string, body: OperationRequest<'updateChapter'>): Promise<OperationResponse<'updateChapter', '200'>>;
  publishChapter(chapterId: string, body: OperationRequest<'publishChapter'>): Promise<OperationResponse<'publishChapter', '200'>>;
  deleteChapter(chapterId: string): Promise<void>;
  listChapterAnnotations(chapterId: string, options?: CursorListOptions<'listChapterAnnotations'>): Promise<OperationResponse<'listChapterAnnotations', '200'>>;
  createChapterAnnotation(
    chapterId: string,
    body: OperationRequest<'createChapterAnnotation'>,
  ): Promise<OperationResponse<'createChapterAnnotation', '201'>>;
  updateReaderAnnotation(
    annotationId: string,
    body: OperationRequest<'updateReaderAnnotation'>,
  ): Promise<OperationResponse<'updateReaderAnnotation', '200'>>;
  deleteReaderAnnotation(annotationId: string): Promise<void>;
  searchProject(projectId: string, query: string, scope?: SearchScope, options?: SearchProjectOptions): Promise<OperationResponse<'searchProject', '200'>>;
  listChatSessions(projectId: string, options?: CursorListOptions<'listChatSessions'>): Promise<OperationResponse<'listChatSessions', '200'>>;
  createChatSession(projectId: string, body: OperationRequest<'createChatSession'>): Promise<OperationResponse<'createChatSession', '201'>>;
  getChatSession(chatId: string): Promise<OperationResponse<'getChatSession', '200'>>;
  renameChatSession(chatId: string, body: OperationRequest<'renameChatSession'>): Promise<OperationResponse<'renameChatSession', '200'>>;
  deleteChatSession(chatId: string): Promise<void>;
  listChatMessages(chatId: string, options?: CursorListOptions<'listChatMessages'>): Promise<OperationResponse<'listChatMessages', '200'>>;
  createChatTurn(chatId: string, body: OperationRequest<'createChatTurn'>, options: RequiredIdempotencyOptions): Promise<OperationResponse<'createChatTurn', '202'>>;
  getChatTurn(turnId: string): Promise<OperationResponse<'getChatTurn', '200'>>;
  streamChatTurnEvents(turnId: string, options?: ApiRequestOptions): AsyncIterable<ChatTurnEventMessage>;
  getChatArtifact(artifactId: string): Promise<OperationResponse<'getChatArtifact', '200'>>;
  listAgentSuggestions(chapterId: string, options?: ListAgentSuggestionsOptions): Promise<OperationResponse<'listAgentSuggestions', '200'>>;
  startAgentRun(chapterId: string, body: OperationRequest<'startAgentRun'>, options: RequiredIdempotencyOptions): Promise<OperationResponse<'startAgentRun', '202'>>;
  getAgentSuggestion(suggestionId: string): Promise<OperationResponse<'getAgentSuggestion', '200'>>;
  approveAgentSuggestion(
    suggestionId: string,
    body: OperationRequest<'approveAgentSuggestion'>,
  ): Promise<OperationResponse<'approveAgentSuggestion', '200'>>;
  rejectAgentSuggestion(
    suggestionId: string,
    body: OperationRequest<'rejectAgentSuggestion'>,
  ): Promise<OperationResponse<'rejectAgentSuggestion', '200'>>;
}

export class ApiStatusError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ApiProblem,
    readonly response: Response,
  ) {
    super(problem.title || `Request failed with ${status}`);
    this.name = 'ApiStatusError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NetworkApiError extends Error {
  constructor(readonly cause: unknown) {
    super('Network request failed.');
    this.name = 'NetworkApiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface CanonKeeperApiClientOptions {
  baseUrl?: string;
  fetch?: ApiFetch;
}

function defaultBaseUrl() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL ?? '/api/v1';
}

function problemFromError(error: unknown, status: number): ApiProblem {
  if (error && typeof error === 'object') {
    return error as ApiProblem;
  }

  return {
    type: 'about:blank',
    title: 'Request failed',
    status,
    detail: typeof error === 'string' ? error : undefined,
    code: 'request_failed',
    requestId: 'req_unavailable',
  };
}

function joinUrl(baseUrl: string, apiPath: string) {
  return `${baseUrl.replace(/\/$/, '')}${apiPath}`;
}

function applyPathParams(apiPath: string, pathParams: Record<string, string | number | boolean>) {
  return apiPath.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = pathParams[key];
    if (value === undefined) {
      throw new Error(`Missing path parameter: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

async function encodeMultipartForm(form: FormData) {
  const boundary = `----canonkeeper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const appendText = (value: string) => chunks.push(encoder.encode(value));

  for (const [name, value] of form as unknown as Iterable<[string, FormDataEntryValue]>) {
    appendText(`--${boundary}\r\n`);
    if (isFileLike(value)) {
      const file = value as MultipartFileLike;
      const filename = multipartQuoted(file.name ?? 'upload.bin');
      const contentType = file.type || 'application/octet-stream';
      appendText(`Content-Disposition: form-data; name="${multipartQuoted(name)}"; filename="${filename}"\r\n`);
      appendText(`Content-Type: ${contentType}\r\n\r\n`);
      chunks.push(await fileBytes(file));
      appendText('\r\n');
    } else {
      appendText(`Content-Disposition: form-data; name="${multipartQuoted(name)}"\r\n\r\n${value}\r\n`);
    }
  }
  appendText(`--${boundary}--\r\n`);

  return {
    body: concatBytes(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function isFileLike(value: FormDataEntryValue) {
  return typeof value === 'object' && value !== null && (typeof (value as { name?: unknown }).name === 'string' || Object.prototype.toString.call(value) === '[object File]');
}

async function fileBytes(value: MultipartFileLike) {
  if (typeof value.arrayBuffer === 'function') {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (typeof value.stream === 'function') {
    const chunks: Uint8Array[] = [];
    const reader = value.stream().getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(chunk);
    }
    return concatBytes(chunks);
  }
  if (typeof value.text === 'function') {
    return new TextEncoder().encode(await value.text());
  }
  return new Uint8Array();
}

function multipartQuoted(value: string) {
  return value.replace(/["\r\n]/g, '_');
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

const csrfHeaderName = 'X-CSRF-Token';
const idempotencyHeaderName = 'Idempotency-Key';

function idempotencyHeaders(options: RequiredIdempotencyOptions | undefined, operationId: OperationId): Record<string, string> {
  const key = options?.idempotencyKey;
  if (!key) {
    throw new Error(`${operationId} requires an Idempotency-Key.`);
  }
  return { [idempotencyHeaderName]: key };
}

export function createIdempotencyKey(operationId: OperationId) {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${operationId}:${randomPart}`;
}

function needsCsrf(operationId: OperationId, method: string, headers: Record<string, string>) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !headers[csrfHeaderName];
}

function withContractHeaders(operationId: OperationId, method: string, params: unknown, headers: Record<string, string> = {}, csrfToken?: string) {
  const nextParams = params && typeof params === 'object' ? { ...(params as Record<string, unknown>) } : {};
  const nextHeaders = { ...((nextParams.header as Record<string, string> | undefined) ?? {}), ...headers };
  if (needsCsrf(operationId, method, nextHeaders) && csrfToken) {
    nextHeaders[csrfHeaderName] = csrfToken;
  }
  if (Object.keys(nextHeaders).length > 0) {
    nextParams.header = nextHeaders;
  }
  return Object.keys(nextParams).length > 0 ? nextParams : undefined;
}

function splitListOptions<TOptions extends { signal?: AbortSignal }>(options: TOptions = {} as TOptions) {
  const { signal, ...queryOptions } = options;
  const query = Object.fromEntries(Object.entries(queryOptions).filter(([, value]) => value !== undefined && value !== null));
  return {
    query: Object.keys(query).length > 0 ? query : undefined,
    signal,
  };
}

export class OpenApiCanonKeeperClient implements CanonKeeperApiClient, ApiClient {
  private readonly baseUrl: string;
  private readonly client: Client<paths>;
  private readonly fetch: ApiFetch;
  private csrfToken: string | null = null;

  constructor(options: CanonKeeperApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? defaultBaseUrl();
    this.fetch = options.fetch ?? ((request) => globalThis.fetch(request));
    this.client = createClient<paths>({
      baseUrl: this.baseUrl,
      credentials: 'include',
      fetch: this.fetch,
    });
  }

  async request<TOperation extends OperationId, TStatus extends keyof OperationResponses<TOperation>>(
    operationId: TOperation,
    init: OperationInit<TOperation> = {},
  ): Promise<OperationResponses<TOperation>[TStatus]> {
    const route = operationManifest[operationId];
    const requestInit: { params?: unknown; body?: unknown; signal?: AbortSignal } = {};
    const explicitHeaders = init.headers ?? {};
    const csrfToken = needsCsrf(operationId, route.method, explicitHeaders) ? await this.ensureCsrfToken() : undefined;
    const params = withContractHeaders(operationId, route.method, init.params, explicitHeaders, csrfToken);
    if (params) {
      requestInit.params = params;
    }
    if (init.body !== undefined) {
      requestInit.body = init.body;
    }
    if (init.signal) {
      requestInit.signal = init.signal;
    }

    try {
      const openApiRequest = this.client.request as unknown as OpenApiFetchRequest;
      const result = await openApiRequest(
        route.method.toLowerCase() as Lowercase<typeof route.method>,
        route.path,
        requestInit,
      );
      if (result.error !== undefined) {
        throw new ApiStatusError(result.response.status, problemFromError(result.error, result.response.status), result.response);
      }
      if (['registerUser', 'loginUser', 'logoutUser', 'rotateSession'].includes(operationId)) {
        this.csrfToken = null;
      }
      return result.data as OperationResponses<TOperation>[TStatus];
    } catch (error) {
      if (error instanceof ApiStatusError) {
        throw error;
      }
      throw new NetworkApiError(error);
    }
  }

  private async ensureCsrfToken() {
    if (this.csrfToken) {
      return this.csrfToken;
    }
    const response = await this.request<'getCsrfToken', '200'>('getCsrfToken');
    this.csrfToken = response.csrfToken;
    return this.csrfToken;
  }

  register(body: OperationRequest<'registerUser'>) {
    return this.request<'registerUser', '201'>('registerUser', { body });
  }

  login(body: OperationRequest<'loginUser'>) {
    return this.request<'loginUser', '200'>('loginUser', { body });
  }

  async logout() {
    await this.request<'logoutUser', '204'>('logoutUser');
  }

  rotateSession() {
    return this.request<'rotateSession', '200'>('rotateSession');
  }

  getCurrentUser(options: ApiRequestOptions = {}) {
    return this.request<'getCurrentUser', '200'>('getCurrentUser', options);
  }

  listProjects(options: CursorListOptions<'listProjects'> = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listProjects', '200'>('listProjects', { params: query ? { query } : undefined, signal });
  }

  createProject(body: OperationRequest<'createProject'>) {
    return this.request<'createProject', '201'>('createProject', { body });
  }

  getProject(projectId: string) {
    return this.request<'getProject', '200'>('getProject', { params: { path: { projectId } } });
  }

  updateProject(projectId: string, body: OperationRequest<'updateProject'>) {
    return this.request<'updateProject', '200'>('updateProject', { params: { path: { projectId } }, body });
  }

  async deleteProject(projectId: string) {
    await this.request<'deleteProject', '204'>('deleteProject', { params: { path: { projectId } } });
  }

  listProjectMembers(projectId: string, options: CursorListOptions<'listProjectMembers'> = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listProjectMembers', '200'>('listProjectMembers', {
      params: query ? { path: { projectId }, query } : { path: { projectId } },
      signal,
    });
  }

  updateProjectMemberRole(projectId: string, memberId: string, body: OperationRequest<'updateProjectMemberRole'>) {
    return this.request<'updateProjectMemberRole', '200'>('updateProjectMemberRole', { params: { path: { projectId, memberId } }, body });
  }

  async removeProjectMember(projectId: string, memberId: string) {
    await this.request<'removeProjectMember', '204'>('removeProjectMember', { params: { path: { projectId, memberId } } });
  }

  listProjectInvitations(projectId: string, options: CursorListOptions<'listProjectInvitations'> = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listProjectInvitations', '200'>('listProjectInvitations', {
      params: query ? { path: { projectId }, query } : { path: { projectId } },
      signal,
    });
  }

  listMyProjectInvitations(options: CursorListOptions<'listMyProjectInvitations'> = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listMyProjectInvitations', '200'>('listMyProjectInvitations', {
      params: query ? { query } : undefined,
      signal,
    });
  }

  createProjectInvitation(projectId: string, body: OperationRequest<'createProjectInvitation'>) {
    return this.request<'createProjectInvitation', '201'>('createProjectInvitation', { params: { path: { projectId } }, body });
  }

  cancelProjectInvitation(invitationId: string) {
    return this.request<'cancelProjectInvitation', '200'>('cancelProjectInvitation', { params: { path: { invitationId } } });
  }

  acceptProjectInvitation(invitationId: string) {
    return this.request<'acceptProjectInvitation', '200'>('acceptProjectInvitation', { params: { path: { invitationId } } });
  }

  listBooks(projectId: string, options: CursorListOptions<'listBooks'> = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listBooks', '200'>('listBooks', {
      params: query ? { path: { projectId }, query } : { path: { projectId } },
      signal,
    });
  }

  createBook(projectId: string, body: OperationRequest<'createBook'>) {
    return this.request<'createBook', '201'>('createBook', { params: { path: { projectId } }, body });
  }

  getBook(bookId: string) {
    return this.request<'getBook', '200'>('getBook', { params: { path: { bookId } } });
  }

  updateBook(bookId: string, body: OperationRequest<'updateBook'>) {
    return this.request<'updateBook', '200'>('updateBook', { params: { path: { bookId } }, body });
  }

  async deleteBook(bookId: string) {
    await this.request<'deleteBook', '204'>('deleteBook', { params: { path: { bookId } } });
  }

  getImportConstraints(projectId: string) {
    return this.request<'getImportConstraints', '200'>('getImportConstraints', { params: { path: { projectId } } });
  }

  importBookFile(projectId: string, input: ImportBookInput, options: RequiredIdempotencyOptions) {
    const form = new FormData();
    form.append('file', input.file, input.file.name);
    if (input.metadata) {
      form.append('metadata', JSON.stringify(input.metadata));
    }
    if (input.options) {
      form.append('options', JSON.stringify(input.options));
    }
    return this.postMultipart<'importBookFile', OperationResponse<'importBookFile', '202'>>('importBookFile', { projectId }, form, options);
  }

  listProjectJobs(projectId: string, options: ListProjectJobsOptions = {}) {
    const { signal, ...query } = options;
    return this.request<'listProjectJobs', '200'>('listProjectJobs', { params: { path: { projectId }, query }, signal });
  }

  startProjectIndexing(projectId: string, body: OperationRequest<'startProjectIndexing'>, options: RequiredIdempotencyOptions) {
    return this.request<'startProjectIndexing', '202'>('startProjectIndexing', {
      params: { path: { projectId } },
      body,
      headers: idempotencyHeaders(options, 'startProjectIndexing'),
      signal: options?.signal,
    });
  }

  getJob(jobId: string) {
    return this.request<'getJob', '200'>('getJob', { params: { path: { jobId } } });
  }

  cancelJob(jobId: string) {
    return this.request<'cancelJob', '200'>('cancelJob', { params: { path: { jobId } } });
  }

  createBookExport(bookId: string, body: OperationRequest<'createBookExport'>, options: RequiredIdempotencyOptions) {
    return this.request<'createBookExport', '202'>('createBookExport', {
      params: { path: { bookId } },
      body,
      headers: idempotencyHeaders(options, 'createBookExport'),
      signal: options?.signal,
    });
  }

  listChapters(bookId: string, options: CursorListOptions<'listChapters'> = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listChapters', '200'>('listChapters', {
      params: query ? { path: { bookId }, query } : { path: { bookId } },
      signal,
    });
  }

  createChapter(bookId: string, body: OperationRequest<'createChapter'>) {
    return this.request<'createChapter', '201'>('createChapter', { params: { path: { bookId } }, body });
  }

  getChapter(chapterId: string) {
    return this.request<'getChapter', '200'>('getChapter', { params: { path: { chapterId } } });
  }

  updateChapter(chapterId: string, body: OperationRequest<'updateChapter'>) {
    return this.request<'updateChapter', '200'>('updateChapter', { params: { path: { chapterId } }, body });
  }

  publishChapter(chapterId: string, body: OperationRequest<'publishChapter'>) {
    return this.request<'publishChapter', '200'>('publishChapter', { params: { path: { chapterId } }, body });
  }

  async deleteChapter(chapterId: string) {
    await this.request<'deleteChapter', '204'>('deleteChapter', { params: { path: { chapterId } } });
  }

  listChapterAnnotations(chapterId: string, options: CursorListOptions<'listChapterAnnotations'> = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listChapterAnnotations', '200'>('listChapterAnnotations', {
      params: query ? { path: { chapterId }, query } : { path: { chapterId } },
      signal,
    });
  }

  createChapterAnnotation(chapterId: string, body: OperationRequest<'createChapterAnnotation'>) {
    return this.request<'createChapterAnnotation', '201'>('createChapterAnnotation', { params: { path: { chapterId } }, body });
  }

  updateReaderAnnotation(annotationId: string, body: OperationRequest<'updateReaderAnnotation'>) {
    return this.request<'updateReaderAnnotation', '200'>('updateReaderAnnotation', { params: { path: { annotationId } }, body });
  }

  async deleteReaderAnnotation(annotationId: string) {
    await this.request<'deleteReaderAnnotation', '204'>('deleteReaderAnnotation', { params: { path: { annotationId } } });
  }

  searchProject(projectId: string, query: string, scope?: SearchScope, options: SearchProjectOptions = {}) {
    return this.request<'searchProject', '200'>('searchProject', {
      params: { path: { projectId } },
      body: { query, scope: scope ?? 'all', filters: options.filters, limit: options.limit ?? 10, cursor: options.cursor },
      signal: options.signal,
    });
  }

  listChatSessions(projectId: string, options: CursorListOptions<'listChatSessions'> = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listChatSessions', '200'>('listChatSessions', {
      params: query ? { path: { projectId }, query } : { path: { projectId } },
      signal,
    });
  }

  createChatSession(projectId: string, body: OperationRequest<'createChatSession'>) {
    return this.request<'createChatSession', '201'>('createChatSession', { params: { path: { projectId } }, body });
  }

  getChatSession(chatId: string) {
    return this.request<'getChatSession', '200'>('getChatSession', { params: { path: { chatId } } });
  }

  renameChatSession(chatId: string, body: OperationRequest<'renameChatSession'>) {
    return this.request<'renameChatSession', '200'>('renameChatSession', { params: { path: { chatId } }, body });
  }

  async deleteChatSession(chatId: string) {
    await this.request<'deleteChatSession', '204'>('deleteChatSession', { params: { path: { chatId } } });
  }

  listChatMessages(chatId: string, options: CursorListOptions<'listChatMessages'> = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listChatMessages', '200'>('listChatMessages', {
      params: query ? { path: { chatId }, query } : { path: { chatId } },
      signal,
    });
  }

  createChatTurn(chatId: string, body: OperationRequest<'createChatTurn'>, options: RequiredIdempotencyOptions) {
    return this.request<'createChatTurn', '202'>('createChatTurn', {
      params: { path: { chatId } },
      body,
      headers: idempotencyHeaders(options, 'createChatTurn'),
      signal: options?.signal,
    });
  }

  getChatTurn(turnId: string) {
    return this.request<'getChatTurn', '200'>('getChatTurn', { params: { path: { turnId } } });
  }

  async *streamChatTurnEvents(turnId: string, options: ApiRequestOptions = {}) {
    const stream = await this.getStream(
      'streamChatTurnEvents',
      { turnId },
      {
        query: options.afterEventId ? { afterEventId: options.afterEventId } : undefined,
        header: options.lastEventId ? { 'Last-Event-ID': options.lastEventId } : undefined,
      },
      options,
    );
    yield* parseSseMessages<ChatTurnEventEnvelope>(stream);
  }

  getChatArtifact(artifactId: string) {
    return this.request<'getChatArtifact', '200'>('getChatArtifact', { params: { path: { artifactId } } });
  }

  listAgentSuggestions(chapterId: string, options: ListAgentSuggestionsOptions = {}) {
    const { query, signal } = splitListOptions(options);
    return this.request<'listAgentSuggestions', '200'>('listAgentSuggestions', {
      params: query ? { path: { chapterId }, query } : { path: { chapterId } },
      signal,
    });
  }

  startAgentRun(chapterId: string, body: OperationRequest<'startAgentRun'>, options: RequiredIdempotencyOptions) {
    return this.request<'startAgentRun', '202'>('startAgentRun', {
      params: { path: { chapterId } },
      body,
      headers: idempotencyHeaders(options, 'startAgentRun'),
      signal: options?.signal,
    });
  }

  getAgentSuggestion(suggestionId: string) {
    return this.request<'getAgentSuggestion', '200'>('getAgentSuggestion', { params: { path: { suggestionId } } });
  }

  approveAgentSuggestion(suggestionId: string, body: OperationRequest<'approveAgentSuggestion'>) {
    return this.request<'approveAgentSuggestion', '200'>('approveAgentSuggestion', { params: { path: { suggestionId } }, body });
  }

  rejectAgentSuggestion(suggestionId: string, body: OperationRequest<'rejectAgentSuggestion'>) {
    return this.request<'rejectAgentSuggestion', '200'>('rejectAgentSuggestion', { params: { path: { suggestionId } }, body });
  }

  private async postMultipart<TOperation extends OperationId, TResult>(
    operationId: TOperation,
    pathParams: Record<string, string | number | boolean>,
    form: FormData,
    options: RequiredIdempotencyOptions,
  ): Promise<TResult> {
    const route = operationManifest[operationId];
    const url = joinUrl(this.baseUrl, applyPathParams(route.path, pathParams));
    const explicitHeaders: Record<string, string> = idempotencyHeaders(options, operationId);
    if (options.lastEventId) {
      explicitHeaders['Last-Event-ID'] = options.lastEventId;
    }
    const csrfToken = needsCsrf(operationId, route.method, explicitHeaders) ? await this.ensureCsrfToken() : undefined;
    const params = withContractHeaders(operationId, route.method, { path: pathParams }, explicitHeaders, csrfToken);
    const encoded = await encodeMultipartForm(form);
    const headers = new Headers((params as { header?: Record<string, string> } | undefined)?.header);
    headers.set('content-type', encoded.contentType);
    const request = new Request(url, {
      method: route.method,
      credentials: 'include',
      headers,
      signal: options.signal,
      body: encoded.body,
    });

    let response: Response;
    try {
      response = await this.fetch(request);
    } catch (error) {
      throw new NetworkApiError(error);
    }

    if (!response.ok) {
      throw new ApiStatusError(response.status, await this.readProblem(response), response);
    }

    return (await response.json()) as TResult;
  }

  private async getStream<TOperation extends OperationId>(
    operationId: TOperation,
    pathParams: Record<string, string | number | boolean>,
    params: Record<string, unknown> = {},
    options: ApiRequestOptions = {},
  ) {
    const route = operationManifest[operationId];
    const url = joinUrl(this.baseUrl, applyPathParams(route.path, pathParams));
    const headerParams = { ...((params.header as Record<string, string> | undefined) ?? {}) };
    if (options.lastEventId) {
      headerParams['Last-Event-ID'] = options.lastEventId;
    }
    const query = params.query as Record<string, string> | undefined;
    const queryString = query ? new URLSearchParams(query).toString() : '';
    const request = new Request(url, {
      method: route.method,
      credentials: 'include',
      headers: {
        accept: 'text/event-stream',
        ...headerParams,
      },
      signal: options.signal,
    });
    const finalRequest = queryString ? new Request(`${request.url}?${queryString}`, request) : request;

    let response: Response;
    try {
      response = await this.fetch(finalRequest);
    } catch (error) {
      throw new NetworkApiError(error);
    }

    if (!response.ok) {
      throw new ApiStatusError(response.status, await this.readProblem(response), response);
    }

    if (!response.body) {
      throw new ApiStatusError(
        response.status,
        { type: 'about:blank', title: 'Empty stream response', status: response.status, code: 'empty_stream', requestId: 'req_unavailable' },
        response,
      );
    }

    return response.body;
  }

  private async readProblem(response: Response): Promise<ApiProblem> {
    try {
      return problemFromError(await response.clone().json(), response.status);
    } catch {
      return { type: 'about:blank', title: response.statusText || 'Request failed', status: response.status, code: 'request_failed', requestId: 'req_unavailable' };
    }
  }
}

export function createCanonKeeperApiClient(options?: CanonKeeperApiClientOptions) {
  return new OpenApiCanonKeeperClient(options);
}

export const apiBoundary = {
  generatedFrom: 'contracts/openapi.json',
  generatedPath: 'src/shared/api/generated/openapi.ts',
  manifestPath: 'src/shared/api/generated/operation-manifest.ts',
  transport: 'openapi-fetch',
  credentials: 'include',
} as const;
