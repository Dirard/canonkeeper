import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Grid2X2,
  LogOut,
  Menu,
  MessageSquare,
  Minus,
  NotebookPen,
  PanelRight,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserCircle,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type {
  Book,
  Chapter,
  ChapterListItem,
  ChatSession,
  ManuscriptApiClient,
  Project,
  ReaderAnnotation,
  ReaderLocator,
} from '../../../entities/manuscript/api';
import { isApiStatusFailure, publicApiErrorMessage } from '../../../entities/api-errors';
import {
  type ReaderDisplaySize,
  type ReaderDisplayTheme,
  useReaderPreferencesStore,
} from '../../../entities/manuscript/display-preferences-store';
import type { AppRoute } from '../../../shared/navigation/app-route';
import { formatProjectMeta, searchResultKindLabel } from '../../../ui/copy';
import { Overlay } from '../../../ui/Overlay';
import { usePresence, type PresenceStatus } from '../../../ui/use-presence';
import { ProjectSidebar, type ProjectSidebarProps } from '../../../ui/ProjectSidebar';
import { ReaderCore } from '../../reader/ReaderCore';
import * as manuscriptModeApi from '../../../entities/manuscript/api';
import styles from './ManuscriptReaderMode.module.css';

type LoadStatus = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden';
type RailTab = 'contents' | 'notes';
type NoteMode = 'add' | 'edit' | 'delete';
type MobilePanel = 'chapters' | 'notes';

interface ReaderPageProps {
  api: ManuscriptApiClient;
  navigate: (path: string, query?: Record<string, string | undefined>) => void;
  onLogout: () => void;
  route: AppRoute;
  userName: string;
}

export function ManuscriptReaderMode({ api, navigate, onLogout, route, userName }: ReaderPageProps) {
  const routeSignature = route.query.toString();
  const requestedChapterId = route.query.get('chapterId') ?? route.params.id ?? '';
  const requestedProjectId = route.query.get('projectId');
  const requestedBookId = route.query.get('bookId');
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState(route.query.get('chatId') ?? '');
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [sessionStatus, setSessionStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [chatNotice, setChatNotice] = useState('');
  const [railTab, setRailTab] = useState<RailTab>(toRailTab(route.query.get('pane')));
  const [noteMode, setNoteMode] = useState<NoteMode | null>(toNoteMode(route.query.get('note')));
  const [activeAnnotationId, setActiveAnnotationId] = useState(route.query.get('annotationId'));
  const [noteBody, setNoteBody] = useState('');
  const [selectedParagraphId, setSelectedParagraphId] = useState(route.query.get('paragraphId') ?? '');
  const { displaySize, displayTheme, hydrateReaderPreferences, setDisplaySize, setDisplayTheme } = useReaderPreferencesStore();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(route.query.get('chapters') === 'open' ? 'chapters' : null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(route.query.get('menu') === 'open');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchStatus, setSearchStatus] = useState<LoadStatus>('ready');
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; kind: string; title: string; excerpt: string; locator: ReaderLocator }>>([]);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workspaceQuery = manuscriptModeApi.useManuscriptReaderWorkspaceQuery(api, {
    bookId: requestedBookId,
    chapterId: requestedChapterId,
    projectId: requestedProjectId,
  });
  const updateAnnotationMutation = manuscriptModeApi.useUpdateReaderAnnotationMutation(api);
  const createAnnotationMutation = manuscriptModeApi.useCreateChapterAnnotationMutation(api);
  const deleteAnnotationMutation = manuscriptModeApi.useDeleteReaderAnnotationMutation(api);
  const searchProjectMutation = manuscriptModeApi.useSearchProjectMutation(api);
  const getChatSessionMutation = manuscriptModeApi.useGetChatSessionMutation(api);
  const createChatMutation = manuscriptModeApi.useCreateChatSessionMutation(api);
  const selectProjectMutation = manuscriptModeApi.useGetProjectMutation(api);
  const logoutMutation = manuscriptModeApi.useLogoutMutation(api);

  useEffect(() => {
    hydrateReaderPreferences();
  }, [hydrateReaderPreferences]);

  useEffect(() => {
    setRailTab(toRailTab(route.query.get('pane')));
    setNoteMode(toNoteMode(route.query.get('note')));
    setActiveAnnotationId(route.query.get('annotationId'));
    setSelectedParagraphId(route.query.get('paragraphId') ?? '');
    setMobileMenuOpen(route.query.get('menu') === 'open');
    setMobilePanel(route.query.get('chapters') === 'open' ? 'chapters' : route.query.get('notes') === 'open' ? 'notes' : null);
  }, [routeSignature, route.query]);

  useEffect(() => {
    if (workspaceQuery.isPending) {
      setStatus('loading');
      setSessionStatus('loading');
      setError('');
      return;
    }

    if (workspaceQuery.isError) {
      const message = formatError(workspaceQuery.error, 'Не удалось открыть главу.');
      setError(message);
      setStatus(isForbidden(workspaceQuery.error) ? 'forbidden' : 'error');
      setSessionStatus('error');
      return;
    }

    const workspace = workspaceQuery.data;
    setProjects(workspace.projects);
    setProject(workspace.project);
    setBook(workspace.book);
    setChapters(workspace.chapters);
    setChapter(workspace.chapter);
    setAnnotations(workspace.annotations);
    setSessions(workspace.sessions);
    setSessionStatus(workspace.sessions.length > 0 ? 'ready' : 'empty');
    setActiveChatId((current) => workspace.sessions.find((chat) => chat.id === current)?.id ?? workspace.sessions[0]?.id ?? '');
    if (workspace.loadError) {
      const message = formatError(workspace.loadError, 'Не удалось открыть главу.');
      setError(message);
      setStatus(isForbidden(workspace.loadError) ? 'forbidden' : 'error');
      return;
    }
    setStatus(workspace.project && workspace.book && workspace.chapter ? 'ready' : 'empty');
  }, [workspaceQuery.data, workspaceQuery.error, workspaceQuery.isError, workspaceQuery.isPending]);

  useEffect(() => {
    if (!chapter) {
      return;
    }
    if (selectedParagraphId && chapter.paragraphs.some((paragraph) => paragraph.id === selectedParagraphId)) {
      return;
    }
    const firstParagraph = chapter.paragraphs.find((paragraph) => paragraph.kind !== 'heading');
    if (firstParagraph) {
      setSelectedParagraphId(firstParagraph.id);
    }
  }, [chapter, selectedParagraphId]);

  useEffect(() => {
    if (noteMode === 'add') {
      setActiveAnnotationId(null);
      setNoteBody('');
      return;
    }
    if (noteMode === 'edit' || noteMode === 'delete') {
      const requestedAnnotation = annotations.find((annotation) => annotation.id === route.query.get('annotationId')) ?? annotations[0] ?? null;
      setActiveAnnotationId(requestedAnnotation?.id ?? null);
      if (noteMode === 'edit') {
        setNoteBody(requestedAnnotation?.body ?? '');
      }
    }
  }, [annotations, noteMode, route.query, routeSignature]);

  const firstReadableParagraph = chapter?.paragraphs.find((paragraph) => paragraph.kind !== 'heading') ?? null;
  const selectedParagraph = chapter?.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? firstReadableParagraph;
  const effectiveParagraphId = selectedParagraph?.id ?? selectedParagraphId;
  const activeAnnotation = annotations.find((annotation) => annotation.id === activeAnnotationId) ?? annotations[0] ?? null;
  const selectedQuote = selectedParagraph?.text ?? activeAnnotation?.quote ?? '';
  const readerLocator = buildLocator(
    project?.id ?? '',
    book?.id ?? '',
    chapter?.id ?? requestedChapterId,
    effectiveParagraphId,
    selectedQuote,
    chapter?.revision ?? null,
    activeAnnotation?.id,
  );
  const projectTitle = project?.title ?? 'Проект';
  const projectMeta = formatProjectMeta(project);
  const bookLabel = book ? formatBookLabel(book) : 'Книга';
  const chapterLabel = chapter ? `Глава ${chapter.navigation.displayNumber}` : 'Глава';
  const visibleTitle = chapter ? `${chapterLabel}. ${chapter.title}` : 'Чтение';

  function navigateReader(overrides: Record<string, string | undefined>) {
    navigate('/manuscript/books', {
      projectId: project?.id ?? undefined,
      bookId: book?.id ?? undefined,
      mode: 'read',
      chapterId: chapter?.id ?? requestedChapterId,
      paragraphId: effectiveParagraphId || undefined,
      pane: railTab === 'notes' ? 'notes' : undefined,
      note: noteMode ?? undefined,
      annotationId: activeAnnotationId ?? undefined,
      chapters: mobilePanel === 'chapters' ? 'open' : undefined,
      notes: mobilePanel === 'notes' ? 'open' : undefined,
      ...overrides,
    });
  }

  function selectParagraph(locator: ReaderLocator, quote: string) {
    const nextParagraphId = locator.paragraphId ?? effectiveParagraphId;
    setSelectedParagraphId(nextParagraphId);
    setNotice(`Выбран фрагмент: ${quote}`);
    navigateReader({ paragraphId: nextParagraphId, note: noteMode ?? undefined });
  }

  function openNote(mode: NoteMode, annotation?: ReaderAnnotation) {
    setRailTab('notes');
    setNoteMode(mode);
    setActiveAnnotationId(annotation?.id ?? null);
    setNoteBody(mode === 'edit' ? annotation?.body ?? '' : '');
    navigateReader({
      annotationId: annotation?.id,
      note: mode,
      pane: 'notes',
      paragraphId: annotation?.locator.paragraphId ?? (effectiveParagraphId || undefined),
    });
  }

  function closeNote() {
    setNoteMode(null);
    navigateReader({ annotationId: undefined, note: undefined, pane: 'notes' });
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chapter || !project || !book || !effectiveParagraphId || noteBody.trim().length === 0) {
      return;
    }

    const locator = buildLocator(project.id, book.id, chapter.id, effectiveParagraphId, selectedQuote, chapter.revision, activeAnnotationId);
    try {
      if (noteMode === 'edit' && activeAnnotation) {
        const updated = await updateAnnotationMutation.mutateAsync({
          annotationId: activeAnnotation.id,
          body: {
            kind: 'note',
            quote: activeAnnotation.quote ?? selectedQuote,
            body: noteBody.trim(),
            color: activeAnnotation.color ?? '#FEF3C7',
            status: 'saved',
            tags: activeAnnotation.tags ?? ['continuity'],
          },
        });
        setAnnotations((current) => current.map((annotation) => (annotation.id === updated.id ? updated : annotation)));
        setNotice('Заметка обновлена без потери привязки к абзацу.');
      } else {
        const created = await createAnnotationMutation.mutateAsync({
          chapterId: chapter.id,
          body: {
            kind: 'note',
            locator,
            quote: selectedQuote,
            body: noteBody.trim(),
            color: '#FEF3C7',
            tags: ['continuity'],
          },
        });
        setAnnotations((current) => [created, ...current]);
        setActiveAnnotationId(created.id);
        setNotice('Заметка сохранена на выбранном фрагменте.');
      }
      closeNote();
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось сохранить заметку.'));
    }
  }

  async function deleteNote() {
    if (!activeAnnotation) {
      return;
    }
    try {
      await deleteAnnotationMutation.mutateAsync(activeAnnotation.id);
      const refreshed = annotations.filter((annotation) => annotation.id !== activeAnnotation.id);
      setAnnotations(refreshed);
      setActiveAnnotationId(refreshed[0]?.id ?? null);
      setNotice('Заметка удалена, чтение осталось на том же абзаце.');
      closeNote();
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось удалить заметку.'));
    }
  }

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!project) {
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
      const response = await searchProjectMutation.mutateAsync({ projectId: project.id, query });
      setSearchResults(response.data);
      setSearchStatus(response.data.length > 0 ? 'ready' : 'empty');
    } catch (nextError) {
      setSearchStatus('error');
      setSearchError(formatError(nextError, 'Поиск временно недоступен.'));
    }
  }

  function chatContextQuery(chatId?: string) {
    const currentChapterId = chapter?.id ?? requestedChapterId;
    const firstParagraphId = chapter?.paragraphs.find((paragraph) => paragraph.kind !== 'heading')?.id;
    return {
      projectId: project?.id ?? undefined,
      bookId: book?.id ?? requestedBookId ?? undefined,
      chapterId: currentChapterId || undefined,
      paragraphId: selectedParagraphId || firstParagraphId || undefined,
      chatId: chatId || activeChatId || undefined,
    };
  }

  async function selectChat(chatId: string) {
    if (!project) {
      return;
    }
    try {
      const chat = await getChatSessionMutation.mutateAsync(chatId);
      setActiveChatId(chat.id);
      navigate('/chat', chatContextQuery(chat.id));
    } catch (nextError) {
      setChatNotice(formatError(nextError, 'Не удалось открыть чат.'));
    }
  }

  async function createChat() {
    if (!project) {
      return;
    }
    try {
      const chat = await createChatMutation.mutateAsync({ projectId: project.id, title: 'Новый чат из читалки' });
      setSessions((current) => [chat, ...current]);
      setActiveChatId(chat.id);
      navigate('/chat', chatContextQuery(chat.id));
    } catch (nextError) {
      setChatNotice(formatError(nextError, 'Не удалось создать чат.'));
    }
  }

  async function selectProject(projectId: string) {
    try {
      const nextProject = await selectProjectMutation.mutateAsync(projectId);
      setProject(nextProject);
      setProjectMenuOpen(false);
      navigateReader({ projectId: nextProject.id });
    } catch (nextError) {
      setProjectMenuOpen(false);
      setNotice(formatError(nextError, 'Не удалось сменить проект.'));
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

  function openChapter(nextChapterId: string) {
    navigate('/manuscript/books', {
      projectId: project?.id ?? undefined,
      bookId: book?.id ?? undefined,
      mode: 'read',
      chapterId: nextChapterId,
      paragraphId: undefined,
      pane: railTab === 'notes' ? 'notes' : undefined,
    });
  }

  function openMobilePanel(panel: MobilePanel) {
    setMobilePanel(panel);
    setRailTab(panel === 'notes' ? 'notes' : 'contents');
    navigateReader({
      chapters: panel === 'chapters' ? 'open' : undefined,
      notes: panel === 'notes' ? 'open' : undefined,
      pane: panel === 'notes' ? 'notes' : undefined,
    });
  }

  function closeMobilePanel() {
    setMobilePanel(null);
    navigateReader({ chapters: undefined, notes: undefined });
  }

  function openSearchResult(locator: ReaderLocator) {
    setSearchOpen(false);
    setSelectedParagraphId(locator.paragraphId ?? '');
    navigate('/manuscript/books', {
      projectId: locator.projectId,
      bookId: locator.bookId,
      mode: 'read',
      chapterId: locator.chapterId,
      paragraphId: locator.paragraphId ?? undefined,
      pane: railTab === 'notes' ? 'notes' : undefined,
    });
  }

  function renderReaderSurface() {
    if (status === 'loading') {
      return <p className={styles.stateBox}>Открываем главу...</p>;
    }
    if (status === 'empty') {
      return <p className={styles.stateBox}>В проекте пока нет доступных глав для чтения.</p>;
    }
    if (status === 'forbidden') {
      return <ForbiddenState message={error} onBack={() => navigate('/manuscript/books', { projectId: project?.id ?? undefined })} />;
    }
    if (status === 'error') {
      return <p className={styles.stateBox}>{error}</p>;
    }
    return (
      <>
        <section className={styles.readingPane}>
          <header className={styles.readerTop}>
            <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
              <button onClick={() => navigate('/manuscript/books', { projectId: project?.id ?? undefined, bookId: book?.id ?? undefined })} type="button">
                Рукопись
              </button>
              <span>/</span>
              <button onClick={() => navigate('/manuscript/books', { projectId: project?.id ?? undefined, bookId: book?.id ?? undefined })} type="button">
                {bookLabel}
              </button>
              <span>/</span>
              <strong>{chapterLabel}</strong>
            </nav>
            <div className={styles.readerTitleBlock}>
              <h1>{visibleTitle}</h1>
              <p className={styles.readerMeta}>
                {chapter?.wordCount.toLocaleString('ru-RU')} слов · {chapter?.navigation.readingTimeMinutes} мин · ревизия {chapter?.revision}
              </p>
            </div>
            <div className={styles.topControls} aria-label="Настройки чтения">
              <button className={styles.secondaryButton} onClick={() => setDisplaySize(displaySize === 'normal' ? 'large' : 'normal')} type="button">
                <Settings2 aria-hidden="true" size={17} />
                Размер текста
              </button>
              <div className={styles.segmented} role="group" aria-label="Тема">
                <button aria-pressed={displayTheme === 'light'} className={displayTheme === 'light' ? styles.segmentActive : styles.segment} onClick={() => setDisplayTheme('light')} type="button">
                  Светлая
                </button>
                <button aria-pressed={displayTheme === 'sepia'} className={displayTheme === 'sepia' ? styles.segmentActive : styles.segment} onClick={() => setDisplayTheme('sepia')} type="button">
                  Сепия
                </button>
                <button aria-pressed={displayTheme === 'dark'} className={displayTheme === 'dark' ? styles.segmentActive : styles.segment} onClick={() => setDisplayTheme('dark')} type="button">
                  Тёмная
                </button>
              </div>
            </div>
          </header>

          {notice ? <p className={styles.notice}>{notice}</p> : null}

          <section className={styles.readerColumn} aria-label="Текст главы">
            <ReaderCore activeParagraphId={effectiveParagraphId} api={api} locator={readerLocator} mode="fullscreen" onParagraphSelect={selectParagraph} />
          </section>

          <footer className={styles.chapterNav} aria-label="Навигация по главам">
            <button
              className={styles.secondaryButton}
              disabled={!chapter?.navigation.previous}
              onClick={() => chapter?.navigation.previous && openChapter(chapter.navigation.previous.id)}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={17} />
              Предыдущая глава
            </button>
            <span>
              {chapter?.navigation.position} / {chapter?.navigation.total}
            </span>
            <button
              className={styles.secondaryButton}
              disabled={!chapter?.navigation.next}
              onClick={() => chapter?.navigation.next && openChapter(chapter.navigation.next.id)}
              type="button"
            >
              Следующая глава
              <ArrowRight aria-hidden="true" size={17} />
            </button>
          </footer>
        </section>

        <RightRail
          activeAnnotation={activeAnnotation}
          annotations={annotations}
          chapters={chapters}
          currentChapterId={chapter?.id ?? requestedChapterId}
          displaySize={displaySize}
          displayTheme={displayTheme}
          onAddNote={() => openNote('add')}
          onDeleteNote={(annotation) => openNote('delete', annotation)}
          onEditNote={(annotation) => openNote('edit', annotation)}
          onOpenChapter={openChapter}
          onSelectAnnotation={(annotation) => {
            setActiveAnnotationId(annotation.id);
            setSelectedParagraphId(annotation.locator.paragraphId ?? effectiveParagraphId);
            navigateReader({ annotationId: annotation.id, paragraphId: annotation.locator.paragraphId ?? effectiveParagraphId, pane: 'notes' });
          }}
          onSetDisplaySize={setDisplaySize}
          onSetDisplayTheme={setDisplayTheme}
          onSetTab={(tab) => {
            setRailTab(tab);
            navigateReader({ pane: tab === 'notes' ? 'notes' : undefined });
          }}
          selectedParagraphId={effectiveParagraphId}
          selectedQuote={selectedQuote}
          tab={railTab}
        />
      </>
    );
  }

  const sidebarProps: ProjectSidebarProps = {
    active: 'manuscript',
    activeChatId,
    chatNotice,
    onChat: () => navigate('/chat', chatContextQuery()),
    onCreateChat: () => void createChat(),
    onManuscript: () => navigate('/manuscript/books', { projectId: project?.id ?? undefined, bookId: book?.id ?? undefined }),
    onOpenProjectMenu: () => setProjectMenuOpen((value) => !value),
    onSelectChat: (chatId) => void selectChat(chatId),
    projectMeta,
    projectTitle,
    sessions,
    sessionStatus,
  };

  const searchPresence = usePresence(searchOpen);
  const accountPresence = usePresence(accountMenuOpen);
  const projectPresence = usePresence(projectMenuOpen);
  const mobileMenuPresence = usePresence(mobileMenuOpen);
  const mobilePanelPresence = usePresence(mobilePanel && status !== 'loading' ? mobilePanel : null);
  const notePresence = usePresence(noteMode);

  return (
    <main className={styles.workspace} data-display-size={displaySize} data-display-theme={displayTheme}>
      <header className={styles.globalBar}>
        <button aria-label="Открыть меню" className={styles.mobileMenuButton} onClick={() => setMobileMenuOpen(true)} type="button">
          <Menu aria-hidden="true" size={21} />
        </button>
        <p className={styles.brand}>
          <span className={styles.desktopBrand}>Canon Keeper</span>
          <span className={styles.mobileTitle}>{chapter?.title ?? 'Чтение'}</span>
        </p>
        <button
          aria-label="Глобальный поиск"
          className={styles.globalSearchButton}
          onClick={() => {
            setSearchOpen(true);
            window.setTimeout(() => searchTriggerRef.current?.focus(), 0);
          }}
          ref={searchTriggerRef}
          type="button"
        >
          <Search aria-hidden="true" size={16} />
          <span>Глобальный поиск</span>
        </button>
        <div className={styles.barActions}>
          <button className={styles.cabinetButton} onClick={() => setAccountMenuOpen((value) => !value)} type="button">
            <Grid2X2 aria-hidden="true" size={16} />
            Личный кабинет
          </button>
          <button aria-label="Аккаунт" className={styles.avatarButton} onClick={() => setAccountMenuOpen((value) => !value)} type="button">
            {userName.slice(0, 1)}
          </button>
        </div>

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

        {accountPresence.mounted ? (
          <div className={styles.accountMenu} data-pop="" data-state={accountPresence.status}>
            <p className={styles.accountName}>{userName}</p>
            <button className={styles.menuItem} onClick={() => setNotice('Настройки профиля вне объема этой сборки.')} type="button">
              <UserCircle aria-hidden="true" size={17} />
              Профиль
            </button>
            <button className={styles.menuItem} onClick={() => void logout()} type="button">
              <LogOut aria-hidden="true" size={17} />
              Выйти
            </button>
          </div>
        ) : null}
      </header>

      <div className={styles.body}>
        <ProjectSidebar {...sidebarProps} />

        <nav className={styles.tabletRail} aria-label="Планшетная навигация">
          <button aria-label="Поиск" className={styles.iconButton} onClick={() => setSearchOpen(true)} type="button">
            <Search aria-hidden="true" size={19} />
          </button>
          <button aria-label="Рукопись" className={styles.activeNavButton} onClick={() => navigate('/manuscript/books', { projectId: project?.id ?? undefined, bookId: book?.id ?? undefined })} type="button">
            <NotebookPen aria-hidden="true" size={19} />
          </button>
          <button aria-label="Чат" className={styles.iconButton} onClick={() => navigate('/chat', chatContextQuery())} type="button">
            <MessageSquare aria-hidden="true" size={19} />
          </button>
        </nav>

        <section className={styles.content} aria-label="Чтение рукописи">
          {renderReaderSurface()}
        </section>
      </div>

      <nav className={styles.mobileControls} aria-label="Мобильные действия чтения">
        <button onClick={() => openMobilePanel('chapters')} type="button">
          <BookOpen aria-hidden="true" size={18} />
          Главы
        </button>
        <button onClick={() => openMobilePanel('notes')} type="button">
          <NotebookPen aria-hidden="true" size={18} />
          Заметки
        </button>
        <button onClick={() => setDisplaySize(displaySize === 'normal' ? 'large' : 'normal')} type="button">
          <Settings2 aria-hidden="true" size={18} />
          Вид
        </button>
      </nav>

      {projectPresence.mounted ? (
        <div className={styles.projectMenu} data-pop="" data-state={projectPresence.status}>
          {projects.map((item) => (
            <button className={styles.menuItem} key={item.id} onClick={() => void selectProject(item.id)} type="button">
              {item.title}
            </button>
          ))}
        </div>
      ) : null}

      {mobileMenuPresence.mounted ? (
        <MobileMenu onClose={() => setMobileMenuOpen(false)} sidebar={sidebarProps} state={mobileMenuPresence.status} />
      ) : null}

      {mobilePanelPresence.mounted && mobilePanelPresence.value ? (
        <MobilePanelLayer
          state={mobilePanelPresence.status}
          annotations={annotations}
          chapters={chapters}
          currentChapterId={chapter?.id ?? requestedChapterId}
          onAddNote={() => openNote('add')}
          onClose={closeMobilePanel}
          onDeleteNote={(annotation) => openNote('delete', annotation)}
          onEditNote={(annotation) => openNote('edit', annotation)}
          onOpenChapter={openChapter}
          onSelectAnnotation={(annotation) => {
            setActiveAnnotationId(annotation.id);
            setSelectedParagraphId(annotation.locator.paragraphId ?? effectiveParagraphId);
            closeMobilePanel();
          }}
          panel={mobilePanelPresence.value}
        />
      ) : null}

      {notePresence.mounted && notePresence.value ? (
        <NoteLayer
          state={notePresence.status}
          annotation={activeAnnotation}
          mode={notePresence.value}
          noteBody={noteBody}
          onClose={closeNote}
          onDelete={() => void deleteNote()}
          onSave={(event) => void saveNote(event)}
          selectedParagraphId={activeAnnotation?.locator.paragraphId ?? effectiveParagraphId}
          selectedQuote={noteMode === 'edit' || noteMode === 'delete' ? activeAnnotation?.quote ?? selectedQuote : selectedQuote}
          setNoteBody={setNoteBody}
        />
      ) : null}
    </main>
  );
}

function RightRail({
  activeAnnotation,
  annotations,
  chapters,
  currentChapterId,
  displaySize,
  displayTheme,
  onAddNote,
  onDeleteNote,
  onEditNote,
  onOpenChapter,
  onSelectAnnotation,
  onSetDisplaySize,
  onSetDisplayTheme,
  onSetTab,
  selectedParagraphId,
  selectedQuote,
  tab,
}: {
  activeAnnotation: ReaderAnnotation | null;
  annotations: ReaderAnnotation[];
  chapters: ChapterListItem[];
  currentChapterId: string;
  displaySize: ReaderDisplaySize;
  displayTheme: ReaderDisplayTheme;
  onAddNote: () => void;
  onDeleteNote: (annotation: ReaderAnnotation) => void;
  onEditNote: (annotation: ReaderAnnotation) => void;
  onOpenChapter: (chapterId: string) => void;
  onSelectAnnotation: (annotation: ReaderAnnotation) => void;
  onSetDisplaySize: (size: ReaderDisplaySize) => void;
  onSetDisplayTheme: (theme: ReaderDisplayTheme) => void;
  onSetTab: (tab: RailTab) => void;
  selectedParagraphId: string;
  selectedQuote: string;
  tab: RailTab;
}) {
  return (
    <aside className={styles.rightRail} aria-label="Панель чтения">
      <div className={styles.railTabs} role="tablist" aria-label="Панель читалки">
        <button aria-selected={tab === 'contents'} className={tab === 'contents' ? styles.railTabActive : styles.railTab} onClick={() => onSetTab('contents')} role="tab" type="button">
          Содержание
        </button>
        <button aria-selected={tab === 'notes'} className={tab === 'notes' ? styles.railTabActive : styles.railTab} onClick={() => onSetTab('notes')} role="tab" type="button">
          Заметки
        </button>
      </div>

      {tab === 'contents' ? (
        <div className={styles.railBody}>
          <section>
            <p className={styles.sectionLabel}>Главы</p>
            <div className={styles.chapterList}>
              {chapters.map((chapter) => (
                <button
                  aria-current={chapter.id === currentChapterId ? 'page' : undefined}
                  className={chapter.id === currentChapterId ? styles.activeChapterButton : styles.chapterButton}
                  key={chapter.id}
                  onClick={() => onOpenChapter(chapter.id)}
                  type="button"
                >
                  <span>{chapter.displayNumber}</span>
                  <strong>{chapter.title}</strong>
                </button>
              ))}
            </div>
          </section>
          <section className={styles.controlsPanel}>
            <p className={styles.sectionLabel}>Вид</p>
            <div className={styles.stepper} aria-label="Размер текста">
              <button aria-label="Уменьшить текст" onClick={() => onSetDisplaySize('normal')} type="button">
                <Minus aria-hidden="true" size={16} />
              </button>
              <span>{displaySize === 'large' ? 'Крупный' : 'Обычный'}</span>
              <button aria-label="Увеличить текст" onClick={() => onSetDisplaySize('large')} type="button">
                <Plus aria-hidden="true" size={16} />
              </button>
            </div>
            <div className={styles.swatches} aria-label="Тема чтения">
              <button aria-label="Светлая тема" aria-pressed={displayTheme === 'light'} className={`${styles.swatch} ${styles.lightSwatch}`} onClick={() => onSetDisplayTheme('light')} type="button" />
              <button aria-label="Сепия" aria-pressed={displayTheme === 'sepia'} className={`${styles.swatch} ${styles.sepiaSwatch}`} onClick={() => onSetDisplayTheme('sepia')} type="button" />
              <button aria-label="Тёмная тема" aria-pressed={displayTheme === 'dark'} className={`${styles.swatch} ${styles.darkSwatch}`} onClick={() => onSetDisplayTheme('dark')} type="button" />
            </div>
          </section>
        </div>
      ) : (
        <NotesPanel
          activeAnnotation={activeAnnotation}
          annotations={annotations}
          onAddNote={onAddNote}
          onDeleteNote={onDeleteNote}
          onEditNote={onEditNote}
          onSelectAnnotation={onSelectAnnotation}
          selectedParagraphId={selectedParagraphId}
          selectedQuote={selectedQuote}
        />
      )}
    </aside>
  );
}

function NotesPanel({
  activeAnnotation,
  annotations,
  onAddNote,
  onDeleteNote,
  onEditNote,
  onSelectAnnotation,
  selectedParagraphId,
  selectedQuote,
}: {
  activeAnnotation: ReaderAnnotation | null;
  annotations: ReaderAnnotation[];
  onAddNote: () => void;
  onDeleteNote: (annotation: ReaderAnnotation) => void;
  onEditNote: (annotation: ReaderAnnotation) => void;
  onSelectAnnotation: (annotation: ReaderAnnotation) => void;
  selectedParagraphId: string;
  selectedQuote: string;
}) {
  return (
    <div className={styles.railBody}>
      <section className={styles.selectedExcerpt}>
        <p className={styles.sectionLabel}>Выбранный фрагмент</p>
        <blockquote>{selectedQuote}</blockquote>
        <span>{selectedParagraphId}</span>
        <button className={styles.primaryButton} onClick={onAddNote} type="button">
          <NotebookPen aria-hidden="true" size={17} />
          Добавить заметку
        </button>
      </section>
      <section>
        <p className={styles.sectionLabel}>Заметки · {annotations.length}</p>
        <div className={styles.noteList}>
          {annotations.length === 0 ? <p className={styles.muted}>В этой главе пока нет заметок.</p> : null}
          {annotations.map((annotation) => (
            <article className={annotation.id === activeAnnotation?.id ? styles.activeNoteCard : styles.noteCard} key={annotation.id}>
              <button className={styles.noteSelectButton} onClick={() => onSelectAnnotation(annotation)} type="button">
                <span>{annotation.locator.paragraphId ?? 'глава'}</span>
                <strong>{annotation.body ?? 'Закладка'}</strong>
                {annotation.quote ? <p>{annotation.quote}</p> : null}
              </button>
              <div className={styles.noteActions}>
                <button aria-label={`Редактировать заметку ${annotation.id}`} className={styles.iconButton} onClick={() => onEditNote(annotation)} type="button">
                  <NotebookPen aria-hidden="true" size={17} />
                </button>
                <button aria-label={`Удалить заметку ${annotation.id}`} className={styles.iconButton} onClick={() => onDeleteNote(annotation)} type="button">
                  <Trash2 aria-hidden="true" size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
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
  selectedParagraphId,
  selectedQuote,
  setNoteBody,
  state,
}: {
  annotation: ReaderAnnotation | null;
  mode: NoteMode;
  noteBody: string;
  onClose: () => void;
  onDelete: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  selectedParagraphId: string;
  selectedQuote: string;
  setNoteBody: (value: string) => void;
  state: PresenceStatus;
}) {
  const title = mode === 'add' ? 'Новая заметка' : mode === 'edit' ? 'Редактировать заметку' : 'Удалить заметку';
  return (
    <LayerPortal>
      <div className={styles.layer} data-overlay-scrim="" data-state={state}>
        <Overlay kind="dialog" label={title} onDismiss={onClose} state={state}>
          {mode === 'delete' ? (
            <section className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2>Удалить заметку?</h2>
                <button aria-label="Закрыть" className={styles.iconButton} onClick={onClose} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <p className={styles.modalCopy}>Заметка «{annotation?.body ?? 'без текста'}» будет удалена, но абзац и локатор останутся в главе.</p>
              <ExcerptBox paragraphId={selectedParagraphId} quote={selectedQuote} />
              <div className={styles.modalActions}>
                <button className={styles.secondaryButton} onClick={onClose} type="button">
                  Отмена
                </button>
                <button className={styles.dangerButton} onClick={onDelete} type="button">
                  Удалить
                </button>
              </div>
            </section>
          ) : (
            <form className={styles.modal} onSubmit={onSave}>
              <div className={styles.modalHeader}>
                <h2>{title}</h2>
                <button aria-label="Закрыть" className={styles.iconButton} onClick={onClose} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <ExcerptBox paragraphId={selectedParagraphId} quote={selectedQuote} />
              <label className={styles.fieldLabel}>
                Текст заметки
                <textarea aria-label="Текст заметки" onChange={(event) => setNoteBody(event.target.value)} value={noteBody} />
              </label>
              <div className={styles.modalActions}>
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

function ExcerptBox({ paragraphId, quote }: { paragraphId: string; quote: string }) {
  return (
    <div className={styles.excerptBox}>
      <p className={styles.sectionLabel}>Фрагмент</p>
      <blockquote>{quote}</blockquote>
      <span>Локатор: {paragraphId}</span>
    </div>
  );
}

function MobilePanelLayer({
  annotations,
  chapters,
  currentChapterId,
  onAddNote,
  onClose,
  onDeleteNote,
  onEditNote,
  onOpenChapter,
  onSelectAnnotation,
  panel,
  state,
}: {
  annotations: ReaderAnnotation[];
  chapters: ChapterListItem[];
  currentChapterId: string;
  onAddNote: () => void;
  onClose: () => void;
  onDeleteNote: (annotation: ReaderAnnotation) => void;
  onEditNote: (annotation: ReaderAnnotation) => void;
  onOpenChapter: (chapterId: string) => void;
  onSelectAnnotation: (annotation: ReaderAnnotation) => void;
  panel: MobilePanel;
  state: PresenceStatus;
}) {
  return (
    <LayerPortal>
      <div className={styles.drawerLayer} data-overlay-scrim="" data-state={state}>
        <Overlay kind="sheet" label={panel === 'chapters' ? 'Главы' : 'Заметки'} onDismiss={onClose} state={state}>
          <section className={styles.sheet}>
            <div className={styles.sheetHandle} />
            <button aria-label="Закрыть панель" className={styles.sheetCloseButton} onClick={onClose} type="button">
              <X aria-hidden="true" size={18} />
            </button>
            {panel === 'chapters' ? (
              <>
                <h2>Главы</h2>
                <div className={styles.chapterList}>
                  {chapters.map((chapter) => (
                    <button
                      aria-current={chapter.id === currentChapterId ? 'page' : undefined}
                      className={chapter.id === currentChapterId ? styles.activeChapterButton : styles.chapterButton}
                      key={chapter.id}
                      onClick={() => onOpenChapter(chapter.id)}
                      type="button"
                    >
                      <span>{chapter.displayNumber}</span>
                      <strong>{chapter.title}</strong>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className={styles.sheetTitleRow}>
                  <h2>Заметки</h2>
                  <button className={styles.primaryButton} onClick={onAddNote} type="button">
                    <Plus aria-hidden="true" size={17} />
                    Добавить
                  </button>
                </div>
                <div className={styles.noteList}>
                  {annotations.map((annotation) => (
                    <article className={styles.noteCard} key={annotation.id}>
                      <button className={styles.noteSelectButton} onClick={() => onSelectAnnotation(annotation)} type="button">
                        <span>{annotation.locator.paragraphId ?? 'глава'}</span>
                        <strong>{annotation.body ?? 'Заметка'}</strong>
                      </button>
                      <div className={styles.noteActions}>
                        <button aria-label={`Редактировать заметку ${annotation.id}`} className={styles.iconButton} onClick={() => onEditNote(annotation)} type="button">
                          <NotebookPen aria-hidden="true" size={17} />
                        </button>
                        <button aria-label={`Удалить заметку ${annotation.id}`} className={styles.iconButton} onClick={() => onDeleteNote(annotation)} type="button">
                          <Trash2 aria-hidden="true" size={17} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </Overlay>
      </div>
    </LayerPortal>
  );
}

function MobileMenu({ onClose, sidebar, state }: { onClose: () => void; sidebar: ProjectSidebarProps; state: PresenceStatus }) {
  return (
    <LayerPortal>
      <div className={styles.drawerLayer} data-overlay-scrim="" data-state={state}>
        <Overlay kind="drawer" label="Меню чтения" onDismiss={onClose} state={state}>
          <aside className={styles.mobileDrawer}>
            <div className={styles.drawerHeader}>
              <h2>Canon Keeper</h2>
              <button aria-label="Закрыть меню" className={styles.iconButton} onClick={onClose} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <ProjectSidebar {...sidebar} onOpenProjectMenu={undefined} variant="drawer" />
          </aside>
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
      data-pop=""
      data-state={state}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <form className={styles.searchForm} onSubmit={onRunSearch}>
        <input aria-label="Запрос поиска" onChange={(event) => setSearchTerm(event.target.value)} value={searchTerm} />
        <button className={styles.primaryButton} type="submit">
          Найти
        </button>
        <button aria-label="Закрыть поиск" className={styles.iconButton} onClick={onClose} type="button">
          <X aria-hidden="true" size={18} />
        </button>
      </form>
      <div className={styles.searchResults}>
        {searchStatus === 'loading' ? <p className={styles.muted}>Ищем...</p> : null}
        {searchStatus === 'empty' ? <p className={styles.muted}>Ничего не найдено в текущем проекте.</p> : null}
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

function ForbiddenState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <section className={styles.forbidden} aria-label="Нет доступа">
      <PanelRight aria-hidden="true" size={26} />
      <h1>Нет доступа к этой главе</h1>
      <p>{message || 'Нет доступа к этому проекту.'}</p>
      <button className={styles.primaryButton} onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={17} />
        Вернуться к книгам
      </button>
    </section>
  );
}

function formatBookLabel(book: Book) {
  return book.displayNumber ? `Книга ${book.displayNumber}` : book.title;
}

function LayerPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

function buildLocator(
  projectId: string,
  bookId: string,
  chapterId: string,
  paragraphId: string,
  quote: string,
  revision: number | null,
  annotationId?: string | null,
): ReaderLocator {
  return {
    projectId,
    bookId,
    chapterId,
    paragraphId,
    targetView: 'published',
    revision: revision ?? 1,
    annotationId: annotationId ?? null,
    range: {
      startOffset: 0,
      endOffset: quote.length,
      quote,
    },
  };
}

function toRailTab(value: string | null): RailTab {
  return value === 'notes' ? 'notes' : 'contents';
}

function toNoteMode(value: string | null): NoteMode | null {
  if (value === 'add' || value === 'edit' || value === 'delete') {
    return value;
  }
  return null;
}

function isForbidden(error: unknown) {
  return isApiStatusFailure(error) ? error.status === 403 : typeof error === 'object' && error !== null && 'status' in error && (error as { status?: number }).status === 403;
}

function formatError(error: unknown, fallback: string) {
  return publicApiErrorMessage(error, fallback, {
    forbidden: 'Нет доступа к этой главе.',
    unauthorized: 'Сессия истекла. Войдите снова, и мы вернем вас к главе.',
  });
}
