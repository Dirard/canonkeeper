import type {
  AgentSuggestion,
  Book,
  CanonKeeperApiClient,
  Chapter,
  ChatArtifact,
  ChatTurnEventEnvelope,
  ChatTurnEventMessage,
  ChatMessage,
  ChatSession,
  ImportBookInput,
  Job,
  JobStartResponse,
  Project,
  ReaderAnnotation,
  ReaderReferenceLocator,
  OperationRequest,
  OperationParameters,
  OperationResponse,
  OperationId,
  RequiredIdempotencyOptions,
  Schema,
} from '../../shared/api';
import { applyScenario, isProtectedOperation, MockApiError, normalScenario, type MockActorRole, type MockScenarioControl } from './scenarios';

type User = Schema<'User'>;
type AuthSession = Schema<'AuthSession'>;
type ProjectInvitation = Schema<'ProjectInvitation'>;
type ProjectMembership = Schema<'ProjectMembership'>;
type InvitationStatus = ProjectInvitation['status'];
type SearchResult = Schema<'SearchResult'>;
type SearchScope = Schema<'SearchScope'>;
type ExportJobResult = Extract<NonNullable<Job['result']>, { type: 'export' }>;
type SearchProjectBody = NonNullable<OperationRequest<'searchProject'>>;
type SearchProjectOptions = Partial<Pick<SearchProjectBody, 'cursor' | 'filters' | 'limit'>> & { signal?: AbortSignal };
type SearchProjectValidationOptions = {
  allowSignal?: boolean;
};
type CursorListOptions = {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
};
type ListAgentSuggestionsOptions = CursorListOptions & {
  batchId?: string;
  sourceMessageId?: string;
  status?: AgentSuggestion['status'];
};
type ProjectJobsQuery = NonNullable<OperationParameters<'listProjectJobs'>['query']>;
type DirectIdempotencyRecord = {
  fingerprint: string;
  response: unknown;
};
type JobCreatorRecord = {
  principalId: string;
  role: MockActorRole;
};
type MockImportBookInput = {
  file:
    | string
    | File
    | {
        contentType?: string | null;
        name?: string | null;
        size?: number;
        sizeBytes?: number;
        type?: string | null;
      };
  metadata?: ImportBookInput['metadata'];
  options?: ImportBookInput['options'];
};

interface MockState {
  user: User;
  session: AuthSession | null;
  projects: Project[];
  invitations: ProjectInvitation[];
  memberships: ProjectMembership[];
  books: Book[];
  chapters: Chapter[];
  annotations: ReaderAnnotation[];
  chats: ChatSession[];
  messages: ChatMessage[];
  artifacts: ChatArtifact[];
  suggestions: AgentSuggestion[];
  jobs: Job[];
}

const now = '2026-06-16T05:00:00.000Z';
const projectId = 'project-white-port';
const foreignProjectId = 'project-foreign-archive';
const bookId = 'book-02';
const indexingBookId = 'book-03';
const chapterId = 'chapter-12';
const draftChapterId = 'chapter-16';
const paragraphId = 'p-12-03';
const chatId = 'chat-white-port';
const suggestionId = 'suggestion-punctuation-1';
const artifactId = 'artifact-reader-references-1';
const batchId = 'batch-agent-1';
const mockPassword = 'white-port-12';
const apiBasePath = '/api/v1';
const allowedImportExtensions = ['.fb2', '.epub'] as const;
const allowedImportMimeTypes = ['application/epub+zip', 'application/x-fictionbook+xml', 'text/xml', 'application/xml'] as const;
const maxImportFileSizeBytes = 52_428_800;
const minIdempotencyKeyLength = 8;
const maxIdempotencyKeyLength = 128;
const maxChatTurnContentLength = 8000;
const maxChatTurnContextLocators = 20;
const maxAgentRunPromptLength = 8000;
const assignableProjectMemberRoles = ['admin', 'editor', 'viewer'] as const;
const bookDisplayNumbers = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function jobUrl(jobId: string) {
  return `${apiBasePath}/jobs/${jobId}`;
}

function chatTurnUrl(turnId: string) {
  return `${apiBasePath}/chat-turns/${turnId}`;
}

function rejectUnknownKeys(operationId: OperationId, value: unknown, allowedKeys: readonly string[]) {
  if (!isRecord(value)) {
    throw new MockApiError(400, 'Request body must be an object.', operationId, 'validation_failed');
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new MockApiError(400, 'Request body contains unsupported keys.', operationId, 'validation_failed');
    }
  }
}

function validateChatTurnStartRequest(body: OperationRequest<'createChatTurn'>) {
  rejectUnknownKeys('createChatTurn', body, ['agentOptions', 'content', 'contextLocators']);
  if (typeof body.content !== 'string' || body.content.trim().length === 0) {
    throw new MockApiError(400, 'Chat turn content must be a non-empty string.', 'createChatTurn', 'validation_failed');
  }
  if (body.content.length > maxChatTurnContentLength) {
    throw new MockApiError(400, 'Chat turn content is too long.', 'createChatTurn', 'validation_failed');
  }
  if (body.contextLocators !== undefined && (!Array.isArray(body.contextLocators) || body.contextLocators.length > maxChatTurnContextLocators)) {
    throw new MockApiError(400, 'Chat turn contextLocators must contain 20 items or fewer.', 'createChatTurn', 'validation_failed');
  }
}

function validateAgentRunRequest(body: OperationRequest<'startAgentRun'>) {
  rejectUnknownKeys('startAgentRun', body, ['expectedChapterRevision', 'prompt', 'selectionQuote', 'targetLocator']);
  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    throw new MockApiError(400, 'Agent run prompt must be a non-empty string.', 'startAgentRun', 'validation_failed');
  }
  if (body.prompt.length > maxAgentRunPromptLength) {
    throw new MockApiError(400, 'Agent run prompt is too long.', 'startAgentRun', 'validation_failed');
  }
  if (!Number.isInteger(body.expectedChapterRevision) || body.expectedChapterRevision < 1) {
    throw new MockApiError(400, 'Agent run expectedChapterRevision must be a positive integer.', 'startAgentRun', 'validation_failed');
  }
  if (body.selectionQuote !== undefined && (typeof body.selectionQuote !== 'string' || body.selectionQuote.length > 500)) {
    throw new MockApiError(400, 'Agent run selectionQuote must be 500 characters or fewer.', 'startAgentRun', 'validation_failed');
  }
}

function validateUpdateProjectRequest(body: OperationRequest<'updateProject'>) {
  rejectUnknownKeys('updateProject', body, ['description', 'title']);
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim().length === 0 || body.title.length > 160)) {
    throw new MockApiError(400, 'Project title is invalid.', 'updateProject', 'validation_failed');
  }
  if (body.description !== undefined && body.description !== null && (typeof body.description !== 'string' || body.description.length > 1000)) {
    throw new MockApiError(400, 'Project description is invalid.', 'updateProject', 'validation_failed');
  }
}

function validateUpdateProjectMemberRoleRequest(body: OperationRequest<'updateProjectMemberRole'>) {
  rejectUnknownKeys('updateProjectMemberRole', body, ['role']);
  if (!assignableProjectMemberRoles.includes((body as { role?: unknown }).role as (typeof assignableProjectMemberRoles)[number])) {
    throw new MockApiError(400, 'Project member role is invalid.', 'updateProjectMemberRole', 'validation_failed');
  }
}

function validateRegisterRequest(body: OperationRequest<'registerUser'>) {
  rejectUnknownKeys('registerUser', body, ['acceptedTerms', 'displayName', 'email', 'password']);
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

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function createProjectInvitationFixture(
  invitationProjectId: string,
  invitationId: string,
  status: InvitationStatus,
  email = 'collaborator@example.test',
  role: ProjectInvitation['role'] = 'editor',
  projectTitle = 'Белый порт',
  inviter: Pick<User, 'displayName' | 'email'> = { displayName: 'Мира Волкова', email: 'mira@example.com' },
): ProjectInvitation {
  return {
    id: invitationId,
    projectId: invitationProjectId,
    project: {
      id: invitationProjectId,
      title: projectTitle,
    },
    inviter: {
      displayName: inviter.displayName,
      email: inviter.email,
    },
    email,
    role,
    status,
    expiresAt: '2026-06-30T05:00:00.000Z',
    acceptedAt: status === 'accepted' ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

function createProjectMembershipFixture(
  project: Pick<Project, 'id'>,
  user: User,
  memberId: string,
  role: ProjectMembership['role'],
  email = 'collaborator@example.test',
  displayName = 'Соавтор',
): ProjectMembership {
  const isCurrentUser = memberId === 'member-owner' || memberId === 'member-current';
  return {
    id: memberId,
    projectId: project.id,
    userId: isCurrentUser ? user.id : `user-${memberId}`,
    email: isCurrentUser ? user.email : email,
    displayName: isCurrentUser ? user.displayName : displayName,
    role,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function createProjectMembershipForUser(project: Pick<Project, 'id'>, user: User, memberId: string, role: ProjectMembership['role']): ProjectMembership {
  return {
    id: memberId,
    projectId: project.id,
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
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

function validateIdempotencyKey(operationId: OperationId, idempotencyKey: string) {
  if (idempotencyKey.length < minIdempotencyKeyLength || idempotencyKey.length > maxIdempotencyKeyLength) {
    throw new MockApiError(400, 'Idempotency-Key must be between 8 and 128 characters.', operationId, 'validation_failed');
  }
}

function hashBytes(bytes: Uint8Array) {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function fileContentHash(file: File) {
  if ('arrayBuffer' in file && typeof file.arrayBuffer === 'function') {
    return hashBytes(new Uint8Array(await file.arrayBuffer()));
  }
  if ('text' in file && typeof file.text === 'function') {
    return hashString(await file.text());
  }
  return hashString('');
}

function isFileLike(value: unknown): value is File {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'name' in value &&
    typeof (value as { name?: unknown }).name === 'string' &&
    'size' in value &&
    typeof (value as { size?: unknown }).size === 'number' &&
    (
      ('arrayBuffer' in value && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function') ||
      ('text' in value && typeof (value as { text?: unknown }).text === 'function')
    ),
  );
}

async function idempotencyFingerprintValue(value: unknown): Promise<unknown> {
  if (isFileLike(value)) {
    return {
      contentHash: await fileContentHash(value),
      lastModified: value.lastModified,
      name: value.name,
      size: value.size,
      type: value.type,
    };
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(idempotencyFingerprintValue));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await idempotencyFingerprintValue(entry)])));
  }
  return value;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function bookDisplayNumber(order: number) {
  return bookDisplayNumbers[order - 1] ?? String(order);
}

function nextChapterId(chapters: Chapter[], bookId: string) {
  const prefix = `chapter-${bookId.replace('book-', '')}-`;
  let suffix = chapters.length + 1;
  while (chapters.some((chapter) => chapter.id === `${prefix}${suffix}`)) {
    suffix += 1;
  }
  return `${prefix}${suffix}`;
}

function extensionForFileName(name: string) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function importFileDetails(file: MockImportBookInput['file']) {
  if (typeof file === 'string') {
    return {
      contentType: '',
      name: file,
      sizeBytes: 0,
    };
  }
  return {
    contentType: ('type' in file ? file.type : undefined) || ('contentType' in file ? file.contentType : undefined) || '',
    name: ('name' in file ? file.name : undefined) || '',
    sizeBytes: ('size' in file ? file.size : undefined) ?? ('sizeBytes' in file ? file.sizeBytes : undefined) ?? 0,
  };
}

function validateImportBookInput(input: MockImportBookInput) {
  const details = importFileDetails(input.file);
  if (!details.name) {
    throw new MockApiError(422, 'Multipart import requires a file part.', 'importBookFile');
  }
  if (details.sizeBytes > maxImportFileSizeBytes) {
    throw new MockApiError(413, 'Import file exceeds the maximum allowed size.', 'importBookFile');
  }
  if (!allowedImportExtensions.includes(extensionForFileName(details.name) as (typeof allowedImportExtensions)[number])) {
    throw new MockApiError(415, 'Import file type is not supported.', 'importBookFile');
  }
  if (
    details.contentType &&
    !allowedImportMimeTypes.includes(details.contentType.toLowerCase() as (typeof allowedImportMimeTypes)[number])
  ) {
    throw new MockApiError(415, 'Import file type is not supported.', 'importBookFile');
  }
}

function searchCursor(fingerprint: string, offset: number) {
  return `search:${fingerprint}:${offset}`;
}

function parseSearchCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  const match = /^search:([0-9a-f]+):(\d+)$/.exec(cursor);
  if (!match) return null;
  return { fingerprint: match[1], offset: Number(match[2]) };
}

function listCursor(operationId: OperationId, fingerprint: string, offset: number) {
  return `list:${operationId}:${fingerprint}:${offset}`;
}

function parseListCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  const match = /^list:([A-Za-z0-9]+):([0-9a-f]+):(\d+)$/.exec(cursor);
  if (!match) return null;
  return { operationId: match[1], fingerprint: match[2], offset: Number(match[3]) };
}

function validateCursorListQuery(operationId: OperationId, query: CursorListOptions = {}, extraAllowedKeys: string[] = []) {
  const allowedKeys = new Set(['cursor', 'limit', 'signal', ...extraAllowedKeys]);
  for (const key of Object.keys(query as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      throw new MockApiError(400, 'List query contains unsupported keys.', operationId, 'validation_failed');
    }
  }
  if (query.cursor !== undefined && query.cursor !== null && typeof query.cursor !== 'string') {
    throw new MockApiError(400, 'List cursor must be a string.', operationId, 'validation_failed');
  }
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MockApiError(400, 'List limit must be an integer between 1 and 100.', operationId, 'validation_failed');
  }
  return { cursor: query.cursor ?? null, limit };
}

function paginateList<T>(operationId: OperationId, data: T[], query: CursorListOptions, fingerprintInput: unknown) {
  const { cursor: rawCursor, limit } = validateCursorListQuery(operationId, query);
  const fingerprint = hashString(stableStringify({ fingerprintInput, limit, operationId }));
  const cursor = parseListCursor(rawCursor);
  if (rawCursor && (!cursor || cursor.operationId !== operationId || cursor.fingerprint !== fingerprint)) {
    throw new MockApiError(400, 'List cursor no longer matches the request fingerprint.', operationId, 'invalid_cursor');
  }
  const offset = cursor?.offset ?? 0;
  const page = data.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    data: clone(page),
    meta: { hasMore: nextOffset < data.length, nextCursor: nextOffset < data.length ? listCursor(operationId, fingerprint, nextOffset) : null },
  };
}

function validateSearchRequest(query: string, scope: SearchScope, options: SearchProjectOptions, validationOptions: SearchProjectValidationOptions = {}) {
  const optionObject = options as Record<string, unknown>;
  const allowedOptionKeys = new Set(['cursor', 'filters', 'limit']);
  if (validationOptions.allowSignal !== false) {
    allowedOptionKeys.add('signal');
  }
  for (const key of Object.keys(optionObject)) {
    if (!allowedOptionKeys.has(key)) {
      throw new MockApiError(400, 'Search request contains unsupported keys.', 'searchProject', 'validation_failed');
    }
  }
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new MockApiError(400, 'Search query must be a non-empty string.', 'searchProject', 'validation_failed');
  }
  if (query.length > 500) {
    throw new MockApiError(400, 'Search query must be 500 characters or fewer.', 'searchProject', 'validation_failed');
  }
  const allowedScopes = new Set<SearchScope>(['all', 'chapters', 'annotations']);
  if (!allowedScopes.has(scope)) {
    throw new MockApiError(400, 'Search scope is invalid.', 'searchProject', 'validation_failed');
  }
  if (options.cursor !== undefined && typeof options.cursor !== 'string') {
    throw new MockApiError(400, 'Search cursor must be a string.', 'searchProject', 'validation_failed');
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50)) {
    throw new MockApiError(400, 'Search limit must be an integer between 1 and 50.', 'searchProject', 'validation_failed');
  }
  return {
    options,
    query: query.trim(),
    scope,
  };
}

function jobCursor(fingerprint: string, offset: number) {
  return `jobs:${fingerprint}:${offset}`;
}

function parseJobCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  const match = /^jobs:([0-9a-f]+):(\d+)$/.exec(cursor);
  if (!match) return null;
  return { fingerprint: match[1], offset: Number(match[2]) };
}

function validateProjectJobsQuery(query: ProjectJobsQuery = {}) {
  const allowedKinds = new Set<Job['kind']>(['import', 'indexing', 'export', 'chat_turn', 'agent_run']);
  if (query.kind !== undefined && !allowedKinds.has(query.kind)) {
    throw new MockApiError(400, 'Job kind filter is invalid.', 'listProjectJobs', 'validation_failed');
  }
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MockApiError(400, 'Job list limit must be an integer between 1 and 100.', 'listProjectJobs', 'validation_failed');
  }
  return {
    cursor: query.cursor ?? null,
    kind: query.kind ?? null,
    limit,
  };
}

function validateAgentSuggestionListQuery(query: ListAgentSuggestionsOptions = {}) {
  validateCursorListQuery('listAgentSuggestions', query, ['batchId', 'sourceMessageId', 'status']);
  const allowedKeys = new Set(['batchId', 'cursor', 'limit', 'signal', 'sourceMessageId', 'status']);
  for (const key of Object.keys(query as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      throw new MockApiError(400, 'Agent suggestion list query contains unsupported keys.', 'listAgentSuggestions', 'validation_failed');
    }
  }
  const allowedStatuses = new Set<AgentSuggestion['status']>(['pending', 'accepted', 'rejected', 'stale', 'conflict']);
  if (query.status !== undefined && !allowedStatuses.has(query.status)) {
    throw new MockApiError(400, 'Agent suggestion status filter is invalid.', 'listAgentSuggestions', 'validation_failed');
  }
  if (query.sourceMessageId !== undefined && !isNonEmptyString(query.sourceMessageId)) {
    throw new MockApiError(400, 'Agent suggestion sourceMessageId filter is invalid.', 'listAgentSuggestions', 'validation_failed');
  }
  if (query.batchId !== undefined && !isNonEmptyString(query.batchId)) {
    throw new MockApiError(400, 'Agent suggestion batchId filter is invalid.', 'listAgentSuggestions', 'validation_failed');
  }
  return query;
}

function assertLocatorRevisionMatchesChapter(locator: ReaderReferenceLocator | ReaderAnnotation['locator'], chapter: Chapter, operationId: OperationId) {
  const expectedRevision = locator.targetView === 'draft' ? chapter.draftRevision : chapter.revision;
  if (typeof locator.revision !== 'number' || locator.revision !== expectedRevision) {
    throw new MockApiError(409, 'Annotation locator revision is stale.', operationId, 'revision_conflict');
  }
}

function validateSearchFilters(filters: SearchProjectBody['filters'] | undefined) {
  if (filters === undefined) {
    return null;
  }
  if (!isRecord(filters)) {
    throw new MockApiError(400, 'Search filters must be an object.', 'searchProject', 'validation_failed');
  }
  const filterObject = filters as Record<string, unknown>;
  const allowedKeys = new Set(['bookId', 'chapterId', 'resultKinds', 'updatedSince']);
  for (const key of Object.keys(filterObject)) {
    if (!allowedKeys.has(key)) {
      throw new MockApiError(400, 'Search filters contain unsupported keys.', 'searchProject', 'validation_failed');
    }
  }
  if (filterObject.bookId !== undefined && !isNonEmptyString(filterObject.bookId)) {
    throw new MockApiError(400, 'Search ID filters must be non-empty strings.', 'searchProject', 'validation_failed');
  }
  if (filterObject.chapterId !== undefined && !isNonEmptyString(filterObject.chapterId)) {
    throw new MockApiError(400, 'Search ID filters must be non-empty strings.', 'searchProject', 'validation_failed');
  }
  if (filterObject.resultKinds !== undefined) {
    const allowedKinds = new Set<SearchResult['kind']>(['chapter', 'annotation']);
    if (
      !Array.isArray(filterObject.resultKinds) ||
      filterObject.resultKinds.length > 4 ||
      new Set(filterObject.resultKinds).size !== filterObject.resultKinds.length ||
      filterObject.resultKinds.some((kind) => typeof kind !== 'string' || !allowedKinds.has(kind as SearchResult['kind']))
    ) {
      throw new MockApiError(400, 'Search resultKinds filter is invalid.', 'searchProject', 'validation_failed');
    }
  }
  if (filterObject.updatedSince !== undefined && (typeof filterObject.updatedSince !== 'string' || Number.isNaN(Date.parse(filterObject.updatedSince)))) {
    throw new MockApiError(400, 'Search updatedSince filter is invalid.', 'searchProject', 'validation_failed');
  }
  return filterObject as {
    bookId?: string;
    chapterId?: string;
    resultKinds?: Array<SearchResult['kind']>;
    updatedSince?: string;
  };
}

function createLocator(): ReaderReferenceLocator {
  const quote = 'Мара первой заметила дым с северной пристани.';
  return {
    projectId,
    bookId,
    chapterId,
    paragraphId,
    targetView: 'published',
    revision: 7,
    range: { startOffset: 0, endOffset: quote.length, quote },
  };
}

function createJob(input: {
  id: string;
  kind: Job['kind'];
  status: Job['status'];
  progress: number;
  subject: Job['subject'];
  result?: Job['result'];
  canCancel?: boolean;
}): Job {
  return {
    id: input.id,
    kind: input.kind,
    status: input.status,
    progress: input.progress,
    subject: input.subject,
    result: input.result ?? null,
    error: null,
    canCancel: input.canCancel ?? !isTerminalJobStatus(input.status),
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    links: { self: jobUrl(input.id), cancel: `${jobUrl(input.id)}/cancel`, result: null },
  };
}

const terminalJobStatuses: readonly Job['status'][] = ['succeeded', 'failed', 'canceled', 'expired'];

function isTerminalJobStatus(status: Job['status']) {
  return terminalJobStatuses.includes(status);
}

function startResponse(job: Job, events: string | null = null): JobStartResponse {
  return { jobId: job.id, job: clone(job), links: { job: jobUrl(job.id), events, poll: jobUrl(job.id) } };
}

function jobResult(job: Job) {
  return (job.result && typeof job.result === 'object' ? job.result : {}) as Record<string, unknown>;
}

function exportJobResult(job: Job, operationId: OperationId): ExportJobResult {
  if (job.result?.type === 'export') {
    return job.result;
  }
  throw new MockApiError(409, 'Export job result is invalid.', operationId, 'invalid_job_result');
}

function createInitialState(): MockState {
  const locator = createLocator();
  const user: User = {
    id: 'user-mira',
    email: 'mira@example.com',
    emailVerified: true,
    displayName: 'Мира Волкова',
    avatarUrl: null,
    createdAt: now,
  };
  const projectBase = {
    id: projectId,
    title: 'Хроники Белого порта',
    description: 'Сага о городе, который помнит каждую клятву.',
    bookCount: 4,
    chapterCount: 186,
    wordCount: 1200000,
    createdAt: now,
    updatedAt: now,
  };
  const project: Project = {
    ...projectBase,
    currentMembership: createProjectMembershipFixture(projectBase, user, 'member-owner', 'owner'),
  };
  const book: Book = {
    id: bookId,
    projectId,
    title: 'Книга II. Карта приливов',
    subtitle: 'Черновая редакция',
    order: 2,
    displayNumber: 'II',
    coverColor: '#4F46E5',
    status: 'ready',
    chapterCount: 48,
    wordCount: 312000,
    indexing: {
      status: 'ready',
      lastIndexedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  const bookOne: Book = {
    id: 'book-01',
    projectId,
    title: 'Книга I. Туманный берег',
    subtitle: 'Первая редакция',
    order: 1,
    displayNumber: 'I',
    coverColor: '#285f58',
    status: 'ready',
    chapterCount: 22,
    wordCount: 96000,
    indexing: {
      status: 'ready',
      lastIndexedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  const bookThree: Book = {
    id: indexingBookId,
    projectId,
    title: 'Книга III. Северный суд',
    subtitle: 'Индексируется',
    order: 3,
    displayNumber: 'III',
    coverColor: '#4c3a5d',
    status: 'draft',
    chapterCount: 9,
    wordCount: 41000,
    indexing: {
      status: 'not_started',
      lastIndexedAt: null,
    },
    createdAt: now,
    updatedAt: now,
  };
  const bookFour: Book = {
    id: 'book-04',
    projectId,
    title: 'Книга IV. Последний свет',
    subtitle: 'Черновая редакция',
    order: 4,
    displayNumber: 'IV',
    coverColor: '#30472b',
    status: 'draft',
    chapterCount: 3,
    wordCount: 12000,
    indexing: {
      status: 'not_started',
      lastIndexedAt: null,
    },
    createdAt: now,
    updatedAt: now,
  };
  const foreignBook: Book = {
    ...book,
    id: 'book-foreign',
    projectId: foreignProjectId,
    title: 'Foreign Archive',
  };
  const chapter: Chapter = {
    id: chapterId,
    bookId,
    title: 'Белый порт',
    order: 12,
    contentVariant: 'published',
    status: 'published',
    paragraphs: [
      { id: 'p-12-01', order: 1, kind: 'heading', text: 'Глава 12. Белый порт', markdown: '## Глава 12. Белый порт' },
      {
        id: 'p-12-02',
        order: 2,
        kind: 'paragraph',
        text: 'Над портом стояла белая пыль, и мокрые канаты пахли солью сильнее обычного.',
        markdown: 'Над портом стояла белая пыль, и мокрые канаты пахли солью сильнее обычного.',
      },
      {
        id: paragraphId,
        order: 3,
        kind: 'paragraph',
        text: 'Мара первой заметила дым с северной пристани.',
        markdown: 'Мара первой заметила дым с северной пристани.',
      },
      {
        id: 'p-12-04',
        order: 4,
        kind: 'paragraph',
        text: 'Позже на допросе Лютов записал все коротко, будто боялся оставить в протоколе слишком много воздуха.',
        markdown: 'Позже на допросе Лютов записал все коротко, будто боялся оставить в протоколе слишком много воздуха.',
      },
      {
        id: 'p-12-05',
        order: 5,
        kind: 'paragraph',
        text: 'В остальном показания почти совпадали: рыбаки видели зарево, сторожа слышали крик.',
        markdown: 'В остальном показания почти совпадали: рыбаки видели зарево, сторожа слышали крик.',
      },
    ],
    wordCount: 2840,
    revision: 7,
    draftRevision: 8,
    publishedRevision: 7,
    savedAt: now,
    publishedAt: now,
    navigation: {
      displayNumber: '12',
      position: 12,
      total: 48,
      readingProgress: 0.25,
      readingTimeMinutes: 14,
      previousChapterId: 'chapter-11',
      nextChapterId: 'chapter-13',
      previous: { id: 'chapter-11', title: 'Соль на стекле', displayNumber: '11' },
      next: { id: 'chapter-13', title: 'Голоса под водой', displayNumber: '13' },
    },
    createdAt: now,
    updatedAt: now,
  };
  const annotation: ReaderAnnotation = {
    id: 'annotation-1',
    projectId,
    bookId,
    chapterId,
    kind: 'note',
    locator,
    quote: locator.range?.quote ?? null,
    body: 'Проверить, кто первым назвал порт Белым.',
    color: '#FEF3C7',
    status: 'saved',
    tags: ['continuity'],
    createdAt: now,
    updatedAt: now,
  };
  const draftChapter: Chapter = {
    ...chapter,
    id: draftChapterId,
    bookId,
    title: 'Возвращение к записи',
    order: 16,
    contentVariant: 'draft',
    status: 'draft',
    paragraphs: [
      { id: 'p-16-01', order: 1, kind: 'heading', text: 'Глава 16. Возвращение к записи', markdown: '## Глава 16. Возвращение к записи' },
      {
        id: 'p-16-02',
        order: 2,
        kind: 'paragraph',
        text: 'Мара вернулась к колоколу, когда порт уже затих. Она помнила, что в протоколе её имя стояло первым, и теперь хотела понять, кто и зачем правил ту страницу.',
        markdown:
          'Мара вернулась к колоколу, когда порт уже затих. Она помнила, что в протоколе её имя стояло первым, и теперь хотела понять, кто и зачем правил ту страницу.',
      },
      {
        id: 'p-16-03',
        order: 3,
        kind: 'paragraph',
        text: 'Знак на полях оказался не случайной чертой. Кто-то отмечал строки, к которым возвращался снова и снова.',
        markdown: 'Знак на полях оказался не случайной чертой. Кто-то отмечал строки, к которым возвращался снова и снова.',
      },
      {
        id: 'p-16-04',
        order: 4,
        kind: 'paragraph',
        text: 'Сава молчал, но его молчание было громче любого признания',
        markdown: 'Сава молчал, но его молчание было громче любого признания',
      },
    ],
    wordCount: 320,
    revision: 7,
    draftRevision: 9,
    publishedRevision: 7,
    savedAt: now,
    publishedAt: null,
    navigation: {
      displayNumber: '16',
      position: 16,
      total: 48,
      readingProgress: 0.34,
      readingTimeMinutes: 5,
      previousChapterId: 'chapter-15',
      nextChapterId: null,
      previous: { id: 'chapter-15', title: 'Перед судом', displayNumber: '15' },
      next: null,
    },
    createdAt: now,
    updatedAt: now,
  };
  const bookOneChapter: Chapter = {
    ...chapter,
    id: 'chapter-01-01',
    bookId: 'book-01',
    title: 'Туманный берег',
    order: 1,
    paragraphs: [
      { id: 'p-01-01', order: 1, kind: 'heading', text: 'Глава 1. Туманный берег', markdown: '## Глава 1. Туманный берег' },
      {
        id: 'p-01-02',
        order: 2,
        kind: 'paragraph',
        text: 'Утро начиналось с низкого тумана, за которым берег казался не линией, а обещанием.',
        markdown: 'Утро начиналось с низкого тумана, за которым берег казался не линией, а обещанием.',
      },
    ],
    wordCount: 1840,
    navigation: {
      ...chapter.navigation,
      displayNumber: '1',
      position: 1,
      total: 22,
      previousChapterId: null,
      nextChapterId: null,
      previous: null,
      next: null,
    },
  };
  const bookThreeChapter: Chapter = {
    ...chapter,
    id: 'chapter-03-01',
    bookId: indexingBookId,
    title: 'Северный суд',
    order: 1,
    status: 'draft',
    paragraphs: [
      { id: 'p-03-01', order: 1, kind: 'heading', text: 'Глава 1. Северный суд', markdown: '## Глава 1. Северный суд' },
      {
        id: 'p-03-02',
        order: 2,
        kind: 'paragraph',
        text: 'Суд начинался до рассвета, когда на каменных ступенях еще держалась соль.',
        markdown: 'Суд начинался до рассвета, когда на каменных ступенях еще держалась соль.',
      },
    ],
    wordCount: 2110,
    navigation: {
      ...chapter.navigation,
      displayNumber: '1',
      position: 1,
      total: 9,
      previousChapterId: null,
      nextChapterId: null,
      previous: null,
      next: null,
    },
  };
  const bookFourChapter: Chapter = {
    ...chapter,
    id: 'chapter-04-01',
    bookId: 'book-04',
    title: 'Последний свет',
    order: 1,
    status: 'draft',
    paragraphs: [
      { id: 'p-04-01', order: 1, kind: 'heading', text: 'Глава 1. Последний свет', markdown: '## Глава 1. Последний свет' },
      {
        id: 'p-04-02',
        order: 2,
        kind: 'paragraph',
        text: 'Последний маяк зажегся без смотрителя, и в городе стало слишком тихо.',
        markdown: 'Последний маяк зажегся без смотрителя, и в городе стало слишком тихо.',
      },
    ],
    wordCount: 980,
    navigation: {
      ...chapter.navigation,
      displayNumber: '1',
      position: 1,
      total: 3,
      previousChapterId: null,
      nextChapterId: null,
      previous: null,
      next: null,
    },
  };
  const foreignChapter: Chapter = {
    ...chapter,
    id: 'chapter-foreign',
    bookId: foreignBook.id,
    title: 'Foreign chapter',
  };
  const chat: ChatSession = {
    id: chatId,
    projectId,
    title: 'Пожар в Белом порту',
    messageCount: 2,
    createdAt: now,
    updatedAt: now,
  };
  const maraChat: ChatSession = {
    id: 'chat-mara-mentions',
    projectId,
    title: 'Упоминания Мары',
    messageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  const trialChat: ChatSession = {
    id: 'chat-trial-scene',
    projectId,
    title: 'Перед сценой суда',
    messageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  const foreignChat: ChatSession = {
    ...chat,
    id: 'chat-foreign',
    projectId: foreignProjectId,
    title: 'Foreign chat',
  };
  const artifact: ChatArtifact = {
    id: artifactId,
    chatId,
    messageId: 'message-assistant-1',
    kind: 'reader_reference_artifact',
    status: 'ready',
    readerReferences: [
      {
        id: 'reference-1',
        locator,
        label: 'Книга II · Глава 12 · абзац 2',
        quote: locator.range?.quote ?? '',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const agentQuote = 'Сава молчал, но его молчание было громче любого признания';
  const agentRange = { startOffset: 0, endOffset: agentQuote.length, quote: agentQuote };
  const agentLocator: ReaderReferenceLocator = {
    projectId,
    bookId,
    chapterId: draftChapterId,
    paragraphId: 'p-16-04',
    targetView: 'draft',
    revision: draftChapter.draftRevision,
    range: agentRange,
  };
  const suggestion: AgentSuggestion = {
    id: suggestionId,
    chapterId: draftChapterId,
    kind: 'punctuation',
    title: 'Добавить запятую после «молчал»',
    rationale: 'Добавил запятую после «молчал» и точку в конце предложения.',
    baseChapterRevision: draftChapter.draftRevision,
    batchId,
    sourceMessageId: 'message-assistant-1',
    anchorLocator: agentLocator,
    contextQuote: agentQuote,
    diffs: [
      {
        hunkId: 'hunk-1',
        range: { ...agentLocator, paragraphId: 'p-16-04', range: agentRange },
        before: 'Сава молчал но его молчание было громче любого признания',
        after: 'Сава молчал, но его молчание было громче любого признания.',
      },
    ],
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  return {
    user,
    session: { user },
    projects: [project],
    invitations: [
      createProjectInvitationFixture(projectId, 'invitation-1', 'pending'),
      createProjectInvitationFixture(projectId, 'invitation-mira', 'pending', 'mira@example.com'),
      createProjectInvitationFixture(projectId, 'invitation-accepted', 'accepted'),
      createProjectInvitationFixture(projectId, 'invitation-canceled', 'canceled'),
    ],
    memberships: [
      createProjectMembershipFixture(project, user, 'member-owner', 'owner'),
      createProjectMembershipFixture(project, user, 'member-collaborator', 'editor'),
    ],
    books: [bookOne, book, bookThree, bookFour, foreignBook],
    chapters: [bookOneChapter, chapter, draftChapter, bookThreeChapter, bookFourChapter, foreignChapter],
    annotations: [annotation],
    chats: [chat, maraChat, trialChat, foreignChat],
    messages: [
      {
        id: 'message-user-1',
        chatId,
        role: 'user',
        content: 'Кто первым заметил пожар в Белом порту?',
        parts: [{ type: 'text', text: 'Кто первым заметил пожар в Белом порту?', sequence: 1, status: 'completed' }],
        references: [],
        createdAt: now,
      },
      {
        id: 'message-assistant-1',
        chatId,
        role: 'assistant',
        content: 'По ранней записи первый дым заметила Мара с северной пристани.',
        parts: [
          {
            type: 'text',
            text: 'По ранней записи первый дым заметила Мара с северной пристани.',
            sequence: 1,
            status: 'completed',
          },
        ],
        references: [{ kind: 'reader_reference_artifact', artifactId }],
        createdAt: now,
      },
      {
        id: 'message-assistant-mara',
        chatId: maraChat.id,
        role: 'assistant',
        content: 'Мара появляется в главах 4, 8 и 12. Последнее упоминание связано с дымом у северной пристани.',
        parts: [
          {
            type: 'text',
            text: 'Мара появляется в главах 4, 8 и 12. Последнее упоминание связано с дымом у северной пристани.',
            sequence: 1,
            status: 'completed',
          },
        ],
        references: [],
        createdAt: now,
      },
      {
        id: 'message-assistant-trial',
        chatId: trialChat.id,
        role: 'assistant',
        content: 'Связку можно строить через протокол Лютова: он переносит первенство с Мары на Саву.',
        parts: [
          {
            type: 'text',
            text: 'Связку можно строить через протокол Лютова: он переносит первенство с Мары на Саву.',
            sequence: 1,
            status: 'completed',
          },
        ],
        references: [],
        createdAt: now,
      },
    ],
    artifacts: [artifact],
    suggestions: [suggestion],
    jobs: [
      createJob({
        id: 'index-job-1',
        kind: 'indexing',
        status: 'running',
        progress: 0.64,
        subject: { type: 'book', id: indexingBookId, projectId },
        result: {
          type: 'progress',
          bookId: indexingBookId,
          stage: 'embedding',
          currentUnit: 9,
          totalUnits: 14,
          unitLabel: 'главы',
          stageLabel: 'Векторизация фрагментов',
          sourceFileName: 'northern-court.epub',
        },
        canCancel: true,
      }),
      createJob({
        id: 'foreign-job-1',
        kind: 'indexing',
        status: 'running',
        progress: 0.2,
        subject: { type: 'book', id: foreignBook.id, projectId: foreignProjectId },
        result: { type: 'progress', stage: 'queued', currentUnit: 1, totalUnits: 3 },
        canCancel: true,
      }),
    ],
  };
}

export class MockRepository implements CanonKeeperApiClient {
  private state = createInitialState();
  private scenario: MockScenarioControl = normalScenario;
  private directIdempotency = new Map<string, DirectIdempotencyRecord>();
  private jobCreators = new Map<string, JobCreatorRecord>();
  private chatTurnLatestEventIds = new Map<string, string>();

  setScenario(scenario: MockScenarioControl) {
    this.scenario = scenario;
  }

  getScenario() {
    return this.scenario;
  }

  hasActiveSession() {
    return this.state.session !== null;
  }

  private applyOperation(operationId: OperationId) {
    if (isProtectedOperation(operationId) && !this.state.session) {
      throw new MockApiError(401, 'Сессия истекла. Войдите снова.', operationId);
    }
    applyScenario(operationId, this.scenario);
  }

  reset() {
    this.state = createInitialState();
    this.scenario = normalScenario;
    this.directIdempotency.clear();
    this.jobCreators.clear();
    this.chatTurnLatestEventIds.clear();
  }

  private reorderProjectBook(projectId: string, bookId: string, afterBookId: string | null | undefined, operationId: 'createBook' | 'updateBook') {
    const orderedBooks = this.state.books
      .filter((book) => book.projectId === projectId)
      .sort((left, right) => left.order - right.order);
    const movedBook = orderedBooks.find((book) => book.id === bookId);
    if (!movedBook) {
      throw new MockApiError(404, 'Resource not found.', operationId);
    }

    let nextOrder = orderedBooks;
    if (afterBookId !== undefined && afterBookId !== bookId) {
      const withoutMovedBook = orderedBooks.filter((book) => book.id !== bookId);
      const insertIndex = afterBookId === null
        ? 0
        : withoutMovedBook.findIndex((book) => book.id === afterBookId) + 1;
      if (insertIndex === 0 && afterBookId !== null) {
        throw new MockApiError(404, 'Resource not found.', operationId);
      }
      withoutMovedBook.splice(insertIndex, 0, movedBook);
      nextOrder = withoutMovedBook;
    }

    nextOrder.forEach((book, index) => {
      const order = index + 1;
      const displayNumber = bookDisplayNumber(order);
      book.order = order;
      book.displayNumber = displayNumber;
    });
    this.state.books = [
      ...nextOrder,
      ...this.state.books.filter((book) => book.projectId !== projectId),
    ];
  }

  private refreshChapterNavigation(bookId: string) {
    const book = this.state.books.find((candidate) => candidate.id === bookId);
    const orderedChapters = this.state.chapters
      .filter((chapter) => chapter.bookId === bookId)
      .sort((left, right) => left.order - right.order);
    const total = Math.max(book?.chapterCount ?? 0, orderedChapters.length);

    orderedChapters.forEach((chapter, index) => {
      const previous = orderedChapters[index - 1] ?? null;
      const next = orderedChapters[index + 1] ?? null;
      chapter.navigation = {
        ...chapter.navigation,
        displayNumber: String(chapter.order),
        position: chapter.order,
        total,
        previousChapterId: previous?.id ?? null,
        nextChapterId: next?.id ?? null,
        previous: previous
          ? { id: previous.id, title: previous.title, displayNumber: String(previous.order) }
          : null,
        next: next ? { id: next.id, title: next.title, displayNumber: String(next.order) } : null,
      };
    });
  }

  private chapterInsertOrder(bookId: string, afterChapterId: string | null | undefined, operationId: 'createChapter') {
    const siblings = this.state.chapters.filter((chapter) => chapter.bookId === bookId);
    if (afterChapterId === undefined) {
      return Math.max(0, ...siblings.map((chapter) => chapter.order)) + 1;
    }
    if (afterChapterId === null) {
      return Math.min(...siblings.map((chapter) => chapter.order), 1);
    }
    const afterChapter = siblings.find((chapter) => chapter.id === afterChapterId);
    if (!afterChapter) {
      throw new MockApiError(404, 'Resource not found.', operationId);
    }
    return afterChapter.order + 1;
  }

  async register(body: OperationRequest<'registerUser'>): Promise<OperationResponse<'registerUser', '201'>> {
    this.applyOperation('registerUser');
    validateRegisterRequest(body);
    if (normalizedEmail(body.email) === normalizedEmail(this.state.user.email)) {
      throw new MockApiError(409, 'Registration cannot be completed.', 'registerUser', 'registration_conflict');
    }
    this.state.user = { ...this.state.user, displayName: body.displayName, email: body.email };
    this.state.session = { user: this.state.user };
    return clone(this.state.session);
  }

  async login(body: OperationRequest<'loginUser'>): Promise<OperationResponse<'loginUser', '200'>> {
    this.applyOperation('loginUser');
    if (normalizedEmail(body.email) !== normalizedEmail(this.state.user.email) || body.password !== mockPassword) {
      throw new MockApiError(401, 'Authentication failed.', 'loginUser', 'auth_failed');
    }
    this.state.session = { user: this.state.user };
    return clone(this.state.session);
  }

  async rotateSession(): Promise<OperationResponse<'rotateSession', '200'>> {
    this.applyOperation('rotateSession');
    if (!this.state.session) {
      throw new MockApiError(401, 'Сессия отсутствует.', 'rotateSession');
    }
    this.state.session = { user: this.state.user };
    return clone(this.state.session);
  }

  async logout(): Promise<void> {
    this.applyOperation('logoutUser');
    this.state.session = null;
  }

  async getCurrentUser(): Promise<OperationResponse<'getCurrentUser', '200'>> {
    this.applyOperation('getCurrentUser');
    if (!this.state.session) {
      throw new MockApiError(401, 'Сессия отсутствует.', 'getCurrentUser');
    }
    return clone(this.state.session.user);
  }

  async listProjects(options: CursorListOptions = {}): Promise<OperationResponse<'listProjects', '200'>> {
    this.applyOperation('listProjects');
    const rawRole = this.rawActorRole();
    const projects = rawRole === 'non_member'
      ? this.state.projects.filter((project) => this.acceptedInvitationMembership(project.id))
      : this.state.projects;
    const data = projects.length === 0 || this.scenario.preset === 'empty-lists'
      ? []
      : projects.map((project) => this.visibleProject(project));
    return paginateList('listProjects', data, options, { actorRole: this.actorRole() });
  }

  async createProject(body: OperationRequest<'createProject'>): Promise<OperationResponse<'createProject', '201'>> {
    this.applyOperation('createProject');
    if (this.scenario.preset === 'failed-create') {
      throw new MockApiError(500, 'Не удалось создать проект.', 'createProject');
    }
    const projectBase = {
      id: `project-${this.state.projects.length + 1}`,
      title: body.title,
      description: body.description ?? null,
      bookCount: 0,
      chapterCount: 0,
      wordCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const project: Project = {
      ...projectBase,
      currentMembership: createProjectMembershipFixture(projectBase, this.state.user, 'member-owner', 'owner'),
    };
    this.state.projects.push(project);
    this.state.memberships.push(this.projectMembership(project, 'member-owner', 'owner'));
    return this.visibleProject(project);
  }

  async getProject(id: string): Promise<OperationResponse<'getProject', '200'>> {
    this.applyOperation('getProject');
    return this.visibleProject(this.projectFor(id, 'getProject'));
  }

  async updateProject(id: string, body: OperationRequest<'updateProject'>): Promise<OperationResponse<'updateProject', '200'>> {
    this.applyOperation('updateProject');
    validateUpdateProjectRequest(body);
    const project = this.projectFor(id, 'updateProject', ['editor', 'admin', 'owner']);
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      project.description = body.description ?? '';
    }
    if (Object.prototype.hasOwnProperty.call(body, 'title')) {
      project.title = body.title!;
    }
    project.updatedAt = now;
    return this.visibleProject(project);
  }

  async deleteProject(id: string): Promise<void> {
    this.applyOperation('deleteProject');
    this.projectFor(id, 'deleteProject', ['admin', 'owner']);
    const removedBookIds = new Set(this.state.books.filter((book) => book.projectId === id).map((book) => book.id));
    const removedChapterIds = new Set(
      this.state.chapters.filter((chapter) => removedBookIds.has(chapter.bookId)).map((chapter) => chapter.id),
    );
    const removedChatIds = new Set(this.state.chats.filter((chat) => chat.projectId === id).map((chat) => chat.id));
    this.state.projects = this.state.projects.filter((project) => project.id !== id);
    this.state.books = this.state.books.filter((book) => book.projectId !== id);
    this.state.chapters = this.state.chapters.filter((chapter) => !removedBookIds.has(chapter.bookId));
    this.state.annotations = this.state.annotations.filter((annotation) => annotation.projectId !== id);
    this.state.chats = this.state.chats.filter((chat) => chat.projectId !== id);
    this.state.messages = this.state.messages.filter((message) => !removedChatIds.has(message.chatId));
    this.state.suggestions = this.state.suggestions.filter((suggestion) => !removedChapterIds.has(suggestion.chapterId));
    this.state.jobs = this.state.jobs.filter((job) => job.subject.projectId !== id);
    this.state.memberships = this.state.memberships.filter((membership) => membership.projectId !== id);
  }

  async listProjectMembers(id: string, options: CursorListOptions = {}): Promise<OperationResponse<'listProjectMembers', '200'>> {
    this.applyOperation('listProjectMembers');
    const project = this.projectFor(id, 'listProjectMembers');
    this.requireProjectAccess('listProjectMembers', project.id, ['admin', 'owner']);
    return paginateList('listProjectMembers', this.state.memberships.filter((membership) => membership.projectId === project.id), options, { projectId: project.id });
  }

  async updateProjectMemberRole(projectIdInput: string, memberId: string, body: OperationRequest<'updateProjectMemberRole'>): Promise<OperationResponse<'updateProjectMemberRole', '200'>> {
    this.applyOperation('updateProjectMemberRole');
    validateUpdateProjectMemberRoleRequest(body);
    const project = this.projectFor(projectIdInput, 'updateProjectMemberRole');
    const membership = this.state.memberships.find((candidate) => candidate.projectId === project.id && candidate.id === memberId);
    if (!membership) {
      throw new MockApiError(404, 'Resource not found.', 'updateProjectMemberRole');
    }
    this.requireProjectAccess('updateProjectMemberRole', project.id, ['admin', 'owner']);
    if (membership.role === 'owner') {
      throw new MockApiError(409, 'Owner membership cannot be changed while ownership transfer is out of scope.', 'updateProjectMemberRole');
    }
    Object.assign(membership, { role: body.role, updatedAt: now });
    return clone(membership);
  }

  async removeProjectMember(projectIdInput: string, memberId: string): Promise<void> {
    this.applyOperation('removeProjectMember');
    const project = this.projectFor(projectIdInput, 'removeProjectMember');
    const membership = this.state.memberships.find((candidate) => candidate.projectId === project.id && candidate.id === memberId);
    if (!membership) {
      throw new MockApiError(404, 'Resource not found.', 'removeProjectMember');
    }
    this.requireProjectAccess('removeProjectMember', project.id, ['admin', 'owner']);
    if (membership.role === 'owner') {
      throw new MockApiError(409, 'Owner membership cannot be removed while last-owner transfer is out of scope.', 'removeProjectMember');
    }
    this.state.memberships = this.state.memberships.filter((candidate) => !(candidate.projectId === project.id && candidate.id === memberId));
  }

  async listProjectInvitations(id: string, options: CursorListOptions = {}): Promise<OperationResponse<'listProjectInvitations', '200'>> {
    this.applyOperation('listProjectInvitations');
    const project = this.projectFor(id, 'listProjectInvitations');
    this.requireProjectAccess('listProjectInvitations', project.id, ['admin', 'owner']);
    return paginateList('listProjectInvitations', this.state.invitations.filter((invitation) => invitation.projectId === project.id), options, { projectId: project.id });
  }

  async listMyProjectInvitations(options: CursorListOptions = {}): Promise<OperationResponse<'listMyProjectInvitations', '200'>> {
    this.applyOperation('listMyProjectInvitations');
    if (!this.state.session) {
      throw new MockApiError(401, 'Сессия отсутствует.', 'listMyProjectInvitations');
    }
    const providerVerified = this.state.session.user.emailVerified && this.scenario.emailVerified !== false;
    const verifiedEmail = providerVerified ? (this.scenario.verifiedEmail ?? this.state.session.user.email) : null;
    if (!verifiedEmail || normalizedEmail(verifiedEmail) !== normalizedEmail(this.state.session.user.email)) {
      throw new MockApiError(403, 'Email is not verified for invitation discovery.', 'listMyProjectInvitations');
    }
    const email = normalizedEmail(verifiedEmail);
    const invitations = this.state.invitations.filter((invitation) => invitation.status === 'pending' && normalizedEmail(invitation.email) === email);
    return paginateList('listMyProjectInvitations', invitations, options, { verifiedEmail: email });
  }

  async createProjectInvitation(id: string, body: OperationRequest<'createProjectInvitation'>): Promise<OperationResponse<'createProjectInvitation', '201'>> {
    this.applyOperation('createProjectInvitation');
    const project = this.projectFor(id, 'createProjectInvitation');
    this.requireProjectAccess('createProjectInvitation', project.id, ['admin', 'owner']);
    if ((body as { role?: string }).role === 'owner') {
      throw new MockApiError(400, 'Owner invitations are out of scope.', 'createProjectInvitation');
    }
    const inviter = this.state.session?.user ?? this.state.user;
    const invitation = createProjectInvitationFixture(
      project.id,
      `invitation-created-${this.state.invitations.length + 1}`,
      'pending',
      body.email,
      body.role,
      project.title,
      inviter,
    );
    this.state.invitations.push(invitation);
    return clone(invitation);
  }

  async cancelProjectInvitation(id: string): Promise<OperationResponse<'cancelProjectInvitation', '200'>> {
    this.applyOperation('cancelProjectInvitation');
    const invitation = this.invitationFor(id, 'cancelProjectInvitation');
    const project = this.projectFor(invitation.projectId, 'cancelProjectInvitation');
    this.requireProjectAccess('cancelProjectInvitation', project.id, ['admin', 'owner']);
    if (invitation.status !== 'pending') {
      throw new MockApiError(409, 'Invitation is not pending.', 'cancelProjectInvitation');
    }
    const canceled = { ...invitation, status: 'canceled' as const, acceptedAt: null, updatedAt: now };
    this.state.invitations = this.state.invitations.map((candidate) => (candidate.id === id ? canceled : candidate));
    return clone(canceled);
  }

  async acceptProjectInvitation(id: string): Promise<OperationResponse<'acceptProjectInvitation', '200'>> {
    this.applyOperation('acceptProjectInvitation');
    if (this.rawActorRole() !== 'non_member') {
      throw new MockApiError(403, 'Нет доступа к этому проекту.', 'acceptProjectInvitation');
    }
    const invitation = this.invitationFor(id, 'acceptProjectInvitation');
    const authenticatedUser = this.state.session?.user ?? this.state.user;
    const providerVerified = authenticatedUser.emailVerified && this.scenario.emailVerified !== false;
    const verifiedEmail = providerVerified ? (this.scenario.verifiedEmail ?? authenticatedUser.email) : null;
    if (!verifiedEmail || normalizedEmail(verifiedEmail) !== normalizedEmail(invitation.email)) {
      throw new MockApiError(404, 'Resource not found.', 'acceptProjectInvitation');
    }
    if (normalizedEmail(authenticatedUser.email) !== normalizedEmail(invitation.email)) {
      throw new MockApiError(404, 'Resource not found.', 'acceptProjectInvitation');
    }
    if (invitation.status !== 'pending') {
      throw new MockApiError(409, 'Invitation is not pending.', 'acceptProjectInvitation');
    }
    const project = this.state.projects.find((candidate) => candidate.id === invitation.projectId);
    if (!project) {
      throw new MockApiError(404, 'Resource not found.', 'acceptProjectInvitation');
    }
    const accepted = { ...invitation, status: 'accepted' as const, acceptedAt: now, updatedAt: now };
    this.state.invitations = this.state.invitations.map((candidate) => (candidate.id === id ? accepted : candidate));
    const membership = createProjectMembershipForUser(project, authenticatedUser, `member-${id}`, invitation.role);
    this.state.memberships = [
      ...this.state.memberships.filter((candidate) => !(candidate.projectId === project.id && candidate.id === membership.id)),
      membership,
    ];
    return clone(membership);
  }

  async listBooks(id: string, options: CursorListOptions = {}): Promise<OperationResponse<'listBooks', '200'>> {
    this.applyOperation('listBooks');
    this.requireProjectAccess('listBooks', id);
    const data = this.state.books.filter((book) => book.projectId === id);
    return paginateList('listBooks', this.scenario.preset === 'empty-lists' ? [] : data, options, { projectId: id });
  }

  async createBook(id: string, body: OperationRequest<'createBook'>): Promise<OperationResponse<'createBook', '201'>> {
    this.applyOperation('createBook');
    this.requireProjectAccess('createBook', id, ['editor', 'admin', 'owner']);
    if (this.scenario.preset === 'failed-create') {
      throw new MockApiError(500, 'Не удалось создать книгу.', 'createBook');
    }
    const book: Book = {
      id: `book-${this.state.books.length + 1}`,
      projectId: id,
      title: body.title,
      subtitle: body.subtitle ?? null,
      order: this.state.books.length + 1,
      displayNumber: String(this.state.books.length + 1),
      coverColor: body.coverColor ?? '#4F46E5',
      status: 'draft',
      chapterCount: 0,
      wordCount: 0,
      indexing: {
        status: 'not_started',
        lastIndexedAt: null,
      },
      createdAt: now,
      updatedAt: now,
    };
    this.state.books.push(book);
    this.reorderProjectBook(id, book.id, body.afterBookId, 'createBook');
    return clone(book);
  }

  async getBook(id: string): Promise<OperationResponse<'getBook', '200'>> {
    this.applyOperation('getBook');
    return clone(this.bookFor(id, 'getBook'));
  }

  async updateBook(id: string, body: OperationRequest<'updateBook'>): Promise<OperationResponse<'updateBook', '200'>> {
    this.applyOperation('updateBook');
    const book = this.bookFor(id, 'updateBook', ['editor', 'admin', 'owner']);
    if (body.title !== undefined) book.title = body.title;
    if (body.subtitle !== undefined) book.subtitle = body.subtitle;
    if (body.coverColor !== undefined) book.coverColor = body.coverColor;
    book.updatedAt = now;
    if (Object.hasOwn(body, 'afterBookId')) {
      this.reorderProjectBook(book.projectId, book.id, body.afterBookId, 'updateBook');
    }
    return clone(book);
  }

  async deleteBook(id: string): Promise<void> {
    this.applyOperation('deleteBook');
    this.bookFor(id, 'deleteBook', ['editor', 'admin', 'owner']);
    const removedChapterIds = new Set(
      this.state.chapters.filter((chapter) => chapter.bookId === id).map((chapter) => chapter.id),
    );
    const removedArtifactIds = new Set(
      this.state.artifacts
        .filter((artifact) => artifact.readerReferences?.some((reference) => reference.locator.bookId === id || removedChapterIds.has(reference.locator.chapterId)))
        .map((artifact) => artifact.id),
    );
    this.state.books = this.state.books.filter((book) => book.id !== id);
    this.state.chapters = this.state.chapters.filter((chapter) => chapter.bookId !== id);
    this.state.annotations = this.state.annotations.filter((annotation) => annotation.bookId !== id && !removedChapterIds.has(annotation.chapterId));
    this.state.suggestions = this.state.suggestions.filter((suggestion) => !removedChapterIds.has(suggestion.chapterId));
    this.state.artifacts = this.state.artifacts.filter((artifact) => !removedArtifactIds.has(artifact.id));
    this.state.jobs = this.state.jobs.filter((job) => {
      const result = jobResult(job);
      if (job.subject.type === 'book' && job.subject.id === id) return false;
      if (job.subject.type === 'chapter' && removedChapterIds.has(job.subject.id)) return false;
      if (typeof result.bookId === 'string' && result.bookId === id) return false;
      return true;
    });
  }

  async getImportConstraints(_id: string): Promise<OperationResponse<'getImportConstraints', '200'>> {
    this.applyOperation('getImportConstraints');
    this.requireProjectAccess('getImportConstraints', _id);
    return {
      allowedExtensions: [...allowedImportExtensions],
      allowedMimeTypes: [...allowedImportMimeTypes],
      maxFileSizeBytes: maxImportFileSizeBytes,
    };
  }

  async importBookFile(
    id: string,
    input: MockImportBookInput,
    options: RequiredIdempotencyOptions,
  ): Promise<OperationResponse<'importBookFile', '202'>> {
    this.applyOperation('importBookFile');
    this.requireProjectAccess('importBookFile', id, ['editor', 'admin', 'owner']);
    validateImportBookInput(input);
    return this.idempotentCommand('importBookFile', id, options, input, () => this.createImportBookJob(id, input));
  }

  private createImportBookJob(
    id: string,
    input: MockImportBookInput,
  ): OperationResponse<'importBookFile', '202'> {
    const sourceFileName = importFileDetails(input.file).name;
    const job = createJob({
      id: `index-job-${this.state.jobs.length + 1}`,
      kind: 'import',
      status: 'queued',
      progress: 0,
      subject: { type: 'book', id: indexingBookId, projectId: id },
      result: {
        type: 'progress',
        bookId: indexingBookId,
        stage: 'queued',
        currentUnit: 0,
        totalUnits: 14,
        unitLabel: 'главы',
        sourceFileName,
        title: input.metadata?.title,
        importMode: input.options?.importMode ?? 'new_book',
      },
      canCancel: true,
    });
    this.state.jobs.push(job);
    this.markJobCreator(job);
    const book = this.state.books.find((candidate) => candidate.id === indexingBookId) ?? this.state.books.find((candidate) => candidate.projectId === id);
    if (book) {
      book.indexing = {
        status: 'not_started',
        lastIndexedAt: null,
      };
      book.status = 'draft';
      book.updatedAt = now;
    }
    return startResponse(job);
  }

  async listProjectJobs(id: string, query: ProjectJobsQuery = {}): Promise<OperationResponse<'listProjectJobs', '200'>> {
    this.applyOperation('listProjectJobs');
    this.requireProjectAccess('listProjectJobs', id);
    const { cursor: rawCursor, kind, limit } = validateProjectJobsQuery(query);
    const jobs = this.state.jobs.filter((job) => job.subject.projectId === id && (!kind || job.kind === kind));
    const fingerprint = hashString(stableStringify({ kind, limit, projectId: id }));
    const cursor = parseJobCursor(rawCursor);
    if (rawCursor && (!cursor || cursor.fingerprint !== fingerprint)) {
      throw new MockApiError(400, 'Job list cursor no longer matches the request fingerprint.', 'listProjectJobs', 'invalid_cursor');
    }
    const offset = cursor?.offset ?? 0;
    const data = jobs.slice(offset, offset + limit).map((job) => this.visibleJob(job));
    const nextOffset = offset + data.length;
    return {
      data,
      meta: { hasMore: nextOffset < jobs.length, nextCursor: nextOffset < jobs.length ? jobCursor(fingerprint, nextOffset) : null },
    };
  }

  async startProjectIndexing(
    id: string,
    body: OperationRequest<'startProjectIndexing'>,
    options: RequiredIdempotencyOptions,
  ): Promise<OperationResponse<'startProjectIndexing', '202'>> {
    this.applyOperation('startProjectIndexing');
    this.requireProjectAccess('startProjectIndexing', id, ['editor', 'admin', 'owner']);
    return this.idempotentCommand('startProjectIndexing', id, options, body, () => this.createProjectIndexingJob(id));
  }

  private createProjectIndexingJob(id: string): OperationResponse<'startProjectIndexing', '202'> {
    const job = createJob({
      id: `index-job-${this.state.jobs.length + 1}`,
      kind: 'indexing',
      status: 'queued',
      progress: 0,
      subject: { type: 'project', id, projectId: id },
      result: { type: 'progress', stage: 'queued', currentUnit: 0, totalUnits: 14, unitLabel: 'главы', stageLabel: 'Постановка в очередь' },
      canCancel: true,
    });
    this.state.jobs.push(job);
    this.markJobCreator(job);
    return startResponse(job);
  }

  async getJob(id: string): Promise<OperationResponse<'getJob', '200'>> {
    this.applyOperation('getJob');
    const job = this.jobFor(id, 'getJob');
    if (job.kind === 'export') {
      const activeExportStatus = !isTerminalJobStatus(job.status) && job.status !== 'canceling';
      if (this.scenario.preset === 'export-error' && activeExportStatus) {
        Object.assign(job, { status: 'failed', progress: 1, error: { type: 'about:blank', title: 'Export failed', status: 409, code: 'export_failed', requestId: 'req_mock_export' }, updatedAt: now });
        job.result = { ...exportJobResult(job, 'getJob'), errorMessage: 'Экспорт временно недоступен.' };
      } else if (job.status === 'canceling') {
        Object.assign(job, { status: 'canceled', canCancel: false, updatedAt: now });
      } else if (activeExportStatus) {
        Object.assign(job, { status: 'succeeded', progress: 1, canCancel: false, updatedAt: now });
        const result = exportJobResult(job, 'getJob');
        job.result = { ...result, downloadUrl: `${apiBasePath}/mock-downloads/${job.id}.${result.format}` };
      }
    }
    return this.visibleJob(job);
  }

  async cancelJob(id: string): Promise<OperationResponse<'cancelJob', '200'>> {
    this.applyOperation('cancelJob');
    const job = this.jobFor(id, 'cancelJob');
    this.requireJobCancelAccess(job);
    if (!job.canCancel || isTerminalJobStatus(job.status)) {
      return this.visibleJob(job);
    }
    Object.assign(job, { status: 'canceling', progress: job.progress, canCancel: false, updatedAt: now });
    if (job.kind === 'import' || job.kind === 'indexing') {
      const resultBookId = jobResult(job).bookId;
      const bookId = job.subject.type === 'book' ? job.subject.id : isNonEmptyString(resultBookId) ? resultBookId : undefined;
      const book = bookId ? this.state.books.find((candidate) => candidate.id === bookId) : undefined;
      if (book) {
        book.indexing = { ...book.indexing, status: 'failed' };
        book.status = 'error';
        book.updatedAt = now;
      }
    }
    return this.visibleJob(job);
  }

  async createBookExport(
    id: string,
    body: OperationRequest<'createBookExport'>,
    options: RequiredIdempotencyOptions,
  ): Promise<OperationResponse<'createBookExport', '202'>> {
    this.applyOperation('createBookExport');
    const book = this.bookFor(id, 'createBookExport', ['admin', 'owner']);
    return this.idempotentCommand('createBookExport', id, options, body, () => this.createBookExportJob(id, body, book.projectId));
  }

  private createBookExportJob(
    id: string,
    body: OperationRequest<'createBookExport'>,
    projectIdForBook: string,
  ): OperationResponse<'createBookExport', '202'> {
    const job = createJob({
      id: `export-job-${this.state.jobs.length + 1}`,
      kind: 'export',
      status: this.scenario.preset === 'export-ready' ? 'succeeded' : 'running',
      progress: this.scenario.preset === 'export-ready' ? 1 : 0.35,
      subject: { type: 'book', id, projectId: projectIdForBook },
      result: {
        type: 'export',
        bookId: id,
        format: body.format,
        downloadUrl: this.scenario.preset === 'export-ready' ? `${apiBasePath}/mock-downloads/book.epub` : null,
      },
      canCancel: this.scenario.preset !== 'export-ready',
    });
    this.state.jobs.push(job);
    this.markJobCreator(job);
    return startResponse(job);
  }

  async listChapters(id: string, options: CursorListOptions = {}): Promise<OperationResponse<'listChapters', '200'>> {
    this.applyOperation('listChapters');
    this.bookFor(id, 'listChapters');
    const data = this.state.chapters
      .filter((chapter) => chapter.bookId === id)
      .sort((left, right) => left.order - right.order)
      .map((chapter) => ({
        id: chapter.id,
        bookId: chapter.bookId,
        title: chapter.title,
        order: chapter.order,
        displayNumber: String(chapter.order),
        status: chapter.status,
        wordCount: chapter.wordCount,
        hasDraft: chapter.draftRevision > (typeof chapter.publishedRevision === 'number' ? chapter.publishedRevision : 0),
      }));
    return paginateList('listChapters', data, options, { bookId: id });
  }

  async createChapter(id: string, body: OperationRequest<'createChapter'>): Promise<OperationResponse<'createChapter', '201'>> {
    this.applyOperation('createChapter');
    if (this.scenario.preset === 'failed-create') {
      throw new MockApiError(500, 'Не удалось создать главу.', 'createChapter');
    }

    const book = this.bookFor(id, 'createChapter', ['editor', 'admin', 'owner']);
    const nextOrder = this.chapterInsertOrder(id, body.afterChapterId, 'createChapter');
    this.state.chapters
      .filter((chapter) => chapter.bookId === id && chapter.order >= nextOrder)
      .forEach((chapter) => {
        chapter.order += 1;
      });
    const paragraphs = (body.paragraphs?.length ? body.paragraphs : [{ order: 1, kind: 'paragraph' as const, markdown: '', text: '' }]).map(
      (paragraph, index) => ({
        id: paragraph.id ?? `p-${nextOrder}-${index + 1}`,
        order: paragraph.order,
        kind: paragraph.kind,
        text: paragraph.text ?? paragraph.markdown,
        markdown: paragraph.markdown,
      }),
    );
    const wordCount = countWords(paragraphs.map((paragraph) => paragraph.text).join(' '));
    const chapter: Chapter = {
      id: nextChapterId(this.state.chapters, id),
      bookId: id,
      title: body.title,
      order: nextOrder,
      contentVariant: 'draft',
      status: 'draft',
      paragraphs,
      wordCount,
      revision: 1,
      draftRevision: 1,
      publishedRevision: null,
      savedAt: now,
      publishedAt: null,
      navigation: {
        displayNumber: String(nextOrder),
        position: nextOrder,
        total: book.chapterCount + 1,
        readingProgress: 0,
        readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 220)),
        previousChapterId: null,
        nextChapterId: null,
        previous: null,
        next: null,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.state.chapters.push(chapter);
    book.chapterCount += 1;
    book.wordCount += wordCount;
    book.updatedAt = now;
    this.refreshChapterNavigation(id);
    return clone(chapter);
  }

  async getChapter(id: string): Promise<OperationResponse<'getChapter', '200'>> {
    this.applyOperation('getChapter');
    return clone(this.chapterFor(id, 'getChapter'));
  }

  async updateChapter(id: string, body: OperationRequest<'updateChapter'>): Promise<OperationResponse<'updateChapter', '200'>> {
    this.applyOperation('updateChapter');
    const chapter = this.chapterFor(id, 'updateChapter', ['editor', 'admin', 'owner']);
    if (this.scenario.preset === 'conflict' || body.expectedRevision !== chapter.draftRevision) {
      throw new MockApiError(409, 'Черновик изменился в другом окне.', 'updateChapter');
    }
    chapter.title = body.title ?? chapter.title;
    chapter.draftRevision += 1;
    if (body.paragraphs) {
      chapter.paragraphs = body.paragraphs.map((paragraph, index) => ({
        id: typeof paragraph.id === 'string' ? paragraph.id : `p-new-${index + 1}`,
        order: paragraph.order,
        kind: paragraph.kind,
        text: paragraph.text ?? paragraph.markdown,
        markdown: paragraph.markdown,
      }));
    }
    return clone(chapter);
  }

  async publishChapter(id: string, body: OperationRequest<'publishChapter'>): Promise<OperationResponse<'publishChapter', '200'>> {
    this.applyOperation('publishChapter');
    const chapter = this.chapterFor(id, 'publishChapter', ['editor', 'admin', 'owner']);
    if (this.scenario.preset === 'conflict' || body.expectedDraftRevision !== chapter.draftRevision) {
      throw new MockApiError(409, 'Версия черновика устарела.', 'publishChapter');
    }
    Object.assign(chapter, { status: 'published', publishedRevision: chapter.draftRevision, publishedAt: now });
    return clone(chapter);
  }

  async deleteChapter(id: string): Promise<void> {
    this.applyOperation('deleteChapter');
    const chapter = this.chapterFor(id, 'deleteChapter', ['editor', 'admin', 'owner']);
    this.state.chapters = this.state.chapters.filter((candidate) => candidate.id !== id);
    this.state.annotations = this.state.annotations.filter((annotation) => annotation.chapterId !== id);
    this.state.suggestions = this.state.suggestions.filter((suggestion) => suggestion.chapterId !== id);
    const book = this.state.books.find((candidate) => candidate.id === chapter.bookId);
    if (book) {
      book.chapterCount = Math.max(0, book.chapterCount - 1);
      book.wordCount = Math.max(0, book.wordCount - chapter.wordCount);
      book.updatedAt = now;
    }
    const project = this.state.projects.find((candidate) => candidate.id === book?.projectId);
    if (project) {
      project.chapterCount = Math.max(0, project.chapterCount - 1);
      project.wordCount = Math.max(0, project.wordCount - chapter.wordCount);
      project.updatedAt = now;
    }
  }

  async listChapterAnnotations(id: string, options: CursorListOptions = {}): Promise<OperationResponse<'listChapterAnnotations', '200'>> {
    this.applyOperation('listChapterAnnotations');
    this.chapterFor(id, 'listChapterAnnotations');
    return paginateList('listChapterAnnotations', this.state.annotations.filter((annotation) => annotation.chapterId === id), options, { chapterId: id });
  }

  async createChapterAnnotation(
    id: string,
    body: OperationRequest<'createChapterAnnotation'>,
  ): Promise<OperationResponse<'createChapterAnnotation', '201'>> {
    this.applyOperation('createChapterAnnotation');
    const chapter = this.chapterFor(id, 'createChapterAnnotation', ['editor', 'admin', 'owner']);
    const book = this.bookFor(chapter.bookId, 'createChapterAnnotation');
    assertLocatorRevisionMatchesChapter(body.locator, chapter, 'createChapterAnnotation');
    const annotation: ReaderAnnotation = {
      id: `annotation-${this.state.annotations.length + 1}`,
      projectId: book.projectId,
      bookId: book.id,
      chapterId: id,
      kind: body.kind,
      locator: body.locator,
      quote: 'quote' in body ? body.quote ?? null : null,
      body: 'body' in body ? body.body ?? null : null,
      color: 'color' in body ? body.color ?? null : null,
      status: 'saved',
      tags: body.tags ?? [],
      createdAt: now,
      updatedAt: now,
    } as ReaderAnnotation;
    this.state.annotations.push(annotation);
    return clone(annotation);
  }

  async updateReaderAnnotation(
    id: string,
    body: OperationRequest<'updateReaderAnnotation'>,
  ): Promise<OperationResponse<'updateReaderAnnotation', '200'>> {
    this.applyOperation('updateReaderAnnotation');
    const annotation = this.annotationFor(id, 'updateReaderAnnotation', ['editor', 'admin', 'owner']);
    Object.assign(annotation, body, { updatedAt: now });
    return clone(annotation);
  }

  async deleteReaderAnnotation(id: string): Promise<void> {
    this.applyOperation('deleteReaderAnnotation');
    this.annotationFor(id, 'deleteReaderAnnotation', ['editor', 'admin', 'owner']);
    this.state.annotations = this.state.annotations.filter((annotation) => annotation.id !== id);
  }

  async searchProject(
    id: string,
    query: string,
    scope: SearchScope = 'all',
    options: SearchProjectOptions = {},
    validationOptions: SearchProjectValidationOptions = {},
  ): Promise<OperationResponse<'searchProject', '200'>> {
    this.applyOperation('searchProject');
    this.requireProjectAccess('searchProject', id);
    const request = validateSearchRequest(query, scope, options, validationOptions);
    const locator = { ...createLocator(), projectId: id };
    const allResults: SearchResult[] =
      this.scenario.preset === 'empty-lists'
        ? []
        : [
            { id: 'search-chapter-1', kind: 'chapter', title: 'Белый порт', excerpt: 'Белый порт впервые показался...', score: 0.97, locator },
            { id: 'search-annotation-1', kind: 'annotation', title: 'Заметка: первенство Мары', excerpt: 'Проверить, кто первым назвал порт Белым.', score: 0.88, locator },
          ];
    const scopeKind: Partial<Record<SearchScope, SearchResult['kind']>> = {
      chapters: 'chapter',
      annotations: 'annotation',
    };
    const wantedKind = scopeKind[request.scope];
    const filters = validateSearchFilters(request.options.filters);
    const filtered = (wantedKind ? allResults.filter((result) => result.kind === wantedKind) : allResults).filter((result) => {
      if (result.locator && !this.locatorHasLiveParent(result.locator)) return false;
      if (filters?.bookId && result.locator?.bookId !== filters.bookId) return false;
      if (filters?.chapterId && result.locator?.chapterId !== filters.chapterId) return false;
      if (filters?.resultKinds && !filters.resultKinds.includes(result.kind)) return false;
      return true;
    });
    const limit = request.options.limit ?? 10;
    const fingerprint = hashString(stableStringify({ filters, limit, projectId: id, query: request.query, scope: request.scope }));
    const cursor = parseSearchCursor(request.options.cursor);
    if (request.options.cursor && (!cursor || cursor.fingerprint !== fingerprint)) {
      throw new MockApiError(400, 'Search cursor no longer matches the request fingerprint.', 'searchProject');
    }
    const offset = cursor?.offset ?? 0;
    const data = filtered.slice(offset, offset + limit);
    const nextOffset = offset + data.length;
    return {
      query: request.query,
      scope: request.scope,
      data,
      meta: { hasMore: nextOffset < filtered.length, nextCursor: nextOffset < filtered.length ? searchCursor(fingerprint, nextOffset) : null },
      cursorFingerprint: fingerprint,
      snippetPolicy: 'bounded_240_chars',
    };
  }

  async listChatSessions(id: string, options: CursorListOptions = {}): Promise<OperationResponse<'listChatSessions', '200'>> {
    this.applyOperation('listChatSessions');
    this.requireProjectAccess('listChatSessions', id);
    const data = this.state.chats.filter((chat) => chat.projectId === id);
    return paginateList('listChatSessions', this.scenario.preset === 'empty-lists' ? [] : data, options, { projectId: id });
  }

  async createChatSession(id: string, body: OperationRequest<'createChatSession'>): Promise<OperationResponse<'createChatSession', '201'>> {
    this.applyOperation('createChatSession');
    this.requireProjectAccess('createChatSession', id, ['editor', 'admin', 'owner']);
    if (this.scenario.preset === 'failed-create') {
      throw new MockApiError(500, 'Не удалось создать чат.', 'createChatSession');
    }
    const projectChatCount = this.state.chats.filter((chat) => chat.projectId === id).length;
    const chat: ChatSession = {
      id: `chat-${projectChatCount + 1}`,
      projectId: id,
      title: body.title ?? 'Новый чат проекта',
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.state.chats.push(chat);
    return clone(chat);
  }

  async getChatSession(id: string): Promise<OperationResponse<'getChatSession', '200'>> {
    this.applyOperation('getChatSession');
    if (this.scenario.preset === 'failed-select') {
      throw new MockApiError(500, 'Не удалось открыть чат.', 'getChatSession');
    }
    return clone(this.chatFor(id, 'getChatSession'));
  }

  async renameChatSession(id: string, body: OperationRequest<'renameChatSession'>): Promise<OperationResponse<'renameChatSession', '200'>> {
    this.applyOperation('renameChatSession');
    const chat = this.chatFor(id, 'renameChatSession', ['editor', 'admin', 'owner']);
    Object.assign(chat, { title: body.title, updatedAt: now });
    return clone(chat);
  }

  async deleteChatSession(id: string): Promise<void> {
    this.applyOperation('deleteChatSession');
    this.chatFor(id, 'deleteChatSession', ['editor', 'admin', 'owner']);
    this.state.chats = this.state.chats.filter((chat) => chat.id !== id);
    this.state.messages = this.state.messages.filter((message) => message.chatId !== id);
    this.state.artifacts = this.state.artifacts.filter((artifact) => artifact.chatId !== id);
    this.state.jobs = this.state.jobs.filter((job) => job.kind !== 'chat_turn' || jobResult(job).chatId !== id);
  }

  async listChatMessages(id: string, options: CursorListOptions = {}): Promise<OperationResponse<'listChatMessages', '200'>> {
    this.applyOperation('listChatMessages');
    this.chatFor(id, 'listChatMessages');
    return paginateList('listChatMessages', this.state.messages.filter((message) => message.chatId === id), options, { chatId: id });
  }

  private findChatTurnJob(id: string, operationId: 'getChatTurn' | 'streamChatTurnEvents') {
    const job =
      this.state.jobs.find((job) => job.kind === 'chat_turn' && job.subject.id === id) ??
      this.state.jobs.find((job) => {
        const result = jobResult(job);
        return job.kind === 'chat_turn' && result.turnId === id;
      }) ??
      this.state.jobs.find((job) => job.id === id);
    if (!job || job.kind !== 'chat_turn') {
      throw new MockApiError(404, 'Resource not found.', operationId);
    }
    return job;
  }

  async createChatTurn(
    id: string,
    body: OperationRequest<'createChatTurn'>,
    options: RequiredIdempotencyOptions,
  ): Promise<OperationResponse<'createChatTurn', '202'>> {
    this.applyOperation('createChatTurn');
    validateChatTurnStartRequest(body);
    const chat = this.chatFor(id, 'createChatTurn', ['editor', 'admin', 'owner']);
    return this.idempotentCommand('createChatTurn', id, options, body, () => this.createChatTurnJob(id, body, chat.projectId));
  }

  private createChatTurnJob(
    id: string,
    body: OperationRequest<'createChatTurn'>,
    projectIdForChat: string,
  ): OperationResponse<'createChatTurn', '202'> {
    const userMessage: ChatMessage = {
      id: `message-user-${this.state.messages.length + 1}`,
      chatId: id,
      role: 'user',
      content: body.content,
      parts: [{ type: 'text', text: body.content, sequence: 1, status: 'completed' }],
      references: [],
      createdAt: now,
    };
    this.state.messages.push(userMessage);

    const turnId = `turn-${this.state.jobs.length + 1}`;
    const job = createJob({
      id: `chat-job-${this.state.jobs.length + 1}`,
      kind: 'chat_turn',
      status: 'running',
      progress: 0.2,
      subject: { type: 'chat_turn', id: turnId, projectId: projectIdForChat },
      result: { type: 'chat_turn', chatId: id, turnId, userMessageId: userMessage.id, artifactId },
      canCancel: true,
    });
    this.state.jobs.push(job);
    this.markJobCreator(job);

    return {
      turnId,
      jobId: job.id,
      status: 'running',
      userMessageId: userMessage.id,
      assistantMessageId: null,
      links: { job: job.links.self, events: `${chatTurnUrl(turnId)}/events`, poll: chatTurnUrl(turnId) },
    };
  }

  async getChatTurn(id: string): Promise<OperationResponse<'getChatTurn', '200'>> {
    this.applyOperation('getChatTurn');
    const job = this.findChatTurnJob(id, 'getChatTurn');
    this.requireProjectAccess('getChatTurn', job.subject.projectId);
    const result = jobResult(job);
    const turnId = typeof result.turnId === 'string' ? result.turnId : id;
    const chatId = typeof result.chatId === 'string' ? result.chatId : this.state.chats[0]?.id ?? '';
    const turnMessageIds = new Set(
      [result.userMessageId, result.assistantMessageId].filter((value): value is string => typeof value === 'string'),
    );
    const messages = this.state.messages.filter((message) => message.chatId === chatId && (turnMessageIds.size === 0 || turnMessageIds.has(message.id)));
    const messageIds = new Set(messages.map((message) => message.id));
    const artifactIds = new Set(
      [
        typeof result.artifactId === 'string' ? result.artifactId : null,
        ...messages.flatMap((message) => message.references.flatMap((reference) => (isRecord(reference) && typeof reference.artifactId === 'string' ? [reference.artifactId] : []))),
      ].filter((value): value is string => typeof value === 'string'),
    );
    const artifacts = this.state.artifacts.filter(
      (artifact) =>
        artifact.chatId === chatId &&
        (artifactIds.has(artifact.id) || (typeof artifact.messageId === 'string' && messageIds.has(artifact.messageId))),
    );
    const suggestionBatchId = typeof result.suggestionBatchId === 'string' ? result.suggestionBatchId : null;
    const suggestionIds = Array.isArray(result.suggestionIds) ? result.suggestionIds.filter((value): value is string => typeof value === 'string') : [];
    const suggestions = this.state.suggestions.filter((suggestion) =>
      (typeof suggestion.sourceMessageId === 'string' && messageIds.has(suggestion.sourceMessageId)) ||
      (suggestionBatchId !== null && suggestion.batchId === suggestionBatchId) ||
      suggestionIds.includes(suggestion.id),
    );
    const status = job.status === 'succeeded'
      ? 'completed'
      : job.status === 'canceled'
        ? 'canceled'
        : job.status === 'failed' || job.status === 'expired'
          ? 'failed'
          : job.status === 'canceling'
            ? 'canceled'
            : job.status;
    return {
      turnId,
      job: clone(job),
      status,
      latestEventId: this.chatTurnLatestEventIds.get(turnId) ?? null,
      messages: clone(messages),
      artifacts: clone(artifacts),
      suggestions: clone(suggestions),
      links: { events: `${chatTurnUrl(turnId)}/events` },
    };
  }

  async *streamChatTurnEvents(id: string, options: { afterEventId?: string; lastEventId?: string } = {}): AsyncIterable<ChatTurnEventMessage> {
    this.applyOperation('streamChatTurnEvents');
    if (id === 'turn-expired' || options.afterEventId === 'evt_expired' || options.lastEventId === 'evt_expired') {
      throw new MockApiError(410, 'Chat turn event log expired.', 'streamChatTurnEvents');
    }
    const job = this.findChatTurnJob(id, 'streamChatTurnEvents');
    this.requireProjectAccess('streamChatTurnEvents', job.subject.projectId);
    const result = jobResult(job);
    const turnId = typeof result.turnId === 'string' ? result.turnId : id;
    const chatId = typeof result.chatId === 'string' ? result.chatId : this.state.chats[0]?.id ?? '';
    const existingAssistantMessageId = typeof result.assistantMessageId === 'string' ? result.assistantMessageId : null;
    const assistantMessageId = existingAssistantMessageId ?? `message-assistant-${turnId}`;
    const events: ChatTurnEventEnvelope[] = [
      {
        eventId: 'evt_001',
        sequence: 1,
        turnId,
        jobId: job.id,
        type: 'job.progress',
        data: { progress: 0.4, label: 'Проверяю локаторы главы.' },
      },
      {
        eventId: 'evt_002',
        sequence: 2,
        turnId,
        jobId: job.id,
        type: 'assistant.delta',
        data: { text: 'Нашел фрагмент и подготовил ссылку.' },
      },
      {
        eventId: 'evt_003',
        sequence: 3,
        turnId,
        jobId: job.id,
        type: 'artifact.ready',
        data: { artifactId, kind: 'reader_reference_artifact' },
      },
      {
        eventId: 'evt_004',
        sequence: 4,
        turnId,
        jobId: job.id,
        type: 'turn.completed',
        data: { assistantMessageId, finishReason: 'stop' },
      },
    ];

    if (options.afterEventId === '' || options.lastEventId === '') {
      throw new MockApiError(400, 'Chat turn event cursor must be non-empty.', 'streamChatTurnEvents');
    }
    const resumeCursor = options.afterEventId ?? options.lastEventId;
    const resumeIndex = resumeCursor ? events.findIndex((event) => event.eventId === resumeCursor) : -1;
    if (resumeCursor && resumeIndex === -1) {
      throw new MockApiError(400, 'Invalid chat turn event cursor.', 'streamChatTurnEvents');
    }

    for (const event of events.slice(resumeIndex + 1)) {
      this.chatTurnLatestEventIds.set(turnId, event.eventId);
      yield { id: event.eventId, event: event.type, retry: 1000, data: clone(event) };
    }

    const latestResult = jobResult(job);
    if (typeof latestResult.assistantMessageId === 'string') {
      return;
    }

    Object.assign(job, {
      status: 'succeeded',
      progress: 1,
      canCancel: false,
      updatedAt: now,
      result: { ...latestResult, assistantMessageId, artifactId },
    });
    if (this.state.messages.some((message) => message.id === assistantMessageId)) {
      return;
    }
    this.state.messages.push({
      id: assistantMessageId,
      chatId,
      role: 'assistant',
      content: 'Нашел фрагмент и подготовил ссылку.',
      parts: [{ type: 'text', text: 'Нашел фрагмент и подготовил ссылку.', sequence: 1, status: 'completed' }],
      references: [{ kind: 'reader_reference_artifact', artifactId }],
      createdAt: now,
    });
  }

  async getChatArtifact(id: string): Promise<OperationResponse<'getChatArtifact', '200'>> {
    this.applyOperation('getChatArtifact');
    if (this.scenario.preset === 'artifact-failure') {
      throw new MockApiError(500, 'Артефакт временно недоступен.', 'getChatArtifact');
    }
    return clone(this.artifactFor(id, 'getChatArtifact'));
  }

  async listAgentSuggestions(id: string, options: ListAgentSuggestionsOptions = {}): Promise<OperationResponse<'listAgentSuggestions', '200'>> {
    this.applyOperation('listAgentSuggestions');
    this.chapterFor(id, 'listAgentSuggestions');
    const query = validateAgentSuggestionListQuery(options);
    const pageQuery = { cursor: query.cursor, limit: query.limit };
    if (this.scenario.preset === 'suggestion-empty') {
      return paginateList('listAgentSuggestions', [], pageQuery, { chapterId: id });
    }
    if (this.scenario.preset === 'suggestion-failure') {
      throw new MockApiError(500, 'Предложения агента временно недоступны.', 'listAgentSuggestions');
    }
    const data = this.state.suggestions.filter((suggestion) =>
      suggestion.chapterId === id &&
      (query.status === undefined || suggestion.status === query.status) &&
      (query.sourceMessageId === undefined || suggestion.sourceMessageId === query.sourceMessageId) &&
      (query.batchId === undefined || suggestion.batchId === query.batchId),
    );
    return paginateList('listAgentSuggestions', data, pageQuery, {
      batchId: query.batchId ?? null,
      chapterId: id,
      sourceMessageId: query.sourceMessageId ?? null,
      status: query.status ?? null,
    });
  }

  async startAgentRun(
    id: string,
    body: OperationRequest<'startAgentRun'>,
    options: RequiredIdempotencyOptions,
  ): Promise<OperationResponse<'startAgentRun', '202'>> {
    this.applyOperation('startAgentRun');
    validateAgentRunRequest(body);
    const chapter = this.chapterFor(id, 'startAgentRun', ['editor', 'admin', 'owner']);
    const replayed = await this.replayIdempotentCommand<OperationResponse<'startAgentRun', '202'>>('startAgentRun', id, options, body);
    if (replayed) {
      return replayed;
    }
    if (body.expectedChapterRevision !== chapter.draftRevision) {
      throw new MockApiError(409, 'Ревизия главы изменилась, обновите черновик.', 'startAgentRun');
    }
    return this.idempotentCommand('startAgentRun', id, options, body, () => this.createAgentRunJob(body, chapter));
  }

  private createAgentRunJob(
    body: OperationRequest<'startAgentRun'>,
    chapter: Chapter,
  ): OperationResponse<'startAgentRun', '202'> {
    const projectIdForChapter = this.bookFor(chapter.bookId, 'startAgentRun').projectId;
    const targetParagraph =
      (body.selectionQuote
        ? chapter.paragraphs.find((paragraph) => paragraph.text.includes(body.selectionQuote!.trim()))
        : undefined) ?? chapter.paragraphs.find((paragraph) => paragraph.kind !== 'heading') ?? chapter.paragraphs[0];
    const before = body.selectionQuote?.trim() || targetParagraph?.text || chapter.title;
    const after = before.endsWith('.') ? `${before.slice(0, -1)} — теперь точнее по запросу редактора.` : `${before}, точнее по запросу редактора.`;
    const seq = this.state.suggestions.length + 1;
    const anchorLocator = {
      projectId: projectIdForChapter,
      bookId: chapter.bookId,
      chapterId: chapter.id,
      targetView: 'draft' as const,
      revision: chapter.draftRevision,
      paragraphId: targetParagraph?.id ?? null,
      annotationId: null,
      range: null,
    };
    const suggestion: AgentSuggestion = {
      id: `suggestion-run-${seq}`,
      chapterId: chapter.id,
      kind: 'rewrite',
      title: 'Правка редакторского агента',
      rationale: 'Подготовил точечную правку по текущему черновику.',
      baseChapterRevision: chapter.draftRevision,
      batchId: `batch-run-${seq}`,
      sourceMessageId: null,
      anchorLocator,
      contextQuote: before,
      diffs: [
        {
          hunkId: `hunk-request-${seq}`,
          range: {
            ...anchorLocator,
            paragraphId: targetParagraph?.id ?? chapter.paragraphs[0]?.id ?? chapter.id,
            range: { startOffset: 0, endOffset: before.length, quote: before },
          },
          before,
          after,
        },
      ],
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.state.suggestions.push(suggestion);
    const runId = `agent-run-${seq}`;
    const job = createJob({
      id: `agent-job-${seq}`,
      kind: 'agent_run',
      status: 'succeeded',
      progress: 1,
      subject: { type: 'chapter', id: chapter.id, projectId: projectIdForChapter },
      result: { type: 'agent_run', runId, suggestionIds: [suggestion.id], suggestionBatchId: suggestion.batchId },
      canCancel: false,
    });
    this.state.jobs.unshift(job);
    this.markJobCreator(job);
    return {
      runId,
      jobId: job.id,
      job: clone(job),
      links: { job: jobUrl(job.id), suggestions: `${apiBasePath}/chapters/${chapter.id}/agent-suggestions` },
    };
  }

  async getAgentSuggestion(id: string): Promise<OperationResponse<'getAgentSuggestion', '200'>> {
    this.applyOperation('getAgentSuggestion');
    return clone(this.suggestionFor(id, 'getAgentSuggestion'));
  }

  async approveAgentSuggestion(
    id: string,
    body: OperationRequest<'approveAgentSuggestion'>,
  ): Promise<OperationResponse<'approveAgentSuggestion', '200'>> {
    this.applyOperation('approveAgentSuggestion');
    if (this.scenario.preset === 'conflict') {
      throw new MockApiError(409, 'Ревизия главы изменилась.', 'approveAgentSuggestion');
    }
    const suggestion = this.suggestionFor(id, 'approveAgentSuggestion', ['editor', 'admin', 'owner']);
    const chapter = this.chapterFor(suggestion.chapterId, 'approveAgentSuggestion', ['editor', 'admin', 'owner']);
    if (body.expectedChapterRevision !== chapter.draftRevision) {
      throw new MockApiError(409, 'Ожидаемая ревизия не совпадает.', 'approveAgentSuggestion');
    }
    if (suggestion.status !== 'pending') {
      throw new MockApiError(409, 'Suggestion is already terminal.', 'approveAgentSuggestion');
    }
    for (const diff of suggestion.diffs) {
      const paragraph =
        (diff.range.paragraphId ? chapter.paragraphs.find((item) => item.id === diff.range.paragraphId) : undefined) ??
        chapter.paragraphs.find((item) => item.text.includes(diff.before) || item.markdown.includes(diff.before));
      if (paragraph) {
        paragraph.text = paragraph.text.includes(diff.before) ? paragraph.text.replace(diff.before, diff.after) : diff.after;
        paragraph.markdown = paragraph.markdown.includes(diff.before) ? paragraph.markdown.replace(diff.before, diff.after) : diff.after;
      }
    }
    Object.assign(suggestion, { status: 'accepted', updatedAt: now });
    chapter.draftRevision += 1;
    chapter.savedAt = new Date().toISOString();
    return { suggestion: clone(suggestion), chapter: clone(chapter) };
  }

  async rejectAgentSuggestion(
    id: string,
    body: OperationRequest<'rejectAgentSuggestion'>,
  ): Promise<OperationResponse<'rejectAgentSuggestion', '200'>> {
    this.applyOperation('rejectAgentSuggestion');
    const suggestion = this.suggestionFor(id, 'rejectAgentSuggestion', ['editor', 'admin', 'owner']);
    const chapter = this.chapterFor(suggestion.chapterId, 'rejectAgentSuggestion', ['editor', 'admin', 'owner']);
    if (body.expectedChapterRevision !== chapter.draftRevision) {
      throw new MockApiError(409, 'Ожидаемая ревизия не совпадает.', 'rejectAgentSuggestion');
    }
    if (suggestion.status !== 'pending') {
      throw new MockApiError(409, 'Suggestion is already terminal.', 'rejectAgentSuggestion');
    }
    Object.assign(suggestion, { status: 'rejected', updatedAt: now });
    return { suggestion: clone(suggestion), chapter: clone(chapter) };
  }

  private projectMembership(
    project: Project,
    memberId: string,
    role: ProjectMembership['role'],
    email?: string,
    displayName?: string,
  ): ProjectMembership {
    return createProjectMembershipFixture(project, this.state.user, memberId, role, email, displayName);
  }

  private rawActorRole(): MockActorRole {
    return this.scenario.actorRole ?? 'owner';
  }

  private acceptedInvitationMembership(projectIdForMembership?: string): ProjectMembership | undefined {
    const principalId = this.currentPrincipalId();
    return this.state.memberships.find((membership) => (
      membership.id.startsWith('member-invitation-') &&
      membership.status === 'active' &&
      membership.userId === principalId &&
      (projectIdForMembership === undefined || membership.projectId === projectIdForMembership)
    ));
  }

  private actorRole(projectIdForMembership?: string): MockActorRole {
    const role = this.rawActorRole();
    if (role !== 'non_member') {
      return role;
    }
    return this.acceptedInvitationMembership(projectIdForMembership)?.role ?? 'non_member';
  }

  private requireProjectAccess(operationId: Parameters<typeof applyScenario>[0], resourceProjectId: string, allowed?: MockActorRole[]) {
    const knownProject = this.state.projects.some((project) => project.id === resourceProjectId);
    const role = this.actorRole(resourceProjectId);
    if (role === 'non_member' || !knownProject) {
      throw new MockApiError(404, 'Resource not found.', operationId);
    }
    if (allowed && !allowed.includes(role)) {
      throw new MockApiError(403, 'Нет доступа к этому проекту.', operationId);
    }
  }

  private visibleJob(job: Job): Job {
    const visible = clone(job);
    const role = this.actorRole(job.subject.projectId);
    if (visible.kind === 'export' && role !== 'owner' && role !== 'admin') {
      const result = visible.result;
      if (result?.type === 'export') {
        visible.result = { ...result, downloadUrl: null };
      }
      visible.links = { ...visible.links, result: null };
    }
    return visible;
  }

  private visibleProject(project: Project): Project {
    const role = this.actorRole(project.id);
    if (role === 'non_member') {
      return clone(project);
    }
    return {
      ...clone(project),
      currentMembership: this.projectMembership(project, role === 'owner' ? 'member-owner' : 'member-current', role),
    };
  }

  private projectFor(id: string, operationId: Parameters<typeof applyScenario>[0], allowed?: MockActorRole[]) {
    const project = findById(this.state.projects, id, operationId);
    this.requireProjectAccess(operationId, project.id, allowed);
    return project;
  }

  private bookFor(id: string, operationId: Parameters<typeof applyScenario>[0], allowed?: MockActorRole[]) {
    const book = findById(this.state.books, id, operationId);
    this.requireProjectAccess(operationId, book.projectId, allowed);
    return book;
  }

  private chapterFor(id: string, operationId: Parameters<typeof applyScenario>[0], allowed?: MockActorRole[]) {
    const chapter = findById(this.state.chapters, id, operationId);
    this.bookFor(chapter.bookId, operationId, allowed);
    return chapter;
  }

  private annotationFor(id: string, operationId: Parameters<typeof applyScenario>[0], allowed?: MockActorRole[]) {
    const annotation = findById(this.state.annotations, id, operationId);
    this.chapterFor(annotation.chapterId, operationId, allowed);
    return annotation;
  }

  private locatorHasLiveParent(locator: { bookId: string; chapterId: string }) {
    return this.state.books.some((book) => book.id === locator.bookId)
      && this.state.chapters.some((chapter) => chapter.id === locator.chapterId && chapter.bookId === locator.bookId);
  }

  private chatFor(id: string, operationId: Parameters<typeof applyScenario>[0], allowed?: MockActorRole[]) {
    const chat = findById(this.state.chats, id, operationId);
    this.requireProjectAccess(operationId, chat.projectId, allowed);
    return chat;
  }

  private artifactFor(id: string, operationId: Parameters<typeof applyScenario>[0]) {
    const artifact = findById(this.state.artifacts, id, operationId);
    if (!artifact.chatId) {
      throw new MockApiError(404, 'Resource not found.', operationId);
    }
    this.chatFor(artifact.chatId, operationId);
    return artifact;
  }

  private suggestionFor(id: string, operationId: Parameters<typeof applyScenario>[0], allowed?: MockActorRole[]) {
    const suggestion = findById(this.state.suggestions, id, operationId);
    this.chapterFor(suggestion.chapterId, operationId, allowed);
    return suggestion;
  }

  private invitationFor(id: string, operationId: Parameters<typeof applyScenario>[0]) {
    return findById(this.state.invitations, id, operationId);
  }

  private jobFor(id: string, operationId: Parameters<typeof applyScenario>[0], allowed?: MockActorRole[]) {
    const job = findById(this.state.jobs, id, operationId);
    this.requireProjectAccess(operationId, job.subject.projectId, allowed);
    return job;
  }

  private currentPrincipalId() {
    return this.state.session?.user.id ?? this.state.user.id;
  }

  private markJobCreator(job: Job) {
    this.jobCreators.set(job.id, { principalId: this.currentPrincipalId(), role: this.actorRole(job.subject.projectId) });
  }

  private requireJobCancelAccess(job: Job) {
    const role = this.actorRole(job.subject.projectId);
    const creator = this.jobCreators.get(job.id);
    if (
      role === 'admin' ||
      role === 'owner' ||
      (role === 'editor' && creator?.role === 'editor' && creator.principalId === this.currentPrincipalId())
    ) {
      return;
    }
    throw new MockApiError(403, 'Нет доступа к этому проекту.', 'cancelJob');
  }

  private async idempotentCommand<TResponse>(
    operationId: OperationId,
    resourceId: string,
    options: RequiredIdempotencyOptions | undefined,
    fingerprintInput: unknown,
    execute: () => TResponse | Promise<TResponse>,
  ): Promise<TResponse> {
    if (!options?.idempotencyKey) {
      throw new MockApiError(400, 'Idempotency-Key is required.', operationId, 'idempotency_key_required');
    }
    validateIdempotencyKey(operationId, options.idempotencyKey);
    const principalId = this.currentPrincipalId();
    const storeKey = `${principalId}:${operationId}:${resourceId}:${options.idempotencyKey}`;
    const fingerprint = stableStringify(await idempotencyFingerprintValue({ operationId, resourceId, body: fingerprintInput }));
    const existing = this.directIdempotency.get(storeKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new MockApiError(409, 'Idempotency-Key payload mismatch.', operationId, 'idempotency_key_mismatch');
      }
      return clone(existing.response) as TResponse;
    }
    const response = await execute();
    this.directIdempotency.set(storeKey, { fingerprint, response: clone(response) });
    return response;
  }

  private async replayIdempotentCommand<TResponse>(
    operationId: OperationId,
    resourceId: string,
    options: RequiredIdempotencyOptions | undefined,
    fingerprintInput: unknown,
  ): Promise<TResponse | undefined> {
    if (!options?.idempotencyKey) {
      throw new MockApiError(400, 'Idempotency-Key is required.', operationId, 'idempotency_key_required');
    }
    validateIdempotencyKey(operationId, options.idempotencyKey);
    const principalId = this.currentPrincipalId();
    const storeKey = `${principalId}:${operationId}:${resourceId}:${options.idempotencyKey}`;
    const fingerprint = stableStringify(await idempotencyFingerprintValue({ operationId, resourceId, body: fingerprintInput }));
    const existing = this.directIdempotency.get(storeKey);
    if (!existing) {
      return undefined;
    }
    if (existing.fingerprint !== fingerprint) {
      throw new MockApiError(409, 'Idempotency-Key payload mismatch.', operationId, 'idempotency_key_mismatch');
    }
    return clone(existing.response) as TResponse;
  }

}

function findById<T extends { id: string }>(items: T[], id: string, operationId: Parameters<typeof applyScenario>[0]): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new MockApiError(404, 'Resource not found.', operationId);
  }
  return item;
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function createMockApiClient() {
  return new MockRepository();
}
