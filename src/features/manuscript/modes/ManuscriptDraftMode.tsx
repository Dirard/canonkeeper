import {
  Bold,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Grid2X2,
  Heading,
  Italic,
  Link,
  List,
  LogOut,
  Minus,
  PanelRight,
  PenLine,
  Plus,
  Quote,
  Redo2,
  Search,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { type FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  AgentSuggestion,
  Book,
  Chapter,
  ChatSession,
  ManuscriptApiClient,
  Project,
  ReaderAnnotation,
  ReaderLocator,
} from '../../../entities/manuscript/api';
import { isApiStatusFailure, publicApiErrorMessage } from '../../../entities/api-errors';
import type { AppRoute } from '../../../shared/navigation/app-route';
import { formatProjectMeta, formatRelativeTime, searchResultKindLabel } from '../../../ui/copy';
import { Overlay } from '../../../ui/Overlay';
import { usePresence, type PresenceStatus } from '../../../ui/use-presence';
import { ProjectSidebar } from '../../../ui/ProjectSidebar';
import styles from './ManuscriptDraftMode.module.css';
import { ManuscriptEditorAgentPanel } from './ManuscriptEditorAgentPanel';
import { RichDraftEditor, type RichDraftEditorHandle, type RichDraftEditorHistoryState } from './RichDraftEditor';
import {
  chapterToDraftText,
  countDraftParagraphs,
  countWords,
  nextChapterNumber,
  toParagraphInputs,
  type DraftChapterListItem,
  type FormatAction,
} from './manuscript-draft-model';
import * as manuscriptModeApi from '../../../entities/manuscript/api';

type LoadStatus = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden';
type RailTab = 'structure' | 'notes' | 'chat';
type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'published' | 'error';
type DisplayTheme = 'light' | 'sepia' | 'dark';

interface DraftPageProps {
  api: ManuscriptApiClient;
  navigate: (path: string, query?: Record<string, string | undefined>) => void;
  onLogout: () => void;
  route: AppRoute;
  userName: string;
}

const newChapterTitle = 'Новая глава';
const autosaveDelayMs = 800;

export function ManuscriptDraftMode({ api, navigate, onLogout, route, userName }: DraftPageProps) {
  const routeSignature = route.query.toString();
  const isNewChapter = route.query.get('newChapter') === '1' || route.path.includes('/draft/new-chapter');
  const requestedChapterId = isNewChapter ? '' : route.query.get('chapterId') ?? route.params.id ?? '';
  const requestedProjectId = route.query.get('projectId');
  const requestedBookId = route.query.get('bookId');
  const [project, setProject] = useState<Project | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [canCreateChats, setCanCreateChats] = useState(false);
  const [canEditManuscript, setCanEditManuscript] = useState(false);
  const [chapters, setChapters] = useState<DraftChapterListItem[]>([]);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState(route.query.get('chatId') ?? '');
  const [agentComposer, setAgentComposer] = useState('');
  const [agentNotice, setAgentNotice] = useState('');
  const [agentActionId, setAgentActionId] = useState<string | null>(null);
  const [selectedDraftExcerpt, setSelectedDraftExcerpt] = useState('');
  const [editorHistory, setEditorHistory] = useState<RichDraftEditorHistoryState>({ canRedo: false, canUndo: false });
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [sessionStatus, setSessionStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [chatNotice, setChatNotice] = useState('');
  const [railTab, setRailTab] = useState<RailTab>(toRailTab(route.query.get('pane')));
  const [draftTitle, setDraftTitle] = useState(isNewChapter ? newChapterTitle : 'Черновик');
  const [draftText, setDraftText] = useState('');
  const [savedText, setSavedText] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [displaySize, setDisplaySize] = useState(18);
  const [displayTheme, setDisplayTheme] = useState<DisplayTheme>('light');
  const [readMode, setReadMode] = useState(false);
  const [noteMode, setNoteMode] = useState<'add' | 'edit' | 'delete' | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchStatus, setSearchStatus] = useState<LoadStatus>('ready');
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; kind: string; title: string; excerpt: string; locator: ReaderLocator }>>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [compact, setCompact] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth <= 700));
  const searchPresence = usePresence(searchOpen);
  const notePresence = usePresence(noteMode);
  const editorRef = useRef<RichDraftEditorHandle | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const saveRequestIdRef = useRef(0);
  const draftTextRef = useRef(draftText);
  const draftTitleRef = useRef(draftTitle);
  const chapterRef = useRef(chapter);
  const bookRef = useRef(book);
  const workspaceQuery = manuscriptModeApi.useManuscriptDraftWorkspaceQuery(api, {
    bookId: requestedBookId,
    chapterId: requestedChapterId,
    isNewChapter,
    projectId: requestedProjectId,
  });
  const createChapterMutation = manuscriptModeApi.useCreateChapterMutation(api);
  const getChapterMutation = manuscriptModeApi.useGetChapterMutation(api);
  const updateChapterMutation = manuscriptModeApi.useUpdateChapterMutation(api);
  const publishChapterMutation = manuscriptModeApi.usePublishChapterMutation(api);
  const searchProjectMutation = manuscriptModeApi.useSearchProjectMutation(api);
  const createChatMutation = manuscriptModeApi.useCreateChatSessionMutation(api);
  const logoutMutation = manuscriptModeApi.useLogoutMutation(api);
  const agentSuggestionsQuery = manuscriptModeApi.useChapterAgentSuggestionsQuery(api, chapter?.id ?? '');
  const startAgentRunMutation = manuscriptModeApi.useStartAgentRunMutation(api);
  const approveSuggestionMutation = manuscriptModeApi.useApproveAgentSuggestionMutation(api);
  const rejectSuggestionMutation = manuscriptModeApi.useRejectAgentSuggestionMutation(api);
  const createAnnotationMutation = manuscriptModeApi.useCreateChapterAnnotationMutation(api);
  const updateAnnotationMutation = manuscriptModeApi.useUpdateReaderAnnotationMutation(api);
  const deleteAnnotationMutation = manuscriptModeApi.useDeleteReaderAnnotationMutation(api);
  const agentSuggestions = agentSuggestionsQuery.data?.data ?? [];
  const agentPanelStatus: 'idle' | 'loading' | 'error' = agentSuggestionsQuery.isPending && Boolean(chapter)
    ? 'loading'
    : agentSuggestionsQuery.isError
      ? 'error'
      : 'idle';

  useEffect(() => {
    function syncCompact() {
      setCompact(window.innerWidth <= 700);
    }
    syncCompact();
    window.addEventListener('resize', syncCompact);
    return () => window.removeEventListener('resize', syncCompact);
  }, []);

  useEffect(() => {
    setRailTab(toRailTab(route.query.get('pane')));
  }, [route.query, routeSignature]);

  useEffect(() => {
    draftTextRef.current = draftText;
  }, [draftText]);

  useEffect(() => {
    draftTitleRef.current = draftTitle;
  }, [draftTitle]);

  useEffect(() => {
    chapterRef.current = chapter;
  }, [chapter]);

  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  useEffect(() => {
    return () => clearAutosaveTimer();
  }, []);

  useEffect(() => {
    if (workspaceQuery.isPending) {
      clearAutosaveTimer();
      setCanCreateChats(false);
      setCanEditManuscript(false);
      setStatus('loading');
      setError('');
      return;
    }

    if (workspaceQuery.isError) {
      setCanCreateChats(false);
      setCanEditManuscript(false);
      setError(formatError(workspaceQuery.error, 'Не удалось открыть черновик.'));
      setStatus(isForbidden(workspaceQuery.error) ? 'forbidden' : 'error');
      setSessionStatus('error');
      return;
    }

    const workspace = workspaceQuery.data;
    clearAutosaveTimer();
    setProject(workspace.project);
    setBook(workspace.book);
    setCanCreateChats(workspace.canCreateChats);
    setCanEditManuscript(workspace.canEditManuscript);
    if (!workspace.canEditManuscript) {
      setReadMode(true);
    }
    setSessions(workspace.sessions);
    setSessionStatus(workspace.sessions.length > 0 ? 'ready' : 'empty');
    setActiveChatId((current) => workspace.sessions.find((chat) => chat.id === current)?.id ?? workspace.sessions[0]?.id ?? '');
    setChapters(workspace.chapters);

    if (!workspace.project || !workspace.book) {
      setChapter(null);
      setAnnotations([]);
      setStatus('empty');
      return;
    }

    if (isNewChapter) {
      setChapter(null);
      setAnnotations([]);
      setDraftTitle(newChapterTitle);
      setDraftText('');
      setSavedText('');
      setSaveState('saved');
    } else if (!workspace.chapter) {
      setChapter(null);
      setAnnotations([]);
      setStatus('empty');
      return;
    } else {
      setChapter(workspace.chapter);
      setAnnotations(workspace.annotations);
      setDraftTitle(workspace.chapter.title);
      const nextText = chapterToDraftText(workspace.chapter);
      setDraftText(nextText);
      setSavedText(nextText);
      setSaveState('saved');
    }
    setStatus('ready');
  }, [isNewChapter, workspaceQuery.data, workspaceQuery.error, workspaceQuery.isError, workspaceQuery.isPending]);

  useEffect(() => {
    if (status !== 'ready' || !canEditManuscript || isNewChapter || saveState !== 'dirty' || !chapter || !book) {
      return;
    }
    clearAutosaveTimer();
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveDraft('autosave');
    }, autosaveDelayMs);
    return () => clearAutosaveTimer();
  }, [book, canEditManuscript, chapter, draftText, draftTitle, isNewChapter, saveState, status]);

  const chapterNumber = isNewChapter ? nextChapterNumber(chapters) : chapter?.navigation.displayNumber ?? '';
  const visibleTitle = `${chapterNumber ? `${chapterNumber}. ` : ''}${draftTitle || newChapterTitle}`;
  const wordCount = countWords(draftText);
  const paragraphCount = countDraftParagraphs(draftText);
  const savedAtLabel = chapter?.savedAt ? formatRelativeTime(chapter.savedAt) : '';
  const saveLabel =
    saveState === 'dirty'
      ? 'Есть несохранённые правки'
      : saveState === 'saving'
        ? 'Сохраняем...'
        : saveState === 'conflict'
          ? 'Конфликт версии'
          : saveState === 'error'
            ? 'Сохранение не удалось'
            : saveState === 'published'
              ? 'Глава опубликована'
              : savedAtLabel
                ? `Черновик сохранён · ${savedAtLabel}`
                : 'Черновик сохранён';
  const projectTitle = project?.title ?? 'Проект';
  const projectMeta = formatProjectMeta(project);
  const currentChapterId = chapter?.id ?? requestedChapterId;
  const bookLabel = book ? formatBookLabel(book) : 'Книга';
  const activeAnnotation = annotations.find((annotation) => annotation.id === activeNoteId) ?? null;
  const noteParagraphId = chapter?.paragraphs.find((paragraph) => paragraph.kind !== 'heading')?.id ?? chapter?.paragraphs[0]?.id ?? '';
  const editorReadMode = readMode || !canEditManuscript;

  function navigateDraft(overrides: Record<string, string | undefined>) {
    navigate('/manuscript/books', {
      projectId: project?.id ?? undefined,
      bookId: book?.id ?? undefined,
      mode: 'draft',
      chapterId: isNewChapter ? undefined : currentChapterId,
      newChapter: isNewChapter ? '1' : undefined,
      pane: railTab === 'structure' ? undefined : railTab,
      ...overrides,
    });
  }

  function updateDraftText(nextText: string) {
    if (!canEditManuscript) {
      return;
    }
    setDraftText(nextText);
    setSaveState(nextText === savedText ? 'saved' : 'dirty');
  }

  function formatSelection(action: FormatAction) {
    if (!canEditManuscript) {
      setNotice('Редактирование рукописи доступно редактору, администратору или владельцу проекта.');
      return;
    }
    editorRef.current?.format(action);
  }

  function clearAutosaveTimer() {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }

  async function saveDraft(trigger: 'manual' | 'autosave' = 'manual') {
    if (trigger === 'manual') {
      clearAutosaveTimer();
    }
    if (!canEditManuscript) {
      setNotice('Редактирование рукописи доступно редактору, администратору или владельцу проекта.');
      return null;
    }
    const targetBook = bookRef.current;
    const targetChapter = chapterRef.current;
    const snapshotText = draftTextRef.current;
    const snapshotTitle = draftTitleRef.current.trim() || newChapterTitle;
    const snapshotChapterNumber = chapterNumber || nextChapterNumber(chapters);
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    if (!targetBook) return null;
    setSaveState('saving');
    setNotice('');
    try {
      if (isNewChapter && !targetChapter) {
        const created = await createChapterMutation.mutateAsync({
          bookId: targetBook.id,
          body: {
            title: snapshotTitle,
            afterChapterId: chapters.at(-1)?.id ?? null,
            paragraphs: toParagraphInputs(snapshotText, snapshotChapterNumber, snapshotTitle),
          },
        });
        if (requestId !== saveRequestIdRef.current) {
          return created;
        }
        setChapter(created);
        if (draftTextRef.current === snapshotText && (draftTitleRef.current.trim() || newChapterTitle) === snapshotTitle) {
          setSavedText(snapshotText);
          setSaveState('saved');
        } else {
          setSaveState('dirty');
        }
        setNotice('Новая глава создана в черновиках.');
        navigate('/manuscript/books', {
          projectId: project?.id ?? undefined,
          bookId: targetBook.id,
          mode: 'draft',
          chapterId: created.id,
          newChapter: undefined,
        });
        return created;
      }

      const draftChapter = targetChapter ?? (requestedChapterId ? await getChapterMutation.mutateAsync(requestedChapterId) : null);
      if (!draftChapter) {
        return null;
      }
      const updated = await updateChapterMutation.mutateAsync({
        chapterId: draftChapter.id,
        body: {
          title: snapshotTitle || draftChapter.title,
          paragraphs: toParagraphInputs(
            snapshotText,
            draftChapter.navigation.displayNumber,
            snapshotTitle || draftChapter.title,
            draftChapter.paragraphs,
          ),
          expectedRevision: draftChapter.draftRevision,
        },
      });
      if (requestId !== saveRequestIdRef.current) {
        return updated;
      }
      setChapter(updated);
      if (draftTextRef.current === snapshotText && (draftTitleRef.current.trim() || newChapterTitle) === snapshotTitle) {
        setSavedText(snapshotText);
        setSaveState('saved');
        if (trigger === 'manual') {
          setNotice('Черновик сохранён.');
        }
      } else {
        setSaveState('dirty');
      }
      return updated;
    } catch (nextError) {
      if (requestId !== saveRequestIdRef.current) {
        return null;
      }
      if (draftTextRef.current !== snapshotText || (draftTitleRef.current.trim() || newChapterTitle) !== snapshotTitle) {
        setSaveState('dirty');
        return null;
      }
      setSaveState(isConflict(nextError) ? 'conflict' : 'error');
      setNotice(formatError(nextError, 'Не удалось сохранить черновик.'));
      return null;
    }
  }

  async function publishDraft() {
    if (!canEditManuscript) {
      setNotice('Публикация доступна редактору, администратору или владельцу проекта.');
      return;
    }
    const saved = saveState === 'dirty' || saveState === 'conflict' || saveState === 'error' ? await saveDraft('manual') : chapter;
    if (!saved) return;
    try {
      const published = await publishChapterMutation.mutateAsync({
        chapterId: saved.id,
        body: { expectedDraftRevision: saved.draftRevision },
      });
      setChapter(published);
      setSaveState('published');
      setNotice('Глава опубликована из актуального черновика.');
    } catch (nextError) {
      setSaveState(isConflict(nextError) ? 'conflict' : 'error');
      setNotice(formatError(nextError, 'Не удалось опубликовать черновик.'));
    }
  }

  async function loadServerVersion() {
    const targetChapter = chapterRef.current;
    if (!targetChapter) return;
    try {
      const fresh = await getChapterMutation.mutateAsync(targetChapter.id);
      setChapter(fresh);
      const nextText = chapterToDraftText(fresh);
      setDraftText(nextText);
      setSavedText(nextText);
      setDraftTitle(fresh.title);
      setSaveState('saved');
      setNotice('Загружена версия с сервера. Локальные правки заменены.');
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось загрузить версию с сервера.'));
    }
  }

  async function overwriteWithLocalVersion() {
    const targetChapter = chapterRef.current;
    if (!targetChapter) return;
    if (!canEditManuscript) {
      setNotice('Редактирование рукописи доступно редактору, администратору или владельцу проекта.');
      return;
    }
    const snapshotText = draftTextRef.current;
    const snapshotTitle = draftTitleRef.current.trim() || newChapterTitle;
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    clearAutosaveTimer();
    setSaveState('saving');
    setNotice('');
    try {
      const fresh = await getChapterMutation.mutateAsync(targetChapter.id);
      const updated = await updateChapterMutation.mutateAsync({
        chapterId: fresh.id,
        body: {
          title: snapshotTitle || fresh.title,
          paragraphs: toParagraphInputs(
            snapshotText,
            fresh.navigation.displayNumber,
            snapshotTitle || fresh.title,
            fresh.paragraphs,
          ),
          expectedRevision: fresh.draftRevision,
        },
      });
      if (requestId !== saveRequestIdRef.current) {
        return;
      }
      setChapter(updated);
      if (draftTextRef.current === snapshotText && (draftTitleRef.current.trim() || newChapterTitle) === snapshotTitle) {
        setSavedText(snapshotText);
        setSaveState('saved');
        setNotice('Ваша версия сохранена поверх актуальной серверной ревизии.');
      } else {
        setSaveState('dirty');
      }
    } catch (nextError) {
      if (requestId !== saveRequestIdRef.current) {
        return;
      }
      setSaveState(isConflict(nextError) ? 'conflict' : 'error');
      setNotice(formatError(nextError, 'Не удалось сохранить вашу версию.'));
    }
  }

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!project) return;
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
      const response = await searchProjectMutation.mutateAsync({ projectId: project.id, query });
      setSearchResults(response.data);
      setSearchStatus(response.data.length > 0 ? 'ready' : 'empty');
    } catch (nextError) {
      setSearchStatus('error');
      setSearchError(formatError(nextError, 'Поиск временно недоступен.'));
    }
  }

  function openSearchResult(locator: ReaderLocator) {
    setSearchOpen(false);
    navigate('/manuscript/books', {
      projectId: locator.projectId,
      bookId: locator.bookId,
      mode: 'read',
      chapterId: locator.chapterId,
      paragraphId: locator.paragraphId ?? undefined,
    });
  }

  function openProjectChat(chatId: string) {
    if (!project) return;
    setActiveChatId(chatId);
    navigate('/chat', { projectId: project.id, chatId });
  }

  async function createProjectChat() {
    if (!project) return;
    if (!canCreateChats) {
      setChatNotice('Создание чатов доступно редактору, администратору или владельцу проекта.');
      return;
    }
    try {
      const chat = await createChatMutation.mutateAsync({ projectId: project.id, title: 'Новый чат по саге' });
      setChatNotice('');
      setSessions((current) => [chat, ...current.filter((item) => item.id !== chat.id)]);
      setActiveChatId(chat.id);
      navigate('/chat', { projectId: project.id, chatId: chat.id });
    } catch (nextError) {
      setChatNotice(formatError(nextError, 'Не удалось создать чат.'));
    }
  }

  async function startAgentRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = agentComposer.trim();
    if (!prompt || !chapter) return;
    if (!canEditManuscript) {
      setAgentNotice('Агентские правки доступны редактору, администратору или владельцу проекта.');
      return;
    }
    if (saveState === 'dirty' || saveState === 'saving') {
      setAgentNotice('Сначала сохраните черновик, чтобы агент работал с актуальным текстом.');
      return;
    }
    setAgentNotice('');
    try {
      await startAgentRunMutation.mutateAsync({
        body: {
          prompt,
          expectedChapterRevision: chapter.draftRevision,
          selectionQuote: selectedDraftExcerpt.trim() || undefined,
        },
        chapterId: chapter.id,
        idempotencyKey: manuscriptModeApi.createIdempotencyKey('startAgentRun'),
      });
      setAgentComposer('');
    } catch (nextError) {
      setAgentNotice(formatError(nextError, 'Не удалось получить предложение агента.'));
    }
  }

  async function approveAgentSuggestion(suggestion: AgentSuggestion) {
    if (!chapter) return;
    if (!canEditManuscript) {
      setAgentNotice('Агентские правки доступны редактору, администратору или владельцу проекта.');
      return;
    }
    if (saveState === 'dirty' || saveState === 'saving') {
      setAgentNotice('Сначала сохраните черновик, затем применяйте предложение.');
      return;
    }
    setAgentActionId(suggestion.id);
    setAgentNotice('');
    try {
      const result = await approveSuggestionMutation.mutateAsync({
        suggestionId: suggestion.id,
        expectedChapterRevision: chapter.draftRevision,
      });
      if (result.chapter) {
        const updatedChapter = result.chapter;
        setChapter(updatedChapter);
        const nextText = chapterToDraftText(updatedChapter);
        setDraftText(nextText);
        setSavedText(nextText);
        setSaveState('saved');
        setNotice('Предложение агента применено к черновику.');
      }
    } catch (nextError) {
      setAgentNotice(formatError(nextError, isConflict(nextError) ? 'Глава изменилась — обновите черновик и повторите.' : 'Не удалось применить предложение.'));
    } finally {
      setAgentActionId(null);
    }
  }

  async function rejectAgentSuggestion(suggestion: AgentSuggestion) {
    if (!chapter) return;
    if (!canEditManuscript) {
      setAgentNotice('Агентские правки доступны редактору, администратору или владельцу проекта.');
      return;
    }
    setAgentActionId(suggestion.id);
    setAgentNotice('');
    try {
      await rejectSuggestionMutation.mutateAsync({
        expectedChapterRevision: chapter.draftRevision,
        suggestionId: suggestion.id,
      });
      setAgentNotice('Предложение отклонено.');
    } catch (nextError) {
      setAgentNotice(formatError(nextError, 'Не удалось отклонить предложение.'));
    } finally {
      setAgentActionId(null);
    }
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

  function openSearchPanel() {
    setSearchOpen(true);
    window.setTimeout(() => searchTriggerRef.current?.focus(), 0);
  }

  function changeDisplaySize(delta: number) {
    setDisplaySize((current) => Math.min(22, Math.max(16, current + delta)));
  }

  function openNote(mode: 'add' | 'edit' | 'delete', annotation?: ReaderAnnotation) {
    if (!canEditManuscript) {
      setNotice('Редактирование рукописи доступно редактору, администратору или владельцу проекта.');
      return;
    }
    setRailTab('notes');
    setActiveNoteId(annotation?.id ?? null);
    setNoteBody(mode === 'edit' ? annotation?.body ?? '' : '');
    setNoteMode(mode);
  }

  function closeNote() {
    setNoteMode(null);
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chapter || !project || !book || noteBody.trim().length === 0) {
      return;
    }
    if (!canEditManuscript) {
      setNotice('Редактирование рукописи доступно редактору, администратору или владельцу проекта.');
      closeNote();
      return;
    }
    const quote = activeAnnotation?.quote ?? selectedDraftExcerpt ?? '';
    try {
      if (noteMode === 'edit' && activeAnnotation) {
        const updated = await updateAnnotationMutation.mutateAsync({
          annotationId: activeAnnotation.id,
          body: { kind: 'note', quote, body: noteBody.trim(), color: activeAnnotation.color ?? '#FEF3C7', status: 'saved', tags: activeAnnotation.tags ?? ['continuity'] },
        });
        setAnnotations((current) => current.map((annotation) => (annotation.id === updated.id ? updated : annotation)));
        setNotice('Заметка обновлена.');
      } else {
        const locator: ReaderLocator = {
          projectId: project.id,
          bookId: book.id,
          chapterId: chapter.id,
          paragraphId: noteParagraphId || null,
          targetView: 'draft',
          revision: chapter.draftRevision,
          range: quote ? { startOffset: 0, endOffset: quote.length, quote } : null,
        };
        const created = await createAnnotationMutation.mutateAsync({
          chapterId: chapter.id,
          body: { kind: 'note', locator, quote: quote || null, body: noteBody.trim(), color: '#FEF3C7', tags: ['continuity'] },
        });
        setAnnotations((current) => [created, ...current]);
        setActiveNoteId(created.id);
        setNotice('Заметка добавлена к черновику.');
      }
      closeNote();
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось сохранить заметку.'));
    }
  }

  async function deleteNote() {
    if (!activeAnnotation) return;
    if (!canEditManuscript) {
      setNotice('Редактирование рукописи доступно редактору, администратору или владельцу проекта.');
      closeNote();
      return;
    }
    try {
      await deleteAnnotationMutation.mutateAsync(activeAnnotation.id);
      setAnnotations((current) => current.filter((annotation) => annotation.id !== activeAnnotation.id));
      setActiveNoteId(null);
      setNotice('Заметка удалена.');
      closeNote();
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось удалить заметку.'));
    }
  }

  if (status === 'loading') {
    return (
      <DraftLoadingShell
        accountOpen={accountMenuOpen}
        onAccountToggle={() => setAccountMenuOpen((value) => !value)}
        onLogout={() => void logout()}
        onOpenSearch={openSearchPanel}
        searchTriggerRef={searchTriggerRef}
        userName={userName}
      />
    );
  }

  if (status === 'empty') {
    return <main className={styles.statePage}>В проекте пока нет глав для черновика.</main>;
  }

  if (status === 'forbidden') {
    return (
      <main className={styles.statePage}>
        <h1>Нет доступа к этому черновику</h1>
        <p>{error || 'Нет доступа к этому проекту.'}</p>
        <button className={styles.primaryButton} onClick={() => navigate('/manuscript/books', { projectId: project?.id ?? undefined })} type="button">
          <ChevronLeft aria-hidden="true" size={17} />
          Вернуться к книгам
        </button>
      </main>
    );
  }

  if (status === 'error') {
    return <main className={styles.statePage}>{error}</main>;
  }

  const railProps: RailProps = {
    agentActionId,
    agentComposer,
    agentNotice,
    agentPanelStatus,
    agentRequesting: startAgentRunMutation.isPending,
    agentSuggestions,
    annotations,
    canEditManuscript,
    currentChapterId,
    displaySize,
    displayTheme,
    draftTitle: visibleTitle,
    isNewChapter,
    onAddNote: () => openNote('add'),
    onApproveSuggestion: (suggestion) => void approveAgentSuggestion(suggestion),
    onDeleteNote: (annotation) => openNote('delete', annotation),
    onEditNote: (annotation) => openNote('edit', annotation),
    onNewChapter: () => {
      if (!canEditManuscript) {
        setNotice('Редактирование рукописи доступно редактору, администратору или владельцу проекта.');
        return;
      }
      navigate('/manuscript/books', { mode: 'draft', newChapter: '1', projectId: project?.id ?? undefined, bookId: book?.id ?? undefined });
    },
    onOpenChapter: (chapterId) =>
      navigate('/manuscript/books', { mode: 'draft', chapterId, projectId: project?.id ?? undefined, bookId: book?.id ?? undefined }),
    onRejectSuggestion: (suggestion) => void rejectAgentSuggestion(suggestion),
    onSetDisplaySize: changeDisplaySize,
    onSetDisplayTheme: setDisplayTheme,
    onSetTab: (tab) => {
      setRailTab(tab);
      navigateDraft({ pane: tab === 'structure' ? undefined : tab, chatId: undefined });
    },
    onSendAgentMessage: startAgentRun,
    onSetAgentComposer: setAgentComposer,
    selectedDraftExcerpt,
    structureChapters: chapters,
    structureDraft: { displayNumber: chapterNumber, id: currentChapterId, title: draftTitle || newChapterTitle },
    tab: railTab,
  };

  const surface = compact ? (
    <MobileDraftSurface
      draftText={draftText}
      editorRef={editorRef}
      formatSelection={formatSelection}
      canEditManuscript={canEditManuscript}
      notice={notice}
      onBack={() => navigate('/manuscript/books', { projectId: project?.id ?? undefined, bookId: book?.id ?? undefined })}
      onChangeText={updateDraftText}
      onDraftMode={() => {
        if (!canEditManuscript) {
          setNotice('Редактирование рукописи доступно редактору, администратору или владельцу проекта.');
          return;
        }
        setReadMode(false);
      }}
      onHistoryStateChange={setEditorHistory}
      onPublish={() => void publishDraft()}
      onReadMode={() => setReadMode(true)}
      onSave={() => void saveDraft('manual')}
      onSelectionTextChange={setSelectedDraftExcerpt}
      rail={railProps}
      readMode={editorReadMode}
      saveLabel={saveLabel}
      title={visibleTitle}
    />
  ) : (
    <main className={styles.workspace} data-design-node="BKEvY" data-display-theme={displayTheme}>
      <GlobalBar
        accountOpen={accountMenuOpen}
        onAccountToggle={() => setAccountMenuOpen((value) => !value)}
        onLogout={() => void logout()}
        onOpenSearch={openSearchPanel}
        searchTriggerRef={searchTriggerRef}
        userName={userName}
      />

      <div className={styles.body}>
        <ProjectSidebar
          active="manuscript"
          activeChatId={activeChatId}
          canCreateChat={canCreateChats}
          chatNotice={chatNotice}
          onChat={() => navigate('/chat', { projectId: project?.id ?? undefined, chatId: activeChatId || undefined })}
          onCreateChat={() => void createProjectChat()}
          onManuscript={() => navigate('/manuscript/books', { projectId: project?.id ?? undefined, bookId: book?.id ?? undefined })}
          onSelectChat={openProjectChat}
          projectMeta={projectMeta}
          projectTitle={projectTitle}
          sessions={sessions}
          sessionStatus={sessionStatus}
        />

        <section className={editorReadMode ? `${styles.editor} ${styles.editorReading}` : styles.editor} aria-label="Черновик главы">
          <Breadcrumb
            bookLabel={bookLabel}
            onBack={() => navigate('/manuscript/books', { projectId: project?.id ?? undefined, bookId: book?.id ?? undefined })}
            projectTitle={projectTitle}
          />
          <DraftHeader
            bookLabel={bookLabel}
            canEditManuscript={canEditManuscript}
            isNewChapter={isNewChapter}
            onDraftMode={() => {
              if (!canEditManuscript) {
                setNotice('Редактирование рукописи доступно редактору, администратору или владельцу проекта.');
                return;
              }
              setReadMode(false);
            }}
            onReadMode={() => setReadMode(true)}
            readMode={editorReadMode}
            title={visibleTitle}
          />
          {editorReadMode ? null : <FormatToolbar formatSelection={formatSelection} redoDisabled={!editorHistory.canRedo} undoDisabled={!editorHistory.canUndo} />}
          <EditorBody
            displaySize={displaySize}
            draftText={draftText}
            editable={!editorReadMode && canEditManuscript}
            editorRef={editorRef}
            onChangeText={updateDraftText}
            onHistoryStateChange={setEditorHistory}
            onSave={() => void saveDraft('manual')}
            onSelectionTextChange={setSelectedDraftExcerpt}
          />
          <DraftFooter canPublish={canEditManuscript} onPublish={() => void publishDraft()} paragraphCount={paragraphCount} saveLabel={saveLabel} saveState={saveState} wordCount={wordCount} />
        </section>

        <RightPane {...railProps} />
      </div>

      {saveState === 'conflict' ? (
        <div className={styles.conflictBanner} role="alert">
          <span>Черновик изменился в другом месте. Ваши правки сохранены здесь — выберите версию.</span>
          <div className={styles.conflictActions}>
            <button className={styles.secondaryButton} onClick={() => void loadServerVersion()} type="button">
              Загрузить версию сервера
            </button>
            <button className={styles.primaryButton} disabled={!canEditManuscript} onClick={() => void overwriteWithLocalVersion()} type="button">
              Сохранить мою версию
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <p className={styles.notice}>{notice}</p> : null}

      {searchPresence.mounted ? (
        <SearchPanel
          state={searchPresence.status}
          onClose={() => {
            setSearchOpen(false);
            searchTriggerRef.current?.focus();
          }}
          onOpenResult={openSearchResult}
          onRunSearch={runSearch}
          results={searchResults}
          searchError={searchError}
          searchStatus={searchStatus}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
        />
      ) : null}

    </main>
  );

  return (
    <>
      {surface}
      {notePresence.mounted && notePresence.value ? (
        <NoteLayer
          state={notePresence.status}
          annotation={activeAnnotation}
          mode={notePresence.value}
          noteBody={noteBody}
          onClose={closeNote}
          onDelete={() => void deleteNote()}
          onSave={saveNote}
          quote={activeAnnotation?.quote ?? selectedDraftExcerpt}
          setNoteBody={setNoteBody}
        />
      ) : null}
    </>
  );
}

function DraftLoadingShell({
  accountOpen,
  onAccountToggle,
  onLogout,
  onOpenSearch,
  searchTriggerRef,
  userName,
}: {
  accountOpen: boolean;
  onAccountToggle: () => void;
  onLogout: () => void;
  onOpenSearch: () => void;
  searchTriggerRef: RefObject<HTMLButtonElement | null>;
  userName: string;
}) {
  return (
    <main className={styles.workspace} aria-busy="true" data-design-node="BKEvY">
      <GlobalBar
        accountOpen={accountOpen}
        onAccountToggle={onAccountToggle}
        onLogout={onLogout}
        onOpenSearch={onOpenSearch}
        searchTriggerRef={searchTriggerRef}
        userName={userName}
      />
      <div className={styles.body}>
        <aside className={styles.sidebar} aria-hidden="true">
          <span className={styles.loadingLine} data-width="wide" />
          <span className={styles.loadingLine} data-width="medium" />
          <span className={styles.loadingLine} data-width="wide" />
          <span className={styles.loadingLine} data-width="short" />
          <span className={styles.loadingLine} data-width="medium" />
        </aside>

        <section className={styles.editor} aria-label="Черновик главы">
          <div className={styles.breadcrumb}>
            <span className={styles.loadingLine} data-width="short" />
            <span className={styles.loadingLine} data-width="medium" />
          </div>
          <header className={styles.docHeader}>
            <div className={styles.loadingTitleBlock}>
              <span className={styles.loadingLine} data-width="short" />
              <span className={styles.loadingLine} data-width="wide" />
            </div>
            <span className={styles.loadingPill} />
          </header>
          <div className={styles.formatToolbar} aria-hidden="true">
            <span className={styles.loadingTool} />
            <span className={styles.loadingTool} />
            <span className={styles.loadingTool} />
            <span className={styles.loadingTool} />
          </div>
          <div className={styles.scroll}>
            <div className={styles.loadingEditorBlock}>
              <span className={styles.loadingLine} data-width="wide" />
              <span className={styles.loadingLine} data-width="wide" />
              <span className={styles.loadingLine} data-width="medium" />
              <span className={styles.loadingLine} data-width="wide" />
              <span className={styles.loadingLine} data-width="short" />
            </div>
          </div>
          <footer className={styles.draftFooter}>
            <span className={styles.loadingLine} data-width="medium" />
            <span className={styles.loadingPill} />
          </footer>
        </section>

        <aside className={styles.rightPane} aria-hidden="true">
          <div className={styles.tabs}>
            <span className={styles.loadingTab} />
            <span className={styles.loadingTab} />
          </div>
          <div className={styles.loadingRightBody}>
            <span className={styles.loadingLine} data-width="wide" />
            <span className={styles.loadingLine} data-width="medium" />
            <span className={styles.loadingLine} data-width="wide" />
          </div>
          <div className={styles.loadingRightFooter}>
            <span className={styles.loadingLine} data-width="medium" />
          </div>
        </aside>
      </div>
    </main>
  );
}

function GlobalBar({
  accountOpen,
  onAccountToggle,
  onLogout,
  onOpenSearch,
  searchTriggerRef,
  userName,
}: {
  accountOpen: boolean;
  onAccountToggle: () => void;
  onLogout: () => void;
  onOpenSearch: () => void;
  searchTriggerRef: RefObject<HTMLButtonElement | null>;
  userName: string;
}) {
  const accountPresence = usePresence(accountOpen);
  return (
    <header className={styles.globalBar}>
      <p className={styles.brand}>Canon Keeper</p>
      <button aria-label="Глобальный поиск" className={styles.globalSearchButton} onClick={onOpenSearch} ref={searchTriggerRef} type="button">
        <Search aria-hidden="true" size={16} />
        <span>Глобальный поиск</span>
      </button>
      <div className={styles.barActions}>
        <button className={styles.cabinetButton} onClick={onAccountToggle} type="button">
          <Grid2X2 aria-hidden="true" size={16} />
          Личный кабинет
        </button>
        <button aria-label="Аккаунт" className={styles.avatarButton} onClick={onAccountToggle} type="button">
          {userName.slice(0, 1)}
        </button>
      </div>
      {accountPresence.mounted ? (
        <div className={styles.accountMenu} data-pop="" data-state={accountPresence.status}>
          <p>{userName}</p>
          <button className={styles.menuItem} onClick={onLogout} type="button">
            <LogOut aria-hidden="true" size={17} />
            Выйти
          </button>
        </div>
      ) : null}
    </header>
  );
}

function Breadcrumb({ bookLabel, onBack, projectTitle }: { bookLabel: string; onBack: () => void; projectTitle: string }) {
  return (
    <nav className={styles.breadcrumb} aria-label="Хлебные крошки">
      <button className={styles.crumbBack} onClick={onBack} type="button">
        <ChevronLeft aria-hidden="true" size={15} />
        Рукопись
      </button>
      <ChevronRight aria-hidden="true" className={styles.crumbSep} size={14} />
      <span>{projectTitle}</span>
      <ChevronRight aria-hidden="true" className={styles.crumbSep} size={14} />
      <strong>{bookLabel}</strong>
    </nav>
  );
}

function formatBookLabel(book: Book) {
  return book.displayNumber ? `Книга ${book.displayNumber}` : book.title;
}

function DraftHeader({
  bookLabel,
  canEditManuscript,
  isNewChapter,
  onDraftMode,
  onReadMode,
  readMode,
  title,
}: {
  bookLabel: string;
  canEditManuscript: boolean;
  isNewChapter: boolean;
  onDraftMode: () => void;
  onReadMode: () => void;
  readMode: boolean;
  title: string;
}) {
  const eyebrow = isNewChapter
    ? 'ЧЕРНОВИК · НОВАЯ ГЛАВА'
    : `${readMode ? 'ЧТЕНИЕ' : 'ЧЕРНОВИК'} · ${bookLabel.toUpperCase()}`;
  return (
    <header className={styles.docHeader}>
      <div className={styles.titleBlock}>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <div className={styles.modeToggle} role="group" aria-label="Режим главы">
        <button aria-pressed={readMode} className={readMode ? styles.segmentActive : styles.segmentGhost} onClick={onReadMode} type="button">
          Чтение
        </button>
        <button aria-pressed={!readMode} className={readMode ? styles.segmentGhost : styles.segmentActive} disabled={!canEditManuscript} onClick={onDraftMode} type="button">
          Черновик
        </button>
      </div>
    </header>
  );
}

function FormatToolbar({
  formatSelection,
  redoDisabled,
  undoDisabled,
}: {
  formatSelection: (action: FormatAction) => void;
  redoDisabled: boolean;
  undoDisabled: boolean;
}) {
  return (
    <div className={styles.formatToolbar} role="toolbar" aria-label="Форматирование черновика">
      <ToolButton action="undo" disabled={undoDisabled} icon={<Undo2 aria-hidden="true" size={16} />} label="Отменить" onClick={formatSelection} />
      <ToolButton action="redo" disabled={redoDisabled} icon={<Redo2 aria-hidden="true" size={16} />} label="Повторить" onClick={formatSelection} />
      <span className={styles.toolbarSep} />
      <ToolButton action="bold" icon={<Bold aria-hidden="true" size={16} />} label="Жирный" onClick={formatSelection} />
      <ToolButton action="italic" icon={<Italic aria-hidden="true" size={16} />} label="Курсив" onClick={formatSelection} />
      <span className={styles.toolbarSep} />
      <ToolButton action="heading" icon={<Heading aria-hidden="true" size={16} />} label="Заголовок" onClick={formatSelection} />
      <ToolButton action="quote" icon={<Quote aria-hidden="true" size={16} />} label="Цитата" onClick={formatSelection} />
      <ToolButton action="list" icon={<List aria-hidden="true" size={16} />} label="Список" onClick={formatSelection} />
      <span className={styles.toolbarSep} />
      <ToolButton action="link" icon={<Link aria-hidden="true" size={16} />} label="Ссылка" onClick={formatSelection} />
    </div>
  );
}

function ToolButton({
  action,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  action: FormatAction;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: (action: FormatAction) => void;
}) {
  return (
    <button aria-label={label} className={styles.toolButton} disabled={disabled} onClick={() => onClick(action)} title={label} type="button">
      {icon}
    </button>
  );
}

function EditorBody({
  displaySize,
  draftText,
  editable,
  editorRef,
  onChangeText,
  onHistoryStateChange,
  onSave,
  onSelectionTextChange,
}: {
  displaySize: number;
  draftText: string;
  editable: boolean;
  editorRef: RefObject<RichDraftEditorHandle | null>;
  onChangeText: (value: string) => void;
  onHistoryStateChange: (state: RichDraftEditorHistoryState) => void;
  onSave: () => void;
  onSelectionTextChange: (text: string) => void;
}) {
  return (
    <div className={styles.scroll}>
      <div className={styles.editorMeasure}>
        <RichDraftEditor
          ariaLabel="Текст черновика"
          displaySize={displaySize}
          editable={editable}
          hint={editable ? 'Продолжайте писать главу...' : ''}
          onChangeMarkdown={onChangeText}
          onHistoryStateChange={onHistoryStateChange}
          onSave={onSave}
          onSelectionTextChange={onSelectionTextChange}
          ref={editorRef}
          value={draftText}
        />
      </div>
    </div>
  );
}

function DraftFooter({
  canPublish,
  onPublish,
  paragraphCount,
  saveLabel,
  saveState,
  wordCount,
}: {
  canPublish: boolean;
  onPublish: () => void;
  paragraphCount: number;
  saveLabel: string;
  saveState: SaveState;
  wordCount: number;
}) {
  return (
    <footer className={styles.draftFooter}>
      <span className={styles.saveStatus} data-state={saveState}>
        <CheckCircle2 aria-hidden="true" size={15} />
        {saveLabel}
      </span>
      <span className={styles.count}>
        {wordCount} слов · {paragraphCount} абзаца
      </span>
      <button className={styles.publishButton} disabled={!canPublish} onClick={onPublish} type="button">
        <Upload aria-hidden="true" size={16} />
        Опубликовать
      </button>
    </footer>
  );
}

type RailProps = {
  agentActionId: string | null;
  agentComposer: string;
  agentNotice: string;
  agentPanelStatus: 'idle' | 'loading' | 'error';
  agentRequesting: boolean;
  agentSuggestions: AgentSuggestion[];
  annotations: ReaderAnnotation[];
  canEditManuscript: boolean;
  currentChapterId: string;
  displaySize: number;
  displayTheme: DisplayTheme;
  draftTitle: string;
  isNewChapter: boolean;
  onAddNote: () => void;
  onApproveSuggestion: (suggestion: AgentSuggestion) => void;
  onDeleteNote: (annotation: ReaderAnnotation) => void;
  onEditNote: (annotation: ReaderAnnotation) => void;
  onNewChapter: () => void;
  onOpenChapter: (chapterId: string) => void;
  onRejectSuggestion: (suggestion: AgentSuggestion) => void;
  onSetDisplaySize: (delta: number) => void;
  onSetDisplayTheme: (theme: DisplayTheme) => void;
  onSetTab: (tab: RailTab) => void;
  onSendAgentMessage: (event: FormEvent<HTMLFormElement>) => void;
  onSetAgentComposer: (value: string) => void;
  selectedDraftExcerpt: string;
  structureChapters: DraftChapterListItem[];
  structureDraft: { displayNumber: string; id: string; title: string };
  tab: RailTab;
};

function RightPane({
  agentActionId,
  agentComposer,
  agentNotice,
  agentPanelStatus,
  agentRequesting,
  agentSuggestions,
  annotations,
  canEditManuscript,
  currentChapterId,
  displaySize,
  displayTheme,
  draftTitle,
  isNewChapter,
  onAddNote,
  onApproveSuggestion,
  onDeleteNote,
  onEditNote,
  onNewChapter,
  onOpenChapter,
  onRejectSuggestion,
  onSetDisplaySize,
  onSetDisplayTheme,
  onSetTab,
  onSendAgentMessage,
  onSetAgentComposer,
  selectedDraftExcerpt,
  structureChapters,
  structureDraft,
  tab,
  variant = 'rail',
}: RailProps & { variant?: 'rail' | 'sheet' }) {
  const rootClass =
    variant === 'sheet'
      ? styles.railSheetPanel
      : tab === 'chat'
        ? `${styles.rightPane} ${styles.rightPaneAgent}`
        : styles.rightPane;
  return (
    <aside className={rootClass}>
      <div className={styles.tabs} role="tablist" aria-label="Правая панель черновика">
        <TabButton active={tab === 'structure'} label="Структура" onClick={() => onSetTab('structure')} />
        <TabButton active={tab === 'notes'} label="Заметки" onClick={() => onSetTab('notes')} />
        <TabButton active={tab === 'chat'} label="Чат" onClick={() => onSetTab('chat')} />
      </div>
      <div className={styles.railBody}>
        {tab === 'structure' ? (
          <StructureList
            currentChapterId={currentChapterId}
            canEditManuscript={canEditManuscript}
            isNewChapter={isNewChapter}
            onNewChapter={onNewChapter}
            onOpenChapter={onOpenChapter}
            structureChapters={structureChapters}
            structureDraft={structureDraft}
          />
        ) : null}
        {tab === 'notes' ? <NotesList annotations={annotations} canEditManuscript={canEditManuscript} onAddNote={onAddNote} onDeleteNote={onDeleteNote} onEditNote={onEditNote} /> : null}
        {tab === 'chat' ? (
          <ManuscriptEditorAgentPanel
            composerValue={agentComposer}
            canEdit={canEditManuscript}
            draftTitle={draftTitle}
            notice={agentNotice}
            onApprove={onApproveSuggestion}
            onChangeComposer={onSetAgentComposer}
            onReject={onRejectSuggestion}
            onSendMessage={onSendAgentMessage}
            pendingActionId={agentActionId}
            requesting={agentRequesting}
            selectedExcerpt={selectedDraftExcerpt}
            status={agentPanelStatus}
            suggestions={agentSuggestions}
          />
        ) : null}
      </div>
      {tab === 'chat' ? null : (
        <div className={styles.displaySettings} aria-label="Отображение">
          <p className={styles.sectionLabel}>ОТОБРАЖЕНИЕ</p>
          <div className={styles.settingRow}>
            <span>Размер текста</span>
            <div className={styles.stepper}>
              <button aria-label="Уменьшить текст" onClick={() => onSetDisplaySize(-1)} type="button">
                <Minus aria-hidden="true" size={14} />
              </button>
              <span>{displaySize}</span>
              <button aria-label="Увеличить текст" onClick={() => onSetDisplaySize(1)} type="button">
                <Plus aria-hidden="true" size={14} />
              </button>
            </div>
          </div>
          <div className={styles.settingRow}>
            <span>Тема</span>
            <div className={styles.themeDots}>
              <button aria-label="Светлая тема" className={displayTheme === 'light' ? styles.themeDotActive : styles.themeDotLight} onClick={() => onSetDisplayTheme('light')} type="button" />
              <button aria-label="Сепия" className={displayTheme === 'sepia' ? styles.themeDotActive : styles.themeDotSepia} onClick={() => onSetDisplayTheme('sepia')} type="button" />
              <button aria-label="Тёмная тема" className={displayTheme === 'dark' ? styles.themeDotActive : styles.themeDotDark} onClick={() => onSetDisplayTheme('dark')} type="button" />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button aria-selected={active} className={active ? styles.tabActive : styles.tabButton} onClick={onClick} role="tab" type="button">
      {label}
    </button>
  );
}

function StructureList({
  canEditManuscript,
  currentChapterId,
  isNewChapter,
  onNewChapter,
  onOpenChapter,
  structureChapters,
  structureDraft,
}: {
  canEditManuscript: boolean;
  currentChapterId: string;
  isNewChapter: boolean;
  onNewChapter: () => void;
  onOpenChapter: (chapterId: string) => void;
  structureChapters: DraftChapterListItem[];
  structureDraft: { displayNumber: string; id: string; title: string };
}) {
  return (
    <nav className={styles.structureList} aria-label="Структура книги">
      {structureChapters
        .filter((item) => item.status === 'published')
        .map((item) => (
          <button className={styles.structureItem} key={item.id} onClick={() => onOpenChapter(item.id)} type="button">
            <span>
              {item.displayNumber}. {item.title}
            </span>
          </button>
        ))}
      <p className={styles.structureLabel}>ЧЕРНОВИКИ</p>
      <button
        className={styles.structureActive}
        onClick={() => {
          if (!isNewChapter) onOpenChapter(currentChapterId);
        }}
        type="button"
      >
        <PenLine aria-hidden="true" size={15} />
        <span>
          {structureDraft.displayNumber}. {structureDraft.title}
        </span>
      </button>
      <button className={styles.addChapterButton} disabled={isNewChapter || !canEditManuscript} onClick={onNewChapter} type="button">
        <Plus aria-hidden="true" size={15} />
        Новая глава
      </button>
    </nav>
  );
}

function NotesList({
  annotations,
  canEditManuscript,
  onAddNote,
  onDeleteNote,
  onEditNote,
}: {
  annotations: ReaderAnnotation[];
  canEditManuscript: boolean;
  onAddNote: () => void;
  onDeleteNote: (annotation: ReaderAnnotation) => void;
  onEditNote: (annotation: ReaderAnnotation) => void;
}) {
  return (
    <div className={styles.notesList}>
      <button className={styles.addNoteButton} disabled={!canEditManuscript} onClick={onAddNote} type="button">
        <Plus aria-hidden="true" size={16} />
        Добавить заметку
      </button>
      {annotations.length === 0 ? <p className={styles.muted}>Нет заметок к черновику.</p> : null}
      {annotations.map((annotation) => (
        <article className={styles.noteCard} key={annotation.id}>
          <div className={styles.noteCardText}>
            <p>{annotation.body ?? annotation.quote ?? 'Заметка'}</p>
            {annotation.quote ? <span>«{annotation.quote}»</span> : null}
          </div>
          <div className={styles.noteCardActions}>
            <button aria-label="Редактировать заметку" className={styles.noteIconButton} disabled={!canEditManuscript} onClick={() => onEditNote(annotation)} type="button">
              <PenLine aria-hidden="true" size={15} />
            </button>
            <button aria-label="Удалить заметку" className={styles.noteIconButton} disabled={!canEditManuscript} onClick={() => onDeleteNote(annotation)} type="button">
              <Trash2 aria-hidden="true" size={15} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function NoteLayer({
  annotation,
  mode,
  noteBody,
  onClose,
  onDelete,
  onSave,
  quote,
  setNoteBody,
  state,
}: {
  annotation: ReaderAnnotation | null;
  mode: 'add' | 'edit' | 'delete';
  noteBody: string;
  onClose: () => void;
  onDelete: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  quote: string;
  setNoteBody: (value: string) => void;
  state: PresenceStatus;
}) {
  const title = mode === 'add' ? 'Новая заметка' : mode === 'edit' ? 'Редактировать заметку' : 'Удалить заметку';
  return (
    <LayerPortal>
      <div className={styles.noteLayer} data-overlay-scrim="" data-state={state}>
        <Overlay kind="dialog" label={title} onDismiss={onClose} state={state}>
          {mode === 'delete' ? (
            <section className={styles.noteModal}>
              <div className={styles.noteModalHeader}>
                <h2>Удалить заметку?</h2>
                <button aria-label="Закрыть" className={styles.noteIconButton} onClick={onClose} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <p className={styles.muted}>Заметка «{annotation?.body ?? 'без текста'}» будет удалена.</p>
              <div className={styles.noteModalActions}>
                <button className={styles.secondaryButton} onClick={onClose} type="button">
                  Отмена
                </button>
                <button className={styles.dangerButton} onClick={onDelete} type="button">
                  Удалить
                </button>
              </div>
            </section>
          ) : (
            <form className={styles.noteModal} onSubmit={onSave}>
              <div className={styles.noteModalHeader}>
                <h2>{title}</h2>
                <button aria-label="Закрыть" className={styles.noteIconButton} onClick={onClose} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              {quote ? <blockquote className={styles.noteQuote}>«{quote}»</blockquote> : null}
              <label className={styles.noteField}>
                Текст заметки
                <textarea aria-label="Текст заметки" onChange={(event) => setNoteBody(event.target.value)} value={noteBody} />
              </label>
              <div className={styles.noteModalActions}>
                <button className={styles.secondaryButton} onClick={onClose} type="button">
                  Отмена
                </button>
                <button className={styles.primaryButton} disabled={noteBody.trim().length === 0} type="submit">
                  Сохранить
                </button>
              </div>
            </form>
          )}
        </Overlay>
      </div>
    </LayerPortal>
  );
}

function LayerPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

function MobileDraftSurface({
  canEditManuscript,
  draftText,
  editorRef,
  formatSelection,
  notice,
  onBack,
  onChangeText,
  onDraftMode,
  onHistoryStateChange,
  onPublish,
  onReadMode,
  onSave,
  onSelectionTextChange,
  rail,
  readMode,
  saveLabel,
  title,
}: {
  canEditManuscript: boolean;
  draftText: string;
  editorRef: RefObject<RichDraftEditorHandle | null>;
  formatSelection: (action: FormatAction) => void;
  notice: string;
  onBack: () => void;
  onChangeText: (value: string) => void;
  onDraftMode: () => void;
  onHistoryStateChange: (state: RichDraftEditorHistoryState) => void;
  onPublish: () => void;
  onReadMode: () => void;
  onSave: () => void;
  onSelectionTextChange: (text: string) => void;
  rail: RailProps;
  readMode: boolean;
  saveLabel: string;
  title: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetPresence = usePresence(sheetOpen);
  const noteCount = rail.annotations.length;
  return (
    <main
      className={readMode ? `${styles.mobileSurface} ${styles.mobileSurfaceReading}` : styles.mobileSurface}
      data-design-node="CBrrx"
      data-display-theme={rail.displayTheme}
    >
      <header className={styles.mobileTop}>
        <div className={styles.mobileTitleWrap}>
          <button aria-label="Назад" className={styles.mobileBack} onClick={onBack} type="button">
            <ChevronLeft aria-hidden="true" size={22} />
          </button>
          <h1>{title.replace(' к записи', '')}</h1>
        </div>
        <div className={styles.mobileTopActions}>
          <button aria-label="Панель главы" className={styles.mobilePanelButton} onClick={() => setSheetOpen(true)} type="button">
            <PanelRight aria-hidden="true" size={20} />
            {noteCount > 0 ? <span className={styles.mobilePanelBadge}>{noteCount}</span> : null}
          </button>
          <button className={styles.mobilePublish} disabled={!canEditManuscript} onClick={onPublish} type="button">
            <Upload aria-hidden="true" size={14} />
            Публикация
          </button>
        </div>
      </header>
      <div className={styles.mobileSubbar}>
        <div className={styles.modeToggle} role="group" aria-label="Режим главы">
          <button aria-pressed={readMode} className={readMode ? styles.segmentActive : styles.segmentGhost} onClick={onReadMode} type="button">
            Чтение
          </button>
          <button aria-pressed={!readMode} className={readMode ? styles.segmentGhost : styles.segmentActive} disabled={!canEditManuscript} onClick={onDraftMode} type="button">
            Черновик
          </button>
        </div>
        <span>{saveLabel.replace('Черновик сохранён · ', 'Сохранёно · ')}</span>
      </div>
      <section className={styles.mobileEditor}>
        {notice ? <p className={styles.mobileNotice}>{notice}</p> : null}
        <RichDraftEditor
          ariaLabel="Текст черновика"
          displaySize={rail.displaySize}
          editable={!readMode && canEditManuscript}
          hint={readMode || !canEditManuscript ? '' : 'Продолжайте писать главу...'}
          onChangeMarkdown={onChangeText}
          onHistoryStateChange={onHistoryStateChange}
          onSave={onSave}
          onSelectionTextChange={onSelectionTextChange}
          ref={editorRef}
          value={draftText}
        />
      </section>
      {readMode || !canEditManuscript ? null : (
        <nav className={styles.mobileFormatBar} aria-label="Форматирование черновика">
          <ToolButton action="bold" icon={<Bold aria-hidden="true" size={16} />} label="Жирный" onClick={formatSelection} />
          <ToolButton action="italic" icon={<Italic aria-hidden="true" size={16} />} label="Курсив" onClick={formatSelection} />
          <ToolButton action="heading" icon={<Heading aria-hidden="true" size={16} />} label="Заголовок" onClick={formatSelection} />
          <ToolButton action="quote" icon={<Quote aria-hidden="true" size={16} />} label="Цитата" onClick={formatSelection} />
          <ToolButton action="list" icon={<List aria-hidden="true" size={16} />} label="Список" onClick={formatSelection} />
          <ToolButton action="link" icon={<Link aria-hidden="true" size={16} />} label="Ссылка" onClick={formatSelection} />
        </nav>
      )}
      {sheetPresence.mounted ? (
        <MobileRailSheet displayTheme={rail.displayTheme} onClose={() => setSheetOpen(false)} rail={rail} state={sheetPresence.status} />
      ) : null}
    </main>
  );
}

function MobileRailSheet({
  displayTheme,
  onClose,
  rail,
  state,
}: {
  displayTheme: DisplayTheme;
  onClose: () => void;
  rail: RailProps;
  state: PresenceStatus;
}) {
  return (
    <LayerPortal>
      <div className={styles.mobileSheetScrim} data-overlay-scrim="" data-state={state} onClick={onClose}>
        <Overlay kind="sheet" label="Панель главы" onDismiss={onClose} state={state}>
          <div className={styles.mobileSheet} data-display-theme={displayTheme} onClick={(event) => event.stopPropagation()}>
            <div className={styles.mobileSheetHandle}>
              <span className={styles.mobileSheetGrip} aria-hidden="true" />
              <button aria-label="Закрыть панель" className={styles.noteIconButton} onClick={onClose} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <RightPane {...rail} variant="sheet" />
          </div>
        </Overlay>
      </div>
    </LayerPortal>
  );
}

function SearchPanel({
  onClose,
  onOpenResult,
  onRunSearch,
  results,
  searchError,
  searchStatus,
  searchTerm,
  setSearchTerm,
  state,
}: {
  onClose: () => void;
  onOpenResult: (locator: ReaderLocator) => void;
  onRunSearch: (event?: FormEvent<HTMLFormElement>) => void;
  results: Array<{ id: string; kind: string; title: string; excerpt: string; locator: ReaderLocator }>;
  searchError: string;
  searchStatus: LoadStatus;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  state: PresenceStatus;
}) {
  return (
    <section
      className={styles.searchPanel}
      data-pop="center"
      data-state={state}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <form className={styles.searchForm} onSubmit={onRunSearch}>
        <input aria-label="Запрос поиска" onChange={(event) => setSearchTerm(event.target.value)} value={searchTerm} />
        <button className={styles.primaryButton} type="submit">
          Найти
        </button>
        <button aria-label="Закрыть поиск" className={styles.iconOnlyButton} onClick={onClose} type="button">
          <X aria-hidden="true" size={18} />
        </button>
      </form>
      <div className={styles.searchResults}>
        {searchStatus === 'loading' ? <p className={styles.muted}>Ищем...</p> : null}
        {searchStatus === 'empty' ? <p className={styles.muted}>Ничего не найдено.</p> : null}
        {searchStatus === 'error' ? <p className={styles.muted}>{searchError}</p> : null}
        {results.map((result) => (
          <button className={styles.searchResult} key={result.id} onClick={() => onOpenResult(result.locator)} type="button">
            <strong>{result.title}</strong>
            <span>{searchResultKindLabel(result.kind)}</span>
            <p>{result.excerpt}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function toRailTab(value: string | null): RailTab {
  if (value === 'notes' || value === 'chat') {
    return value;
  }
  return 'structure';
}

function isForbidden(error: unknown) {
  return isApiStatusFailure(error) && error.status === 403;
}

function isConflict(error: unknown) {
  return isApiStatusFailure(error) && error.status === 409;
}

function formatError(error: unknown, fallback: string) {
  return publicApiErrorMessage(error, fallback, {
    conflict: 'Черновик изменился в другом окне.',
    forbidden: 'Нет доступа к этому черновику.',
    unauthorized: 'Сессия истекла. Войдите снова, и мы вернем вас к черновику.',
  });
}
