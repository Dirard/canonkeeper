import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createIdempotencyKey } from '../../../shared/api';
import type {
  AgentSuggestion,
  Book,
  CanonKeeperApiClient,
  Chapter,
  ChatMessage,
  ChatSession,
  Job,
  Project,
  ProjectMembership,
  ReaderAnnotation,
  ReaderLocator,
  SearchScope,
} from '../../../shared/api';

export { createIdempotencyKey };
export type { AgentSuggestion, Book, Chapter, ChatMessage, ChatSession, Project, ProjectMembership, ReaderAnnotation, ReaderLocator, SearchScope };
export type ReaderSourceClient = Pick<CanonKeeperApiClient, 'getChapter'>;

export type ManuscriptApiClient = Pick<
  CanonKeeperApiClient,
  | 'approveAgentSuggestion'
  | 'cancelJob'
  | 'createBook'
  | 'createBookExport'
  | 'createChapter'
  | 'createChapterAnnotation'
  | 'createChatSession'
  | 'deleteBook'
  | 'deleteReaderAnnotation'
  | 'getBook'
  | 'getChapter'
  | 'getChatSession'
  | 'getImportConstraints'
  | 'getJob'
  | 'getProject'
  | 'importBookFile'
  | 'listBooks'
  | 'listChapterAnnotations'
  | 'listChapters'
  | 'listAgentSuggestions'
  | 'listChatMessages'
  | 'listChatSessions'
  | 'listProjectJobs'
  | 'listProjects'
  | 'logout'
  | 'publishChapter'
  | 'rejectAgentSuggestion'
  | 'searchProject'
  | 'startAgentRun'
  | 'startProjectIndexing'
  | 'updateBook'
  | 'updateChapter'
  | 'updateReaderAnnotation'
>;

export type ChapterListItem = Awaited<ReturnType<ManuscriptApiClient['listChapters']>>['data'][number];
export type ProjectJob = Job;
export type SearchResult = Awaited<ReturnType<ManuscriptApiClient['searchProject']>>['data'][number];

export interface ManuscriptShelfWorkspace {
  books: Book[];
  canCreateChats: boolean;
  canEditManuscript: boolean;
  canExportBooks: boolean;
  jobs: ProjectJob[];
  project: Project | null;
  projects: Project[];
  sessions: ChatSession[];
}

export type ManuscriptNotFound = 'project' | 'book' | 'chapter';

export interface ManuscriptReaderWorkspace {
  annotations: ReaderAnnotation[];
  book: Book | null;
  chapter: Chapter | null;
  chapters: ChapterListItem[];
  loadError?: unknown;
  notFound?: ManuscriptNotFound;
  project: Project | null;
  projects: Project[];
  sessions: ChatSession[];
}

export interface ManuscriptDraftWorkspace {
  annotations: ReaderAnnotation[];
  book: Book | null;
  canCreateChats: boolean;
  canEditManuscript: boolean;
  chapter: Chapter | null;
  chapters: ChapterListItem[];
  notFound?: ManuscriptNotFound;
  project: Project | null;
  sessions: ChatSession[];
}

export interface ManuscriptWorkspaceParams {
  bookId?: string | null;
  chapterId?: string | null;
  projectId?: string | null;
}

export interface ManuscriptDraftWorkspaceParams extends ManuscriptWorkspaceParams {
  isNewChapter: boolean;
}

export const manuscriptQueryKeys = {
  all: ['canonkeeper', 'manuscript'] as const,
  draftWorkspace: (params: ManuscriptDraftWorkspaceParams) =>
    [...manuscriptQueryKeys.all, 'draft-workspace', normalizeKey(params.projectId), normalizeKey(params.bookId), normalizeKey(params.chapterId), params.isNewChapter] as const,
  readerWorkspace: (params: ManuscriptWorkspaceParams) =>
    [...manuscriptQueryKeys.all, 'reader-workspace', normalizeKey(params.projectId), normalizeKey(params.bookId), normalizeKey(params.chapterId)] as const,
  sourceChapter: (chapterId: string) => [...manuscriptQueryKeys.all, 'source-chapter', chapterId] as const,
  shelf: (params: Pick<ManuscriptWorkspaceParams, 'projectId'>) => [...manuscriptQueryKeys.all, 'shelf', normalizeKey(params.projectId)] as const,
};

interface ManuscriptApiQueryMeta extends Record<string, unknown> {
  manuscriptApi: ManuscriptApiClient;
}

interface ReaderSourceQueryMeta extends Record<string, unknown> {
  readerSourceApi: ReaderSourceClient;
}

function manuscriptApiMeta(api: ManuscriptApiClient): ManuscriptApiQueryMeta {
  return { manuscriptApi: api };
}

function readerSourceMeta(api: ReaderSourceClient): ReaderSourceQueryMeta {
  return { readerSourceApi: api };
}

function manuscriptApiFromMeta(meta: unknown) {
  const queryMeta = meta as Partial<ManuscriptApiQueryMeta> | undefined;
  if (!queryMeta?.manuscriptApi) {
    throw new Error('Manuscript query is missing CanonKeeper API client metadata.');
  }
  return queryMeta.manuscriptApi;
}

function readerSourceApiFromMeta(meta: unknown) {
  const queryMeta = meta as Partial<ReaderSourceQueryMeta> | undefined;
  if (!queryMeta?.readerSourceApi) {
    throw new Error('Reader source query is missing CanonKeeper API client metadata.');
  }
  return queryMeta.readerSourceApi;
}

function normalizeKey(value: string | null | undefined) {
  return value ?? '';
}

function selectProject(projects: Project[], projectId?: string | null) {
  return projects.find((item) => item.id === projectId) ?? projects[0] ?? null;
}

function preferredBook(books: Book[]) {
  return books
    .filter((item) => item.status === 'ready')
    .sort((left, right) => right.chapterCount - left.chapterCount || left.order - right.order)[0] ?? books[0] ?? null;
}

function selectBook(books: Book[], bookId: string | null | undefined) {
  return books.find((item) => item.id === bookId) ?? preferredBook(books);
}

export type ProjectRole = ProjectMembership['role'];

export function projectRole(project: Project | null | undefined): ProjectRole | null {
  return project?.currentMembership.role ?? null;
}

export function canEditProject(project: Project | null | undefined) {
  const role = projectRole(project);
  return role === 'owner' || role === 'admin' || role === 'editor';
}

export function canExportProject(project: Project | null | undefined) {
  const role = projectRole(project);
  return role === 'owner' || role === 'admin';
}

async function loadShelfWorkspace(api: ManuscriptApiClient, params: Pick<ManuscriptWorkspaceParams, 'projectId'>): Promise<ManuscriptShelfWorkspace> {
  const projectList = await api.listProjects();
  const projectSummary = selectProject(projectList.data, params.projectId);
  if (!projectSummary) {
    return { books: [], canCreateChats: false, canEditManuscript: false, canExportBooks: false, jobs: [], project: null, projects: projectList.data, sessions: [] };
  }

  const [project, bookList, jobList, chatList] = await Promise.all([
    api.getProject(projectSummary.id),
    api.listBooks(projectSummary.id),
    api.listProjectJobs(projectSummary.id),
    api.listChatSessions(projectSummary.id),
  ]);

  return {
    books: bookList.data,
    canCreateChats: canEditProject(project),
    canEditManuscript: canEditProject(project),
    canExportBooks: canExportProject(project),
    jobs: jobList.data,
    project,
    projects: projectList.data,
    sessions: chatList.data,
  };
}

async function loadReaderWorkspace(api: ManuscriptApiClient, params: ManuscriptWorkspaceParams): Promise<ManuscriptReaderWorkspace> {
  const projectList = await api.listProjects();
  const projectSummary = selectProject(projectList.data, params.projectId);
  if (!projectSummary) {
    return { annotations: [], book: null, chapter: null, chapters: [], project: null, projects: projectList.data, sessions: [] };
  }

  const [project, bookList, chatList] = await Promise.all([
    api.getProject(projectSummary.id),
    api.listBooks(projectSummary.id),
    api.listChatSessions(projectSummary.id),
  ]);
  const book = selectBook(bookList.data, params.bookId);
  if (!book) {
    return { annotations: [], book: null, chapter: null, chapters: [], project, projects: projectList.data, sessions: chatList.data };
  }

  let chapterList: Awaited<ReturnType<ManuscriptApiClient['listChapters']>>;
  try {
    chapterList = await api.listChapters(book.id);
  } catch (loadError) {
    return { annotations: [], book, chapter: null, chapters: [], loadError, project, projects: projectList.data, sessions: chatList.data };
  }
  const chapterSummary =
    chapterList.data.find((item) => item.id === params.chapterId) ??
    chapterList.data[0] ??
    null;
  if (!chapterSummary) {
    return { annotations: [], book, chapter: null, chapters: chapterList.data, project, projects: projectList.data, sessions: chatList.data };
  }

  let chapter: Chapter;
  let annotationList: Awaited<ReturnType<ManuscriptApiClient['listChapterAnnotations']>>;
  try {
    [chapter, annotationList] = await Promise.all([
      api.getChapter(chapterSummary.id),
      api.listChapterAnnotations(chapterSummary.id),
    ]);
  } catch (loadError) {
    return { annotations: [], book, chapter: null, chapters: chapterList.data, loadError, project, projects: projectList.data, sessions: chatList.data };
  }

  return {
    annotations: annotationList.data,
    book,
    chapter,
    chapters: chapterList.data,
    project,
    projects: projectList.data,
    sessions: chatList.data,
  };
}

async function loadDraftWorkspace(api: ManuscriptApiClient, params: ManuscriptDraftWorkspaceParams): Promise<ManuscriptDraftWorkspace> {
  const projectList = await api.listProjects();
  const projectSummary = selectProject(projectList.data, params.projectId);
  if (!projectSummary) {
    return { annotations: [], book: null, canCreateChats: false, canEditManuscript: false, chapter: null, chapters: [], project: null, sessions: [] };
  }

  const [project, bookList, chatList] = await Promise.all([
    api.getProject(projectSummary.id),
    api.listBooks(projectSummary.id),
    api.listChatSessions(projectSummary.id),
  ]);
  const canEditManuscript = canEditProject(project);
  const canCreateChats = canEditManuscript;
  const book = selectBook(bookList.data, params.bookId);
  if (!book) {
    return { annotations: [], book: null, canCreateChats, canEditManuscript, chapter: null, chapters: [], project, sessions: chatList.data };
  }

  const chapterList = await api.listChapters(book.id);
  if (params.isNewChapter) {
    return { annotations: [], book, canCreateChats, canEditManuscript, chapter: null, chapters: chapterList.data, project, sessions: chatList.data };
  }

  const chapterSummary =
    chapterList.data.find((item) => item.id === params.chapterId) ??
    chapterList.data.find((item) => item.status === 'draft' || item.hasDraft) ??
    chapterList.data[0] ??
    null;
  if (!chapterSummary) {
    return { annotations: [], book, canCreateChats, canEditManuscript, chapter: null, chapters: chapterList.data, project, sessions: chatList.data };
  }

  const [chapter, annotationList] = await Promise.all([
    api.getChapter(chapterSummary.id),
    api.listChapterAnnotations(chapterSummary.id).catch(() => ({ data: [] as ReaderAnnotation[] })),
  ]);

  return { annotations: annotationList.data, book, canCreateChats, canEditManuscript, chapter, chapters: chapterList.data, project, sessions: chatList.data };
}

export function useManuscriptShelfQuery(api: ManuscriptApiClient, params: Pick<ManuscriptWorkspaceParams, 'projectId'>) {
  return useQuery({
    queryKey: manuscriptQueryKeys.shelf(params),
    queryFn: ({ meta }) => loadShelfWorkspace(manuscriptApiFromMeta(meta), params),
    meta: manuscriptApiMeta(api),
  });
}

export function useManuscriptReaderWorkspaceQuery(api: ManuscriptApiClient, params: ManuscriptWorkspaceParams) {
  return useQuery({
    queryKey: manuscriptQueryKeys.readerWorkspace(params),
    queryFn: ({ meta }) => loadReaderWorkspace(manuscriptApiFromMeta(meta), params),
    meta: manuscriptApiMeta(api),
  });
}

export function useManuscriptDraftWorkspaceQuery(api: ManuscriptApiClient, params: ManuscriptDraftWorkspaceParams) {
  return useQuery({
    queryKey: manuscriptQueryKeys.draftWorkspace(params),
    queryFn: ({ meta }) => loadDraftWorkspace(manuscriptApiFromMeta(meta), params),
    meta: manuscriptApiMeta(api),
  });
}

export function useReaderSourceChapterQuery(api: ReaderSourceClient, chapterId: string) {
  return useQuery({
    queryKey: manuscriptQueryKeys.sourceChapter(chapterId),
    queryFn: ({ meta }) => readerSourceApiFromMeta(meta).getChapter(chapterId),
    meta: readerSourceMeta(api),
    enabled: chapterId.length > 0,
  });
}

export function useRefreshManuscriptBooksMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: async (projectId: string) => {
      const [bookList, jobList] = await Promise.all([api.listBooks(projectId), api.listProjectJobs(projectId)]);
      return { books: bookList.data, jobs: jobList.data };
    },
  });
}

export function useOpenBookMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: async (bookId: string) => {
      const [book, chapters] = await Promise.all([api.getBook(bookId), api.listChapters(bookId)]);
      return { book, chapters: chapters.data };
    },
  });
}

export function useCreateBookMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: ({ projectId, body }: { body: Parameters<ManuscriptApiClient['createBook']>[1]; projectId: string }) =>
      api.createBook(projectId, body),
  });
}

export function useUpdateBookMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: ({ bookId, body }: { body: Parameters<ManuscriptApiClient['updateBook']>[1]; bookId: string }) =>
      api.updateBook(bookId, body),
  });
}

export function useDeleteBookMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: (bookId: string) => api.deleteBook(bookId),
  });
}

export function useImportBookMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: async ({
      body,
      idempotencyKey,
      projectId,
    }: {
      body: Parameters<ManuscriptApiClient['importBookFile']>[1];
      idempotencyKey: string;
      projectId: string;
    }) => {
      const constraints = await api.getImportConstraints(projectId);
      const started = await api.importBookFile(projectId, body, { idempotencyKey });
      return { constraints, job: started.job };
    },
  });
}

export function useCancelJobMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: async (jobId: string) => {
      const canceled = await api.cancelJob(jobId);
      return api.getJob(canceled.id);
    },
  });
}

const exportPollDelayMs = 250;
const exportPollMaxAttempts = 20;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useExportBookMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: async ({
      bookId,
      format,
      idempotencyKey,
    }: {
      bookId: string;
      format: 'fb2' | 'epub';
      idempotencyKey: string;
    }) => {
      const created = await api.createBookExport(bookId, { format }, { idempotencyKey });
      let job = created.job;
      let attempts = 0;
      while (!['succeeded', 'failed', 'canceled', 'expired'].includes(job.status) && attempts < exportPollMaxAttempts) {
        await delay(exportPollDelayMs);
        job = await api.getJob(created.jobId);
        attempts += 1;
      }
      return job;
    },
  });
}

export function useSearchProjectMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: ({ projectId, query, scope }: { projectId: string; query: string; scope?: SearchScope }) =>
      api.searchProject(projectId, query, scope),
  });
}

export function useGetProjectMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: (projectId: string) => api.getProject(projectId),
  });
}

export function useCreateChapterMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: ({ bookId, body }: { body: Parameters<ManuscriptApiClient['createChapter']>[1]; bookId: string }) =>
      api.createChapter(bookId, body),
  });
}

export function useGetChapterMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: (chapterId: string) => api.getChapter(chapterId),
  });
}

export function useUpdateChapterMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: ({ body, chapterId }: { body: Parameters<ManuscriptApiClient['updateChapter']>[1]; chapterId: string }) =>
      api.updateChapter(chapterId, body),
  });
}

export function usePublishChapterMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: ({ body, chapterId }: { body: Parameters<ManuscriptApiClient['publishChapter']>[1]; chapterId: string }) =>
      api.publishChapter(chapterId, body),
  });
}

export function useCreateChapterAnnotationMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: ({ body, chapterId }: { body: Parameters<ManuscriptApiClient['createChapterAnnotation']>[1]; chapterId: string }) =>
      api.createChapterAnnotation(chapterId, body),
  });
}

export function useUpdateReaderAnnotationMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: ({ annotationId, body }: { annotationId: string; body: Parameters<ManuscriptApiClient['updateReaderAnnotation']>[1] }) =>
      api.updateReaderAnnotation(annotationId, body),
  });
}

export function useDeleteReaderAnnotationMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: (annotationId: string) => api.deleteReaderAnnotation(annotationId),
  });
}

export function useGetChatSessionMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: (chatId: string) => api.getChatSession(chatId),
  });
}

export function useCreateChatSessionMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: ({ projectId, title }: { projectId: string; title: string }) => api.createChatSession(projectId, { title }),
  });
}

export function useLogoutMutation(api: ManuscriptApiClient) {
  return useMutation({
    mutationFn: () => api.logout(),
  });
}

export const chapterAgentSuggestionsKey = (chapterId: string) =>
  [...manuscriptQueryKeys.all, 'agent-suggestions', chapterId] as const;

export function useChapterAgentSuggestionsQuery(api: ManuscriptApiClient, chapterId: string) {
  return useQuery({
    queryKey: chapterAgentSuggestionsKey(chapterId),
    queryFn: ({ meta }) => manuscriptApiFromMeta(meta).listAgentSuggestions(chapterId),
    meta: manuscriptApiMeta(api),
    enabled: chapterId.length > 0,
  });
}

export function useStartAgentRunMutation(api: ManuscriptApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      body,
      chapterId,
      idempotencyKey,
    }: {
      body: Parameters<ManuscriptApiClient['startAgentRun']>[1];
      chapterId: string;
      idempotencyKey: string;
    }) => api.startAgentRun(chapterId, body, { idempotencyKey }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: chapterAgentSuggestionsKey(variables.chapterId) }),
  });
}

export function useApproveAgentSuggestionMutation(api: ManuscriptApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ suggestionId, expectedChapterRevision }: { expectedChapterRevision: number; suggestionId: string }) =>
      api.approveAgentSuggestion(suggestionId, { expectedChapterRevision }),
    onSuccess: (result) => {
      if (result.chapter) {
        queryClient.invalidateQueries({ queryKey: chapterAgentSuggestionsKey(result.chapter.id) });
      }
    },
  });
}

export function useRejectAgentSuggestionMutation(api: ManuscriptApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expectedChapterRevision, suggestionId }: { expectedChapterRevision: number; suggestionId: string }) =>
      api.rejectAgentSuggestion(suggestionId, { expectedChapterRevision }),
    onSuccess: (result) => {
      if (result.chapter) {
        queryClient.invalidateQueries({ queryKey: chapterAgentSuggestionsKey(result.chapter.id) });
      }
    },
  });
}
