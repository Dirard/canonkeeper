import type { OperationId } from '../../shared/api';

export type MockScenarioPreset =
  | 'normal'
  | 'auth-401'
  | 'forbidden-403'
  | 'empty-lists'
  | 'request-error'
  | 'suggestion-empty'
  | 'failed-create'
  | 'failed-select'
  | 'artifact-failure'
  | 'suggestion-failure'
  | 'conflict'
  | 'indexing-cancel-error'
  | 'export-ready'
  | 'export-error';

export interface MockScenarioControl {
  preset: MockScenarioPreset;
  operationFailures?: Partial<Record<OperationId, { status: number; message: string }>>;
}

export class MockApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly operationId: OperationId,
  ) {
    super(message);
    this.name = 'MockApiError';
  }
}

const protectedOperations = new Set<OperationId>([
  'getCurrentUser',
  'logoutUser',
  'listProjects',
  'getProject',
  'createProject',
  'updateProject',
  'deleteProject',
  'listBooks',
  'createBook',
  'getBook',
  'updateBook',
  'deleteBook',
  'getImportConstraints',
  'importBookFile',
  'listIndexingJobs',
  'getIndexingJob',
  'cancelIndexingJob',
  'createBookExport',
  'getExportJob',
  'listChapters',
  'createChapter',
  'getChapter',
  'updateChapter',
  'publishChapter',
  'deleteChapter',
  'listChapterAnnotations',
  'createChapterAnnotation',
  'updateReaderAnnotation',
  'deleteReaderAnnotation',
  'searchProject',
  'listChatSessions',
  'createChatSession',
  'getChatSession',
  'renameChatSession',
  'deleteChatSession',
  'listChatMessages',
  'sendChatMessage',
  'getChatArtifact',
  'listAgentSuggestions',
  'getAgentSuggestion',
  'approveAgentSuggestion',
  'rejectAgentSuggestion',
]);

export function applyScenario(operationId: OperationId, scenario: MockScenarioControl) {
  const injected = scenario.operationFailures?.[operationId];
  if (injected) {
    throw new MockApiError(injected.status, injected.message, operationId);
  }

  if (scenario.preset === 'auth-401' && protectedOperations.has(operationId)) {
    throw new MockApiError(401, 'Сессия истекла. Войдите снова.', operationId);
  }

  if (scenario.preset === 'forbidden-403' && operationId !== 'getCurrentUser' && protectedOperations.has(operationId)) {
    throw new MockApiError(403, 'Нет доступа к этому проекту.', operationId);
  }

  if (scenario.preset === 'request-error') {
    throw new MockApiError(500, 'Mock request failed.', operationId);
  }
}

export const normalScenario: MockScenarioControl = { preset: 'normal' };
