import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  MoreVertical,
  NotebookPen,
  Pencil,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  UserCircle,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type {
  AgentSuggestion,
  ChatApiClient,
  ChatArtifact,
  ChatMessage,
  ChatSession,
  Chapter,
  Project,
  ReaderReferenceLocator,
  ReaderLocator,
  SearchScope,
} from '../../entities/chat/api';
import { createIdempotencyKey } from '../../entities/chat/api';
import { isApiStatusFailure, isNetworkFailure, publicApiErrorMessage } from '../../entities/api-errors';
import { getArtifactReferenceIds, sameLocator } from '../../entities/chat/model';
import type { AppRoute } from '../../shared/navigation/app-route';
import { formatProjectMeta, searchResultKindLabel } from '../../ui/copy';
import { Overlay } from '../../ui/Overlay';
import { usePresence, type PresenceStatus } from '../../ui/use-presence';
import { ProjectSidebar } from '../../ui/ProjectSidebar';
import {
  assistantVisibleText,
  partitionAssistantParts,
  reasoningDurationLabel,
  toolChipLabel,
} from '../../entities/chat/message-parts';
import { ReaderCore } from '../reader/ReaderCore';
import {
  appendStreamEvent,
  resolveReaderMode,
  toModalMode,
  toReaderMode,
  type ModalMode,
  type ReaderMode,
} from './chat-model';
import {
  emptyChatAssistance,
  emptyChatWorkspace,
  hydrateChatArtifacts,
  useApproveChatAssistanceMutation,
  useChatAssistanceQuery,
  useChatWorkspaceQuery,
  useCreateChatSessionMutation,
  useDeleteChatSessionMutation,
  useLogoutMutation,
  useRefreshChatMessagesMutation,
  useRejectChatAssistanceMutation,
  useRenameChatSessionMutation,
  useSearchProjectMutation,
  type ChatAssistanceData,
  type ChatSearchResult,
} from '../../entities/chat/api';
import styles from './ChatPage.module.css';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface ChatPageProps {
  api: ChatApiClient;
  onLogout: () => void;
  navigate: (path: string, query?: Record<string, string | undefined>) => void;
  route: AppRoute;
  userName: string;
}

export function ChatPage({ api, onLogout, navigate, route, userName }: ChatPageProps) {
  const routeSignature = route.query.toString();
  const requestedProjectId = route.query.get('projectId') ?? '';
  const requestedChatId = route.query.get('chatId') ?? '';
  const requestedBookId = route.query.get('bookId') ?? '';
  const requestedChapterId = route.query.get('chapterId') ?? '';
  const requestedParagraphId = route.query.get('paragraphId') ?? '';
  const [selectedProjectId, setSelectedProjectId] = useState(requestedProjectId);
  const [activeChatId, setActiveChatId] = useState(requestedChatId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [artifactsById, setArtifactsById] = useState<Record<string, ChatArtifact>>({});
  const [notice, setNotice] = useState('');
  const [readerMode, setReaderMode] = useState<ReaderMode | null>(toReaderMode(route.query.get('reader')));
  const [selectedLocator, setSelectedLocator] = useState<ReaderLocator | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode | null>(toModalMode(route.query.get('modal')));
  const [renameValue, setRenameValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(route.query.get('menu') === 'open');
  const [actionsOpen, setActionsOpen] = useState(route.query.get('actions') === 'open');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchStatus, setSearchStatus] = useState<LoadStatus>('idle');
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<ChatSearchResult[]>([]);
  const [composerValue, setComposerValue] = useState('');
  const [streamStatus, setStreamStatus] = useState<'idle' | 'pending' | 'streaming' | 'error'>('idle');
  const [streamText, setStreamText] = useState('');
  const [streamEvents, setStreamEvents] = useState<string[]>([]);
  const [assistanceAction, setAssistanceAction] = useState<{ id: string; kind: 'approve' | 'reject' } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const readerReturnRef = useRef<HTMLElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamJobRef = useRef<string | null>(null);
  const streamRunRef = useRef(0);

  const workspaceQuery = useChatWorkspaceQuery(api, {
    chatId: activeChatId || requestedChatId,
    projectId: selectedProjectId || requestedProjectId,
  });
  const workspace = workspaceQuery.data ?? emptyChatWorkspace;
  const projects = workspace.projects;
  const activeProject = workspace.activeProject;
  const canWriteChat = canMutateProject(activeProject);
  const sessions = workspace.sessions;
  const activeChat = workspace.activeChat;
  const visibleActiveChatId = activeChatId || workspace.activeChatId;
  const workspaceStatus: LoadStatus = workspaceQuery.isPending
    ? 'loading'
    : workspaceQuery.isError
      ? 'error'
      : projects.length === 0
        ? 'empty'
        : 'ready';
  const sessionStatus: LoadStatus = workspaceQuery.isPending
    ? 'loading'
    : workspaceQuery.isError
      ? 'error'
      : sessions.length === 0
        ? 'empty'
        : 'ready';
  const threadStatus: LoadStatus = workspaceQuery.isPending
    ? 'loading'
    : workspaceQuery.isError
      ? 'error'
      : !activeChat
        ? 'empty'
        : messages.length > 0
          ? 'ready'
          : 'empty';
  const error = workspaceQuery.isError ? formatError(workspaceQuery.error, 'Не удалось загрузить рабочую область.') : '';
  const assistanceQuery = useChatAssistanceQuery(api, {
    bookId: requestedBookId,
    chapterId: requestedChapterId,
    projectId: activeProject?.id ?? selectedProjectId ?? requestedProjectId,
  });
  const assistance = assistanceQuery.data ?? emptyChatAssistance;
  const assistanceStatus: LoadStatus = assistanceQuery.isPending
    ? 'loading'
    : assistanceQuery.isError
      ? 'error'
      : assistance.suggestions.length > 0
        ? 'ready'
        : 'empty';
  const assistanceError = assistanceQuery.isError ? formatError(assistanceQuery.error, 'Предложения временно недоступны.') : '';
  const hasAssistanceContext = requestedChapterId.length > 0;
  const createSessionMutation = useCreateChatSessionMutation(api);
  const renameSessionMutation = useRenameChatSessionMutation(api);
  const deleteSessionMutation = useDeleteChatSessionMutation(api);
  const searchProjectMutation = useSearchProjectMutation(api);
  const refreshMessagesMutation = useRefreshChatMessagesMutation(api);
  const logoutMutation = useLogoutMutation(api);
  const approveAssistanceMutation = useApproveChatAssistanceMutation(api);
  const rejectAssistanceMutation = useRejectChatAssistanceMutation(api);

  useEffect(() => {
    setSelectedProjectId(requestedProjectId);
    setReaderMode(toReaderMode(route.query.get('reader')));
    setModalMode(toModalMode(route.query.get('modal')));
    setMenuOpen(route.query.get('menu') === 'open');
    setActionsOpen(route.query.get('actions') === 'open');
    if (requestedChatId) {
      setActiveChatId(requestedChatId);
    }
  }, [requestedChatId, requestedProjectId, routeSignature, route.query]);

  useEffect(() => {
    if (!workspaceQuery.data) {
      return;
    }

    setRenameValue(workspace.activeChat?.title ?? '');
    setMessages(workspace.messages);
    setArtifactsById(workspace.artifactsById);
    setSelectedLocator(locatorFromRoute(workspace.activeProject, requestedBookId, requestedChapterId, requestedParagraphId) ?? workspace.firstLocator);

    if (workspace.artifactErrors[0]) {
      setNotice(formatError(workspace.artifactErrors[0], 'Источник временно недоступен.'));
    }
  }, [requestedBookId, requestedChapterId, requestedParagraphId, workspace, workspaceQuery.data]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamRunRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) {
      return;
    }
    if (typeof thread.scrollTo === 'function') {
      thread.scrollTo({ top: thread.scrollHeight });
      return;
    }
    thread.scrollTop = thread.scrollHeight;
  }, [messages, streamText]);

  function selectSession(chatId: string, options?: { preserveRoute?: boolean }) {
    void stopActiveStream({ clearStream: true });
    setActiveChatId(chatId);
    setSelectedLocator(null);
    setStreamStatus('idle');
    setStreamText('');
    setStreamEvents([]);
    if (!options?.preserveRoute) {
      navigateChat({ chatId });
    }
  }

  async function createSession() {
    if (!activeProject) {
      return;
    }
    if (!canWriteChat) {
      setNotice('Действия с чатом доступны редактору, администратору или владельцу проекта.');
      return;
    }
    setNotice('');
    try {
      const created = await createSessionMutation.mutateAsync({ projectId: activeProject.id, title: 'Новый чат проекта' });
      setActiveChatId(created.id);
      navigateChat({ chatId: created.id });
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось создать чат.'));
    }
  }

  async function createAssistanceChat() {
    if (!activeProject) {
      setNotice('Проект загружается.');
      return;
    }
    if (!canWriteChat) {
      setNotice('Действия с чатом доступны редактору, администратору или владельцу проекта.');
      return;
    }
    setNotice('');
    try {
      const created = await createSessionMutation.mutateAsync({ projectId: activeProject.id, title: 'Помощь по черновику' });
      setActiveChatId(created.id);
      navigateChat({
        bookId: assistance.book?.id ?? (requestedBookId || undefined),
        chapterId: assistance.chapter?.id ?? (requestedChapterId || undefined),
        chatId: created.id,
        paragraphId: requestedParagraphId || undefined,
      });
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось создать чат.'));
    }
  }

  function navigateToManuscript() {
    if (!activeProject) {
      setNotice('Проект загружается.');
      return;
    }
    navigate('/manuscript/books', { projectId: activeProject.id });
  }

  function openGlobalSearch() {
    setSearchScope('all');
    setSearchOpen(true);
    window.setTimeout(() => searchTriggerRef.current?.focus(), 0);
  }

  async function approveSuggestion(suggestion: AgentSuggestion) {
    if (!canWriteChat) {
      setNotice('Агентские правки доступны редактору, администратору или владельцу проекта.');
      return;
    }
    setAssistanceAction({ id: suggestion.id, kind: 'approve' });
    setNotice('Применяем предложение...');
    try {
      await approveAssistanceMutation.mutateAsync({
        expectedChapterRevision: assistance.chapter?.draftRevision ?? suggestion.baseChapterRevision,
        suggestionId: suggestion.id,
      });
      setNotice('Предложение применено к черновику.');
    } catch (nextError) {
      setNotice(isConflict(nextError) ? 'Конфликт версии: обновите черновик перед применением.' : formatError(nextError, 'Не удалось применить предложение.'));
    } finally {
      setAssistanceAction(null);
    }
  }

  async function rejectSuggestion(suggestion: AgentSuggestion) {
    if (!canWriteChat) {
      setNotice('Агентские правки доступны редактору, администратору или владельцу проекта.');
      return;
    }
    setAssistanceAction({ id: suggestion.id, kind: 'reject' });
    setNotice('Отклоняем предложение...');
    try {
      await rejectAssistanceMutation.mutateAsync({
        expectedChapterRevision: assistance.chapter?.draftRevision ?? suggestion.baseChapterRevision,
        suggestionId: suggestion.id,
      });
      setNotice('Предложение отклонено.');
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось отклонить предложение.'));
    } finally {
      setAssistanceAction(null);
    }
  }

  async function renameSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChat || renameValue.trim().length === 0) {
      return;
    }
    if (!canWriteChat) {
      setNotice('Действия с чатом доступны редактору, администратору или владельцу проекта.');
      closeModal();
      return;
    }
    try {
      await renameSessionMutation.mutateAsync({ chatId: activeChat.id, title: renameValue.trim() });
      closeModal();
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось переименовать чат.'));
    }
  }

  async function deleteSession() {
    if (!activeChat) {
      return;
    }
    if (!canWriteChat) {
      setNotice('Действия с чатом доступны редактору, администратору или владельцу проекта.');
      closeModal();
      return;
    }
    try {
      await deleteSessionMutation.mutateAsync(activeChat.id);
      const remaining = sessions.filter((session) => session.id !== activeChat.id);
      closeModal();
      if (remaining[0]) {
        selectSession(remaining[0].id);
      } else {
        setActiveChatId('');
        setMessages([]);
      }
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось удалить чат.'));
    }
  }

  async function stopActiveStream({
    clearStream = false,
    showCancelError = false,
    stoppedNotice,
  }: {
    clearStream?: boolean;
    showCancelError?: boolean;
    stoppedNotice?: string;
  } = {}) {
    const jobId = streamJobRef.current;
    const controller = streamAbortRef.current;
    if (!controller && !jobId) {
      return;
    }
    streamRunRef.current += 1;
    controller?.abort();
    streamAbortRef.current = null;
    streamJobRef.current = null;
    if (clearStream) {
      setStreamStatus('idle');
      setStreamText('');
      setStreamEvents([]);
    }
    if (stoppedNotice) {
      setNotice(stoppedNotice);
    }
    if (jobId) {
      try {
        await api.cancelJob(jobId);
      } catch (nextError) {
        if (showCancelError) {
          setStreamStatus('error');
          setNotice(formatError(nextError, 'Не удалось остановить ответ.'));
        }
      }
    }
  }

  async function cancelStream() {
    await stopActiveStream({ clearStream: true, showCancelError: true, stoppedNotice: 'Ответ остановлен.' });
    composerRef.current?.focus();
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = composerValue.trim();
    if (!content || !activeChat || streamStatus === 'pending' || streamStatus === 'streaming') {
      return;
    }
    if (!canWriteChat) {
      setNotice('Отправка сообщений доступна редактору, администратору или владельцу проекта.');
      return;
    }

    setComposerValue('');
    setStreamStatus('pending');
    setStreamText('');
    setStreamEvents(['Отправка запроса']);
    const optimisticMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      chatId: activeChat.id,
      role: 'user',
      content,
      parts: [{ type: 'text', text: content, sequence: 1, status: 'completed' }],
      references: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticMessage]);
    void stopActiveStream();
    streamJobRef.current = null;
    const streamAbortController = new AbortController();
    streamAbortRef.current = streamAbortController;
    const streamRunId = streamRunRef.current + 1;
    streamRunRef.current = streamRunId;
    let activeJobId: string | null = null;
    let activeTurnId: string | null = null;

    try {
      const contextLocator = selectedLocator && selectedLocator.projectId === activeProject?.id ? toReaderReferenceLocator(selectedLocator) : null;
      const turn = await api.createChatTurn(
        activeChat.id,
        {
          content,
          contextLocators: contextLocator ? [contextLocator] : [],
        },
        { idempotencyKey: createIdempotencyKey('createChatTurn'), signal: streamAbortController.signal },
      );
      activeJobId = turn.jobId;
      activeTurnId = turn.turnId;
      streamJobRef.current = turn.jobId;
      const stream = api.streamChatTurnEvents(turn.turnId, { signal: streamAbortController.signal });
      for await (const eventMessage of stream) {
        if (streamRunRef.current !== streamRunId) {
          return;
        }
        const eventChunk = eventMessage.data;
        if (eventChunk.type === 'job.progress') {
          setStreamStatus('streaming');
          setStreamEvents((current) => appendStreamEvent(current, stringEventData(eventChunk.data, 'label') ?? 'Готовим ответ'));
        }
        if (eventChunk.type === 'assistant.delta') {
          setStreamStatus('streaming');
          setStreamText((current) => `${current}${stringEventData(eventChunk.data, 'text') ?? ''}`);
        }
        if (eventChunk.type === 'artifact.ready') {
          const artifactId = stringEventData(eventChunk.data, 'artifactId');
          if (artifactId) {
            const hydrated = await hydrateChatArtifacts(api, [
              {
                ...optimisticMessage,
                references: [{ kind: 'reader_reference_artifact', artifactId }],
              },
            ]);
            setArtifactsById((current) => ({ ...current, ...hydrated.artifactsById }));
            setSelectedLocator((current) => current ?? hydrated.firstLocator);
            if (hydrated.artifactErrors[0]) {
              setNotice(formatError(hydrated.artifactErrors[0], 'Источник временно недоступен.'));
            }
          }
        }
        if (eventChunk.type === 'artifact.failed' || eventChunk.type === 'suggestions.failed') {
          setStreamEvents((current) => appendStreamEvent(current, stringEventData(eventChunk.data, 'message') ?? 'Не удалось завершить шаг'));
        }
        if (eventChunk.type === 'suggestions.ready') {
          setStreamEvents((current) => appendStreamEvent(current, 'Предложения по черновику обновлены.'));
          if (hasAssistanceContext) {
            void assistanceQuery.refetch();
          }
        }
        if (eventChunk.type === 'turn.failed') {
          const message = stringEventData(eventChunk.data, 'message') ?? 'Не удалось завершить ответ.';
          setStreamEvents((current) => appendStreamEvent(current, message));
          setStreamStatus('error');
          setNotice(message);
          composerRef.current?.focus();
          return;
        }
        if (eventChunk.type === 'turn.canceled') {
          const reason = stringEventData(eventChunk.data, 'reason') ?? 'Ответ остановлен.';
          setStreamEvents((current) => appendStreamEvent(current, reason));
          setStreamStatus('idle');
          setNotice(reason);
          composerRef.current?.focus();
          return;
        }
      }

      if (streamRunRef.current !== streamRunId) {
        return;
      }
      const refreshed = await refreshMessagesMutation.mutateAsync(activeChat.id);
      if (streamRunRef.current !== streamRunId) {
        return;
      }
      setMessages(refreshed.messages);
      setArtifactsById(refreshed.artifactsById);
      setSelectedLocator((current) => (current?.projectId === activeProject?.id ? current : refreshed.firstLocator));
      if (refreshed.artifactErrors[0]) {
        setNotice(formatError(refreshed.artifactErrors[0], 'Источник временно недоступен.'));
      }
      setStreamStatus('idle');
      composerRef.current?.focus();
    } catch (nextError) {
      if (isAbortError(nextError)) {
        return;
      }
      if (streamRunRef.current !== streamRunId) {
        return;
      }
      if (activeTurnId && isApiStatusFailure(nextError) && nextError.status === 410) {
        try {
          const snapshot = await api.getChatTurn(activeTurnId);
          if (streamRunRef.current !== streamRunId) {
            return;
          }
          const artifacts = Object.fromEntries(snapshot.artifacts.map((artifact) => [artifact.id, artifact]));
          setMessages(snapshot.messages);
          setArtifactsById(artifacts);
          setSelectedLocator((current) => (current?.projectId === activeProject?.id ? current : snapshot.artifacts[0]?.readerReferences?.[0]?.locator ?? null));
          if (snapshot.suggestions.length > 0 && hasAssistanceContext) {
            void assistanceQuery.refetch();
          }
          setStreamStatus('idle');
          composerRef.current?.focus();
          return;
        } catch (recoveryError) {
          setStreamStatus('error');
          setNotice(formatError(recoveryError, 'Не удалось восстановить ответ. Обновите чат.'));
          composerRef.current?.focus();
          return;
        }
      }
      setStreamStatus('error');
      setNotice(formatError(nextError, 'Не удалось завершить ответ.'));
      composerRef.current?.focus();
    } finally {
      if (streamRunRef.current === streamRunId && streamAbortRef.current === streamAbortController) {
        streamAbortRef.current = null;
      }
      if (streamRunRef.current === streamRunId && streamJobRef.current === activeJobId) {
        streamJobRef.current = null;
      }
    }
  }

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!activeProject) {
      return;
    }

    const query = searchTerm.trim();
    if (!query) {
      setSearchResults([]);
      setSearchStatus('ready');
      setSearchError('');
      return;
    }
    setSearchStatus('loading');
    setSearchError('');
    try {
      const response = await searchProjectMutation.mutateAsync({ projectId: activeProject.id, query, scope: searchScope });
      setSearchResults(response.data);
      setSearchStatus(response.data.length === 0 ? 'empty' : 'ready');
    } catch (nextError) {
      setSearchStatus('error');
      setSearchError(formatError(nextError, 'Поиск временно недоступен.'));
    }
  }

  async function selectProject(projectId: string) {
    void stopActiveStream({ clearStream: true });
    setSelectedProjectId(projectId);
    setActiveChatId('');
    setSelectedLocator(null);
    setProjectMenuOpen(false);
    navigate('/chat', { projectId });
  }

  async function logout() {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // User-initiated logout clears local session state even if the server endpoint fails.
    } finally {
      onLogout();
    }
  }

  function openReader(locator: ReaderLocator, trigger: HTMLElement | null, requestedMode?: ReaderMode) {
    readerReturnRef.current = trigger;
    setSelectedLocator(locator);
    const nextMode = requestedMode ?? resolveReaderMode(window.innerWidth);
    setReaderMode(nextMode);
    setSearchOpen(false);
    setMenuOpen(false);
    setActionsOpen(false);
    navigateChat({ actions: undefined, menu: undefined, reader: nextMode });
  }

  function closeReader() {
    setReaderMode(null);
    navigateChat({ reader: undefined });
    window.setTimeout(() => readerReturnRef.current?.focus(), 0);
  }

  function openModal(mode: ModalMode) {
    setModalMode(mode);
    setActionsOpen(false);
    navigateChat({ actions: undefined, modal: mode });
  }

  function closeModal() {
    setModalMode(null);
    navigateChat({ modal: undefined });
  }

  function openMobileMenu() {
    setMenuOpen(true);
    navigateChat({ menu: 'open' });
  }

  function closeMobileMenu() {
    setMenuOpen(false);
    navigateChat({ menu: undefined });
  }

  function openMobileActions() {
    setActionsOpen(true);
    navigateChat({ actions: 'open' });
  }

  function closeMobileActions() {
    setActionsOpen(false);
    navigateChat({ actions: undefined });
  }

  function navigateChat(overrides: Record<string, string | undefined>) {
    navigate('/chat', {
      chatId: visibleActiveChatId,
      bookId: requestedBookId || undefined,
      chapterId: requestedChapterId || undefined,
      reader: readerMode ?? undefined,
      modal: modalMode ?? undefined,
      menu: menuOpen ? 'open' : undefined,
      actions: actionsOpen ? 'open' : undefined,
      paragraphId: requestedParagraphId || undefined,
      projectId: (activeProject?.id ?? requestedProjectId) || undefined,
      ...overrides,
    });
  }

  const title = activeChat?.title ?? 'Чат проекта';
  const projectTitle = activeProject?.title ?? 'Проект';
  const projectMeta = formatProjectMeta(activeProject);

  const searchPresence = usePresence(searchOpen);
  const accountPresence = usePresence(accountMenuOpen);
  const projectPresence = usePresence(projectMenuOpen);
  const modalPresence = usePresence(modalMode);
  const menuPresence = usePresence(menuOpen);
  const actionsPresence = usePresence(actionsOpen);
  const readerDrawerPresence = usePresence(readerMode === 'drawer' ? selectedLocator : null);
  const readerFullscreenPresence = usePresence(readerMode === 'fullscreen' ? selectedLocator : null);

  return (
    <main className={styles.workspace}>
      <header className={styles.globalBar}>
        <button aria-label="Открыть меню" className={styles.mobileMenuButton} onClick={openMobileMenu} type="button">
          <Menu aria-hidden="true" size={21} />
        </button>
        <p className={styles.brand}>
          <span className={styles.desktopBrand}>Canon Keeper</span>
          <span className={styles.mobileTitle}>{title}</span>
        </p>
        <button
          aria-label="Глобальный поиск"
          className={styles.globalSearchButton}
          onClick={() => openGlobalSearch()}
          ref={searchTriggerRef}
          type="button"
        >
          <Search aria-hidden="true" size={16} />
          <span>Глобальный поиск</span>
        </button>
        <div className={styles.barActions}>
          <button aria-label="Открыть действия чата" className={styles.mobileActionsButton} onClick={openMobileActions} type="button">
            <MoreVertical aria-hidden="true" size={20} />
          </button>
          <button className={styles.cabinetButton} onClick={() => setAccountMenuOpen((value) => !value)} type="button">
            <LayoutDashboard aria-hidden="true" size={16} />
            Личный кабинет
          </button>
          <button aria-label="Аккаунт" className={styles.avatarButton} onClick={() => setAccountMenuOpen((value) => !value)} type="button">
            {userName.slice(0, 1)}
          </button>
        </div>

        {searchPresence.mounted ? (
          <SearchPanel
            onClose={() => {
              setSearchOpen(false);
              setSearchScope('all');
              searchTriggerRef.current?.focus();
            }}
            onOpenResult={(locator, trigger) => openReader(locator, trigger)}
            onRunSearch={runSearch}
            results={searchResults}
            searchError={searchError}
            searchStatus={searchStatus}
            searchTerm={searchTerm}
            searchScope={searchScope}
            setSearchTerm={setSearchTerm}
            state={searchPresence.status}
          />
        ) : null}

        {accountPresence.mounted ? (
          <div className={styles.accountMenu} data-pop="" data-state={accountPresence.status}>
            <p className={styles.accountName}>{userName}</p>
            <button className={styles.menuItem} onClick={() => setNotice('Настройки профиля вне объема этой сборки.')} type="button">
              <UserCircle aria-hidden="true" size={17} />
              Профиль
            </button>
            <button className={styles.menuItem} onClick={logout} type="button">
              <LogOut aria-hidden="true" size={17} />
              Выйти
            </button>
          </div>
        ) : null}
      </header>

      <div className={styles.body}>
        <ProjectSidebar
          active="chat"
          activeChatId={visibleActiveChatId}
          canCreateChat={canWriteChat}
          onChat={() => undefined}
          onCreateChat={createSession}
          onManuscript={navigateToManuscript}
          onOpenProjectMenu={() => setProjectMenuOpen((value) => !value)}
          onSelectChat={(chatId) => void selectSession(chatId)}
          projectMeta={projectMeta}
          projectTitle={projectTitle}
          sessions={sessions}
          sessionStatus={sessionStatus}
        />

        <nav className={styles.tabletRail} aria-label="Планшетная навигация">
          <button aria-label="Поиск" className={styles.iconButton} onClick={() => setSearchOpen(true)} type="button">
            <Search aria-hidden="true" size={19} />
          </button>
          <button aria-label="Рукопись" className={styles.iconButton} onClick={navigateToManuscript} type="button">
            <NotebookPen aria-hidden="true" size={19} />
          </button>
          <button aria-label="Чат" className={styles.activeNavButton} type="button">
            <MessageSquare aria-hidden="true" size={19} />
          </button>
        </nav>

        <div className={styles.split}>
          <section className={styles.chatColumn} aria-label="Чат проекта">
            <header className={styles.chatHeader} data-proof="chat-header">
              <div className={styles.chatHeaderInner}>
                <h1>{title}</h1>
                <div className={styles.chatHeaderActions}>
                  <button aria-label="Переименовать чат" className={styles.iconButton} disabled={!activeChat || !canWriteChat} onClick={() => openModal('rename-chat')} type="button">
                    <Pencil aria-hidden="true" size={18} />
                  </button>
                  <button aria-label="Удалить чат" className={`${styles.iconButton} ${styles.deleteIcon}`} disabled={!activeChat || !canWriteChat} onClick={() => openModal('delete-chat')} type="button">
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                </div>
              </div>
            </header>

            <div className={styles.thread} data-proof="chat-thread" ref={threadRef}>
              <div className={styles.threadInner}>
                {workspaceStatus === 'loading' || threadStatus === 'loading' ? <p className={styles.stateBox}>Загружаем чат...</p> : null}
                {workspaceStatus === 'empty' ? <p className={styles.stateBox}>У вас пока нет проектов.</p> : null}
                {workspaceStatus === 'ready' && sessionStatus === 'empty' ? (
                  <div className={styles.stateBox}>
                    <p>В проекте пока нет чатов.</p>
                    <button className={styles.primaryButton} disabled={!canWriteChat} onClick={() => void createSession()} type="button">
                      Создать чат
                    </button>
                  </div>
                ) : null}
                {workspaceStatus === 'error' || threadStatus === 'error' ? <p className={styles.stateBox}>{error}</p> : null}
                {threadStatus === 'empty' && workspaceStatus === 'ready' && sessionStatus === 'ready' ? <p className={styles.stateBox}>В этом чате пока нет сообщений.</p> : null}
                {notice ? <p className={styles.stateBox}>{notice}</p> : null}
                {hasAssistanceContext ? (
                  <ChatAssistancePanel
                    action={assistanceAction}
                    assistance={assistance}
                    canWriteChat={canWriteChat}
                    error={assistanceError}
                    onApprove={(suggestion) => void approveSuggestion(suggestion)}
                    onCreateChat={() => void createAssistanceChat()}
                    onReject={(suggestion) => void rejectSuggestion(suggestion)}
                    status={assistanceStatus}
                  />
                ) : null}

                {messages.map((message) => (
                  <MessageBlock
                    artifactsById={artifactsById}
                    activeLocator={readerMode ? selectedLocator : null}
                    key={message.id}
                    message={message}
                    onOpenReader={(locator, trigger) => openReader(locator, trigger)}
                  />
                ))}

                {streamStatus === 'pending' || streamStatus === 'streaming' || streamStatus === 'error' ? (
                  <div className={styles.message} aria-live="polite">
                    <p className={styles.assistantMeta}>{streamStatus === 'error' ? 'Ответ не завершен' : 'Ответ формируется'}</p>
                    {streamEvents.map((item, index) => (
                      <p className={styles.activityLine} key={`${index}-${item}`}>
                        {item}
                      </p>
                    ))}
                    {streamText ? <p className={styles.assistantText}>{streamText}</p> : null}
                  </div>
                ) : null}
              </div>
            </div>

            <footer className={styles.composer} data-proof="chat-composer">
              <form className={styles.composerForm} onSubmit={sendMessage}>
                <textarea
                  aria-label="Сообщение"
                  disabled={!activeChat || !canWriteChat}
                  onChange={(event) => setComposerValue(event.target.value)}
                  placeholder={!canWriteChat ? 'У вас доступ только для чтения' : activeChat ? 'Задайте свой вопрос...' : 'Создайте чат, чтобы начать диалог'}
                  ref={composerRef}
                  value={composerValue}
                />
                {streamStatus === 'pending' || streamStatus === 'streaming' ? (
                  <button aria-label="Остановить ответ" className={styles.sendButton} onClick={cancelStream} type="button">
                    <Square aria-hidden="true" size={17} />
                  </button>
                ) : (
                  <button aria-label="Отправить" className={styles.sendButton} disabled={!activeChat || !canWriteChat || !composerValue.trim()} type="submit">
                    <Send aria-hidden="true" size={19} />
                  </button>
                )}
              </form>
            </footer>
          </section>

          {readerMode === 'open' && selectedLocator ? (
            <aside className={styles.readerPane} aria-label="Читалка источника">
              <ReaderCore api={api} locator={selectedLocator} mode="pane" onClose={closeReader} />
            </aside>
          ) : null}
        </div>
      </div>

      {projectPresence.mounted ? (
        <div className={styles.projectMenu} data-pop="" data-state={projectPresence.status}>
          {projects.map((project) => (
            <button className={styles.menuItem} key={project.id} onClick={() => void selectProject(project.id)} type="button">
              <FolderOpen aria-hidden="true" size={17} />
              {project.title}
            </button>
          ))}
        </div>
      ) : null}

      {modalPresence.mounted && modalPresence.value ? (
        <ModalLayer
          activeChatTitle={title}
          modalMode={modalPresence.value}
          onClose={closeModal}
          onDelete={() => void deleteSession()}
          onRename={(event) => void renameSession(event)}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          state={modalPresence.status}
        />
      ) : null}

      {menuPresence.mounted ? (
        <MobileMenu
          activeChatId={visibleActiveChatId}
          canCreateChat={canWriteChat}
          onClose={closeMobileMenu}
          onCreateSession={createSession}
          onNavigateChat={() => closeMobileMenu()}
          onNavigateManuscript={() => {
            closeMobileMenu();
            navigateToManuscript();
          }}
          onSelectSession={(chatId) => void selectSession(chatId)}
          projectMeta={projectMeta}
          projectTitle={projectTitle}
          sessions={sessions}
          sessionStatus={sessionStatus}
          state={menuPresence.status}
        />
      ) : null}

      {actionsPresence.mounted ? (
        <ActionsMenu
          canWriteChat={canWriteChat}
          onClose={closeMobileActions}
          onDelete={() => openModal('delete-chat')}
          onRename={() => openModal('rename-chat')}
          state={actionsPresence.status}
        />
      ) : null}

      {readerDrawerPresence.mounted && readerDrawerPresence.value ? (
        <LayerPortal>
          <div className={styles.drawerLayer} data-overlay-scrim="" data-state={readerDrawerPresence.status}>
            <Overlay kind="drawer" label="Читалка" onDismiss={closeReader} state={readerDrawerPresence.status}>
              <aside className={styles.readerDrawer}>
                <ReaderCore api={api} locator={readerDrawerPresence.value} mode="drawer" onClose={closeReader} />
              </aside>
            </Overlay>
          </div>
        </LayerPortal>
      ) : null}

      {readerFullscreenPresence.mounted && readerFullscreenPresence.value ? (
        <LayerPortal>
          <div className={styles.drawerLayer} data-overlay-scrim="" data-state={readerFullscreenPresence.status}>
            <Overlay kind="fullscreen" label="Читалка" onDismiss={closeReader} state={readerFullscreenPresence.status}>
              <section className={styles.mobileReader}>
                <ReaderCore api={api} locator={readerFullscreenPresence.value} mode="fullscreen" onClose={closeReader} />
              </section>
            </Overlay>
          </div>
        </LayerPortal>
      ) : null}
    </main>
  );
}

function ChatAssistancePanel({
  action,
  assistance,
  canWriteChat,
  error,
  onApprove,
  onCreateChat,
  onReject,
  status,
}: {
  action: { id: string; kind: 'approve' | 'reject' } | null;
  assistance: ChatAssistanceData;
  canWriteChat: boolean;
  error: string;
  onApprove: (suggestion: AgentSuggestion) => void;
  onCreateChat: () => void;
  onReject: (suggestion: AgentSuggestion) => void;
  status: LoadStatus;
}) {
  const chapterLabel = chapterAssistanceLabel(assistance.chapter);

  return (
    <section className={styles.assistancePanel} aria-label="Помощь по черновику" data-proof="chat-assistance">
      <div className={styles.assistanceHeader}>
        <div>
          <p className={styles.assistantMeta}>Черновик</p>
          <h2>{chapterLabel}</h2>
        </div>
        <button className={styles.secondaryButton} disabled={!canWriteChat} onClick={onCreateChat} type="button">
          <MessageSquare aria-hidden="true" size={15} />
          Создать чат
        </button>
      </div>

      {status === 'loading' ? <p className={styles.projectMeta}>Ищем предложения...</p> : null}
      {status === 'error' ? <p className={styles.projectMeta}>{error}</p> : null}
      {status === 'empty' ? <p className={styles.projectMeta}>Для этого черновика нет открытых предложений.</p> : null}

      <div className={styles.assistanceList}>
        {assistance.suggestions.map((suggestion) => (
          <article className={styles.assistanceItem} key={suggestion.id}>
            <div className={styles.assistanceTitleRow}>
              <span className={styles.chip}>
                <Sparkles aria-hidden="true" size={14} />
                {formatSuggestionKind(suggestion.kind)}
              </span>
              <span className={styles.suggestionStatus}>{formatSuggestionStatus(suggestion.status)}</span>
            </div>
            <h3>{suggestion.title}</h3>
            <p>{suggestion.rationale}</p>
            <blockquote>{suggestion.contextQuote}</blockquote>
            <div className={styles.assistanceActions}>
              <button
                className={styles.secondaryButton}
                disabled={!canWriteChat || Boolean(action) || suggestion.status !== 'pending'}
                onClick={() => onReject(suggestion)}
                type="button"
              >
                <X aria-hidden="true" size={15} />
                Отклонить
              </button>
              <button
                className={styles.primaryButton}
                disabled={!canWriteChat || Boolean(action) || suggestion.status !== 'pending'}
                onClick={() => onApprove(suggestion)}
                type="button"
              >
                <Check aria-hidden="true" size={15} />
                Применить
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MessageBlock({
  activeLocator,
  artifactsById,
  message,
  onOpenReader,
}: {
  activeLocator: ReaderLocator | null;
  artifactsById: Record<string, ChatArtifact>;
  message: ChatMessage;
  onOpenReader: (locator: ReaderLocator, trigger: HTMLElement | null) => void;
}) {
  const [reasoningOpen, setReasoningOpen] = useState(false);

  if (message.role === 'user') {
    return (
      <div className={styles.message}>
        <div className={styles.userBubble}>
          <p className={styles.messageLabel}>Вы</p>
          <p className={styles.messageText}>{message.content}</p>
        </div>
      </div>
    );
  }

  const { reasoningParts, textParts, toolParts } = partitionAssistantParts(message.parts);
  const reasoningLabel = reasoningDurationLabel(reasoningParts);
  const visibleText = assistantVisibleText(textParts);
  const artifactIds = getArtifactReferenceIds(message);

  return (
    <div className={styles.message}>
      {reasoningLabel ? (
        <button
          aria-expanded={reasoningOpen}
          className={styles.reasoningToggle}
          onClick={() => setReasoningOpen((value) => !value)}
          type="button"
        >
          {reasoningLabel}
          <ChevronDown aria-hidden="true" className={reasoningOpen ? styles.reasoningChevronOpen : styles.reasoningChevron} size={16} />
        </button>
      ) : null}
      {reasoningOpen
        ? reasoningParts.map((part) => (
            <p className={styles.reasoningText} key={`${message.id}-reasoning-${part.sequence ?? part.text}`}>
              {part.text}
            </p>
          ))
        : null}
      {visibleText ? <p className={styles.assistantText}>{visibleText}</p> : null}
      {toolParts.length > 0 ? (
        <div className={styles.chipRow}>
          {toolParts.map((part) => (
            <span className={styles.chip} key={`${message.id}-tool-${part.sequence ?? part.text}`}>
              {part.text.includes('Поиск') ? <Search aria-hidden="true" size={14} /> : null}
              {part.text.includes('Открыл') ? <BookOpen aria-hidden="true" size={14} /> : null}
              {toolChipLabel(part)}
            </span>
          ))}
        </div>
      ) : null}
      {artifactIds.map((artifactId) => {
        const artifact = artifactsById[artifactId];
        return artifact?.readerReferences?.map((reference) => (
          <div className={sameLocator(reference.locator, activeLocator) ? styles.sourceCardActive : styles.sourceCard} key={reference.id}>
            <div className={styles.sourceTop}>
              <span className={styles.sourceLabel}>{reference.label}</span>
              <button
                className={styles.openLink}
                onClick={(event) => onOpenReader(reference.locator, event.currentTarget)}
                type="button"
              >
                Открыть
                <ArrowUpRight aria-hidden="true" size={14} />
              </button>
            </div>
            <p className={styles.sourceQuote}>{reference.quote}</p>
          </div>
        ));
      })}
    </div>
  );
}

function SearchPanel({
  onClose,
  onOpenResult,
  onRunSearch,
  results,
  searchError,
  searchScope,
  searchStatus,
  searchTerm,
  setSearchTerm,
  state,
}: {
  onClose: () => void;
  onOpenResult: (locator: ReaderLocator, trigger: HTMLElement | null) => void;
  onRunSearch: (event?: FormEvent<HTMLFormElement>) => void;
  results: ChatSearchResult[];
  searchError: string;
  searchScope: SearchScope;
  searchStatus: LoadStatus;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  state: PresenceStatus;
}) {
  const placeholder = searchScope === 'annotations' ? 'Поиск заметок проекта' : 'Глобальный поиск';

  return (
    <section
      className={styles.searchPanel}
      data-pop="center"
      data-state={state}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <form className={styles.searchForm} onSubmit={onRunSearch}>
        <input
          aria-label="Запрос поиска"
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={placeholder}
          value={searchTerm}
        />
        <button className={styles.primaryButton} type="submit">
          Найти
        </button>
        <button aria-label="Закрыть поиск" className={styles.iconButton} onClick={onClose} type="button">
          <X aria-hidden="true" size={18} />
        </button>
      </form>
      <div className={styles.searchResults}>
        {searchStatus === 'loading' ? <p className={styles.projectMeta}>Ищем...</p> : null}
        {searchStatus === 'empty' ? <p className={styles.projectMeta}>Ничего не найдено в текущем проекте.</p> : null}
        {searchStatus === 'error' ? <p className={styles.projectMeta}>{searchError}</p> : null}
        {results.map((result) => (
          <button className={styles.searchResult} key={result.id} onClick={(event) => onOpenResult(result.locator, event.currentTarget)} type="button">
            <strong>{result.title}</strong>
            <span>{searchResultKindLabel(result.kind)}</span>
            <p>{result.excerpt}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function ModalLayer({
  activeChatTitle,
  modalMode,
  onClose,
  onDelete,
  onRename,
  renameValue,
  setRenameValue,
  state,
}: {
  activeChatTitle: string;
  modalMode: ModalMode;
  onClose: () => void;
  onDelete: () => void;
  onRename: (event: FormEvent<HTMLFormElement>) => void;
  renameValue: string;
  setRenameValue: (value: string) => void;
  state: PresenceStatus;
}) {
  return (
    <LayerPortal>
      <div className={styles.layer} data-overlay-scrim="" data-state={state}>
      <Overlay kind="dialog" label={modalMode === 'rename-chat' ? 'Переименовать чат' : 'Удалить чат'} onDismiss={onClose} state={state}>
        {modalMode === 'rename-chat' ? (
          <form className={styles.modal} onSubmit={onRename}>
            <div className={styles.modalHeader}>
              <h2>Переименовать чат</h2>
              <button aria-label="Закрыть" className={styles.iconButton} onClick={onClose} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <p className={styles.modalCopy}>Название чата</p>
            <input className={styles.modalInput} onChange={(event) => setRenameValue(event.target.value)} value={renameValue} />
            <div className={styles.modalActions}>
              <button className={styles.secondaryButton} onClick={onClose} type="button">
                Отмена
              </button>
              <button className={styles.primaryButton} type="submit">
                Сохранить
              </button>
            </div>
          </form>
        ) : (
          <section className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Удалить чат?</h2>
              <button aria-label="Закрыть" className={styles.iconButton} onClick={onClose} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <p className={styles.modalCopy}>Диалог «{activeChatTitle}» будет удален безвозвратно. Это действие нельзя отменить.</p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryButton} onClick={onClose} type="button">
                Отмена
              </button>
              <button className={styles.dangerButton} onClick={onDelete} type="button">
                Удалить
              </button>
            </div>
          </section>
        )}
      </Overlay>
      </div>
    </LayerPortal>
  );
}

function MobileMenu({
  activeChatId,
  canCreateChat,
  onClose,
  onCreateSession,
  onNavigateChat,
  onNavigateManuscript,
  onSelectSession,
  projectMeta,
  projectTitle,
  sessions,
  sessionStatus,
  state,
}: {
  activeChatId: string;
  canCreateChat: boolean;
  onClose: () => void;
  onCreateSession: () => void;
  onNavigateChat: () => void;
  onNavigateManuscript: () => void;
  onSelectSession: (chatId: string) => void;
  projectMeta: string;
  projectTitle: string;
  sessions: ChatSession[];
  sessionStatus: LoadStatus;
  state: PresenceStatus;
}) {
  return (
    <LayerPortal>
      <div className={styles.drawerLayer} data-overlay-scrim="" data-state={state}>
        <Overlay kind="drawer" label="Меню чата" onDismiss={onClose} state={state}>
          <aside className={styles.mobileDrawer}>
            <div className={styles.drawerHeader}>
              <h2>Canon Keeper</h2>
              <button aria-label="Закрыть меню" className={styles.iconButton} onClick={onClose} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <ProjectSidebar
              active="chat"
              activeChatId={activeChatId}
              canCreateChat={canCreateChat}
              onChat={onNavigateChat}
              onCreateChat={onCreateSession}
              onManuscript={onNavigateManuscript}
              onSelectChat={onSelectSession}
              projectMeta={projectMeta}
              projectTitle={projectTitle}
              sessions={sessions}
              sessionStatus={sessionStatus}
              variant="drawer"
            />
          </aside>
        </Overlay>
      </div>
    </LayerPortal>
  );
}

function ActionsMenu({
  canWriteChat,
  onClose,
  onDelete,
  onRename,
  state,
}: {
  canWriteChat: boolean;
  onClose: () => void;
  onDelete: () => void;
  onRename: () => void;
  state: PresenceStatus;
}) {
  return (
    <LayerPortal>
      <div className={styles.layer} data-overlay-scrim="" data-state={state}>
        <Overlay kind="menu" label="Действия чата" onDismiss={onClose} state={state}>
          <div className={styles.mobileActionsPanel}>
          <button className={styles.menuItem} disabled={!canWriteChat} onClick={onRename} type="button">
            <Pencil aria-hidden="true" size={17} />
            Переименовать
          </button>
          <button className={styles.menuDangerItem} disabled={!canWriteChat} onClick={onDelete} type="button">
            <Trash2 aria-hidden="true" size={17} />
            Удалить
          </button>
          </div>
        </Overlay>
      </div>
    </LayerPortal>
  );
}

function LayerPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

function locatorFromRoute(
  project: { id: string } | null,
  bookId: string,
  chapterId: string,
  paragraphId: string,
): ReaderLocator | null {
  if (!project?.id || !bookId || !chapterId) {
    return null;
  }

  return {
    bookId,
    chapterId,
    paragraphId: paragraphId || null,
    projectId: project.id,
    revision: 1,
    targetView: 'draft',
  };
}

function chapterAssistanceLabel(chapter: Chapter | null) {
  if (!chapter) {
    return 'Помощь по черновику';
  }
  const prefix = chapter.navigation.displayNumber ? `${chapter.navigation.displayNumber}. ` : '';
  return `${prefix}${chapter.title}`;
}

function formatSuggestionKind(kind: AgentSuggestion['kind']) {
  const labels: Record<AgentSuggestion['kind'], string> = {
    canon_consistency: 'Канон',
    continuity: 'Связность',
    punctuation: 'Пунктуация',
    rewrite: 'Перепись',
    style: 'Стиль',
  };
  return labels[kind] ?? 'Черновик';
}

function formatSuggestionStatus(status: AgentSuggestion['status']) {
  const labels: Record<AgentSuggestion['status'], string> = {
    accepted: 'Принято',
    conflict: 'Конфликт',
    pending: 'Открыто',
    rejected: 'Отклонено',
    stale: 'Устарело',
  };
  return labels[status] ?? status;
}

function isConflict(error: unknown) {
  return isApiStatusFailure(error) && error.status === 409;
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (isNetworkFailure(error)) {
    const cause = error.cause;
    return cause instanceof DOMException && cause.name === 'AbortError';
  }
  return false;
}

function stringEventData(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function toReaderReferenceLocator(locator: ReaderLocator): ReaderReferenceLocator | null {
  if (!locator.paragraphId) {
    return null;
  }
  return { ...locator, paragraphId: locator.paragraphId };
}

function canMutateProject(project: Project | null) {
  const role = project?.currentMembership.role;
  return role === 'owner' || role === 'admin' || role === 'editor';
}

function formatError(error: unknown, fallback: string) {
  return publicApiErrorMessage(error, fallback, {
    forbidden: 'Нет доступа к этому чату.',
    unauthorized: 'Сессия истекла. Войдите снова, и мы вернем вас к чату.',
  });
}
