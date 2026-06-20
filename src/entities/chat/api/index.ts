import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryFunctionContext } from '@tanstack/react-query';
import type {
  AgentSuggestion,
  ApiRequestOptions,
  Book,
  CanonKeeperApiClient,
  Chapter,
  ChatArtifact,
  ChatMessage,
  ChatSession,
  Project,
  ReaderLocator,
  SearchScope,
} from '../../../shared/api';
import { getArtifactTriggerIds } from '../model';

export type { AgentSuggestion, ApiRequestOptions, Book, Chapter, ChatArtifact, ChatMessage, ChatSession, Project, ReaderLocator, SearchScope };

export type ChatApiClient = Pick<
  CanonKeeperApiClient,
  | 'approveAgentSuggestion'
  | 'createChatSession'
  | 'deleteChatSession'
  | 'getAgentSuggestion'
  | 'getChapter'
  | 'getChatArtifact'
  | 'getChatSession'
  | 'getProject'
  | 'listAgentSuggestions'
  | 'listBooks'
  | 'listChapters'
  | 'listChatMessages'
  | 'listChatSessions'
  | 'listProjects'
  | 'logout'
  | 'rejectAgentSuggestion'
  | 'renameChatSession'
  | 'searchProject'
  | 'sendChatMessage'
>;

export type ChatSearchResult = Awaited<ReturnType<CanonKeeperApiClient['searchProject']>>['data'][number];

interface ChatWorkspaceParams {
  chatId: string;
  projectId: string;
}

interface ChatAssistanceParams {
  bookId: string;
  chapterId: string;
  projectId: string;
}

interface ChatQueryMeta extends Record<string, unknown> {
  api: ChatApiClient;
}

export interface ChatWorkspaceData {
  activeChat: ChatSession | null;
  activeChatId: string;
  activeProject: Project | null;
  artifactErrors: unknown[];
  artifactsById: Record<string, ChatArtifact>;
  firstLocator: ReaderLocator | null;
  messages: ChatMessage[];
  projects: Project[];
  sessions: ChatSession[];
}

export interface ChatAssistanceData {
  book: Book | null;
  chapter: Chapter | null;
  project: Project | null;
  suggestions: AgentSuggestion[];
}

export const emptyChatWorkspace: ChatWorkspaceData = {
  activeChat: null,
  activeChatId: '',
  activeProject: null,
  artifactErrors: [],
  artifactsById: {},
  firstLocator: null,
  messages: [],
  projects: [],
  sessions: [],
};

export const emptyChatAssistance: ChatAssistanceData = {
  book: null,
  chapter: null,
  project: null,
  suggestions: [],
};

export const chatQueryKeys = {
  all: ['canonkeeper', 'chat'] as const,
  workspace: (projectId: string, chatId: string) => [...chatQueryKeys.all, 'workspace', projectId, chatId] as const,
  assistance: (projectId: string, bookId: string, chapterId: string) =>
    [...chatQueryKeys.all, 'assistance', projectId, bookId, chapterId] as const,
};

function chatQueryMeta(api: ChatApiClient): ChatQueryMeta {
  return { api };
}

function readChatQueryApi(meta: QueryFunctionContext['meta']) {
  const api = (meta as ChatQueryMeta | undefined)?.api;
  if (!api) {
    throw new Error('Chat query API client is missing.');
  }
  return api;
}

export async function hydrateChatArtifacts(api: ChatApiClient, messages: ChatMessage[]) {
  const artifactErrors: unknown[] = [];
  const artifactsById: Record<string, ChatArtifact> = {};
  let firstLocator: ReaderLocator | null = null;

  for (const artifactId of new Set(messages.flatMap(getArtifactTriggerIds))) {
    try {
      const artifact = await api.getChatArtifact(artifactId);
      artifactsById[artifactId] = artifact;
      firstLocator ??= artifact.readerReferences?.[0]?.locator ?? null;
    } catch (error) {
      artifactErrors.push(error);
    }
  }

  return { artifactErrors, artifactsById, firstLocator };
}

export async function loadChatThread(api: ChatApiClient, chatId: string) {
  const messageList = await api.listChatMessages(chatId);
  const hydrated = await hydrateChatArtifacts(api, messageList.data);
  return { messages: messageList.data, ...hydrated };
}

export async function loadChatWorkspace(api: ChatApiClient, params: ChatWorkspaceParams): Promise<ChatWorkspaceData> {
  const projectList = await api.listProjects();
  if (projectList.data.length === 0) {
    return emptyChatWorkspace;
  }

  const projectSummary = projectList.data.find((project) => project.id === params.projectId) ?? projectList.data[0];
  if (!projectSummary) {
    return emptyChatWorkspace;
  }
  const activeProject = await api.getProject(projectSummary.id);
  const sessionList = await api.listChatSessions(activeProject.id);
  if (sessionList.data.length === 0) {
    return {
      ...emptyChatWorkspace,
      activeProject,
      projects: projectList.data,
      sessions: [],
    };
  }

  const activeSessionSummary = sessionList.data.find((session) => session.id === params.chatId) ?? sessionList.data[0];
  if (!activeSessionSummary) {
    return {
      ...emptyChatWorkspace,
      activeProject,
      projects: projectList.data,
      sessions: [],
    };
  }
  const [activeChat, thread] = await Promise.all([api.getChatSession(activeSessionSummary.id), loadChatThread(api, activeSessionSummary.id)]);

  return {
    activeChat,
    activeChatId: activeChat.id,
    activeProject,
    artifactErrors: thread.artifactErrors,
    artifactsById: thread.artifactsById,
    firstLocator: thread.firstLocator,
    messages: thread.messages,
    projects: projectList.data,
    sessions: sessionList.data,
  };
}

export async function loadChatAssistance(api: ChatApiClient, params: ChatAssistanceParams): Promise<ChatAssistanceData> {
  if (!params.projectId) {
    return emptyChatAssistance;
  }

  const [project, bookList] = await Promise.all([api.getProject(params.projectId), api.listBooks(params.projectId)]);
  const book =
    bookList.data.find((item) => item.id === params.bookId) ??
    bookList.data.find((item) => item.id === project.activeBookId) ??
    bookList.data[0] ??
    null;
  if (!book) {
    return { ...emptyChatAssistance, project };
  }

  if (!params.chapterId) {
    return { ...emptyChatAssistance, book, project };
  }

  const chapterList = await api.listChapters(book.id);
  const chapterSummary = chapterList.data.find((item) => item.id === params.chapterId) ?? null;
  if (!chapterSummary) {
    return { ...emptyChatAssistance, book, project };
  }

  const chapter = await api.getChapter(chapterSummary.id);
  const suggestionList = await api.listAgentSuggestions(chapter.id);
  const suggestions = await Promise.all(suggestionList.data.map((suggestion) => api.getAgentSuggestion(suggestion.id)));

  return { book, chapter, project, suggestions };
}

export function useChatWorkspaceQuery(api: ChatApiClient, params: ChatWorkspaceParams) {
  const { chatId, projectId } = params;
  return useQuery({
    queryKey: chatQueryKeys.workspace(projectId, chatId),
    queryFn: ({ meta }) => loadChatWorkspace(readChatQueryApi(meta), { chatId, projectId }),
    meta: chatQueryMeta(api),
    retry: false,
  });
}

export function useChatAssistanceQuery(api: ChatApiClient, params: ChatAssistanceParams) {
  const { bookId, chapterId, projectId } = params;
  const hasHandoffContext = chapterId.length > 0;
  return useQuery({
    queryKey: chatQueryKeys.assistance(projectId, bookId, chapterId),
    queryFn: ({ meta }) => loadChatAssistance(readChatQueryApi(meta), { bookId, chapterId, projectId }),
    enabled: projectId.length > 0 && hasHandoffContext,
    meta: chatQueryMeta(api),
    retry: false,
  });
}

export function useCreateChatSessionMutation(api: ChatApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, title }: { projectId: string; title: string }) => api.createChatSession(projectId, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatQueryKeys.all }),
  });
}

export function useRenameChatSessionMutation(api: ChatApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) => api.renameChatSession(chatId, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatQueryKeys.all }),
  });
}

export function useDeleteChatSessionMutation(api: ChatApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api.deleteChatSession(chatId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatQueryKeys.all }),
  });
}

export function useSearchProjectMutation(api: ChatApiClient) {
  return useMutation({
    mutationFn: ({ projectId, query, scope }: { projectId: string; query: string; scope?: SearchScope }) =>
      api.searchProject(projectId, query, scope),
  });
}

export function useRefreshChatMessagesMutation(api: ChatApiClient) {
  return useMutation({
    mutationFn: (chatId: string) => loadChatThread(api, chatId),
  });
}

export function useLogoutMutation(api: ChatApiClient) {
  return useMutation({
    mutationFn: () => api.logout(),
  });
}

export function useApproveChatAssistanceMutation(api: ChatApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expectedChapterRevision, suggestionId }: { expectedChapterRevision: number; suggestionId: string }) =>
      api.approveAgentSuggestion(suggestionId, { expectedChapterRevision }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatQueryKeys.all }),
  });
}

export function useRejectChatAssistanceMutation(api: ChatApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) => api.rejectAgentSuggestion(suggestionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatQueryKeys.all }),
  });
}
