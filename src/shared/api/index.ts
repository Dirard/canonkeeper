import createClient, { type Client } from 'openapi-fetch';
import type { components, operations, paths } from './generated/openapi';
import { operationManifest, type OperationId } from './generated/operation-manifest';
import { parseSseStream } from './sse';

export type { OperationId };

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
export type LlmStreamEvent = Schema<'LlmStreamEvent'>;
export type Project = Schema<'Project'>;
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
  params?: OperationParameters<TOperation>;
  body?: OperationRequest<TOperation>;
  signal?: AbortSignal;
};

export interface ApiRequestOptions {
  signal?: AbortSignal;
}

/** Real file upload input for `importBookFile`; serialized as multipart/form-data per the contract. */
export interface ImportBookInput {
  file: File;
  title?: string;
}

export interface ApiClient {
  request<TOperation extends OperationId, TStatus extends keyof OperationResponses<TOperation>>(
    operationId: TOperation,
    init?: OperationInit<TOperation>,
  ): Promise<OperationResponses<TOperation>[TStatus]>;
  streamChatMessage(chatId: string, body: OperationRequest<'sendChatMessage'>, options?: ApiRequestOptions): AsyncIterable<LlmStreamEvent>;
}

export interface CanonKeeperApiClient {
  register(body: OperationRequest<'registerUser'>): Promise<OperationResponse<'registerUser', '201'>>;
  login(body: OperationRequest<'loginUser'>): Promise<OperationResponse<'loginUser', '200'>>;
  logout(): Promise<void>;
  getCurrentUser(options?: ApiRequestOptions): Promise<OperationResponse<'getCurrentUser', '200'>>;
  listProjects(): Promise<OperationResponse<'listProjects', '200'>>;
  createProject(body: OperationRequest<'createProject'>): Promise<OperationResponse<'createProject', '201'>>;
  getProject(projectId: string): Promise<OperationResponse<'getProject', '200'>>;
  updateProject(projectId: string, body: OperationRequest<'updateProject'>): Promise<OperationResponse<'updateProject', '200'>>;
  deleteProject(projectId: string): Promise<void>;
  listBooks(projectId: string): Promise<OperationResponse<'listBooks', '200'>>;
  createBook(projectId: string, body: OperationRequest<'createBook'>): Promise<OperationResponse<'createBook', '201'>>;
  getBook(bookId: string): Promise<OperationResponse<'getBook', '200'>>;
  updateBook(bookId: string, body: OperationRequest<'updateBook'>): Promise<OperationResponse<'updateBook', '200'>>;
  deleteBook(bookId: string): Promise<void>;
  getImportConstraints(projectId: string): Promise<OperationResponse<'getImportConstraints', '200'>>;
  importBookFile(projectId: string, input: ImportBookInput): Promise<OperationResponse<'importBookFile', '202'>>;
  listIndexingJobs(projectId: string): Promise<OperationResponse<'listIndexingJobs', '200'>>;
  getIndexingJob(jobId: string): Promise<OperationResponse<'getIndexingJob', '200'>>;
  cancelIndexingJob(jobId: string): Promise<OperationResponse<'cancelIndexingJob', '200'>>;
  createBookExport(bookId: string, body: OperationRequest<'createBookExport'>): Promise<OperationResponse<'createBookExport', '202'>>;
  getExportJob(exportJobId: string): Promise<OperationResponse<'getExportJob', '200'>>;
  listChapters(bookId: string): Promise<OperationResponse<'listChapters', '200'>>;
  createChapter(bookId: string, body: OperationRequest<'createChapter'>): Promise<OperationResponse<'createChapter', '201'>>;
  getChapter(chapterId: string): Promise<OperationResponse<'getChapter', '200'>>;
  updateChapter(chapterId: string, body: OperationRequest<'updateChapter'>): Promise<OperationResponse<'updateChapter', '200'>>;
  publishChapter(chapterId: string, body: OperationRequest<'publishChapter'>): Promise<OperationResponse<'publishChapter', '200'>>;
  deleteChapter(chapterId: string): Promise<void>;
  listChapterAnnotations(chapterId: string): Promise<OperationResponse<'listChapterAnnotations', '200'>>;
  createChapterAnnotation(
    chapterId: string,
    body: OperationRequest<'createChapterAnnotation'>,
  ): Promise<OperationResponse<'createChapterAnnotation', '201'>>;
  updateReaderAnnotation(
    annotationId: string,
    body: OperationRequest<'updateReaderAnnotation'>,
  ): Promise<OperationResponse<'updateReaderAnnotation', '200'>>;
  deleteReaderAnnotation(annotationId: string): Promise<void>;
  searchProject(projectId: string, query: string, scope?: SearchScope): Promise<OperationResponse<'searchProject', '200'>>;
  listChatSessions(projectId: string): Promise<OperationResponse<'listChatSessions', '200'>>;
  createChatSession(projectId: string, body: OperationRequest<'createChatSession'>): Promise<OperationResponse<'createChatSession', '201'>>;
  getChatSession(chatId: string): Promise<OperationResponse<'getChatSession', '200'>>;
  renameChatSession(chatId: string, body: OperationRequest<'renameChatSession'>): Promise<OperationResponse<'renameChatSession', '200'>>;
  deleteChatSession(chatId: string): Promise<void>;
  listChatMessages(chatId: string): Promise<OperationResponse<'listChatMessages', '200'>>;
  sendChatMessage(chatId: string, body: OperationRequest<'sendChatMessage'>, options?: ApiRequestOptions): AsyncIterable<LlmStreamEvent>;
  getChatArtifact(artifactId: string): Promise<OperationResponse<'getChatArtifact', '200'>>;
  listAgentSuggestions(chapterId: string): Promise<OperationResponse<'listAgentSuggestions', '200'>>;
  requestAgentSuggestion(
    chapterId: string,
    body: OperationRequest<'requestAgentSuggestion'>,
  ): Promise<OperationResponse<'requestAgentSuggestion', '201'>>;
  getAgentSuggestion(suggestionId: string): Promise<OperationResponse<'getAgentSuggestion', '200'>>;
  approveAgentSuggestion(
    suggestionId: string,
    body: OperationRequest<'approveAgentSuggestion'>,
  ): Promise<OperationResponse<'approveAgentSuggestion', '200'>>;
  rejectAgentSuggestion(suggestionId: string): Promise<OperationResponse<'rejectAgentSuggestion', '200'>>;
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

export class OpenApiCanonKeeperClient implements CanonKeeperApiClient, ApiClient {
  private readonly baseUrl: string;
  private readonly client: Client<paths>;
  private readonly fetch: ApiFetch;

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
    if (init.params) {
      requestInit.params = init.params;
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
      return result.data as OperationResponses<TOperation>[TStatus];
    } catch (error) {
      if (error instanceof ApiStatusError) {
        throw error;
      }
      throw new NetworkApiError(error);
    }
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

  getCurrentUser(options: ApiRequestOptions = {}) {
    return this.request<'getCurrentUser', '200'>('getCurrentUser', options);
  }

  listProjects() {
    return this.request<'listProjects', '200'>('listProjects');
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

  listBooks(projectId: string) {
    return this.request<'listBooks', '200'>('listBooks', { params: { path: { projectId } } });
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

  importBookFile(projectId: string, input: ImportBookInput) {
    const form = new FormData();
    form.append('file', input.file, input.file.name);
    if (input.title) {
      form.append('title', input.title);
    }
    return this.postMultipart<'importBookFile', OperationResponse<'importBookFile', '202'>>('importBookFile', { projectId }, form);
  }

  listIndexingJobs(projectId: string) {
    return this.request<'listIndexingJobs', '200'>('listIndexingJobs', { params: { path: { projectId } } });
  }

  getIndexingJob(jobId: string) {
    return this.request<'getIndexingJob', '200'>('getIndexingJob', { params: { path: { jobId } } });
  }

  cancelIndexingJob(jobId: string) {
    return this.request<'cancelIndexingJob', '200'>('cancelIndexingJob', { params: { path: { jobId } } });
  }

  createBookExport(bookId: string, body: OperationRequest<'createBookExport'>) {
    return this.request<'createBookExport', '202'>('createBookExport', { params: { path: { bookId } }, body });
  }

  getExportJob(exportJobId: string) {
    return this.request<'getExportJob', '200'>('getExportJob', { params: { path: { exportJobId } } });
  }

  listChapters(bookId: string) {
    return this.request<'listChapters', '200'>('listChapters', { params: { path: { bookId } } });
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

  listChapterAnnotations(chapterId: string) {
    return this.request<'listChapterAnnotations', '200'>('listChapterAnnotations', { params: { path: { chapterId } } });
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

  searchProject(projectId: string, query: string, scope?: SearchScope) {
    return this.request<'searchProject', '200'>('searchProject', {
      params: { path: { projectId }, query: { q: query, scope } },
    });
  }

  listChatSessions(projectId: string) {
    return this.request<'listChatSessions', '200'>('listChatSessions', { params: { path: { projectId } } });
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

  listChatMessages(chatId: string) {
    return this.request<'listChatMessages', '200'>('listChatMessages', { params: { path: { chatId } } });
  }

  async *sendChatMessage(chatId: string, body: OperationRequest<'sendChatMessage'>, options: ApiRequestOptions = {}) {
    const stream = await this.postStream('sendChatMessage', { chatId }, body, options);
    yield* parseSseStream<LlmStreamEvent>(stream);
  }

  streamChatMessage(chatId: string, body: OperationRequest<'sendChatMessage'>, options: ApiRequestOptions = {}) {
    return this.sendChatMessage(chatId, body, options);
  }

  getChatArtifact(artifactId: string) {
    return this.request<'getChatArtifact', '200'>('getChatArtifact', { params: { path: { artifactId } } });
  }

  listAgentSuggestions(chapterId: string) {
    return this.request<'listAgentSuggestions', '200'>('listAgentSuggestions', { params: { path: { chapterId } } });
  }

  requestAgentSuggestion(chapterId: string, body: OperationRequest<'requestAgentSuggestion'>) {
    return this.request<'requestAgentSuggestion', '201'>('requestAgentSuggestion', { params: { path: { chapterId } }, body });
  }

  getAgentSuggestion(suggestionId: string) {
    return this.request<'getAgentSuggestion', '200'>('getAgentSuggestion', { params: { path: { suggestionId } } });
  }

  approveAgentSuggestion(suggestionId: string, body: OperationRequest<'approveAgentSuggestion'>) {
    return this.request<'approveAgentSuggestion', '200'>('approveAgentSuggestion', { params: { path: { suggestionId } }, body });
  }

  rejectAgentSuggestion(suggestionId: string) {
    return this.request<'rejectAgentSuggestion', '200'>('rejectAgentSuggestion', { params: { path: { suggestionId } } });
  }

  private async postMultipart<TOperation extends OperationId, TResult>(
    operationId: TOperation,
    pathParams: Record<string, string | number | boolean>,
    form: FormData,
    options: ApiRequestOptions = {},
  ): Promise<TResult> {
    const route = operationManifest[operationId];
    const url = joinUrl(this.baseUrl, applyPathParams(route.path, pathParams));
    // Intentionally omit content-type so the browser sets the multipart boundary.
    const request = new Request(url, {
      method: route.method,
      credentials: 'include',
      signal: options.signal,
      body: form,
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

  private async postStream<TOperation extends OperationId>(
    operationId: TOperation,
    pathParams: Record<string, string | number | boolean>,
    body: OperationRequest<TOperation>,
    options: ApiRequestOptions = {},
  ) {
    const route = operationManifest[operationId];
    const url = joinUrl(this.baseUrl, applyPathParams(route.path, pathParams));
    const request = new Request(url, {
      method: route.method,
      credentials: 'include',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      signal: options.signal,
      body: JSON.stringify(body),
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

    if (!response.body) {
      throw new ApiStatusError(
        response.status,
        { type: 'about:blank', title: 'Empty stream response', status: response.status },
        response,
      );
    }

    return response.body;
  }

  private async readProblem(response: Response): Promise<ApiProblem> {
    try {
      return problemFromError(await response.clone().json(), response.status);
    } catch {
      return { type: 'about:blank', title: response.statusText || 'Request failed', status: response.status };
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
