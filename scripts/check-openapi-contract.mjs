import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const contractPath = path.resolve('contracts/openapi.json');
const reviewPath = path.resolve('contracts/openapi-review-matrix.md');
const securityPath = path.resolve('contracts/openapi-security-matrix.md');
const migrationPath = path.resolve('contracts/openapi-migration.md');
const contractReadmePath = path.resolve('contracts/README.md');
const baselinePath = path.resolve('contracts/openapi-baseline-inventory.json');
const manifestPath = path.resolve('src/shared/api/generated/operation-manifest.ts');
const activeSurfaceRoots = ['src', 'mock-server', 'README.md', 'contracts'].map((filePath) => path.resolve(filePath));
const activeSurfaceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.md', '.json']);
const activeSurfaceIgnoreDirs = new Set(['.git', 'dist', 'node_modules']);
const legacyReferenceAllowlist = new Set(
  [
    'contracts/openapi-baseline-inventory.json',
    'contracts/openapi-migration.md',
    'contracts/openapi-review-matrix.md',
    'scripts/check-openapi-contract.mjs',
  ].map((filePath) => path.resolve(filePath)),
);
const execFileAsync = promisify(execFile);
const httpMethods = ['get', 'post', 'put', 'patch', 'delete'];
const unsafeMethods = new Set(['post', 'put', 'patch', 'delete']);
const requiredScenarioIds = [
  'SCN-AUTH-SESSION',
  'SCN-MEMBERS-INVITES',
  'SCN-PROJECTS',
  'SCN-BOOKS-CHAPTERS',
  'SCN-READER-NAV',
  'SCN-ANNOTATIONS',
  'SCN-SEARCH',
  'SCN-IMPORT',
  'SCN-EXPORT-INDEX-JOBS',
  'SCN-CHAT-TURNS-SSE',
  'SCN-ARTIFACTS',
  'SCN-AGENT-SUGGESTIONS',
  'SCN-CONFLICT-RETRY-ERRORS',
  'SCN-DATA-GOVERNANCE',
  'SCN-GENERATED-BOUNDARY',
];
const requiredScenarioRows = {
  'SCN-AUTH-SESSION': {
    source: 'SPEC: OpenAPI Security/Data Contract Requirements',
    operations: ['getCsrfToken', 'registerUser', 'loginUser', 'logoutUser', 'getCurrentUser', 'rotateSession'],
    requestSchemas: ['CsrfTokenResponse', 'AuthSession', 'Problem'],
    authTokens: ['non-enumerating', 'no-store', 'CSRF'],
  },
  'SCN-MEMBERS-INVITES': {
    source: 'SPEC: Backend Resource Model Baseline',
    operations: ['listProjectMembers', 'updateProjectMemberRole', 'removeProjectMember', 'listProjectInvitations', 'listMyProjectInvitations', 'createProjectInvitation', 'cancelProjectInvitation', 'acceptProjectInvitation'],
    requestSchemas: ['ProjectMembership', 'ProjectInvitation'],
    authTokens: ['project membership'],
  },
  'SCN-PROJECTS': {
    source: 'SPEC: Backend Resource Model Baseline',
    operations: ['listProjects', 'createProject', 'getProject', 'updateProject', 'deleteProject'],
    requestSchemas: ['Project'],
    authTokens: ['direct IDs', 'cross-project 404'],
  },
  'SCN-BOOKS-CHAPTERS': {
    source: 'SPEC: Backend Resource Model Baseline',
    operations: ['listBooks', 'createBook', 'getBook', 'updateBook', 'deleteBook', 'listChapters', 'createChapter', 'getChapter', 'updateChapter', 'publishChapter', 'deleteChapter'],
    requestSchemas: ['Book', 'Chapter', 'ChapterList'],
    authTokens: ['project-scoped'],
  },
  'SCN-READER-NAV': {
    source: 'SPEC: Revision And Locator Rules',
    operations: ['getChapter', 'listChapters'],
    requestSchemas: ['ReaderLocator', 'ReaderReferenceLocator', 'ChapterNavigation'],
    authTokens: ['bounded content-read'],
  },
  'SCN-ANNOTATIONS': {
    source: 'SPEC: Revision And Locator Rules',
    operations: ['listChapterAnnotations', 'createChapterAnnotation', 'updateReaderAnnotation', 'deleteReaderAnnotation'],
    requestSchemas: ['ReaderAnnotation', 'CreateReaderAnnotationRequest'],
    authTokens: ['project-scoped'],
  },
  'SCN-SEARCH': {
    source: 'SPEC: Command, Query And Job Rules',
    operations: ['searchProject'],
    requestSchemas: ['SearchProjectRequest', 'SearchResponse'],
    authTokens: ['private text', 'no URL leakage'],
  },
  'SCN-IMPORT': {
    source: 'SPEC: Command, Query And Job Rules',
    operations: ['getImportConstraints', 'importBookFile'],
    requestSchemas: ['ImportBookRequest', 'ImportConstraints', 'JobStartResponse', 'Job'],
    authTokens: ['upload abuse'],
  },
  'SCN-EXPORT-INDEX-JOBS': {
    source: 'SPEC: Command, Query And Job Rules',
    operations: ['startProjectIndexing', 'createBookExport', 'listProjectJobs', 'getJob', 'cancelJob'],
    requestSchemas: ['Job', 'JobStartResponse'],
    authTokens: ['owner/admin', 'direct-ID 404'],
  },
  'SCN-CHAT-TURNS-SSE': {
    source: 'SPEC: Command, Query And Job Rules',
    operations: ['createChatTurn', 'getChatTurn', 'streamChatTurnEvents'],
    requestSchemas: ['ChatTurnStartRequest', 'ChatTurnStartResponse', 'ChatTurnSnapshot', 'ChatTurnEventEnvelope'],
    authTokens: ['project chat'],
  },
  'SCN-ARTIFACTS': {
    source: 'SPEC: Command, Query And Job Rules',
    operations: ['getChatArtifact'],
    requestSchemas: ['ChatArtifact'],
    authTokens: ['project-scoped', 'no raw provider traces'],
  },
  'SCN-AGENT-SUGGESTIONS': {
    source: 'SPEC: Command, Query And Job Rules',
    operations: ['startAgentRun', 'listAgentSuggestions', 'getAgentSuggestion', 'approveAgentSuggestion', 'rejectAgentSuggestion'],
    requestSchemas: ['AgentRunRequest', 'AgentRunStartResponse', 'AgentSuggestion', 'RejectAgentSuggestionRequest'],
    authTokens: ['project/chapter', 'editor'],
  },
  'SCN-CONFLICT-RETRY-ERRORS': {
    source: 'SPEC: API Policy Decisions',
    operations: [],
    requestSchemas: ['Problem'],
    authTokens: ['stable problem'],
  },
  'SCN-DATA-GOVERNANCE': {
    source: 'SPEC: OpenAPI Security/Data Contract Requirements',
    operations: [],
    requestSchemas: ['security matrix rows'],
    authTokens: ['no raw secrets', 'no-store'],
    allowNotApplicableResponses: true,
  },
  'SCN-GENERATED-BOUNDARY': {
    source: 'SPEC: Proof Package And Contract Gates',
    operations: [],
    requestSchemas: ['generated openapi.ts', 'operation-manifest.ts'],
    authTokens: ['OpenAPI source of truth'],
    allowNotApplicableResponses: true,
  },
};
const requiredSchemas = [
  'Problem',
  'ValidationIssue',
  'PageMeta',
  'CsrfTokenResponse',
  'ProjectRole',
  'ProjectMembership',
  'ProjectInvitation',
  'Job',
  'JobStartResponse',
  'SearchProjectRequest',
  'SearchProjectFilters',
  'SearchResultKind',
  'ImportBookRequest',
  'ChatTurnStartRequest',
  'ChatTurnStartResponse',
  'ChatTurnSnapshot',
  'ChatTurnEventEnvelope',
  'AgentRunRequest',
  'AgentRunStartResponse',
];
const requiredOperations = [
  'getCsrfToken',
  'getCurrentUser',
  'rotateSession',
  'listProjectMembers',
  'createProjectInvitation',
  'listMyProjectInvitations',
  'acceptProjectInvitation',
  'searchProject',
  'listProjectJobs',
  'startProjectIndexing',
  'getJob',
  'cancelJob',
  'createChatTurn',
  'getChatTurn',
  'streamChatTurnEvents',
  'startAgentRun',
];
const publicOperationIds = new Set(['getCsrfToken', 'registerUser', 'loginUser']);
const legacyOperationIds = new Set(['sendChatMessage', 'listIndexingJobs', 'getIndexingJob', 'cancelIndexingJob', 'getExportJob', 'requestAgentSuggestion']);
const legacySchemaNames = new Set([
  'CreateChatMessageRequest',
  'SendChatMessageRequest',
  'LlmStreamEvent',
  'LlmStreamEventType',
  'IndexingJob',
  'IndexingJobList',
  'IndexingJobStage',
  'IndexingJobStatus',
  'ExportJob',
  'ExportJobId',
  'ChatTrigger',
  'ChatTriggerKind',
  'ReaderReferencesChatTrigger',
  'AgentSuggestionsReadyChatTrigger',
  'RequestAgentSuggestionRequest',
]);
const legacyParameterNames = new Set(['ExportJobId']);
const cursorPaginatedOperationIds = new Set([
  'listProjects',
  'listProjectMembers',
  'listProjectInvitations',
  'listBooks',
  'listProjectJobs',
  'listChapters',
  'listChapterAnnotations',
  'listChatSessions',
  'listChatMessages',
  'listAgentSuggestions',
]);
const expectedBaselineRef = '18ace36ff53f61284d225b25f0024c6fcef28e0e';
const expectedBaselineOperationCount = 45;
const expectedBaselineSchemaCount = 102;
const expectedBaselineInventoryDigest = '69f7080929c4292e111e14aafabf3f478218e0ad31771581adf69ecd427522bd';
const requiredExampleOperations = new Set([
  'getCsrfToken',
  'registerUser',
  'loginUser',
  'logoutUser',
  'getCurrentUser',
  'rotateSession',
  'getProject',
  'getBook',
  'getChapter',
  'importBookFile',
  'searchProject',
  'streamChatTurnEvents',
  'approveAgentSuggestion',
  'rejectAgentSuggestion',
]);

async function collectActiveSurfacePaths(entries) {
  const files = [];
  for (const entry of entries) {
    files.push(...await collectActiveSurfaceEntry(entry));
  }
  return uniqueSortedPaths(files);
}

async function collectActiveSurfaceEntry(entry) {
  const statEntries = await readdir(path.dirname(entry), { withFileTypes: true }).catch(() => []);
  const namedEntry = statEntries.find((candidate) => path.resolve(path.dirname(entry), candidate.name) === entry);
  if (!namedEntry) return [];
  if (namedEntry.isFile()) return activeSurfaceExtensions.has(path.extname(entry)) ? [entry] : [];
  if (!namedEntry.isDirectory()) return [];
  const children = await readdir(entry, { withFileTypes: true });
  const files = [];
  for (const child of children) {
    if (child.isDirectory() && activeSurfaceIgnoreDirs.has(child.name)) continue;
    const childPath = path.join(entry, child.name);
    if (child.isDirectory()) {
      files.push(...await collectActiveSurfaceEntry(childPath));
    } else if (child.isFile() && activeSurfaceExtensions.has(path.extname(child.name))) {
      files.push(childPath);
    }
  }
  return files;
}

function uniqueSortedPaths(paths) {
  return [...new Set(paths.map((filePath) => path.resolve(filePath)))].sort((left, right) => left.localeCompare(right));
}

function isIgnoredSurfacePath(filePath) {
  return path.relative(process.cwd(), filePath).split(path.sep).some((part) => activeSurfaceIgnoreDirs.has(part));
}

function isScannableSurfacePath(filePath) {
  return activeSurfaceExtensions.has(path.extname(filePath)) && !isIgnoredSurfacePath(filePath);
}

async function gitOutput(args) {
  const safeDirectory = process.cwd().replace(/\\/g, '/');
  const candidates = [
    ...new Set(
      process.platform === 'win32'
        ? [process.env.GIT ?? 'git', 'C:\\Program Files\\Git\\cmd\\git.exe']
        : [process.env.GIT ?? 'git'],
    ),
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate, ['-c', `safe.directory=${safeDirectory}`, ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 16,
      });
      return stdout;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function collectChangedUnionPaths() {
  try {
    const outputs = await Promise.all([
      gitOutput(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--']),
      gitOutput(['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB', '--']),
      gitOutput(['ls-files', '--others', '--exclude-standard']),
    ]);
    return {
      error: null,
      paths: uniqueSortedPaths(
        outputs
          .flatMap((output) => output.split(/\r?\n/))
          .map((line) => line.trim())
          .filter(Boolean)
          .map((filePath) => path.resolve(filePath))
          .filter(isScannableSurfacePath),
      ),
    };
  } catch (error) {
    return { error, paths: [] };
  }
}

function baselineInventoryDigest(operations, schemas, baselineRef) {
  const payload = {
    baselineRef,
    operations: operations.map(operationKey).sort(),
    schemas: [...schemas].sort(),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const changedUnion = await collectChangedUnionPaths();
const activeSurfacePaths = uniqueSortedPaths([
  ...await collectActiveSurfacePaths(activeSurfaceRoots),
  ...changedUnion.paths,
]);
const [rawContract, reviewMd, securityMd, migrationMd, contractReadme, rawBaseline, manifest, ...activeSurfaceReadResults] = await Promise.all([
  readFile(contractPath, 'utf8'),
  readFile(reviewPath, 'utf8'),
  readFile(securityPath, 'utf8'),
  readFile(migrationPath, 'utf8'),
  readFile(contractReadmePath, 'utf8'),
  readFile(baselinePath, 'utf8'),
  readFile(manifestPath, 'utf8'),
  ...activeSurfacePaths.map(async (filePath) => {
    try {
      return { error: null, text: await readFile(filePath, 'utf8') };
    } catch (error) {
      return { error, text: '' };
    }
  }),
]);
const activeSurfaceReadFailures = activeSurfacePaths.filter((_, index) => activeSurfaceReadResults[index]?.error);
const activeSurfaceRecords = activeSurfacePaths.map((filePath, index) => ({
  filePath,
  text: activeSurfaceReadResults[index]?.text ?? '',
}));
const staleScanRecords = activeSurfaceRecords.filter((record) => !legacyReferenceAllowlist.has(record.filePath));
const spec = JSON.parse(rawContract);
const baselineInventory = JSON.parse(rawBaseline);
const failures = [];
const operations = collectOperations(spec);
const operationIds = operations.map((operation) => operation.operationId);
const uniqueOperationIds = new Set(operationIds);
const baselineOps = baselineInventory.operations ?? [];
const baselineSchemas = baselineInventory.schemas ?? [];
const finalSchemaNames = Object.keys(spec.components?.schemas ?? {}).sort((left, right) => left.localeCompare(right));

function fail(message) {
  failures.push(message);
}

const cursorDescriptionPhrase = 'Cursor-paginated collection; invalid or mismatched cursors return 400 Problem.';
const forbiddenCanonicalChatMarkers = ['"reader_references"', '"agent_suggestions_ready"', 'trigger in message text'];
const forbiddenCanonicalChatMarkerHits = forbiddenCanonicalChatMarkers.filter((marker) => rawContract.includes(marker));
if (forbiddenCanonicalChatMarkerHits.length > 0) {
  fail(`canonical_chat_text_trigger_markers = ${forbiddenCanonicalChatMarkerHits.join(',')}`);
}
const repeatedCursorDescriptions = collectRepeatedCursorDescriptions(spec);
if (repeatedCursorDescriptions.length > 0) {
  fail(`repeated_cursor_descriptions = ${repeatedCursorDescriptions.length} (${repeatedCursorDescriptions.slice(0, 6).join(', ')})`);
}
const publicChatSchemaIssues = collectPublicChatSchemaIssues(spec);
if (publicChatSchemaIssues.length > 0) {
  fail(`public_chat_schema_issues = ${publicChatSchemaIssues.join(',')}`);
}
const readerLocatorRevisionIssues = collectReaderLocatorRevisionIssues(spec);
if (readerLocatorRevisionIssues.length > 0) {
  fail(`reader_locator_revision_issues = ${readerLocatorRevisionIssues.join(',')}`);
}
const chapterContentContractIssues = collectChapterContentContractIssues(spec);
if (chapterContentContractIssues.length > 0) {
  fail(`chapter_content_contract_issues = ${chapterContentContractIssues.join(',')}`);
}
const requestSchemaClosureIssues = collectRequestSchemaClosureIssues(spec);
if (requestSchemaClosureIssues.length > 0) {
  fail(`request_schema_closure_issues = ${requestSchemaClosureIssues.join(',')}`);
}

function collectOperations(openapi) {
  const result = [];
  for (const [apiPath, pathItem] of Object.entries(openapi.paths ?? {})) {
    for (const method of httpMethods) {
      const operation = pathItem[method];
      if (operation) {
        result.push({
          method,
          methodUpper: method.toUpperCase(),
          path: apiPath,
          operationId: operation.operationId,
          operation,
        });
      }
    }
  }
  return result;
}

function collectPublicChatSchemaIssues(openapi) {
  const schemas = openapi.components?.schemas ?? {};
  const issues = [];
  const roleValues = new Set(schemas.ChatRole?.enum ?? []);
  for (const forbiddenRole of ['system', 'tool']) {
    if (roleValues.has(forbiddenRole)) issues.push(`ChatRole.${forbiddenRole}`);
  }

  const partTypes = new Set(schemas.ChatMessagePartType?.enum ?? []);
  for (const forbiddenType of ['reasoning', 'tool_call', 'tool_result']) {
    if (partTypes.has(forbiddenType)) issues.push(`ChatMessagePartType.${forbiddenType}`);
  }

  const partProperties = schemas.ChatMessagePart?.properties ?? {};
  for (const forbiddenProperty of ['toolName', 'toolCallId']) {
    if (Object.hasOwn(partProperties, forbiddenProperty)) issues.push(`ChatMessagePart.${forbiddenProperty}`);
  }

  const publicChatSchemaText = JSON.stringify({
    AgentOptions: schemas.AgentOptions,
    ChatMessage: schemas.ChatMessage,
    ChatMessagePart: schemas.ChatMessagePart,
    ChatTurnEventEnvelope: schemas.ChatTurnEventEnvelope,
  });
  for (const forbiddenPhrase of [
    /reasoning blocks/i,
    /tool chips/i,
    /provider traces/i,
    /tool traces/i,
    /tool args/i,
    /tool_limit/i,
    /task chips selected in the UI/i,
    /current_selection/i,
    /current_chapter/i,
    /current_book/i,
  ]) {
    if (forbiddenPhrase.test(publicChatSchemaText)) issues.push(`description.${forbiddenPhrase.source}`);
  }
  const agentScopeValues = new Set(schemas.AgentOptions?.properties?.scope?.enum ?? []);
  for (const forbiddenScope of ['current_selection', 'current_chapter', 'current_book']) {
    if (agentScopeValues.has(forbiddenScope)) issues.push(`AgentOptions.scope.${forbiddenScope}`);
  }
  const finishReasonValues = new Set(
    (JSON.stringify(schemas.ChatTurnEventEnvelope ?? {}).match(/"finishReason"[\s\S]*?"enum":\s*\[([\s\S]*?)\]/)?.[1] ?? '')
      .match(/"([^"]+)"/g)
      ?.map((value) => value.slice(1, -1)) ?? [],
  );
  if (finishReasonValues.has('tool_limit')) issues.push('ChatTurnEventEnvelope.finishReason.tool_limit');
  return issues;
}

function collectReaderLocatorRevisionIssues(openapi) {
  const readerLocator = openapi.components?.schemas?.ReaderLocator ?? {};
  const required = new Set(readerLocator.required ?? []);
  const revision = readerLocator.properties?.revision;
  const issues = [];
  if (!required.has('revision')) issues.push('revision_not_required');
  if (revision?.type !== 'integer') issues.push('revision_not_integer');
  if (JSON.stringify(revision ?? {}).includes('"null"')) issues.push('revision_allows_null');
  if (readerLocator.properties?.targetView?.$ref !== '#/components/schemas/ChapterContentVariant') {
    issues.push('targetView_not_content_variant');
  }
  return issues;
}

function collectChapterContentContractIssues(openapi) {
  const schemas = openapi.components?.schemas ?? {};
  const issues = [];
  const getChapter = operations.find((operation) => operation.operationId === 'getChapter')?.operation;
  const getChapterParameters = getChapter?.parameters ?? [];
  if (getChapterParameters.some((parameter) => parameter.name === 'viewMode')) issues.push('getChapter.viewMode_param');
  if (!getChapterParameters.some((parameter) => parameter.name === 'contentVariant')) issues.push('getChapter.missing_contentVariant_param');

  const chapter = schemas.Chapter ?? {};
  const chapterRequired = new Set(chapter.required ?? []);
  if (chapterRequired.has('viewMode') || Object.hasOwn(chapter.properties ?? {}, 'viewMode')) issues.push('Chapter.viewMode');
  if (!chapterRequired.has('contentVariant') || !Object.hasOwn(chapter.properties ?? {}, 'contentVariant')) issues.push('Chapter.missing_contentVariant');

  const paragraphInput = schemas.ChapterParagraphInput ?? {};
  const paragraphInputText = JSON.stringify(paragraphInput);
  if (Object.hasOwn(paragraphInput.properties ?? {}, 'clientKey') || /clientKey|temporary frontend|frontend can reconcile/i.test(paragraphInputText)) {
    issues.push('ChapterParagraphInput.frontend_reconcile_key');
  }

  const chapterSummary = schemas.ChapterSummary ?? {};
  const chapterSummaryRequired = new Set(chapterSummary.required ?? []);
  const chapterSummaryText = JSON.stringify(chapterSummary);
  if (chapterSummaryRequired.has('isCurrent') || Object.hasOwn(chapterSummary.properties ?? {}, 'isCurrent')) {
    issues.push('ChapterSummary.isCurrent');
  }
  if (/TOC|sidebar|screen/i.test(chapterSummaryText)) {
    issues.push('ChapterSummary.ui_screen_description');
  }

  const variantValues = new Set(schemas.ChapterContentVariant?.enum ?? []);
  for (const expectedVariant of ['published', 'draft']) {
    if (!variantValues.has(expectedVariant)) issues.push(`ChapterContentVariant.missing_${expectedVariant}`);
  }
  if (variantValues.has('reading') || Object.hasOwn(schemas, 'ChapterViewMode')) issues.push('ChapterContentVariant.legacy_view_terms');

  const navigationText = JSON.stringify(schemas.ChapterNavigation ?? {});
  if (/reader header|reader footer|footer controls/i.test(navigationText)) issues.push('ChapterNavigation.reader_control_description');
  const chapterContentText = JSON.stringify({
    ChapterParagraph: schemas.ChapterParagraph,
    ChapterParagraphInput: schemas.ChapterParagraphInput,
  });
  if (/toolbar|visible in the design/i.test(chapterContentText)) issues.push('ChapterContent.ui_widget_description');
  return issues;
}

function collectRequestSchemaClosureIssues(openapi) {
  const issues = [];
  for (const { operationId, operation } of operations) {
    for (const [mediaType, media] of Object.entries(operation.requestBody?.content ?? {})) {
      const schema = media?.schema;
      if (!schema) continue;
      const schemaName = typeof schema.$ref === 'string' ? schema.$ref.split('/').at(-1) : `${operationId}.${mediaType}`;
      const resolved = typeof schema.$ref === 'string' ? resolveJsonPointer(openapi, schema.$ref) : schema;
      if (resolved?.type === 'object' && resolved.additionalProperties !== false) {
        issues.push(`${operationId}:${schemaName}`);
      }
    }
  }
  return issues;
}

function operationPathParams(apiPath) {
  return [...apiPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function parseOperationManifest(manifestText) {
  const result = new Map();
  const entryPattern = /^\s+"([^"]+)": \{ method: "([A-Z]+)", path: "([^"]+)", pathParams: \[([^\]]*)\] \},$/gm;
  for (const match of manifestText.matchAll(entryPattern)) {
    result.set(match[1], {
      method: match[2],
      path: match[3],
      pathParams: [...(match[4] ?? '').matchAll(/"([^"]+)"/g)].map((paramMatch) => paramMatch[1]),
    });
  }
  return result;
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveJsonPointer(root, ref) {
  if (!ref.startsWith('#/')) {
    return undefined;
  }
  return ref
    .slice(2)
    .split('/')
    .reduce((node, segment) => node?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

function collectRefs(node, location = '$', refs = []) {
  if (!node || typeof node !== 'object') return refs;
  if (typeof node.$ref === 'string') refs.push({ ref: node.$ref, location });
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectRefs(item, `${location}[${index}]`, refs));
    return refs;
  }
  for (const [key, value] of Object.entries(node)) collectRefs(value, `${location}.${key}`, refs);
  return refs;
}

function collectRepeatedCursorDescriptions(node, location = '$', result = []) {
  if (!node || typeof node !== 'object') return result;
  if (typeof node.description === 'string') {
    const count = node.description.split(cursorDescriptionPhrase).length - 1;
    if (count > 1) result.push(`${location}.description`);
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectRepeatedCursorDescriptions(item, `${location}[${index}]`, result));
    return result;
  }
  for (const [key, value] of Object.entries(node)) collectRepeatedCursorDescriptions(value, `${location}.${key}`, result);
  return result;
}

function hasApplicationProblem(response) {
  if (!response) return false;
  const resolved = response.$ref ? resolveJsonPointer(spec, response.$ref) : response;
  return Boolean(resolved?.content?.['application/problem+json']?.schema?.$ref === '#/components/schemas/Problem');
}

function resolveResponse(response) {
  return response?.$ref ? resolveJsonPointer(spec, response.$ref) : response;
}

function getParameter(operation, name) {
  return (operation.parameters ?? [])
    .map((parameter) => (parameter.$ref ? resolveJsonPointer(spec, parameter.$ref) : parameter))
    .find((parameter) => parameter?.name === name);
}

function hasHeader(response, name) {
  const resolved = resolveResponse(response);
  return Boolean(resolved?.headers?.[name]);
}

function counterValue(markdown, name) {
  const match = markdown.match(new RegExp(`^- ${name} = ([^\\n\\r]+)`, 'm'));
  return match?.[1]?.trim();
}

function markdownHasZero(markdown, name) {
  return counterValue(markdown, name) === '0';
}

function expectCounter(markdown, label, name, expected) {
  const actual = counterValue(markdown, name);
  if (actual !== String(expected)) fail(`${label} counter ${name} expected ${expected}, received ${actual ?? '<missing>'}`);
}

function tableRows(markdown, sectionTitle) {
  const section = markdown.split(`## ${sectionTitle}`)[1]?.split(/\n## /)[0] ?? '';
  return section
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.includes('---'))
    .slice(1);
}

function tableCells(row) {
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function operationSetFromRows(rows, column = 0) {
  return new Set(rows.map((row) => tableCells(row)[column]).filter(Boolean));
}

function isBlankCell(value) {
  return !value || value === 'n/a' || value === '-' || value === 'none';
}

function countRowsWithBlank(rows, indexes) {
  return rows
    .map(tableCells)
    .filter((cells) => indexes.some((index) => isBlankCell(cells[index])))
    .length;
}

function mediaTypeHasExample(mediaType) {
  return Object.keys(mediaType?.examples ?? {}).length > 0;
}

function operationHasXExample(operation) {
  return Object.keys(operation?.['x-examples'] ?? {}).length > 0;
}

function requestHasExample(operation, mediaType = 'application/json') {
  return mediaTypeHasExample(operation?.requestBody?.content?.[mediaType]);
}

function responseHasExample(operation, status, mediaType = 'application/json') {
  const resolved = resolveResponse(operation?.responses?.[String(status)]);
  return mediaTypeHasExample(resolved?.content?.[mediaType]);
}

function operationHasExample(operation) {
  if (!operation) return false;
  const requestExamples = Object.values(operation.requestBody?.content ?? {}).some(mediaTypeHasExample);
  const responseExamples = Object.values(operation.responses ?? {}).some((response) => {
    const resolved = resolveResponse(response);
    return Object.values(resolved?.content ?? {}).some(mediaTypeHasExample);
  });
  return operationHasXExample(operation) || requestExamples || responseExamples;
}

function jsonValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function typeMatches(value, expectedType) {
  const actual = jsonValueType(value);
  if (expectedType === 'number') return actual === 'number' || actual === 'integer';
  return actual === expectedType;
}

function resolveSchema(schema) {
  return schema?.$ref ? resolveJsonPointer(spec, schema.$ref) : schema;
}

function validateExampleValue(schema, value, location, seen = new Set()) {
  const resolved = resolveSchema(schema);
  if (!resolved || typeof resolved !== 'object') return [];
  if (seen.has(resolved)) return [];
  const nextSeen = new Set(seen).add(resolved);
  if (Array.isArray(resolved.allOf)) {
    return resolved.allOf.flatMap((item, index) => validateExampleValue(item, value, `${location}.allOf[${index}]`, nextSeen));
  }
  if (Array.isArray(resolved.anyOf)) {
    const matches = resolved.anyOf.filter((item, index) => validateExampleValue(item, value, `${location}.anyOf[${index}]`, nextSeen).length === 0);
    return matches.length > 0 ? [] : [`${location} does not match anyOf`];
  }
  if (Array.isArray(resolved.oneOf)) {
    const matches = resolved.oneOf.filter((item, index) => validateExampleValue(item, value, `${location}.oneOf[${index}]`, nextSeen).length === 0);
    return matches.length > 0 ? [] : [`${location} does not match oneOf`];
  }
  const errors = [];
  if (Object.hasOwn(resolved, 'const') && value !== resolved.const) {
    errors.push(`${location} expected const ${JSON.stringify(resolved.const)}`);
  }
  if (Array.isArray(resolved.enum) && !resolved.enum.includes(value)) {
    errors.push(`${location} expected enum value`);
  }
  const expectedTypes = Array.isArray(resolved.type) ? resolved.type : resolved.type ? [resolved.type] : [];
  if (expectedTypes.length > 0 && !expectedTypes.some((type) => typeMatches(value, type))) {
    errors.push(`${location} expected ${expectedTypes.join('|')}, received ${jsonValueType(value)}`);
    return errors;
  }
  if (value === null) return errors;
  if (jsonValueType(value) === 'object') {
    for (const requiredName of resolved.required ?? []) {
      if (!Object.hasOwn(value, requiredName)) errors.push(`${location}.${requiredName} is required`);
    }
    const properties = resolved.properties ?? {};
    if (resolved.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${location}.${key} is not allowed`);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        errors.push(...validateExampleValue(propertySchema, value[key], `${location}.${key}`, nextSeen));
      }
    }
  }
  if (Array.isArray(value) && resolved.items) {
    value.forEach((item, index) => {
      errors.push(...validateExampleValue(resolved.items, item, `${location}[${index}]`, nextSeen));
    });
  }
  return errors;
}

function isJsonMediaType(mediaType) {
  return mediaType === 'application/json' || mediaType === 'application/problem+json' || mediaType.endsWith('+json');
}

function collectInvalidJsonExamples() {
  const invalid = [];
  for (const { operationId, operation } of operations) {
    for (const [mediaType, media] of Object.entries(operation.requestBody?.content ?? {})) {
      if (!isJsonMediaType(mediaType) || !media?.schema) continue;
      for (const [exampleName, example] of Object.entries(media.examples ?? {})) {
        if (!Object.hasOwn(example, 'value')) continue;
        const errors = validateExampleValue(media.schema, example.value, `${operationId}.request.${mediaType}.${exampleName}`);
        invalid.push(...errors.slice(0, 3));
      }
    }
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      const resolvedResponse = resolveResponse(response);
      for (const [mediaType, media] of Object.entries(resolvedResponse?.content ?? {})) {
        if (!isJsonMediaType(mediaType) || !media?.schema) continue;
        for (const [exampleName, example] of Object.entries(media.examples ?? {})) {
          if (!Object.hasOwn(example, 'value')) continue;
          const errors = validateExampleValue(media.schema, example.value, `${operationId}.response.${status}.${mediaType}.${exampleName}`);
          invalid.push(...errors.slice(0, 3));
        }
      }
    }
  }
  return invalid;
}

function parseSseExampleDataFrames(value, location) {
  if (typeof value !== 'string') {
    return [`${location} SSE example must be a string`];
  }
  const payloads = [];
  const frames = value.split(/\r?\n\r?\n/).filter((frame) => frame.trim());
  for (const [frameIndex, frame] of frames.entries()) {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (dataLines.length === 0) continue;
    const data = dataLines.join('\n');
    try {
      payloads.push({ location: `${location}.frame[${frameIndex}]`, value: JSON.parse(data) });
    } catch {
      return [`${location}.frame[${frameIndex}] data is not valid JSON`];
    }
  }
  return payloads.length > 0 ? payloads : [`${location} has no data frames`];
}

function collectInvalidSseExamples() {
  const invalid = [];
  for (const { operationId, operation } of operations) {
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      const resolvedResponse = resolveResponse(response);
      for (const [mediaType, media] of Object.entries(resolvedResponse?.content ?? {})) {
        if (mediaType !== 'text/event-stream') continue;
        const eventSchemaRef = media?.['x-event-schema'] ?? resolvedResponse?.['x-event-schema'];
        if (!eventSchemaRef) {
          invalid.push(`${operationId}.response.${status}.${mediaType} is missing x-event-schema`);
          continue;
        }
        const eventSchema = { $ref: eventSchemaRef };
        for (const [exampleName, example] of Object.entries(media.examples ?? {})) {
          if (!Object.hasOwn(example, 'value')) continue;
          const payloads = parseSseExampleDataFrames(example.value, `${operationId}.response.${status}.${mediaType}.${exampleName}`);
          for (const payload of payloads) {
            if (typeof payload === 'string') {
              invalid.push(payload);
            } else {
              invalid.push(...validateExampleValue(eventSchema, payload.value, payload.location).slice(0, 3));
            }
          }
        }
      }
    }
  }
  return invalid;
}

function scanRedactedPrivateSurface(records) {
  const secretLike = /\b(?:ck_session|csrfTokenValue|sessionCookieValue|mock-session|ck_msw_csrf_token_000000|ck_mock_csrf_token_000000|password|secret|token|cookie|authorization)\b/i;
  const privateContent = /\b(?:quote|contextQuote|excerpt|downloadUrl|prompt|provider traces?|tool args?|raw manuscript|manuscript)\b/i;
  const touchedFiles = new Set();
  let secretLikeMatches = 0;
  let privateContentMatches = 0;
  let allowlisted = 0;
  const unclassified = [];
  for (const record of records) {
    const relativePath = path.relative(process.cwd(), record.filePath).replace(/\\/g, '/');
    const lines = record.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const matchesSecret = secretLike.test(line);
      const matchesPrivateContent = privateContent.test(line);
      if (!matchesSecret && !matchesPrivateContent) return;
      touchedFiles.add(relativePath);
      if (matchesSecret) secretLikeMatches += 1;
      if (matchesPrivateContent) privateContentMatches += 1;
      const classification = classifyRedactedPrivateAnchor(relativePath, line, matchesSecret);
      if (classification) {
        allowlisted += 1;
      } else {
        unclassified.push(`${relativePath}:${index + 1}:${matchesSecret ? 'secret-like' : 'private-content'}`);
      }
    });
  }
  return {
    allowlisted,
    anchorCount: allowlisted + unclassified.length,
    files: touchedFiles.size,
    privateContentMatches,
    secretLikeMatches,
    unclassified,
  };
}

function classifyRedactedPrivateAnchor(relativePath, line, matchesSecret) {
  const knownSyntheticFixture = /\b(?:ck_session|mock-session|ck_msw_csrf_token_000000|ck_mock_csrf_token_000000|ck_csrf_example_token_000000|csrf_test_token_12345|white-port-12|wrong-password|csrfTokenValue|sessionCookieName|sessionCookieValue|idem-[A-Za-z0-9_-]+|req_(?:mock|msw|synthetic)[A-Za-z0-9_]*)\b/;
  const sensitiveAssignedQuotedLiteral = /['"]?(?:csrf|csrfToken|token|cookie|session|authorization|idempotency|password|credentials|csrfTokenValue|sessionCookieName|sessionCookieValue|x-csrf-token|idempotency-key|set-cookie)['"]?\s*[:=]\s*['"][^'"]{8,}['"]/i;
  const securityIdentifierOnly = /\b(?:csrf|token|cookie|session|authorization|idempotency|password|credentials|csrfTokenValue|sessionCookieName|sessionCookieValue)\b/i.test(line) && !sensitiveAssignedQuotedLiteral.test(line);
  const privateFieldIdentifier = /\b(?:quote|contextQuote|excerpt|downloadUrl|prompt|manuscript)\b/i.test(line) && !/:\s*['"][^'"]{20,}['"]/.test(line);
  if (knownSyntheticFixture.test(line)) {
    return 'known_synthetic_fixture';
  }
  if (relativePath === 'scripts/check-openapi-contract.mjs' && line.includes('auth-store.test.ts')) {
    return 'checker_self_rule';
  }
  if (relativePath === 'scripts/check-openapi-contract.mjs' && line.includes('leakedJsonValue')) {
    return 'checker_self_rule';
  }
  if (relativePath.startsWith('contracts/') && (securityIdentifierOnly || privateFieldIdentifier)) {
    return 'contract_security_or_private_identifier';
  }
  if (relativePath.startsWith('contracts/') && /\b(?:synthetic|redacted|bounded|no raw|no-store|schema|description|examples?|x-authz|data exposure|retention|audit)\b/i.test(line)) {
    return 'contract_redacted_policy_or_example';
  }
  if (relativePath.startsWith('scripts/') && /\b(?:synthetic|redacted|bounded|no raw|non-secret|private text|provider traces?|tool args?|regex|scan|fixture|example|unclassified|secret-like|csrf|token|cookie|session|idempotency|csrfTokenValue|sessionCookieValue|mock-session)\b/i.test(line)) {
    return 'checker_or_generator_rule';
  }
  if ((relativePath.startsWith('mock-server/') || relativePath.startsWith('src/test/') || relativePath.startsWith('src/api/mock/') || /\.test\.tsx?$/.test(relativePath)) && (securityIdentifierOnly || privateFieldIdentifier)) {
    return 'mock_or_test_identifier';
  }
  if (relativePath.startsWith('src/shared/api/generated/') && ((securityIdentifierOnly || privateFieldIdentifier) || /\b(?:bounded|no raw|provider traces?|tool args?)\b/i.test(line))) {
    return 'generated_contract_identifier';
  }
  if (relativePath === 'src/app/auth-store.test.ts' && /\bnon-secret auth shell state\b/i.test(line)) {
    return 'application_auth_state_test_label';
  }
  if (relativePath.startsWith('src/features/auth/') && /\bpassword\b/i.test(line)) {
    return 'application_auth_form_field';
  }
  if (relativePath.startsWith('src/shared/api/') && /\b(?:csrf|token|cookie|session|authorization|idempotency)\b/i.test(line)) {
    return 'application_security_identifier';
  }
  if (!matchesSecret && /\b(?:quote|contextQuote|excerpt|downloadUrl|prompt|manuscript)\b/i.test(line)) {
    return 'application_field_reference';
  }
  if (matchesSecret && /\b(?:csrf|token|cookie|session|authorization|credentials)\b/i.test(line) && !sensitiveAssignedQuotedLiteral.test(line)) {
    return 'application_security_identifier';
  }
  return null;
}

function assertRedactedPrivateClassifierCatchesAssignedSecrets() {
  const leakedJsonValue = '"password": "very-secret-value-123"';
  const leakedClassification = classifyRedactedPrivateAnchor('contracts/openapi.json', leakedJsonValue, true);
  if (leakedClassification) {
    fail(`redacted private classifier self-test expected JSON password value to be unclassified, received ${leakedClassification}`);
  }
  const syntheticJsonValue = '"password": "white-port-12"';
  if (!classifyRedactedPrivateAnchor('contracts/openapi.json', syntheticJsonValue, true)) {
    fail('redacted private classifier self-test expected known synthetic password fixture to be classified');
  }
}

assertRedactedPrivateClassifierCatchesAssignedSecrets();

function duplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function operationKey(operation) {
  return `${operation.method} ${operation.path} ${operation.operationId}`;
}

function rowSetDiff(label, expected, actual) {
  const diff = diffSet(new Set(expected), new Set(actual));
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    fail(`${label} mismatch missing=${diff.missing.join(',') || '0'} extra=${diff.extra.join(',') || '0'}`);
  }
  const duplicateRows = [...new Set(duplicates(actual))];
  if (duplicateRows.length > 0) fail(`${label} duplicate rows: ${duplicateRows.join(',')}`);
}

function operationById(operationId) {
  return operations.find((operation) => operation.operationId === operationId);
}

function diffSet(expected, actual) {
  return {
    missing: [...expected].filter((value) => !actual.has(value)),
    extra: [...actual].filter((value) => !expected.has(value)),
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsIdentifier(text, identifier) {
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(identifier)}(?![A-Za-z0-9_])`).test(text);
}

function extractStatuses(text) {
  return [...String(text).matchAll(/\b([1-5]\d\d)\b/g)].map((match) => match[1]);
}

function extractOperationIds(text) {
  return operationIds.filter((operationId) => containsIdentifier(String(text), operationId));
}

function parameterRefs(operation) {
  return new Set((operation.parameters ?? []).map((parameter) => parameter.$ref ?? `${parameter.in}:${parameter.name}`));
}

function successJsonSchema(operation, status = '200') {
  return operation?.responses?.[status]?.content?.['application/json']?.schema;
}

function hasPageMeta(schema) {
  const resolved = schema?.$ref ? resolveJsonPointer(spec, schema.$ref) : schema;
  return resolved?.properties?.meta?.$ref === '#/components/schemas/PageMeta'
    && (resolved.required ?? []).includes('meta');
}

function collectOpenObjectSchemaPaths(schema, label, issues = [], seen = new Set()) {
  if (!schema || typeof schema !== 'object') return issues;
  if (seen.has(schema)) return issues;
  seen.add(schema);
  if (schema.$ref) {
    return collectOpenObjectSchemaPaths(resolveJsonPointer(spec, schema.$ref), `${label}${schema.$ref}`, issues, seen);
  }
  if (schema.type === 'object' && schema.additionalProperties === undefined) {
    issues.push(label);
  }
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    collectOpenObjectSchemaPaths(value, `${label}.properties.${key}`, issues, seen);
  }
  for (const keyword of ['oneOf', 'anyOf', 'allOf']) {
    for (const [index, value] of (schema[keyword] ?? []).entries()) {
      collectOpenObjectSchemaPaths(value, `${label}.${keyword}[${index}]`, issues, seen);
    }
  }
  if (schema.items) collectOpenObjectSchemaPaths(schema.items, `${label}.items`, issues, seen);
  return issues;
}

function schemaProperty(schemaName, propertyName) {
  return spec.components?.schemas?.[schemaName]?.properties?.[propertyName];
}

function maxLengthFor(schema) {
  if (typeof schema?.maxLength === 'number') return schema.maxLength;
  if (Array.isArray(schema?.oneOf)) return Math.max(...schema.oneOf.map(maxLengthFor).filter(Number.isFinite));
  if (Array.isArray(schema?.anyOf)) return Math.max(...schema.anyOf.map(maxLengthFor).filter(Number.isFinite));
  return undefined;
}

if (spec.openapi !== '3.1.0') fail(`openapi version expected 3.1.0, received ${spec.openapi ?? '<missing>'}`);
if (spec.servers?.[0]?.url !== '/api/v1') fail('servers[0].url must be /api/v1');
if (!spec.components?.securitySchemes?.sessionAuth) fail('security scheme sessionAuth is missing');
for (const schema of requiredSchemas) {
  if (!spec.components?.schemas?.[schema]) fail(`schema ${schema} is missing`);
}
for (const operation of requiredOperations) {
  if (!uniqueOperationIds.has(operation)) fail(`operation ${operation} is missing`);
}
for (const operationId of legacyOperationIds) {
  if (uniqueOperationIds.has(operationId)) fail(`legacy operation ${operationId} is present in final contract`);
}
for (const schemaName of legacySchemaNames) {
  if (spec.components?.schemas?.[schemaName]) fail(`legacy schema ${schemaName} is present in final contract`);
}
for (const parameterName of legacyParameterNames) {
  if (spec.components?.parameters?.[parameterName]) fail(`legacy parameter ${parameterName} is present in final contract`);
}
for (const [schemaName, propertyName] of [
  ['TextRange', 'quote'],
  ['ReaderAnnotationBase', 'quote'],
  ['CreateHighlightAnnotationRequest', 'quote'],
  ['CreateNoteAnnotationRequest', 'quote'],
  ['CreateBookmarkAnnotationRequest', 'quote'],
  ['UpdateHighlightAnnotationRequest', 'quote'],
  ['UpdateNoteAnnotationRequest', 'quote'],
  ['UpdateBookmarkAnnotationRequest', 'quote'],
  ['ReaderReference', 'quote'],
  ['AgentSuggestion', 'contextQuote'],
]) {
  const property = schemaProperty(schemaName, propertyName);
  if (!property || (maxLengthFor(property) ?? Infinity) > 500) {
    fail(`${schemaName}.${propertyName} must be bounded to maxLength <= 500`);
  }
}
if ((maxLengthFor(schemaProperty('SearchResult', 'excerpt')) ?? Infinity) !== 240) {
  fail('SearchResult.excerpt must match snippetPolicy bounded_240_chars with maxLength 240');
}
for (const [schemaName, propertyName] of [
  ['ChatMessage', 'content'],
  ['ChatMessagePart', 'text'],
]) {
  const property = schemaProperty(schemaName, propertyName);
  if (!property || (maxLengthFor(property) ?? Infinity) !== 8000) {
    fail(`${schemaName}.${propertyName} must be bounded to maxLength 8000`);
  }
}
if (schemaProperty('ReaderLocator', 'source')) fail('ReaderLocator.source must not be part of the canonical locator');
if (schemaProperty('ChatTurnStartRequest', 'stream')) fail('ChatTurnStartRequest.stream compatibility flag must not be part of the canonical request');
if (schemaProperty('Project', 'activeBookId')) fail('Project.activeBookId must not be part of the canonical backend project resource');
if (schemaProperty('Project', 'ownerId')) fail('Project.ownerId must not be part of the canonical backend project resource; ownership is represented by ProjectMembership');
if (schemaProperty('UpdateProjectRequest', 'activeBookId')) fail('UpdateProjectRequest.activeBookId must not be part of canonical project mutations');
const bookStatuses = new Set(spec.components?.schemas?.BookStatus?.enum ?? []);
if (bookStatuses.has('indexing')) fail('BookStatus must not duplicate active indexing job lifecycle state');
const indexingStatuses = new Set(spec.components?.schemas?.IndexingStatus?.enum ?? []);
for (const forbiddenStatus of ['queued', 'running', 'canceling']) {
  if (indexingStatuses.has(forbiddenStatus)) fail(`IndexingStatus.${forbiddenStatus} must live on shared Job lifecycle, not Book.indexing`);
}
const indexingSummary = spec.components?.schemas?.IndexingSummary ?? {};
for (const forbiddenProperty of ['progress', 'activeJobId', 'currentUnit', 'totalUnits', 'message']) {
  if (Object.hasOwn(indexingSummary.properties ?? {}, forbiddenProperty) || (indexingSummary.required ?? []).includes(forbiddenProperty)) {
    fail(`IndexingSummary.${forbiddenProperty} must live on shared Job lifecycle, not Book.indexing`);
  }
}
const jobStatuses = new Set(spec.components?.schemas?.JobStatus?.enum ?? []);
if (!jobStatuses.has('canceling') || jobStatuses.has('ready')) fail('JobStatus must use shared queued/running/canceling/succeeded/failed/canceled/expired lifecycle without ready');
if ((spec.components?.schemas?.ChatTurnEventEnvelope?.oneOf ?? []).length < 10 || !spec.components?.schemas?.ChatTurnEventEnvelope?.discriminator) {
  fail('ChatTurnEventEnvelope must be a discriminated oneOf event schema');
}
const sensitiveClosedSchemaNames = [
  'ChatArtifact',
  'ChatMessage',
  'ChatMessagePart',
  'ChatTurnEventEnvelope',
  'ChatTurnSnapshot',
  'ChatTurnStartResponse',
  'AgentSuggestion',
  'AgentRunStartResponse',
  'Job',
  'JobList',
  'JobStartResponse',
  'ReaderReference',
];
const sensitiveOpenObjectSchemaPaths = sensitiveClosedSchemaNames.flatMap((schemaName) =>
  collectOpenObjectSchemaPaths(spec.components?.schemas?.[schemaName], schemaName),
);
if (sensitiveOpenObjectSchemaPaths.length > 0) {
  fail(`sensitive_open_object_schemas = ${sensitiveOpenObjectSchemaPaths.length}: ${sensitiveOpenObjectSchemaPaths.slice(0, 12).join(', ')}`);
}
if (schemaProperty('ChatMessagePart', 'metadata')) fail('ChatMessagePart.metadata must not be part of persisted canonical message parts');
if (schemaProperty('ChatMessagePart', 'label')) fail('ChatMessagePart.label must not be part of persisted canonical message parts; clients derive local labels');
for (const [schemaName, propertyName] of [
  ['Book', 'displayLabel'],
  ['ChapterNavigationItem', 'displayLabel'],
  ['ChatSession', 'lastMessagePreview'],
  ['ReaderAnnotationBase', 'createdFromSelection'],
  ['CreateHighlightAnnotationRequest', 'createdFromSelection'],
  ['CreateNoteAnnotationRequest', 'createdFromSelection'],
  ['CreateBookmarkAnnotationRequest', 'createdFromSelection'],
  ['UpdateHighlightAnnotationRequest', 'createdFromSelection'],
  ['UpdateNoteAnnotationRequest', 'createdFromSelection'],
  ['UpdateBookmarkAnnotationRequest', 'createdFromSelection'],
  ['ChatTurnStartResponse', 'streamUrl'],
  ['ChatTurnStartResponse', 'pollUrl'],
]) {
  if (schemaProperty(schemaName, propertyName)) fail(`${schemaName}.${propertyName} must not be part of the backend-first public contract`);
}
const uiOnlyContractTerms = ['displayLabel', 'lastMessagePreview', 'createdFromSelection', 'dropzone', 'frontend validation', 'project sidebar'];
const contractText = JSON.stringify(spec);
for (const term of uiOnlyContractTerms) {
  if (new RegExp(escapeRegex(term), 'i').test(contractText)) fail(`OpenAPI contract still contains UI-only term: ${term}`);
  if (new RegExp(escapeRegex(term), 'i').test(contractReadme)) fail(`contracts/README.md still contains UI-only term: ${term}`);
}
const bookOrder = schemaProperty('Book', 'order');
if (bookOrder?.minimum !== 1 || /zero-based/i.test(bookOrder?.description ?? '')) {
  fail('Book.order must be one-based with minimum 1');
}
const jobResult = schemaProperty('Job', 'result');
const jobLinks = schemaProperty('Job', 'links');
if (!jobResult?.anyOf?.some((entry) => entry.$ref === '#/components/schemas/JobResult')) fail('Job.result must reference bounded JobResult');
if (jobLinks?.additionalProperties !== false || jobLinks?.properties?.result?.type?.[0] !== 'string' || !jobLinks?.properties?.result?.pattern) {
  fail('Job.links.result must be a constrained relative result link or null');
}
const userSchema = spec.components?.schemas?.User;
if (!userSchema?.required?.includes('emailVerified') || userSchema?.properties?.emailVerified?.type !== 'boolean') {
  fail('User.emailVerified must be a required provider-verified session field for invitation discovery');
}
const readerReferenceParagraphId = schemaProperty('ReaderReferenceLocator', 'paragraphId');
if (readerReferenceParagraphId?.anyOf?.some((entry) => entry.type === 'null') || readerReferenceParagraphId?.type === 'null') {
  fail('ReaderReferenceLocator.paragraphId must be a required non-null Id');
}
const allowedSearchScopes = ['all', 'chapters', 'annotations'];
const searchScopeEnum = spec.components?.schemas?.SearchScope?.enum ?? [];
if (JSON.stringify(searchScopeEnum) !== JSON.stringify(allowedSearchScopes)) {
  fail(`SearchScope must expose only project/book/chapter-backed scopes: ${searchScopeEnum.join(',')}`);
}
const allowedSearchKinds = ['chapter', 'annotation'];
const searchResultKindEnum = schemaProperty('SearchResult', 'kind')?.enum ?? [];
const searchResultKindSchemaEnum = spec.components?.schemas?.SearchResultKind?.enum ?? [];
if (JSON.stringify(searchResultKindEnum) !== JSON.stringify(allowedSearchKinds) || JSON.stringify(searchResultKindSchemaEnum) !== JSON.stringify(allowedSearchKinds)) {
  fail('SearchResult kinds must be limited to chapter and annotation');
}
const jobResultSchema = spec.components?.schemas?.JobResult;
if (jobResultSchema?.discriminator?.propertyName !== 'type') fail('JobResult must use type discriminator');
for (const [schemaName, resultType, requiredFields] of [
  ['JobProgressResult', 'progress', ['type']],
  ['ExportJobResult', 'export', ['type', 'bookId', 'format']],
  ['ChatTurnJobResult', 'chat_turn', ['type', 'chatId', 'turnId', 'userMessageId']],
  ['AgentRunJobResult', 'agent_run', ['type', 'runId', 'suggestionIds', 'suggestionBatchId']],
]) {
  const schema = spec.components?.schemas?.[schemaName];
  if (schema?.properties?.type?.const !== resultType) fail(`${schemaName}.type must const ${resultType}`);
  for (const field of requiredFields) {
    if (!schema?.required?.includes(field)) fail(`${schemaName}.${field} must be required`);
  }
}
if (jobLinks?.properties?.self?.pattern !== '^/api/v1/jobs/[^/]+$') fail('Job.links.self must use canonical /api/v1/jobs/{jobId} URLs');
if (jobLinks?.properties?.cancel?.pattern !== '^/api/v1/jobs/[^/]+/cancel$') fail('Job.links.cancel must use canonical /api/v1/jobs/{jobId}/cancel URLs');
const jobStartLinks = schemaProperty('JobStartResponse', 'links');
if (jobStartLinks?.properties?.job?.pattern !== '^/api/v1/jobs/[^/]+$') fail('JobStartResponse.links.job must use canonical /api/v1/jobs/{jobId} URLs');
if (jobStartLinks?.properties?.poll?.pattern !== '^/api/v1/jobs/[^/]+$') fail('JobStartResponse.links.poll must use canonical /api/v1/jobs/{jobId} URLs');
const chatTurnStartLinks = schemaProperty('ChatTurnStartResponse', 'links');
if (chatTurnStartLinks?.additionalProperties !== false) fail('ChatTurnStartResponse.links must be a closed canonical link object');
if (chatTurnStartLinks?.properties?.events?.pattern !== '^/api/v1/chat-turns/[^/]+/events$') fail('ChatTurnStartResponse.links.events must use canonical /api/v1/chat-turns/{turnId}/events URLs');
if (chatTurnStartLinks?.properties?.poll?.pattern !== '^/api/v1/chat-turns/[^/]+$') fail('ChatTurnStartResponse.links.poll must use canonical /api/v1/chat-turns/{turnId} URLs');
const agentRunLinks = schemaProperty('AgentRunStartResponse', 'links');
if (agentRunLinks?.properties?.job?.pattern !== '^/api/v1/jobs/[^/]+$') fail('AgentRunStartResponse.links.job must use canonical /api/v1/jobs/{jobId} URLs');
const unprefixedJobLinkExamples = rawContract.match(/"(?:self|cancel|job|poll)"\s*:\s*"\/jobs\//g) ?? [];
if (unprefixedJobLinkExamples.length > 0) fail(`unprefixed_job_link_examples = ${unprefixedJobLinkExamples.length}`);
const asyncLocationHeaderIssues = operations
  .filter((operation) => operation.responses?.['202'])
  .filter((operation) => operation.responses?.['202']?.headers?.Location?.schema?.pattern !== '^/api/v1/jobs/[^/]+$')
  .map((operation) => operation.operationId);
if (asyncLocationHeaderIssues.length > 0) fail(`async_location_headers_must_point_to_canonical_jobs = ${asyncLocationHeaderIssues.join(',')}`);
const problemRequired = new Set(spec.components?.schemas?.Problem?.required ?? []);
for (const requiredField of ['type', 'title', 'status', 'code', 'requestId']) {
  if (!problemRequired.has(requiredField)) fail(`Problem.required is missing ${requiredField}`);
}
if (!spec.components?.schemas?.Problem?.properties?.errors) fail('Problem must expose validation details as errors[]');
if (spec.components?.schemas?.Problem?.properties?.validationErrors) fail('Problem must not expose validationErrors; use errors[]');
if (operationIds.length !== uniqueOperationIds.size) {
  const duplicates = operationIds.filter((operationId, index) => operationIds.indexOf(operationId) !== index);
  fail(`duplicate operationId(s): ${[...new Set(duplicates)].join(', ')}`);
}
if (changedUnion.error) {
  fail(`changed union scan could not read git status: ${changedUnion.error instanceof Error ? changedUnion.error.message : String(changedUnion.error)}`);
}
if (activeSurfaceReadFailures.length > 0) {
  fail(`active_surface_read_failures = ${activeSurfaceReadFailures.length} (${activeSurfaceReadFailures.slice(0, 8).map((filePath) => path.relative(process.cwd(), filePath)).join(', ')})`);
}
if (baselineInventory.baselineRef !== expectedBaselineRef) {
  fail(`baselineRef expected ${expectedBaselineRef}, received ${baselineInventory.baselineRef ?? '<missing>'}`);
}
if (baselineOps.length !== expectedBaselineOperationCount) {
  fail(`baseline operation inventory expected ${expectedBaselineOperationCount}, received ${baselineOps.length}`);
}
if (baselineSchemas.length !== expectedBaselineSchemaCount) {
  fail(`baseline schema inventory expected ${expectedBaselineSchemaCount}, received ${baselineSchemas.length}`);
}
rowSetDiff('baseline operation inventory', [...new Set(baselineOps.map(operationKey))], baselineOps.map(operationKey));
rowSetDiff('baseline schema inventory', [...new Set(baselineSchemas)], baselineSchemas);
const actualBaselineInventoryDigest = baselineInventoryDigest(baselineOps, baselineSchemas, baselineInventory.baselineRef);
if (actualBaselineInventoryDigest !== expectedBaselineInventoryDigest) {
  fail(`baseline inventory digest expected ${expectedBaselineInventoryDigest}, received ${actualBaselineInventoryDigest}`);
}
const genericProjectAuthz =
  'Project membership is checked through the owning project; inaccessible cross-project direct IDs return leak-safe 404.';
const nonProjectAuthzOperations = new Set(['getCsrfToken', 'registerUser', 'loginUser', 'logoutUser', 'getCurrentUser', 'rotateSession', 'createProject']);
for (const { operationId, path: apiPath, method, operation } of operations) {
  if (!operationId) fail(`${method.toUpperCase()} ${apiPath} is missing operationId`);
  const authz = operation['x-authz'];
  if (!authz) fail(`${operationId} must declare x-authz`);
  if (method === 'get' && /command|job/i.test(operation['x-backend-purpose'] ?? '')) {
    fail(`${operationId} GET operation must be marked as query/read purpose, not ${operation['x-backend-purpose']}`);
  }
  if (authz === genericProjectAuthz) fail(`${operationId} x-authz is generic copied project text`);
  if (nonProjectAuthzOperations.has(operationId) && /owning project|direct IDs|direct ids|cross-project/i.test(authz ?? '')) {
    fail(`${operationId} x-authz must not describe project direct-ID membership`);
  }
  if (operationId === 'renameChatSession' && !/viewer.*403/i.test(authz ?? '')) {
    fail('renameChatSession x-authz must state viewer 403 for rename mutation');
  }
  if (operationId === 'createBookExport' && !/owner\/admin/i.test(authz ?? '')) {
    fail('createBookExport x-authz must state owner/admin export restriction');
  }
  if (operationId === 'importBookFile' && !/editor\/admin\/owner/i.test(authz ?? '')) {
    fail('importBookFile x-authz must state editor/admin/owner upload restriction');
  }
  if (cursorPaginatedOperationIds.has(operationId)) {
    const refs = parameterRefs(operation);
    if (!refs.has('#/components/parameters/Limit') || !refs.has('#/components/parameters/Cursor')) {
      fail(`${operationId} must declare cursor pagination query parameters`);
    }
    if (!hasPageMeta(successJsonSchema(operation))) {
      fail(`${operationId} 200 response must include PageMeta`);
    }
  }
  if (!publicOperationIds.has(operationId) && !operation.security?.some((item) => Object.hasOwn(item, 'sessionAuth'))) {
    fail(`${operationId} must declare sessionAuth`);
  }
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    if (/^[45]/.test(status) && response.content !== undefined && !hasApplicationProblem(response)) {
      fail(`${operationId} ${status} must use application/problem+json Problem`);
    }
    if (status === '429' && !hasHeader(response, 'Retry-After')) {
      fail(`${operationId} 429 must declare Retry-After`);
    }
    if (/^2/.test(status) && ['registerUser', 'loginUser', 'logoutUser', 'getCsrfToken', 'rotateSession'].includes(operationId) && !hasHeader(response, 'Cache-Control')) {
      fail(`${operationId} ${status} must declare Cache-Control`);
    }
    const resolvedResponse = resolveResponse(response);
    const isProtectedJsonSuccess = /^2/.test(status) &&
      operation.security?.some((item) => Object.hasOwn(item, 'sessionAuth')) &&
      resolvedResponse?.content !== undefined &&
      resolvedResponse?.content?.['text/event-stream'] === undefined;
    if (isProtectedJsonSuccess && !hasHeader(response, 'Cache-Control')) {
      fail(`${operationId} ${status} protected JSON response must declare Cache-Control`);
    }
  }
}
const searchOperation = operationById('searchProject')?.operation;
const searchRequestRef = searchOperation?.requestBody?.content?.['application/json']?.schema?.$ref;
const searchRequestSchema = searchRequestRef ? resolveJsonPointer(spec, searchRequestRef) : searchOperation?.requestBody?.content?.['application/json']?.schema;
if (!searchRequestSchema?.properties?.limit || !searchRequestSchema?.properties?.cursor) {
  fail('searchProject request body must include limit and cursor pagination fields');
}
const searchFiltersSchema = searchRequestSchema?.properties?.filters?.$ref
  ? resolveJsonPointer(spec, searchRequestSchema.properties.filters.$ref)
  : searchRequestSchema?.properties?.filters;
if (!searchFiltersSchema || searchFiltersSchema.additionalProperties !== false) {
  fail('SearchProjectRequest.filters must reference a closed typed filter schema');
}
for (const filterKey of ['bookId', 'chapterId', 'resultKinds', 'updatedSince']) {
  if (!searchFiltersSchema?.properties?.[filterKey]) fail(`SearchProjectFilters must define ${filterKey}`);
}
const resultKindValues = new Set(spec.components?.schemas?.SearchResultKind?.enum ?? []);
for (const expectedKind of ['chapter', 'annotation']) {
  if (!resultKindValues.has(expectedKind)) fail(`SearchResultKind enum is missing ${expectedKind}`);
}
if (!hasPageMeta(successJsonSchema(searchOperation))) {
  fail('searchProject 200 response must include PageMeta');
}
const cursorDescription = spec.components?.parameters?.Cursor?.description ?? '';
if (!/invalid or mismatched cursors return 400 Problem/i.test(cursorDescription)) {
  fail('Cursor parameter must state invalid or mismatched cursors return 400 Problem');
}
if (!searchOperation?.responses?.['400']) {
  fail('searchProject must declare 400 Problem for invalid or mismatched cursors');
}
const missingExampleOperations = [...requiredExampleOperations].filter((operationId) => !operationHasExample(operationById(operationId)?.operation));
if (missingExampleOperations.length > 0) {
  fail(`missing_required_operation_examples = ${missingExampleOperations.join(',')}`);
}
const missingProblemExamples = ['BadRequest', 'Unauthorized', 'Forbidden', 'Conflict', 'TooManyRequests'].filter((name) => {
  const response = resolveResponse(spec.components?.responses?.[name]);
  return Object.keys(response?.content?.['application/problem+json']?.examples ?? {}).length === 0;
});
if (missingProblemExamples.length > 0) {
  fail(`missing_problem_examples = ${missingProblemExamples.join(',')}`);
}
const invalidJsonExamples = collectInvalidJsonExamples();
const invalidSseExamples = collectInvalidSseExamples();
const invalidSchemaExamples = [...invalidJsonExamples, ...invalidSseExamples];
if (invalidSchemaExamples.length > 0) {
  fail(`invalid_schema_examples = ${invalidSchemaExamples.slice(0, 20).join('; ')}`);
}
const authSessionExampleFailures = [];
const csrfOperation = operationById('getCsrfToken')?.operation;
if (!responseHasExample(csrfOperation, 200)) authSessionExampleFailures.push('getCsrfToken:200');
const loginOperation = operationById('loginUser')?.operation;
if (!requestHasExample(loginOperation)) authSessionExampleFailures.push('loginUser:request');
if (!responseHasExample(loginOperation, 200)) authSessionExampleFailures.push('loginUser:200');
if (!responseHasExample(loginOperation, 401, 'application/problem+json')) authSessionExampleFailures.push('loginUser:401_problem');
const registerOperation = operationById('registerUser')?.operation;
if (!requestHasExample(registerOperation)) authSessionExampleFailures.push('registerUser:request');
if (!responseHasExample(registerOperation, 201)) authSessionExampleFailures.push('registerUser:201');
if (!responseHasExample(registerOperation, 409, 'application/problem+json')) authSessionExampleFailures.push('registerUser:409_problem');
if (!operationHasXExample(operationById('logoutUser')?.operation)) authSessionExampleFailures.push('logoutUser:x-example');
if (!responseHasExample(operationById('rotateSession')?.operation, 200)) authSessionExampleFailures.push('rotateSession:200');
if (authSessionExampleFailures.length > 0) {
  fail(`missing_auth_session_examples = ${authSessionExampleFailures.join(',')}`);
}

const unsafeProtected = operations.filter(
  ({ method, operation }) =>
    unsafeMethods.has(method) &&
    operation.security?.some((item) => Object.hasOwn(item, 'sessionAuth')),
);
const missingCsrfHeaderOps = unsafeProtected.filter(({ operation }) => getParameter(operation, 'X-CSRF-Token')?.required !== true).length;
if (missingCsrfHeaderOps > 0) fail(`missing_csrf_header_ops = ${missingCsrfHeaderOps}`);
const safeMethodCsrfParameterOps = operations
  .filter(({ method, operation }) => !unsafeMethods.has(method) && getParameter(operation, 'X-CSRF-Token'))
  .map(({ operationId }) => operationId);
if (safeMethodCsrfParameterOps.length > 0) fail(`safe_method_csrf_parameter_ops = ${safeMethodCsrfParameterOps.length}: ${safeMethodCsrfParameterOps.join(', ')}`);
const sessionMutationOps = operations.filter(({ operation }) => operation['x-session-cookie-mutation']);
const missingSessionMutationCsrfOps = sessionMutationOps.filter(({ operation }) => getParameter(operation, 'X-CSRF-Token')?.required !== true || !operation['x-strict-origin-required']).length;
if (missingSessionMutationCsrfOps > 0) fail(`missing_session_mutation_csrf_ops = ${missingSessionMutationCsrfOps}`);

const myInvitationsOperation = operationById('listMyProjectInvitations')?.operation;
if (!myInvitationsOperation) fail('listMyProjectInvitations must provide verified-email invitation discovery before accept');
if (myInvitationsOperation && !hasPageMeta(successJsonSchema(myInvitationsOperation))) {
  fail('listMyProjectInvitations 200 response must include PageMeta');
}
if (myInvitationsOperation && !/provider-verified canonical email/i.test(myInvitationsOperation.description ?? '')) {
  fail('listMyProjectInvitations must describe verified-email discovery for non-secret invitation ids');
}
const acceptInvitationOperation = operationById('acceptProjectInvitation')?.operation;
if (!/listMyProjectInvitations/i.test(acceptInvitationOperation?.description ?? '') || !/opaque invitation id/i.test(acceptInvitationOperation?.description ?? '')) {
  fail('acceptProjectInvitation must document the verified-email discovery flow for opaque invitation ids');
}

const problemShapeExceptions = operations.filter(({ operation }) =>
  Object.entries(operation.responses ?? {}).some(([status, response]) => /^[45]/.test(status) && response.content !== undefined && !hasApplicationProblem(response)),
).length;
if (problemShapeExceptions > 0) fail(`json_problem_media_shape_exceptions = ${problemShapeExceptions}`);

for (const { ref, location } of collectRefs(spec)) {
  if (!resolveJsonPointer(spec, ref)) fail(`unresolved ref ${ref} at ${location}`);
}

const manifestOperations = parseOperationManifest(manifest);
const manifestOperationIds = [...manifestOperations.keys()];
const missingManifest = operationIds.filter((operationId) => !manifestOperationIds.includes(operationId));
const extraManifest = manifestOperationIds.filter((operationId) => !uniqueOperationIds.has(operationId));
const manifestRouteMismatches = operations
  .filter(({ methodUpper, operationId, path }) => {
    const route = manifestOperations.get(operationId);
    if (!route) return false;
    return route.method !== methodUpper || route.path !== path || !sameStringArray(route.pathParams, operationPathParams(path));
  })
  .map(({ operationId }) => operationId);
if (missingManifest.length > 0 || extraManifest.length > 0 || manifestRouteMismatches.length > 0) {
  fail(
    `operationManifest mismatch missing=${missingManifest.join(',') || '0'} extra=${extraManifest.join(',') || '0'} route_mismatches=${
      manifestRouteMismatches.join(',') || '0'
    }`,
  );
}

for (const scenarioId of requiredScenarioIds) {
  if (!reviewMd.includes(`| ${scenarioId} |`)) fail(`scenario row ${scenarioId} is missing`);
}
for (const [markdown, label, requiredZeros] of [
  [reviewMd, 'review', ['missing_scenario_rows', 'duplicate_scenario_rows', 'extra_scenario_rows', 'missing_final_operation_rows', 'missing_final_schema_rows', 'missing_policy_rows', 'ui_only_rows', 'unresolved_overlap_rows', 'missing_proof_notes', 'unresolved']],
  [securityMd, 'security', ['missing_security_rows', 'missing_actor_rows', 'missing_rate_limit_rows', 'missing_csrf_rows', 'missing_audit_rows', 'missing_deletion_rows', 'missing_data_exposure_rows', 'missing_matrix_response_statuses', 'missing_session_mutation_csrf_ops', 'missing_csrf_header_ops', 'missing_actor_outcome_rows', 'extra_actor_outcome_rows', 'actor_outcome_cell_issues', 'missing_actor_outcome_statuses', 'unresolved']],
  [migrationMd, 'migration', ['unresolved', 'old_operation_missing', 'old_operation_duplicate', 'old_schema_missing', 'old_schema_duplicate', 'no_replacement_rows']],
]) {
  for (const counter of requiredZeros) {
    if (!markdownHasZero(markdown, counter)) fail(`${label} counter ${counter} is not 0`);
  }
}

const reviewScenarioTableRows = tableRows(reviewMd, 'Scenario Coverage Matrix');
const reviewScenarioRows = reviewScenarioTableRows.length;
const reviewEndpointTableRows = tableRows(reviewMd, 'Endpoint Inventory Diff');
const reviewSchemaTableRows = tableRows(reviewMd, 'Schema Component Inventory Diff');
const reviewFinalOperationTableRows = tableRows(reviewMd, 'Final Operation Inventory');
const reviewFinalSchemaTableRows = tableRows(reviewMd, 'Final Schema Inventory');
const policyTableRows = tableRows(reviewMd, 'Policy Matrix');
const stagedAllowanceTableRows = tableRows(reviewMd, 'Staged Allowance Inventory');
const reviewEndpointRows = reviewEndpointTableRows.length;
const reviewSchemaRows = reviewSchemaTableRows.length;
const reviewFinalOperationRows = reviewFinalOperationTableRows.length;
const reviewFinalSchemaRows = reviewFinalSchemaTableRows.length;
const policyRows = policyTableRows.length;
const reviewRows = reviewScenarioRows + reviewEndpointRows + reviewSchemaRows + reviewFinalOperationRows + reviewFinalSchemaRows + policyRows;
const securityOperationRows = tableRows(securityMd, 'Operation Security Rows');
const securityRows = securityOperationRows.length;
const migrationEndpointTableRows = tableRows(migrationMd, 'Endpoint Migration Table');
const migrationSchemaTableRows = tableRows(migrationMd, 'Schema Component Migration Table');
const migrationEndpointRows = migrationEndpointTableRows.length;
const migrationSchemaRows = migrationSchemaTableRows.length;
const migrationRows = migrationEndpointRows + migrationSchemaRows;
const expectedOperationSet = new Set(operationIds);
const finalOperationKeys = operations.map((operation) => `${operation.method.toUpperCase()} ${operation.path} ${operation.operationId}`);
const finalReviewOperationKeys = reviewFinalOperationTableRows.map((row) => {
  const [operationId, methodPath] = tableCells(row);
  return `${methodPath} ${operationId}`;
});
const finalOperationDiff = diffSet(new Set(finalOperationKeys), new Set(finalReviewOperationKeys));
const policyDiff = diffSet(expectedOperationSet, operationSetFromRows(policyTableRows));
const securityDiff = diffSet(expectedOperationSet, operationSetFromRows(tableRows(securityMd, 'Operation Security Rows')));
const missingProofNotes = countRowsWithBlank(tableRows(reviewMd, 'Scenario Coverage Matrix'), [10]);
const uiOnlyRows = policyTableRows.map(tableCells).filter((cells) => cells[5] !== '0').length;
const unresolvedOverlapRows = countRowsWithBlank(policyTableRows, [3]) + uiOnlyRows;
const noReplacementRows = [
  ...reviewEndpointTableRows.map(tableCells).filter((cells) => cells.some((cell) => /no replacement/i.test(cell)) || isBlankCell(cells[4])),
  ...reviewSchemaTableRows.map(tableCells).filter((cells) => cells.some((cell) => /no replacement/i.test(cell)) || isBlankCell(cells[2])),
  ...migrationEndpointTableRows.map(tableCells).filter((cells) => cells.some((cell) => /no replacement/i.test(cell)) || isBlankCell(cells[1]) || cells[5] !== '0'),
  ...migrationSchemaTableRows.map(tableCells).filter((cells) => cells.some((cell) => /no replacement/i.test(cell)) || isBlankCell(cells[1]) || cells[5] !== '0'),
].length;
const blankRequiredCells = [
  ...reviewEndpointTableRows.map((row) => tableCells(row)).filter((cells) => [3, 4, 5, 6].some((index) => isBlankCell(cells[index]))),
  ...reviewSchemaTableRows.map((row) => tableCells(row)).filter((cells) => [1, 2, 3, 4].some((index) => isBlankCell(cells[index]))),
  ...reviewFinalOperationTableRows.map((row) => tableCells(row)).filter((cells) => [0, 1, 2, 3].some((index) => isBlankCell(cells[index]))),
  ...reviewFinalSchemaTableRows.map((row) => tableCells(row)).filter((cells) => [0, 1, 2].some((index) => isBlankCell(cells[index]))),
  ...migrationEndpointTableRows.map((row) => tableCells(row)).filter((cells) => [0, 1, 2, 3].some((index) => isBlankCell(cells[index]))),
  ...migrationSchemaTableRows.map((row) => tableCells(row)).filter((cells) => [0, 1, 2, 3].some((index) => isBlankCell(cells[index]))),
].length;
const securityCells = securityOperationRows.map(tableCells);
const requiredActorClasses = ['anonymous', 'authenticated_non_member', 'invited_user', 'viewer', 'editor', 'admin', 'owner', 'internal_worker/provider'];
const missingActorRows = securityCells.filter((cells) => requiredActorClasses.some((actor) => !cells[2]?.includes(actor))).length;
const missingRoleRows = securityCells.filter((cells) => isBlankCell(cells[4])).length;
const missingTenantRows = securityCells.filter((cells) => isBlankCell(cells[5])).length;
const missingCsrfRows = securityCells.filter((cells) => isBlankCell(cells[6])).length;
const missingReplayRows = securityCells.filter((cells) => isBlankCell(cells[7])).length;
const missingRateLimitRows = securityCells.filter((cells) => isBlankCell(cells[8])).length;
const missingAuditRows = securityCells.filter((cells) => isBlankCell(cells[10]) || !/^audit\./.test(cells[10])).length;
const missingDeletionRows = securityCells.filter((cells) => isBlankCell(cells[11])).length;
const missingDataExposureRows = securityCells.filter((cells) => isBlankCell(cells[12])).length;
const missingSecurityRows = securityCells.filter((cells) => [2, 3, 4, 5, 6, 7, 8, 10, 11, 12].some((index) => isBlankCell(cells[index]))).length;
const actorOutcomeRows = tableRows(securityMd, 'Actor Outcome Matrix');
const actorOutcomeCells = actorOutcomeRows.map(tableCells);
const actorOutcomeDiff = diffSet(expectedOperationSet, operationSetFromRows(actorOutcomeRows));
const missingActorOutcomeRows = actorOutcomeDiff.missing.length;
const extraActorOutcomeRows = actorOutcomeDiff.extra.length;
const actorOutcomeIndexes = [2, 3, 4, 5, 6, 7, 8, 9];
const securityRolePolicyByOperationId = new Map(securityCells.map((cells) => [cells[0], cells[4] ?? '']));
function hasSuccessfulStatus(value) {
  return extractStatuses(value).some((status) => /^2\d\d$/.test(status));
}
function rolePolicyDeniesViewer(rolePolicy) {
  return /viewer denied|editor\/viewer denied|viewer\/editor denied|viewer.*403|unauthorized project members get 403/i.test(rolePolicy);
}
const actorOutcomeCellIssues = actorOutcomeCells.flatMap((cells) => {
  const [operationId, methodPath] = cells;
  const operationEntry = operationById(operationId);
  const issues = [];
  if (!operationEntry) return [`${operationId}:missing-operation`];
  const expectedMethodPath = `${operationEntry.method.toUpperCase()} ${operationEntry.path}`;
  if (methodPath !== expectedMethodPath) issues.push(`${operationId}:method-path`);
  for (const index of actorOutcomeIndexes) {
    if (isBlankCell(cells[index]) || extractStatuses(cells[index]).length === 0) issues.push(`${operationId}:actor-${index}`);
  }
  if (rolePolicyDeniesViewer(securityRolePolicyByOperationId.get(operationId) ?? '') && hasSuccessfulStatus(cells[5])) {
    issues.push(`${operationId}:viewer-outcome-contradicts-role-policy`);
  }
  return issues;
});
const actorOutcomeStatusMissingPairs = actorOutcomeCells.flatMap((cells) => {
  const [operationId] = cells;
  const operation = operationById(operationId)?.operation;
  if (!operation) return [];
  const openApiStatuses = new Set(Object.keys(operation.responses ?? {}));
  return actorOutcomeIndexes.flatMap((index) =>
    extractStatuses(cells[index])
      .filter((status) => !openApiStatuses.has(status))
      .map((status) => `${operationId}:${index}:${status}`),
  );
});
const scenarioIds = reviewScenarioTableRows.map((row) => tableCells(row)[0]).filter(Boolean);
const missingScenarioRows = requiredScenarioIds.filter((scenarioId) => !scenarioIds.includes(scenarioId)).length;
const duplicateScenarioRows = [...new Set(duplicates(scenarioIds))].length;
const extraScenarioRows = scenarioIds.filter((scenarioId) => !requiredScenarioIds.includes(scenarioId)).length;
const scenarioFieldIssues = reviewScenarioTableRows.flatMap((row) => {
  const cells = tableCells(row);
  const [scenarioId, sourceRef, actor, operationText, requestSchemaText, successText, authText, negativeText, retryText, asyncText, proofNote] = cells;
  const expected = requiredScenarioRows[scenarioId];
  const issues = [];
  if (!expected) return [`${scenarioId}:unexpected`];
  if (sourceRef !== expected.source) issues.push(`${scenarioId}:source_ref`);
  for (const token of [...expected.operations, ...expected.requestSchemas, ...expected.authTokens]) {
    const haystack = `${operationText} ${requestSchemaText} ${authText} ${retryText} ${asyncText}`;
    if (!haystack.includes(token)) issues.push(`${scenarioId}:missing:${token}`);
  }
  const missingSuccess = expected.allowNotApplicableResponses ? !successText : isBlankCell(successText);
  const missingNegative = expected.allowNotApplicableResponses ? !negativeText : isBlankCell(negativeText);
  if (isBlankCell(actor) || missingSuccess || missingNegative || isBlankCell(proofNote) || !/^pass:/i.test(proofNote)) {
    issues.push(`${scenarioId}:blank_or_unproven_cell`);
  }
  return issues;
});
const reviewMatrixStatusMissingPairs = reviewScenarioTableRows.flatMap((row) => {
  const cells = tableCells(row);
  const scenarioId = cells[0];
  const rowOperationIds = extractOperationIds(cells[3]);
  if (rowOperationIds.length === 0) return [];
  const openApiStatuses = new Set(rowOperationIds.flatMap((operationId) => Object.keys(operationById(operationId)?.operation?.responses ?? {})));
  return extractStatuses(cells[7])
    .filter((status) => !openApiStatuses.has(status))
    .map((status) => `${scenarioId}:${status}`);
});
const idempotencyOperationIds = new Set(operations.filter(({ operation }) => parameterRefs(operation).has('#/components/parameters/IdempotencyKey')).map(({ operationId }) => operationId));
const ownerAdminOperationIds = new Set(['createBookExport', 'listProjectInvitations', 'createProjectInvitation', 'cancelProjectInvitation', 'listProjectMembers', 'updateProjectMemberRole', 'removeProjectMember']);
const editorMutationOperationIds = new Set(['createBook', 'updateBook', 'deleteBook', 'createChapter', 'updateChapter', 'publishChapter', 'deleteChapter', 'createChapterAnnotation', 'updateReaderAnnotation', 'deleteReaderAnnotation', 'createChatSession', 'createChatTurn', 'deleteChatSession', 'renameChatSession', 'startProjectIndexing', 'startAgentRun', 'approveAgentSuggestion', 'rejectAgentSuggestion', 'importBookFile']);
const securitySemanticIssues = securityCells.flatMap((cells) => {
  const [operationId, methodPath, , auth, role, tenantScope, csrf, replay, rateLimit, statusText, audit, deletion, dataExposure] = cells;
  const operationEntry = operationById(operationId);
  const issues = [];
  if (!operationEntry) return [`${operationId}:missing-operation`];
  const expectedMethodPath = `${operationEntry.method.toUpperCase()} ${operationEntry.path}`;
  if (methodPath !== expectedMethodPath) issues.push(`${operationId}:method-path`);
  const isPublic = publicOperationIds.has(operationId);
  if (isPublic && auth !== 'public') issues.push(`${operationId}:auth-public`);
  if (!isPublic && auth !== 'sessionAuth') issues.push(`${operationId}:auth-session`);
  const method = operationEntry.method.toLowerCase();
  if (unsafeMethods.has(method) && !/X-CSRF-Token required/i.test(csrf)) issues.push(`${operationId}:csrf-required`);
  if (!unsafeMethods.has(method) && !/not required for safe method/i.test(csrf)) issues.push(`${operationId}:csrf-safe`);
  if (idempotencyOperationIds.has(operationId) && !/Idempotency-Key.*mismatched payload 409 Problem/i.test(replay)) issues.push(`${operationId}:idempotency`);
  if (operationId === 'searchProject' && !/cursor bound to request fingerprint/i.test(replay)) issues.push(`${operationId}:cursor-replay`);
  if (!idempotencyOperationIds.has(operationId) && operationId !== 'searchProject') {
    if (method === 'get' && !/ordinary safe\/idempotent HTTP/i.test(replay)) issues.push(`${operationId}:safe-replay-policy`);
    if (operationId === 'cancelJob' && !/ordinary idempotent cancel.*no Idempotency-Key required.*terminal jobs return current state/i.test(replay)) {
      issues.push(`${operationId}:cancel-replay-policy`);
    } else if (unsafeMethods.has(method) && operationId !== 'cancelJob' && !/Non-idempotent command; no Idempotency-Key replay; backend rejects .*409 Problem.*expectedRevision/i.test(replay)) {
      issues.push(`${operationId}:mutation-replay-policy`);
    }
  }
  if (ownerAdminOperationIds.has(operationId) && !/owner\/admin|owner-admin/i.test(role)) issues.push(`${operationId}:owner-admin-role`);
  if (editorMutationOperationIds.has(operationId) && !/viewer denied|editor\/admin\/owner|owner\/admin|job creator/i.test(role)) issues.push(`${operationId}:mutation-role`);
  if (nonProjectAuthzOperations.has(operationId) && /project membership|cross-project|direct IDs|direct ids/i.test(tenantScope)) issues.push(`${operationId}:non-project-tenant`);
  if (!nonProjectAuthzOperations.has(operationId) && !/project|tenant|membership|cross-/i.test(tenantScope)) issues.push(`${operationId}:tenant-scope`);
  if (!/Retry-After meaningful|standard project operation budget/i.test(rateLimit)) issues.push(`${operationId}:rate-limit`);
  if (!audit.startsWith(`audit.${operationId}:`)) issues.push(`${operationId}:audit`);
  if (!/retained|purge|expire|invalidated|visible|hidden|deletion|session records/i.test(deletion)) issues.push(`${operationId}:deletion`);
  if (/secret|token|raw|bounded|download|customer content|no URL query text|synthetic|redacted/i.test(dataExposure) === false) issues.push(`${operationId}:data-exposure`);
  const openApiStatuses = new Set(Object.keys(operationEntry.operation.responses ?? {}));
  for (const status of extractStatuses(statusText)) {
    if (!openApiStatuses.has(status)) issues.push(`${operationId}:status:${status}`);
  }
  return issues;
});
if (reviewScenarioRows !== requiredScenarioIds.length) fail(`scenario_rows mismatch: ${reviewScenarioRows}`);
if (missingScenarioRows > 0) fail(`missing_scenario_rows = ${missingScenarioRows}`);
if (duplicateScenarioRows > 0) fail(`duplicate_scenario_rows = ${duplicateScenarioRows}`);
if (extraScenarioRows > 0) fail(`extra_scenario_rows = ${extraScenarioRows}`);
if (scenarioFieldIssues.length > 0) fail(`scenario_field_issues = ${scenarioFieldIssues.length} (${scenarioFieldIssues.slice(0, 12).join(', ')})`);
if (reviewEndpointRows !== expectedBaselineOperationCount) fail(`old operation row count ${reviewEndpointRows} != baseline ${expectedBaselineOperationCount}`);
if (reviewSchemaRows !== expectedBaselineSchemaCount) fail(`old schema row count ${reviewSchemaRows} != baseline ${expectedBaselineSchemaCount}`);
if (reviewFinalSchemaRows !== finalSchemaNames.length) fail(`final schema row count ${reviewFinalSchemaRows} != final schemas ${finalSchemaNames.length}`);
if (migrationEndpointRows !== expectedBaselineOperationCount) fail(`migration endpoint row count ${migrationEndpointRows} != baseline ${expectedBaselineOperationCount}`);
if (migrationSchemaRows !== expectedBaselineSchemaCount) fail(`migration schema row count ${migrationSchemaRows} != baseline ${expectedBaselineSchemaCount}`);
if (policyRows !== operations.length) fail(`policy_rows ${policyRows} != final operations ${operations.length}`);
if (securityRows !== operations.length) fail(`security_rows ${securityRows} != final operations ${operations.length}`);
if (actorOutcomeRows.length !== operations.length) fail(`actor_outcome_rows ${actorOutcomeRows.length} != final operations ${operations.length}`);
if (policyDiff.missing.length > 0 || policyDiff.extra.length > 0) fail(`policy operation set mismatch missing=${policyDiff.missing.join(',') || '0'} extra=${policyDiff.extra.join(',') || '0'}`);
if (securityDiff.missing.length > 0 || securityDiff.extra.length > 0) fail(`security operation set mismatch missing=${securityDiff.missing.join(',') || '0'} extra=${securityDiff.extra.join(',') || '0'}`);
if (missingActorOutcomeRows > 0 || extraActorOutcomeRows > 0) {
  fail(`actor outcome operation set mismatch missing=${actorOutcomeDiff.missing.join(',') || '0'} extra=${actorOutcomeDiff.extra.join(',') || '0'}`);
}
if (missingProofNotes > 0) fail(`missing_proof_notes = ${missingProofNotes}`);
if (uiOnlyRows > 0) fail(`ui_only_rows = ${uiOnlyRows}`);
if (unresolvedOverlapRows > 0) fail(`unresolved_overlap_rows = ${unresolvedOverlapRows}`);
if (noReplacementRows > 0) fail(`no_replacement_rows = ${noReplacementRows}`);
if (blankRequiredCells > 0) fail(`blank_required_cells = ${blankRequiredCells}`);
if (missingSecurityRows > 0) fail(`missing_security_rows = ${missingSecurityRows}`);
if (missingActorRows > 0) fail(`missing_actor_rows = ${missingActorRows}`);
if (missingRoleRows > 0) fail(`missing_role_rows = ${missingRoleRows}`);
if (missingTenantRows > 0) fail(`missing_tenant_rows = ${missingTenantRows}`);
if (missingCsrfRows > 0) fail(`missing_csrf_rows = ${missingCsrfRows}`);
if (missingReplayRows > 0) fail(`missing_replay_rows = ${missingReplayRows}`);
if (missingRateLimitRows > 0) fail(`missing_rate_limit_rows = ${missingRateLimitRows}`);
if (missingAuditRows > 0) fail(`missing_audit_rows = ${missingAuditRows}`);
if (missingDeletionRows > 0) fail(`missing_deletion_rows = ${missingDeletionRows}`);
if (missingDataExposureRows > 0) fail(`missing_data_exposure_rows = ${missingDataExposureRows}`);
if (actorOutcomeCellIssues.length > 0) fail(`actor_outcome_cell_issues = ${actorOutcomeCellIssues.length} (${actorOutcomeCellIssues.slice(0, 12).join(', ')})`);
if (actorOutcomeStatusMissingPairs.length > 0) fail(`missing_actor_outcome_statuses = ${actorOutcomeStatusMissingPairs.length} (${actorOutcomeStatusMissingPairs.slice(0, 12).join(', ')})`);
if (securitySemanticIssues.length > 0) fail(`security_semantic_issues = ${securitySemanticIssues.length} (${securitySemanticIssues.slice(0, 12).join(', ')})`);
const expectedBaselineOperationKeys = baselineOps.map(operationKey);
const reviewOperationKeys = reviewEndpointTableRows.map((row) => {
  const [method, apiPath, operationId] = tableCells(row);
  return `${method} ${apiPath} ${operationId}`;
});
const migrationOperationKeys = migrationEndpointTableRows.map((row) => tableCells(row)[0]);
rowSetDiff('review baseline operations', expectedBaselineOperationKeys, reviewOperationKeys);
rowSetDiff('migration baseline operations', expectedBaselineOperationKeys, migrationOperationKeys);
rowSetDiff('review baseline schemas', baselineSchemas, reviewSchemaTableRows.map((row) => tableCells(row)[0]));
rowSetDiff('migration baseline schemas', baselineSchemas, migrationSchemaTableRows.map((row) => tableCells(row)[0]));
rowSetDiff('review final operations', finalOperationKeys, finalReviewOperationKeys);
rowSetDiff('review final schemas', finalSchemaNames, reviewFinalSchemaTableRows.map((row) => tableCells(row)[0]));
expectCounter(reviewMd, 'review', 'review_rows', reviewRows);
expectCounter(reviewMd, 'review', 'old_operation_rows', reviewEndpointRows);
expectCounter(reviewMd, 'review', 'old_schema_rows', reviewSchemaRows);
expectCounter(reviewMd, 'review', 'final_operation_rows', operations.length);
expectCounter(reviewMd, 'review', 'missing_final_operation_rows', finalOperationDiff.missing.length);
expectCounter(reviewMd, 'review', 'final_schema_rows', finalSchemaNames.length);
expectCounter(reviewMd, 'review', 'missing_final_schema_rows', 0);
expectCounter(reviewMd, 'review', 'policy_rows', policyRows);
expectCounter(reviewMd, 'review', 'missing_proof_notes', missingProofNotes);
expectCounter(reviewMd, 'review', 'ui_only_rows', uiOnlyRows);
expectCounter(reviewMd, 'review', 'unresolved_overlap_rows', unresolvedOverlapRows);
expectCounter(securityMd, 'security', 'security_rows', securityRows);
expectCounter(securityMd, 'security', 'actor_outcome_rows', actorOutcomeRows.length);
expectCounter(securityMd, 'security', 'missing_security_rows', missingSecurityRows);
expectCounter(securityMd, 'security', 'missing_actor_rows', missingActorRows);
expectCounter(securityMd, 'security', 'missing_rate_limit_rows', missingRateLimitRows);
expectCounter(securityMd, 'security', 'missing_csrf_rows', missingCsrfRows);
expectCounter(securityMd, 'security', 'missing_audit_rows', missingAuditRows);
expectCounter(securityMd, 'security', 'missing_deletion_rows', missingDeletionRows);
expectCounter(securityMd, 'security', 'missing_data_exposure_rows', missingDataExposureRows);
expectCounter(securityMd, 'security', 'missing_actor_outcome_rows', missingActorOutcomeRows);
expectCounter(securityMd, 'security', 'extra_actor_outcome_rows', extraActorOutcomeRows);
expectCounter(securityMd, 'security', 'actor_outcome_cell_issues', actorOutcomeCellIssues.length);
expectCounter(securityMd, 'security', 'missing_actor_outcome_statuses', actorOutcomeStatusMissingPairs.length);
expectCounter(migrationMd, 'migration', 'endpoint_rows', migrationEndpointRows);
expectCounter(migrationMd, 'migration', 'schema_rows', migrationSchemaRows);
expectCounter(migrationMd, 'migration', 'migration_rows', migrationRows);
expectCounter(migrationMd, 'migration', 'no_replacement_rows', noReplacementRows);
const nonProjectSecurityBoundaryMatches = securityOperationRows
  .map(tableCells)
  .filter(([operationId, , , , , dataBoundary]) => nonProjectAuthzOperations.has(operationId) && /project membership|cross-project|direct IDs|direct ids/i.test(dataBoundary ?? ''));
if (nonProjectSecurityBoundaryMatches.length > 0) {
  fail(`non-project security boundary rows mention project direct-ID membership: ${nonProjectSecurityBoundaryMatches.map(([operationId]) => operationId).join(', ')}`);
}
const securityMatrixStatusMissingPairs = securityOperationRows.flatMap((row) => {
  const [operationId, , , , , , , , , matrixStatuses] = tableCells(row);
  const operation = operationById(operationId)?.operation;
  if (!operation) return [];
  const openApiStatuses = new Set(Object.keys(operation.responses ?? {}));
  return matrixStatuses
    .split(',')
    .map((status) => status.trim())
    .filter((status) => /^\d+$/.test(status) && !openApiStatuses.has(status))
    .map((status) => `${operationId}:${status}`);
});
const matrixStatusMissingPairs = [...reviewMatrixStatusMissingPairs, ...securityMatrixStatusMissingPairs];
if (matrixStatusMissingPairs.length > 0) {
  fail(`missing_matrix_response_statuses = ${matrixStatusMissingPairs.length} (${matrixStatusMissingPairs.join(', ')})`);
}
if (migrationEndpointRows !== reviewEndpointRows) fail(`migration endpoint rows ${migrationEndpointRows} != review endpoint rows ${reviewEndpointRows}`);
if (migrationSchemaRows !== reviewSchemaRows) fail(`migration schema rows ${migrationSchemaRows} != review schema rows ${reviewSchemaRows}`);
if (!reviewMd.includes('## Staged Allowance Inventory')) fail('review matrix must include Staged Allowance Inventory');
if (stagedAllowanceTableRows.length !== 0) fail(`staged_allowance_rows = ${stagedAllowanceTableRows.length}`);
const genericPolicyReasons = policyTableRows
  .map(tableCells)
  .filter(([, , , reason]) => reason === 'stable backend resource/query/command/job/stream boundary' || !reason || reason === 'none')
  .map(([operationId]) => operationId);
if (genericPolicyReasons.length > 0) fail(`generic policy reasons: ${genericPolicyReasons.join(', ')}`);
const genericFinalOperationProofs = reviewFinalOperationTableRows
  .map(tableCells)
  .filter(([, , , proof]) => /present in OpenAPI final operation set|generated manifest parity check/i.test(proof ?? '') || !/backend reason:/i.test(proof ?? '') || !/no UI-only:/i.test(proof ?? ''))
  .map(([operationId]) => operationId);
if (genericFinalOperationProofs.length > 0) fail(`generic final-operation proofs: ${genericFinalOperationProofs.join(', ')}`);
const placeholderMigrationRows = migrationEndpointTableRows
  .map(tableCells)
  .filter((cells) => /tests as needed|kept because it maps to a stable backend resource\/command\/query boundary|generated types; operation manifest; mock-server handlers; API adapter methods/i.test(`${cells[2] ?? ''} ${cells[3] ?? ''}`))
  .map(([oldOperation]) => oldOperation);
if (placeholderMigrationRows.length > 0) fail(`placeholder endpoint migration rows: ${placeholderMigrationRows.join(', ')}`);

const activeSurface = staleScanRecords.map((record) => record.text).join('\n');
const staleActiveSurfaceMatches = [...legacyOperationIds, ...legacySchemaNames].filter((name) => containsIdentifier(activeSurface, name));
if (staleActiveSurfaceMatches.length > 0) fail(`stale active surface legacy names: ${staleActiveSurfaceMatches.join(', ')}`);
const staleSseDoneMarkers = staleScanRecords.filter((record) => record.text.includes('[DONE]')).map((record) => path.relative(process.cwd(), record.filePath));
if (staleSseDoneMarkers.length > 0) fail(`stale_sse_done_markers = ${staleSseDoneMarkers.join(', ')}`);
const openStagedAllowanceMatches = [
  ...reviewMd.matchAll(/\b(?:STAGED_ALLOWANCE|approved-exemption|temporary_allowance|allowance_status:\s*open)\b/gi),
  ...securityMd.matchAll(/\b(?:STAGED_ALLOWANCE|approved-exemption|temporary_allowance|allowance_status:\s*open)\b/gi),
  ...migrationMd.matchAll(/\b(?:STAGED_ALLOWANCE|approved-exemption|temporary_allowance|allowance_status:\s*open)\b/gi),
  ...activeSurface.matchAll(/\b(?:STAGED_ALLOWANCE|approved-exemption|temporary_allowance|allowance_status:\s*open)\b/gi),
];
if (openStagedAllowanceMatches.length > 0) fail(`open_staged_allowances = ${openStagedAllowanceMatches.length}`);
const genericSecurityPhrases = ['viewer/editor/admin/owner by operation', 'where applicable', 'may exist', 'expire and purge'];
const genericSecurityPhraseMatches = genericSecurityPhrases.filter((phrase) => securityMd.includes(phrase));
if (genericSecurityPhraseMatches.length > 0) fail(`generic security matrix phrases: ${genericSecurityPhraseMatches.join(', ')}`);

const redactedPrivateScan = scanRedactedPrivateSurface(activeSurfaceRecords);
if (redactedPrivateScan.unclassified.length > 0) {
  fail(`redacted_private_scan_unclassified = ${redactedPrivateScan.unclassified.length} (${redactedPrivateScan.unclassified.slice(0, 12).join(', ')})`);
}

if (failures.length > 0) {
  console.error('OpenAPI backend-first contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`OpenAPI backend-first contract OK: operations=${operations.length} schemas=${Object.keys(spec.components?.schemas ?? {}).length}`);
console.log(`review_rows=${reviewRows}`);
console.log(`baseline_scenarios=${requiredScenarioIds.length}`);
console.log(`missing_scenario_rows = ${missingScenarioRows}`);
console.log(`duplicate_scenario_rows = ${duplicateScenarioRows}`);
console.log(`extra_scenario_rows = ${extraScenarioRows}`);
console.log(`scenario_field_issues = ${scenarioFieldIssues.length}`);
console.log(`old_operation_rows=${reviewEndpointRows}`);
console.log(`old_schema_rows=${reviewSchemaRows}`);
console.log(`final_operation_rows=${operations.length}`);
console.log(`missing_final_operation_rows = ${finalOperationDiff.missing.length}`);
console.log(`final_schema_rows=${finalSchemaNames.length}`);
console.log('missing_final_schema_rows = 0');
console.log(`policy_rows=${policyRows}`);
console.log(`missing_policy_rows = ${policyDiff.missing.length}`);
console.log(`ui_only_rows = ${uiOnlyRows}`);
console.log(`unresolved_overlap_rows = ${unresolvedOverlapRows}`);
console.log(`blank_required_cells = ${blankRequiredCells}`);
console.log(`missing_proof_notes = ${missingProofNotes}`);
console.log(`no_replacement_rows = ${noReplacementRows}`);
console.log(`security_rows=${securityRows}`);
console.log(`actor_outcome_rows=${actorOutcomeRows.length}`);
console.log(`missing_security_rows = ${missingSecurityRows}`);
console.log(`missing_actor_rows = ${missingActorRows}`);
console.log(`missing_role_rows = ${missingRoleRows}`);
console.log(`missing_tenant_rows = ${missingTenantRows}`);
console.log(`missing_rate_limit_rows = ${missingRateLimitRows}`);
console.log(`missing_csrf_rows = ${missingCsrfRows}`);
console.log(`missing_replay_rows = ${missingReplayRows}`);
console.log(`missing_audit_rows = ${missingAuditRows}`);
console.log(`missing_deletion_rows = ${missingDeletionRows}`);
console.log(`missing_data_exposure_rows = ${missingDataExposureRows}`);
console.log(`missing_actor_outcome_rows = ${missingActorOutcomeRows}`);
console.log(`extra_actor_outcome_rows = ${extraActorOutcomeRows}`);
console.log(`actor_outcome_cell_issues = ${actorOutcomeCellIssues.length}`);
console.log(`missing_actor_outcome_statuses = ${actorOutcomeStatusMissingPairs.length}`);
console.log(`missing_csrf_header_ops = ${missingCsrfHeaderOps}`);
console.log(`safe_method_csrf_parameter_ops = ${safeMethodCsrfParameterOps.length}`);
console.log(`missing_session_mutation_csrf_ops = ${missingSessionMutationCsrfOps}`);
console.log(`json_problem_media_shape_exceptions = ${problemShapeExceptions}`);
console.log(`invalid_schema_examples = ${invalidSchemaExamples.length}`);
console.log(`missing_matrix_response_statuses = ${matrixStatusMissingPairs.length}`);
console.log(`security_semantic_issues = ${securitySemanticIssues.length}`);
console.log(`repeated_cursor_descriptions = ${repeatedCursorDescriptions.length}`);
console.log(`public_chat_schema_issues = ${publicChatSchemaIssues.length}`);
console.log(`sensitive_open_object_schemas = ${sensitiveOpenObjectSchemaPaths.length}`);
console.log(`reader_locator_revision_issues = ${readerLocatorRevisionIssues.length}`);
console.log(`chapter_content_contract_issues = ${chapterContentContractIssues.length}`);
console.log(`request_schema_closure_issues = ${requestSchemaClosureIssues.length}`);
console.log(`migration_rows=${migrationRows}`);
console.log(`redacted_private_scan_files = ${redactedPrivateScan.files}`);
console.log(`redacted_private_scan_secret_like_matches = ${redactedPrivateScan.secretLikeMatches}`);
console.log(`redacted_private_scan_private_content_matches = ${redactedPrivateScan.privateContentMatches}`);
console.log(`redacted_private_scan_allowlisted = ${redactedPrivateScan.allowlisted}`);
console.log(`redacted_private_scan_anchor_count = ${redactedPrivateScan.anchorCount}`);
console.log(`redacted_private_scan_unclassified = ${redactedPrivateScan.unclassified.length}`);
console.log(`open_staged_allowances = ${openStagedAllowanceMatches.length}`);
console.log(`staged_allowance_rows = ${stagedAllowanceTableRows.length}`);
console.log(`operation_manifest_missing=${missingManifest.length}`);
console.log(`operation_manifest_extra=${extraManifest.length}`);
console.log(`operation_manifest_route_mismatches=${manifestRouteMismatches.length}`);
console.log(`policy_operation_set_missing=${policyDiff.missing.length}`);
console.log(`policy_operation_set_extra=${policyDiff.extra.length}`);
console.log(`security_operation_set_missing=${securityDiff.missing.length}`);
console.log(`security_operation_set_extra=${securityDiff.extra.length}`);
console.log(`changed_union_files=${changedUnion.paths.length}`);
console.log(`searched_files=${staleScanRecords.length}`);
console.log(`active_surface_read_failures=${activeSurfaceReadFailures.length}`);
console.log(`stale_active_surface_legacy_names=${staleActiveSurfaceMatches.length}`);
console.log(`stale_sse_done_markers=${staleSseDoneMarkers.length}`);
console.log(`generic_security_phrase_matches=${genericSecurityPhraseMatches.length}`);
