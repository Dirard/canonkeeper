import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const contractPath = path.resolve('contracts/openapi.json');
const raw = await readFile(contractPath, 'utf8');
const spec = JSON.parse(raw);

const requiredTopLevelKeys = ['openapi', 'info', 'paths', 'components'];
const requiredPaths = [
  '/auth/register',
  '/auth/login',
  '/auth/me',
  '/projects',
  '/projects/{projectId}/books',
  '/books/{bookId}',
  '/projects/{projectId}/import-constraints',
  '/projects/{projectId}/imports',
  '/indexing-jobs/{jobId}',
  '/indexing-jobs/{jobId}/cancel',
  '/books/{bookId}/chapters',
  '/export-jobs/{exportJobId}',
  '/chapters/{chapterId}',
  '/chapters/{chapterId}/publish',
  '/chapters/{chapterId}/annotations',
  '/annotations/{annotationId}',
  '/projects/{projectId}/search',
  '/projects/{projectId}/chats',
  '/chats/{chatId}',
  '/chats/{chatId}/messages',
  '/chat-artifacts/{artifactId}',
  '/chapters/{chapterId}/agent-suggestions',
  '/agent-suggestions/{suggestionId}',
  '/agent-suggestions/{suggestionId}/approve',
  '/agent-suggestions/{suggestionId}/reject',
];
const requiredSchemas = [
  'Project',
  'Book',
  'IndexingJob',
  'ImportConstraints',
  'Chapter',
  'ChapterSummary',
  'ChapterNavigation',
  'ChapterNavigationItem',
  'ChapterParagraph',
  'ChapterParagraphInput',
  'ReaderLocator',
  'ReaderReferenceLocator',
  'ReaderAnnotation',
  'HighlightAnnotation',
  'NoteAnnotation',
  'BookmarkAnnotation',
  'CreateReaderAnnotationRequest',
  'UpdateReaderAnnotationRequest',
  'ChatSession',
  'ChatMessage',
  'ChatMessagePart',
  'ChatMessagePartStatus',
  'LlmStreamEvent',
  'LlmTextDeltaEvent',
  'LlmReasoningDeltaEvent',
  'LlmToolCallEvent',
  'LlmToolResultEvent',
  'LlmCompletedEvent',
  'LlmErrorEvent',
  'ChatArtifact',
  'ChatTrigger',
  'ReaderReferencesChatTrigger',
  'AgentSuggestionsReadyChatTrigger',
  'ReaderReference',
  'AgentOptions',
  'AgentTask',
  'AgentSuggestion',
  'AgentSuggestionStatus',
  'AgentDiffLocator',
  'ApproveAgentSuggestionRequest',
  'AgentSuggestionActionResult',
  'Problem',
];

const missing = [];
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);

function resolveJsonPointer(root, ref) {
  if (!ref.startsWith('#/')) {
    throw new Error(`Only local refs are allowed in this contract check: ${ref}`);
  }

  return ref
    .slice(2)
    .split('/')
    .reduce((node, segment) => {
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      return node?.[key];
    }, root);
}

function collectRefs(node, location = '$', refs = []) {
  if (!node || typeof node !== 'object') {
    return refs;
  }

  if (typeof node.$ref === 'string') {
    refs.push({ ref: node.$ref, location });
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => collectRefs(item, `${location}[${index}]`, refs));
    return refs;
  }

  for (const [key, value] of Object.entries(node)) {
    collectRefs(value, `${location}.${key}`, refs);
  }

  return refs;
}

for (const key of requiredTopLevelKeys) {
  if (!(key in spec)) {
    missing.push(`top-level key: ${key}`);
  }
}

for (const apiPath of requiredPaths) {
  if (!spec.paths?.[apiPath]) {
    missing.push(`path: ${apiPath}`);
  }
}

for (const schema of requiredSchemas) {
  if (!spec.components?.schemas?.[schema]) {
    missing.push(`schema: ${schema}`);
  }
}

if (spec.openapi !== '3.1.0') {
  missing.push(`openapi version 3.1.0, received ${spec.openapi ?? '<missing>'}`);
}

if (!spec.components?.securitySchemes?.sessionAuth) {
  missing.push('security scheme: sessionAuth');
}

if (!spec.components?.responses?.Forbidden) {
  missing.push('response: Forbidden');
}

if (!Array.isArray(spec.security) || !spec.security.some((item) => 'sessionAuth' in item)) {
  missing.push('root security: sessionAuth');
}

if (spec.paths?.['/agent-suggestions/{suggestionId}']?.get?.requestBody) {
  missing.push('GET /agent-suggestions/{suggestionId} must not define requestBody');
}

if (!spec.paths?.['/agent-suggestions/{suggestionId}/approve']?.post?.requestBody) {
  missing.push('POST /agent-suggestions/{suggestionId}/approve requestBody');
}

if (spec.paths?.['/books/{bookId}/chapters']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref !== '#/components/schemas/ChapterList') {
  missing.push('GET /books/{bookId}/chapters must return ChapterList');
}

if (spec.components?.schemas?.ChapterList?.properties?.data?.items?.$ref !== '#/components/schemas/ChapterSummary') {
  missing.push('ChapterList must use ChapterSummary items');
}

if (!spec.components?.schemas?.ReaderAnnotation?.oneOf || !spec.components?.schemas?.ReaderAnnotation?.discriminator) {
  missing.push('ReaderAnnotation oneOf discriminator');
}

if (!spec.components?.schemas?.CreateReaderAnnotationRequest?.oneOf || !spec.components?.schemas?.UpdateReaderAnnotationRequest?.oneOf) {
  missing.push('Reader annotation request oneOf validation');
}

if (spec.components?.schemas?.ImportConstraints?.properties?.maxFileSizeBytes?.const !== 52428800) {
  missing.push('ImportConstraints maxFileSizeBytes must be 52428800');
}

if (!spec.components?.responses?.UnsupportedMediaType) {
  missing.push('response: UnsupportedMediaType');
}

if (!spec.paths?.['/projects/{projectId}/imports']?.post?.responses?.['415']) {
  missing.push('POST /projects/{projectId}/imports 415 response');
}

const llmStreamEvent = spec.components?.schemas?.LlmStreamEvent;
const requiredStreamEventRefs = [
  '#/components/schemas/LlmTextDeltaEvent',
  '#/components/schemas/LlmReasoningDeltaEvent',
  '#/components/schemas/LlmToolCallEvent',
  '#/components/schemas/LlmToolResultEvent',
  '#/components/schemas/LlmCompletedEvent',
  '#/components/schemas/LlmErrorEvent',
];

if (!llmStreamEvent?.oneOf || !llmStreamEvent?.discriminator || llmStreamEvent.discriminator.propertyName !== 'type') {
  missing.push('LlmStreamEvent oneOf discriminator by type');
}

for (const ref of requiredStreamEventRefs) {
  if (!llmStreamEvent?.oneOf?.some((item) => item.$ref === ref)) {
    missing.push(`LlmStreamEvent includes ${ref}`);
  }
}

const streamRequiredFields = {
  LlmTextDeltaEvent: ['type', 'sequence', 'delta'],
  LlmReasoningDeltaEvent: ['type', 'sequence', 'delta'],
  LlmToolCallEvent: ['type', 'sequence', 'toolCallId', 'toolName'],
  LlmToolResultEvent: ['type', 'sequence', 'toolCallId', 'toolName', 'delta'],
  LlmCompletedEvent: ['type', 'sequence', 'assistantMessageId', 'turnId', 'finishReason'],
  LlmErrorEvent: ['type', 'sequence', 'message', 'finishReason'],
};

for (const [schemaName, fields] of Object.entries(streamRequiredFields)) {
  const schema = spec.components?.schemas?.[schemaName];
  for (const field of fields) {
    if (!schema?.required?.includes(field)) {
      missing.push(`${schemaName} required ${field}`);
    }
  }
}

if (!spec.paths?.['/chats/{chatId}/messages']?.post?.responses?.['200']?.content?.['text/event-stream']?.examples) {
  missing.push('chat stream SSE examples');
}

for (const field of ['order', 'displayNumber', 'displayLabel']) {
  if (!spec.components?.schemas?.Book?.required?.includes(field)) {
    missing.push(`Book required ${field}`);
  }
}

if (!spec.components?.schemas?.Project?.required?.includes('chapterCount')) {
  missing.push('Project required chapterCount');
}

if (!spec.components?.schemas?.CreateBookRequest?.properties?.afterBookId) {
  missing.push('CreateBookRequest afterBookId');
}

if (!spec.components?.schemas?.Chapter?.required?.includes('navigation')) {
  missing.push('Chapter navigation');
}

for (const field of ['previous', 'next']) {
  if (!spec.components?.schemas?.ChapterNavigation?.required?.includes(field)) {
    missing.push(`ChapterNavigation required ${field}`);
  }
}

for (const field of ['id', 'title', 'displayNumber', 'displayLabel']) {
  if (!spec.components?.schemas?.ChapterNavigationItem?.required?.includes(field)) {
    missing.push(`ChapterNavigationItem required ${field}`);
  }
}

if (!spec.components?.schemas?.CreateChatMessageRequest?.properties?.agentOptions) {
  missing.push('CreateChatMessageRequest agentOptions');
}

if (!spec.components?.schemas?.CreateChatMessageRequest?.properties?.contextLocators) {
  missing.push('CreateChatMessageRequest contextLocators');
}

const chatTrigger = spec.components?.schemas?.ChatTrigger;
const readerTrigger = spec.components?.schemas?.ReaderReferencesChatTrigger;
const suggestionsTrigger = spec.components?.schemas?.AgentSuggestionsReadyChatTrigger;

if (!chatTrigger?.oneOf || !chatTrigger?.discriminator || chatTrigger.discriminator.propertyName !== 'kind') {
  missing.push('ChatTrigger oneOf discriminator by kind');
}

if (!readerTrigger?.required?.includes('artifactId')) {
  missing.push('ReaderReferencesChatTrigger required artifactId');
}

if (!suggestionsTrigger?.required?.includes('chapterId')) {
  missing.push('AgentSuggestionsReadyChatTrigger required chapterId');
}

if (!suggestionsTrigger?.anyOf?.some((branch) => branch.required?.includes('suggestionBatchId'))) {
  missing.push('AgentSuggestionsReadyChatTrigger suggestionBatchId handle');
}

if (!suggestionsTrigger?.anyOf?.some((branch) => branch.required?.includes('suggestionIds')) || suggestionsTrigger?.properties?.suggestionIds?.minItems !== 1) {
  missing.push('AgentSuggestionsReadyChatTrigger non-empty suggestionIds handle');
}

if (!spec.paths?.['/chapters/{chapterId}/agent-suggestions']?.get?.parameters?.some((parameter) => parameter.name === 'batchId')) {
  missing.push('listAgentSuggestions batchId filter');
}

if (!spec.components?.schemas?.AgentSuggestion?.required?.includes('batchId')) {
  missing.push('AgentSuggestion required batchId');
}

if (spec.components?.schemas?.ReaderReference?.properties?.locator?.$ref !== '#/components/schemas/ReaderReferenceLocator') {
  missing.push('ReaderReference must use ReaderReferenceLocator');
}

if (spec.components?.schemas?.ReaderAnnotationBase?.properties?.locator?.$ref !== '#/components/schemas/ReaderLocator') {
  missing.push('ReaderAnnotationBase must use ReaderLocator');
}

const highlightLocatorRef = spec.components?.schemas?.HighlightAnnotation?.allOf?.[1]?.properties?.locator?.$ref;
if (highlightLocatorRef !== '#/components/schemas/ReaderReferenceLocator') {
  missing.push('HighlightAnnotation must use ReaderReferenceLocator');
}

const deleteChapterParameterNames = spec.paths?.['/chapters/{chapterId}']?.delete?.parameters?.map((parameter) => parameter.name ?? parameter.$ref) ?? [];
for (const forbiddenParameterName of ['status', 'sourceMessageId', 'batchId']) {
  if (deleteChapterParameterNames.includes(forbiddenParameterName)) {
    missing.push(`deleteChapter must not include ${forbiddenParameterName}`);
  }
}

if (spec.components?.schemas?.DiffHunk?.properties?.range?.$ref !== '#/components/schemas/AgentDiffLocator') {
  missing.push('DiffHunk must use AgentDiffLocator');
}

if (!spec.components?.schemas?.DiffHunk?.required?.includes('hunkId')) {
  missing.push('DiffHunk hunkId');
}

for (const field of ['sequence', 'toolCallId', 'status', 'label', 'metadata']) {
  if (!spec.components?.schemas?.ChatMessagePart?.properties?.[field]) {
    missing.push(`ChatMessagePart ${field}`);
  }
}

for (const [apiPath, pathItem] of Object.entries(spec.paths ?? {})) {
  if (apiPath.startsWith('/auth')) {
    continue;
  }

  for (const [method, operation] of Object.entries(pathItem)) {
    if (!httpMethods.has(method) || !operation.responses) {
      continue;
    }

    if (operation.responses['401'] && !operation.responses['403']) {
      missing.push(`${method.toUpperCase()} ${apiPath} 403 response`);
    }
  }
}

for (const { ref, location } of collectRefs(spec)) {
  if (!resolveJsonPointer(spec, ref)) {
    missing.push(`unresolved ref ${ref} at ${location}`);
  }
}

if (missing.length > 0) {
  console.error('OpenAPI contract check failed. Missing or invalid:');
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log(
  `OpenAPI contract OK: ${requiredPaths.length} required paths and ${requiredSchemas.length} required schemas present.`,
);
