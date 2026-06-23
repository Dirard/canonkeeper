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
export type MockActorRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'non_member';

export interface MockScenarioControl {
  actorRole?: MockActorRole;
  emailVerified?: boolean;
  preset: MockScenarioPreset;
  operationFailures?: Partial<Record<OperationId, { status: number; message: string }>>;
  verifiedEmail?: string;
}

export class MockApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly operationId: OperationId,
    readonly code?: string,
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
  'listProjectJobs',
  'startProjectIndexing',
  'getJob',
  'cancelJob',
  'createBookExport',
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
  'createChatTurn',
  'getChatTurn',
  'streamChatTurnEvents',
  'getChatArtifact',
  'listProjectMembers',
  'updateProjectMemberRole',
  'removeProjectMember',
  'listProjectInvitations',
  'listMyProjectInvitations',
  'createProjectInvitation',
  'acceptProjectInvitation',
  'cancelProjectInvitation',
  'startAgentRun',
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

export function isProtectedOperation(operationId: OperationId) {
  return protectedOperations.has(operationId);
}

export const normalScenario: MockScenarioControl = { actorRole: 'owner', preset: 'normal' };
