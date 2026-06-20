import {
  BookOpen,
  FileDown,
  FileUp,
  FolderOpen,
  Image,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { type ChangeEvent, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { publicApiErrorMessage } from '../../entities/api-errors';
import type { Book, ChatSession, ExportJob, IndexingJob, ManuscriptApiClient, Project, ReaderLocator, SearchScope } from '../../entities/manuscript/api';
import * as manuscriptApi from '../../entities/manuscript/api';
import type { AppRoute } from '../../shared/navigation/app-route';
import { formatProjectMeta } from '../../ui/copy';
import { Overlay } from '../../ui/Overlay';
import { usePresence, type PresenceStatus } from '../../ui/use-presence';
import { ProjectSidebar, type ProjectSidebarProps } from '../../ui/ProjectSidebar';
import { ManuscriptReaderMode } from './modes/ManuscriptReaderMode';
import styles from './ManuscriptPage.module.css';

// The draft editor pulls in TipTap, which is irrelevant to the book shelf (the
// default /manuscript/books surface) and the reader. Load it as its own chunk
// and prefetch it (below) so opening the editor stays instant and flash-free.
const importManuscriptDraftMode = () => import('./modes/ManuscriptDraftMode');
const ManuscriptDraftMode = lazy(() => importManuscriptDraftMode().then((module) => ({ default: module.ManuscriptDraftMode })));

type LoadStatus = 'loading' | 'ready' | 'empty' | 'error';
type BookOpenMode = 'draft' | 'read';
type MenuPosition = { left: number; top: number };

interface ManuscriptPageProps {
  api: ManuscriptApiClient;
  navigate: (path: string, query?: Record<string, string | undefined>) => void;
  onLogout: () => void;
  route: AppRoute;
  userName: string;
}

const coverPalette = ['#4F46E5', '#285f58', '#4c3a5d', '#30472b', '#8a6500'];

export function ManuscriptPage({ api, navigate, onLogout, route, userName }: ManuscriptPageProps) {
  const manuscriptMode = route.query.get('mode');

  // Warm the draft editor chunk while the shelf/reader is on screen so opening
  // the editor is instant and never flashes the Suspense fallback.
  useEffect(() => {
    void importManuscriptDraftMode();
  }, []);

  if (manuscriptMode === 'read') {
    return <ManuscriptReaderMode api={api} navigate={navigate} onLogout={onLogout} route={route} userName={userName} />;
  }
  if (manuscriptMode === 'draft') {
    return (
      <Suspense fallback={<div aria-hidden="true" className={styles.modeFallback} />}>
        <ManuscriptDraftMode api={api} navigate={navigate} onLogout={onLogout} route={route} userName={userName} />
      </Suspense>
    );
  }
  return <ManuscriptShelfPage api={api} navigate={navigate} onLogout={onLogout} route={route} userName={userName} />;
}

function ManuscriptShelfPage({ api, navigate, onLogout, route, userName }: ManuscriptPageProps) {
  const routeSignature = route.query.toString();
  const requestedProjectId = route.query.get('projectId');
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [jobs, setJobs] = useState<IndexingJob[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState(route.query.get('chatId') ?? '');
  const [selectedBookId, setSelectedBookId] = useState(route.query.get('bookId') ?? '');
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [sessionStatus, setSessionStatus] = useState<LoadStatus>('loading');
  const [notice, setNotice] = useState('');
  const [chatNotice, setChatNotice] = useState('');
  const [error, setError] = useState('');
  const [menuBookId, setMenuBookId] = useState<string | null>(route.query.get('bookMenu') === 'open' ? selectedBookId : null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchScope] = useState<SearchScope>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchStatus, setSearchStatus] = useState<LoadStatus>('ready');
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; kind: string; title: string; excerpt: string; locator: ReaderLocator }>>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(route.query.get('menu') === 'open');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const menuReturnRef = useRef<HTMLElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shelfQuery = manuscriptApi.useManuscriptShelfQuery(api, { projectId: requestedProjectId });
  const refreshBooksMutation = manuscriptApi.useRefreshManuscriptBooksMutation(api);
  const openBookMutation = manuscriptApi.useOpenBookMutation(api);
  const createBookMutation = manuscriptApi.useCreateBookMutation(api);
  const updateBookMutation = manuscriptApi.useUpdateBookMutation(api);
  const deleteBookMutation = manuscriptApi.useDeleteBookMutation(api);
  const importBookMutation = manuscriptApi.useImportBookMutation(api);
  const cancelIndexingMutation = manuscriptApi.useCancelIndexingJobMutation(api);
  const exportBookMutation = manuscriptApi.useExportBookMutation(api);
  const searchProjectMutation = manuscriptApi.useSearchProjectMutation(api);
  const selectProjectMutation = manuscriptApi.useGetProjectMutation(api);
  const createChatMutation = manuscriptApi.useCreateChatSessionMutation(api);
  const getChatSessionMutation = manuscriptApi.useGetChatSessionMutation(api);
  const logoutMutation = manuscriptApi.useLogoutMutation(api);

  useEffect(() => {
    setMenuBookId(route.query.get('bookMenu') === 'open' ? selectedBookId : null);
    setMobileMenuOpen(route.query.get('menu') === 'open');
  }, [routeSignature, route.query, selectedBookId]);

  useEffect(() => {
    if (shelfQuery.isPending) {
      setStatus('loading');
      setSessionStatus('loading');
      setError('');
      return;
    }

    if (shelfQuery.isError) {
      setStatus('error');
      setSessionStatus('error');
      setError(formatError(shelfQuery.error, 'Не удалось загрузить рукопись.'));
      return;
    }

    const workspace = shelfQuery.data;
    setProjects(workspace.projects);
    if (!workspace.project) {
      setProject(null);
      setBooks([]);
      setJobs([]);
      setSessions([]);
      setStatus('empty');
      setSessionStatus('empty');
      return;
    }

    setProject(workspace.project);
    setBooks(workspace.books);
    setJobs(workspace.jobs);
    setSessions(workspace.sessions);
    setActiveChatId((current) => workspace.sessions.find((chat) => chat.id === current)?.id ?? workspace.sessions[0]?.id ?? '');
    setSessionStatus(workspace.sessions.length > 0 ? 'ready' : 'empty');
    setSelectedBookId((current) => {
      const candidate = current || workspace.project?.activeBookId || '';
      return workspace.books.find((book) => book.id === candidate)?.id ?? workspace.books[0]?.id ?? '';
    });
    setStatus(workspace.books.length > 0 ? 'ready' : 'empty');
  }, [shelfQuery.data, shelfQuery.error, shelfQuery.isError, shelfQuery.isPending]);

  const selectedBook = books.find((book) => book.id === selectedBookId) ?? books[0] ?? null;
  const menuBook = books.find((book) => book.id === menuBookId) ?? selectedBook;
  const activeJob = jobs.find((job) => job.status === 'running' || job.status === 'queued') ?? null;
  const showIndexing = activeJob;

  async function refreshBooks(projectId = project?.id) {
    if (!projectId) return;
    const refreshed = await refreshBooksMutation.mutateAsync(projectId);
    setBooks(refreshed.books);
    setJobs(refreshed.jobs);
  }

  function openBookMenu(bookId: string, trigger: HTMLElement | null) {
    menuReturnRef.current = trigger;
    const rect = trigger?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 258;
      const menuHeight = 342;
      const gap = 8;
      setMenuPosition({
        left: Math.max(gap, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - gap)),
        top: Math.max(gap, Math.min(rect.bottom + gap, window.innerHeight - menuHeight - gap)),
      });
    } else {
      setMenuPosition(null);
    }
    setSelectedBookId(bookId);
    setMenuBookId(bookId);
    navigateManuscript({ bookMenu: 'open', bookId });
  }

  function closeBookMenu() {
    setMenuBookId(null);
    setMenuPosition(null);
    navigateManuscript({ bookMenu: undefined, bookId: selectedBookId });
    window.setTimeout(() => menuReturnRef.current?.focus(), 0);
  }

  async function openBook(book = selectedBook, mode: BookOpenMode = 'draft') {
    if (!book) return;
    try {
      const { book: freshBook, chapters } = await openBookMutation.mutateAsync(book.id);
      const chapter = chapters.find((item) => item.isCurrent) ?? chapters[0];
      if (!chapter) {
        if (mode === 'draft') {
          openNewChapter(freshBook);
          return;
        }
        setNotice(`В ${freshBook.displayLabel} пока нет глав для чтения.`);
        setMenuBookId(null);
        return;
      }
      setNotice(`Открываем ${freshBook.displayLabel}: ${chapter.title}.`);
      setMenuBookId(null);
      navigate('/manuscript/books', {
        projectId: freshBook.projectId,
        bookId: freshBook.id,
        mode,
        chapterId: chapter.id,
      });
    } catch (nextError) {
      setMenuBookId(null);
      setNotice(formatError(nextError, 'Не удалось открыть книгу.'));
    }
  }

  function openNewChapter(book = selectedBook) {
    if (!book) {
      setNotice('Выберите книгу, чтобы создать главу.');
      return;
    }
    setMenuBookId(null);
    navigate('/manuscript/books', {
      projectId: book.projectId,
      bookId: book.id,
      mode: 'draft',
      newChapter: '1',
    });
  }

  async function createBook() {
    if (!project) return;
    setNotice('Создаем книгу...');
    try {
      const created = await createBookMutation.mutateAsync({
        projectId: project.id,
        body: { title: 'Новая книга', subtitle: 'Черновая редакция', coverColor: '#4F46E5' },
      });
      setBooks((current) => [...current, created]);
      setSelectedBookId(created.id);
      setNotice('Новая книга создана в библиотеке.');
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось создать книгу.'));
    }
  }

  async function changeCover(book = selectedBook) {
    if (!book) return;
    setNotice('Обновляем обложку...');
    const currentIndex = coverPalette.indexOf(book.coverColor ?? '');
    const nextColor = coverPalette[(currentIndex + 1) % coverPalette.length] ?? '#4F46E5';
    try {
      const updated = await updateBookMutation.mutateAsync({ bookId: book.id, body: { coverColor: nextColor } });
      setBooks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedBookId(updated.id);
      setMenuBookId(null);
      setNotice('Обложка обновлена.');
      navigateManuscript({ bookMenu: undefined, bookId: updated.id });
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось обновить обложку.'));
    }
  }

  async function deleteBook(book = selectedBook) {
    if (!book) return;
    try {
      await deleteBookMutation.mutateAsync(book.id);
      const remaining = books.filter((item) => item.id !== book.id);
      const nextBookId = remaining[0]?.id ?? '';
      setBooks(remaining);
      setSelectedBookId(nextBookId);
      setDeleteConfirmOpen(false);
      setMenuBookId(null);
      setNotice(`Книга «${book.title}» удалена из библиотеки.`);
      navigateManuscript({ bookMenu: undefined, bookId: nextBookId || undefined });
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось удалить книгу.'));
    }
  }

  function chooseImportFile() {
    fileInputRef.current?.click();
  }

  function handleImportInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      void importBook(file);
    }
  }

  function handleDropZoneDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void importBook(file);
    }
  }

  async function importBook(file: File) {
    if (!project) return;
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.fb2') && !lowerName.endsWith('.epub')) {
      setNotice('Поддерживаются только файлы FB2 и EPUB.');
      return;
    }
    setNotice(`Загружаем «${file.name}»...`);
    try {
      const title = file.name.replace(/\.(fb2|epub)$/i, '');
      const { constraints, job } = await importBookMutation.mutateAsync({
        projectId: project.id,
        body: { file, title },
      });
      setJobs((current) => [job, ...current]);
      await refreshBooks(project.id);
      setNotice(`Импорт принят: ${constraints.allowedExtensions.join(', ')} до ${Math.round(constraints.maxFileSizeBytes / 1024 / 1024)} MB.`);
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось импортировать книгу.'));
    }
  }

  async function cancelIndexing() {
    if (!activeJob) return;
    setNotice('Отменяем индексацию...');
    try {
      const reconciled = await cancelIndexingMutation.mutateAsync(activeJob.id);
      setJobs((current) => current.map((job) => (job.id === reconciled.id ? reconciled : job)));
      await refreshBooks();
      setNotice('Индексация отменена, контекст полки сохранен.');
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось отменить индексацию.'));
    }
  }

  async function exportBook(format: 'fb2' | 'epub', book = selectedBook) {
    if (!book) return;
    setNotice(`Готовим экспорт ${format.toUpperCase()}...`);
    try {
      const job: ExportJob = await exportBookMutation.mutateAsync({ bookId: book.id, format });
      if (job.status === 'ready' && job.downloadUrl) {
        downloadExport(job.downloadUrl, `${shortBookTitle(book.title)}.${format}`);
      }
      const label =
        job.status === 'ready'
          ? `Экспорт ${format.toUpperCase()} готов — файл загружается.`
          : job.status === 'failed'
            ? `Экспорт ${format.toUpperCase()} не удался${job.errorMessage ? `: ${job.errorMessage}` : '.'}`
            : `Экспорт ${format.toUpperCase()} запущен.`;
      setSelectedBookId(book.id);
      setMenuBookId(null);
      setNotice(label);
      navigateManuscript({ bookMenu: undefined, bookId: book.id });
    } catch (nextError) {
      setNotice(formatError(nextError, 'Не удалось запустить экспорт.'));
    }
  }

  async function runSearch() {
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
      const response = await searchProjectMutation.mutateAsync({ projectId: project.id, query, scope: searchScope });
      setSearchResults(response.data);
      setSearchStatus(response.data.length ? 'ready' : 'empty');
    } catch (nextError) {
      setSearchStatus('error');
      setSearchError(formatError(nextError, 'Поиск временно недоступен.'));
    }
  }

  async function selectProject(projectId: string) {
    try {
      const nextProject = await selectProjectMutation.mutateAsync(projectId);
      setProject(nextProject);
      setProjectMenuOpen(false);
      await refreshBooks(nextProject.id);
    } catch (nextError) {
      setProjectMenuOpen(false);
      setNotice(formatError(nextError, 'Не удалось сменить проект.'));
    }
  }

  async function createChat() {
    if (!project) return;
    setChatNotice('');
    setSessionStatus('loading');
    try {
      const chat = await createChatMutation.mutateAsync({ projectId: project.id, title: 'Новый чат рукописи' });
      setSessions((current) => [chat, ...current]);
      setActiveChatId(chat.id);
      navigate('/chat', { chatId: chat.id, projectId: project.id });
    } catch (nextError) {
      setSessionStatus(sessions.length > 0 ? 'ready' : 'empty');
      setChatNotice(formatError(nextError, 'Не удалось создать чат.'));
    }
  }

  async function selectChat(chatId: string) {
    if (!project) return;
    setChatNotice('');
    setSessionStatus('loading');
    try {
      const chat = await getChatSessionMutation.mutateAsync(chatId);
      setActiveChatId(chat.id);
      setSessionStatus('ready');
      navigate('/chat', { chatId: chat.id, projectId: project.id });
    } catch (nextError) {
      setSessionStatus(sessions.length > 0 ? 'ready' : 'empty');
      setChatNotice(formatError(nextError, 'Не удалось открыть чат.'));
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

  function navigateManuscript(overrides: Record<string, string | undefined>) {
    navigate('/manuscript/books', {
      projectId: project?.id ?? requestedProjectId ?? undefined,
      bookId: selectedBookId || undefined,
      indexing: route.query.get('indexing') ?? undefined,
      menu: mobileMenuOpen ? 'open' : undefined,
      bookMenu: menuBookId ? 'open' : undefined,
      ...overrides,
    });
  }

  const projectTitle = project?.title ?? 'Проект';
  const projectMeta = formatProjectMeta(project);

  const searchPresence = usePresence(searchOpen);
  const accountPresence = usePresence(accountMenuOpen);
  const projectPresence = usePresence(projectMenuOpen);
  const bookMenuPresence = usePresence(menuBookId && menuBook ? menuBook : null);
  const mobileMenuPresence = usePresence(mobileMenuOpen);
  const deletePresence = usePresence(deleteConfirmOpen && selectedBook ? selectedBook : null);
  const lastMenuPosition = useRef(menuPosition);
  if (menuPosition) {
    lastMenuPosition.current = menuPosition;
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.globalBar}>
        <button
          aria-label="Открыть меню"
          className={styles.mobileMenuButton}
          onClick={() => {
            setMobileMenuOpen(true);
            navigateManuscript({ menu: 'open' });
          }}
          type="button"
        >
          <Menu aria-hidden="true" size={21} />
        </button>
        <p className={styles.brand}>
          <span className={styles.desktopBrand}>Canon Keeper</span>
          <span className={styles.mobileTitle}>Рукопись</span>
        </p>
        <button
          aria-label="Глобальный поиск"
          className={styles.globalSearchButton}
          onClick={() => setSearchOpen(true)}
          ref={searchTriggerRef}
          type="button"
        >
          <Search aria-hidden="true" size={16} />
          <span>Глобальный поиск</span>
        </button>
        <div className={styles.barActions}>
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
            state={searchPresence.status}
            onClose={() => {
              setSearchOpen(false);
              searchTriggerRef.current?.focus();
            }}
            onOpenResult={(locator) =>
              navigate('/manuscript/books', {
                projectId: locator.projectId,
                bookId: locator.bookId,
                mode: 'read',
                chapterId: locator.chapterId,
                paragraphId: locator.paragraphId ?? undefined,
              })
            }
            onRunSearch={() => void runSearch()}
            results={searchResults}
            searchError={searchError}
            searchStatus={searchStatus}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
          />
        ) : null}
        {accountPresence.mounted ? (
          <div className={styles.accountMenu} data-pop="" data-state={accountPresence.status}>
            <p className={styles.muted}>{userName}</p>
            <button className={styles.menuItem} onClick={logout} type="button">
              <LogOut aria-hidden="true" size={17} />
              Выйти
            </button>
          </div>
        ) : null}
      </header>

      <div className={styles.body}>
        <ProjectSidebar
          active="manuscript"
          activeChatId={activeChatId}
          chatNotice={chatNotice}
          onChat={() => {
            if (activeChatId) {
              void selectChat(activeChatId);
              return;
            }
            if (sessions[0]) {
              void selectChat(sessions[0].id);
              return;
            }
            void createChat();
          }}
          onCreateChat={() => void createChat()}
          onManuscript={() => undefined}
          onOpenProjectMenu={() => setProjectMenuOpen((value) => !value)}
          onSelectChat={(chatId) => void selectChat(chatId)}
          projectMeta={projectMeta}
          projectTitle={projectTitle}
          sessions={sessions}
          sessionStatus={sessionStatus}
        />
        <nav className={styles.tabletRail} aria-label="Планшетная навигация">
          <button aria-label="Поиск" className={styles.iconButton} onClick={() => setSearchOpen(true)} type="button">
            <Search aria-hidden="true" size={19} />
          </button>
          <button aria-label="Рукопись" className={styles.activeNavButton} type="button">
            <NotebookPen aria-hidden="true" size={19} />
          </button>
          <button aria-label="Чат" className={styles.iconButton} onClick={() => navigate('/chat')} type="button">
            <MessageSquare aria-hidden="true" size={19} />
          </button>
        </nav>

        <section className={styles.content} aria-label="Библиотека рукописи">
          <div className={styles.headerRow}>
            <div className={styles.titleBlock}>
              <h1>{projectTitle}</h1>
              <p className={styles.projectMeta}>{projectMeta}</p>
            </div>
            <div className={styles.topActions}>
              <button className={styles.uploadButton} onClick={chooseImportFile} type="button">
                <FileUp aria-hidden="true" size={17} />
                Загрузить файл
              </button>
              <input
                accept=".fb2,.epub"
                aria-label="Файл рукописи FB2 или EPUB"
                className={styles.fileInput}
                onChange={handleImportInputChange}
                ref={fileInputRef}
                type="file"
              />
              <button className={styles.primaryButton} onClick={() => void createBook()} type="button">
                <Plus aria-hidden="true" size={17} />
                Новая книга
              </button>
            </div>
          </div>

          {showIndexing ? <IndexingBanner job={activeJob} onCancel={() => void cancelIndexing()} /> : null}
          {status === 'loading' ? <p className={styles.notice}>Загружаем книги...</p> : null}
          {status === 'empty' ? <p className={styles.notice}>В саге пока нет книг.</p> : null}
          {status === 'error' ? <p className={styles.notice}>{error}</p> : null}
          {notice ? <p className={styles.notice}>{notice}</p> : null}

          <p className={styles.sectionLabel}>Книги саги</p>
          <div className={styles.booksGrid}>
            {books.map((book) => (
              <BookCard
                book={book}
                isActive={book.id === selectedBookId}
                key={book.id}
                onOpenMenu={(trigger) => openBookMenu(book.id, trigger)}
                onOpen={() => void openBook(book, 'draft')}
                onSelect={() => setSelectedBookId(book.id)}
              />
            ))}
          </div>

          <button
            className={dragActive ? `${styles.dropZone} ${styles.dropZoneActive}` : styles.dropZone}
            onClick={chooseImportFile}
            onDragLeave={() => setDragActive(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDrop={handleDropZoneDrop}
            type="button"
          >
            <span>
              <UploadCloud aria-hidden="true" size={30} />
              <strong>Перетащите FB2 или EPUB</strong>
              <span className={styles.muted}>Canon Keeper распознает главы и проиндексирует текст · до 50 MB</span>
            </span>
          </button>
        </section>
      </div>

      {projectPresence.mounted ? (
        <div className={styles.projectMenu} data-pop="" data-state={projectPresence.status}>
          {projects.map((item) => (
            <button className={styles.menuItem} key={item.id} onClick={() => void selectProject(item.id)} type="button">
              <FolderOpen aria-hidden="true" size={17} />
              {item.title}
            </button>
          ))}
        </div>
      ) : null}

      {bookMenuPresence.mounted && bookMenuPresence.value ? (
        <BookActionMenu
          book={bookMenuPresence.value}
          onChangeCover={() => void changeCover(bookMenuPresence.value!)}
          onClose={closeBookMenu}
          onDelete={() => {
            setSelectedBookId(bookMenuPresence.value!.id);
            setMenuBookId(null);
            setDeleteConfirmOpen(true);
          }}
          onExport={(format) => void exportBook(format, bookMenuPresence.value!)}
          onNewChapter={() => openNewChapter(bookMenuPresence.value!)}
          onOpen={() => void openBook(bookMenuPresence.value!, 'draft')}
          onOpenRead={() => void openBook(bookMenuPresence.value!, 'read')}
          position={menuPosition ?? lastMenuPosition.current}
          state={bookMenuPresence.status}
        />
      ) : null}

      {mobileMenuPresence.mounted ? (
        <MobileMenu
          state={mobileMenuPresence.status}
          onClose={() => {
            setMobileMenuOpen(false);
            navigateManuscript({ menu: undefined });
          }}
          sidebar={{
            active: 'manuscript',
            activeChatId,
            chatNotice,
            onChat: () => navigate('/chat', { projectId: project?.id ?? undefined, chatId: activeChatId || undefined }),
            onCreateChat: () => void createChat(),
            onManuscript: () => {
              setMobileMenuOpen(false);
              navigateManuscript({ menu: undefined });
            },
            onSelectChat: (chatId) => void selectChat(chatId),
            projectMeta,
            projectTitle,
            sessions,
            sessionStatus,
          }}
        />
      ) : null}

      {deletePresence.mounted && deletePresence.value ? (
        <ConfirmDelete
          book={deletePresence.value}
          onClose={() => setDeleteConfirmOpen(false)}
          onDelete={() => void deleteBook(deletePresence.value!)}
          state={deletePresence.status}
        />
      ) : null}
    </main>
  );
}

function BookCard({
  book,
  isActive,
  onOpen,
  onOpenMenu,
  onSelect,
}: {
  book: Book;
  isActive: boolean;
  onOpen: () => void;
  onOpenMenu: (trigger: HTMLElement | null) => void;
  onSelect: () => void;
}) {
  const statusClass =
    book.status === 'ready'
      ? styles.statusReady
      : book.status === 'indexing'
        ? styles.statusIndexing
        : book.status === 'error'
          ? styles.statusError
          : styles.statusDraft;
  const statusLabel =
    book.status === 'ready'
      ? 'Готова'
      : book.status === 'indexing'
        ? `Индексация · ${book.indexing.currentUnit}/${book.indexing.totalUnits}`
        : book.status === 'error'
          ? 'Индексация отменена'
          : 'Черновик';
  return (
    <article className={isActive ? styles.activeBookCard : styles.bookCard} onClick={onSelect}>
      <div className={styles.cover} style={{ background: book.coverColor ?? '#4F46E5' }}>
        {shortBookTitle(book.title)}
      </div>
      <button aria-label={`Действия книги ${book.title}`} className={styles.bookMenuButton} onClick={(event) => { event.stopPropagation(); onOpenMenu(event.currentTarget); }} type="button">
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      <div className={styles.bookInfo}>
        <strong>{book.title}</strong>
        <p>{book.chapterCount} главы · {formatWords(book.wordCount)} слов</p>
        <div className={styles.cardActions}>
          <span className={statusClass}>{statusLabel}</span>
          <button
            aria-label={`Открыть редактор ${book.title}`}
            className={styles.textButton}
            onClick={(event) => { event.stopPropagation(); onOpen(); }}
            type="button"
          >
            Редактор
          </button>
        </div>
      </div>
    </article>
  );
}

function IndexingBanner({ job, onCancel }: { job: IndexingJob; onCancel: () => void }) {
  const percent = Math.round(job.progress * 100);
  return (
    <section className={styles.indexBanner} aria-label="Индексация книги">
      <UploadCloud aria-hidden="true" size={24} />
      <div>
        <strong>Индексируется «{job.sourceFileName ?? 'файл рукописи'}»</strong>
        <p className={styles.muted}>Извлечение глав · {job.currentUnit} из {job.totalUnits} · {job.stageLabel ?? 'векторизация абзацев'}</p>
      </div>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
      <span className={styles.percentBadge}>{percent}%</span>
      <button aria-label="Отменить индексацию" className={styles.iconButton} onClick={onCancel} type="button">
        <X aria-hidden="true" size={18} />
      </button>
    </section>
  );
}

function BookActionMenu({
  book,
  onChangeCover,
  onClose,
  onDelete,
  onExport,
  onNewChapter,
  onOpen,
  onOpenRead,
  position,
  state,
}: BookActionsProps & { state: PresenceStatus }) {
  // When the menu is restored from URL state (e.g. reload) there is no trigger
  // to anchor to, so center it instead of letting it stick to a corner.
  const style = position ? { left: `${position.left}px`, top: `${position.top}px` } : undefined;
  const menuClassName = position ? styles.floatingMenu : `${styles.floatingMenu} ${styles.floatingMenuCentered}`;
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  function handleLayerPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose?.();
    }
  }

  return (
    <PortalLayer>
      <div className={styles.menuLayer} onPointerDown={handleLayerPointerDown}>
        <div
          aria-label="Действия книги"
          className={menuClassName}
          data-pop={position ? '' : undefined}
          data-state={state}
          onKeyDown={handleMenuKeyDown}
          ref={menuRef}
          role="menu"
          style={style}
          tabIndex={-1}
        >
          <div className={styles.floatingMenuHeader}>
            <strong>{book.title}</strong>
            <button aria-label="Закрыть меню" className={styles.iconButton} onClick={onClose} type="button">
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          <BookActionItems
            book={book}
            onChangeCover={onChangeCover}
            onDelete={onDelete}
            onExport={onExport}
            onNewChapter={onNewChapter}
            onOpen={onOpen}
            onOpenRead={onOpenRead}
          />
        </div>
      </div>
    </PortalLayer>
  );
}

interface BookActionsProps {
  book: Book;
  onChangeCover: () => void;
  onClose?: () => void;
  onDelete: () => void;
  onExport: (format: 'fb2' | 'epub') => void;
  onNewChapter: () => void;
  onOpen: () => void;
  onOpenRead: () => void;
  position?: MenuPosition | null;
}

function BookActionItems({ onChangeCover, onDelete, onExport, onNewChapter, onOpen, onOpenRead }: BookActionsProps) {
  return (
    <>
      <button className={styles.menuItem} onClick={onOpen} type="button">
        <NotebookPen aria-hidden="true" size={17} />
        Открыть редактор
      </button>
      <button className={styles.menuItem} onClick={onOpenRead} type="button">
        <BookOpen aria-hidden="true" size={17} />
        Открыть чтение
      </button>
      <button className={styles.menuItem} onClick={onNewChapter} type="button">
        <Plus aria-hidden="true" size={17} />
        Новая глава
      </button>
      <button className={styles.menuItem} onClick={onChangeCover} type="button">
        <Image aria-hidden="true" size={17} />
        Изменить обложку
      </button>
      <button className={styles.menuItem} onClick={() => onExport('fb2')} type="button">
        <FileDown aria-hidden="true" size={17} />
        Экспорт в FB2
      </button>
      <button className={styles.menuItem} onClick={() => onExport('epub')} type="button">
        <FileDown aria-hidden="true" size={17} />
        Экспорт в EPUB
      </button>
      <button className={styles.dangerMenuItem} onClick={onDelete} type="button">
        <Trash2 aria-hidden="true" size={17} />
        Удалить книгу
      </button>
    </>
  );
}

function ConfirmDelete({
  book,
  onClose,
  onDelete,
  state,
}: {
  book: Book;
  onClose: () => void;
  onDelete: () => void;
  state: PresenceStatus;
}) {
  return (
    <PortalLayer>
      <div className={styles.layer} data-overlay-scrim="" data-state={state}>
        <Overlay kind="dialog" label="Удалить книгу" onDismiss={onClose} state={state}>
          <section className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Удалить книгу?</h2>
              <button aria-label="Закрыть" className={styles.iconButton} onClick={onClose} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <p className={styles.modalCopy}>«{book.title}» будет удалена из библиотеки. Это действие нельзя отменить.</p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryButton} onClick={onClose} type="button">
                Отмена
              </button>
              <button className={styles.dangerButton} onClick={onDelete} type="button">
                Удалить
              </button>
            </div>
          </section>
        </Overlay>
      </div>
    </PortalLayer>
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
  onRunSearch: () => void;
  results: Array<{ id: string; kind: string; title: string; excerpt: string; locator: ReaderLocator }>;
  searchError: string;
  searchStatus: LoadStatus;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  state: PresenceStatus;
}) {
  return (
    <section className={styles.searchPanel} data-pop="center" data-state={state}>
      <form className={styles.searchForm} onSubmit={(event) => { event.preventDefault(); onRunSearch(); }}>
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
        {searchStatus === 'empty' ? <p className={styles.muted}>Ничего не найдено в текущей рукописи.</p> : null}
        {searchStatus === 'error' ? <p className={styles.muted}>{searchError}</p> : null}
        {results.map((result) => (
          <button className={styles.searchResult} key={result.id} onClick={() => onOpenResult(result.locator)} type="button">
            <strong>{result.title}</strong>
            <p>{result.kind === 'material' ? 'Материал · открывается в читалке' : result.excerpt}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function MobileMenu({ onClose, sidebar, state }: { onClose: () => void; sidebar: ProjectSidebarProps; state: PresenceStatus }) {
  return (
    <PortalLayer>
      <div className={styles.drawerLayer} data-overlay-scrim="" data-state={state}>
        <Overlay kind="drawer" label="Меню рукописи" onDismiss={onClose} state={state}>
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
    </PortalLayer>
  );
}

function PortalLayer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

function downloadExport(url: string, filename: string) {
  if (typeof document === 'undefined') return;
  // jsdom does not implement navigation; skip the actual click in the test runtime.
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) return;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function formatWords(value: number) {
  if (value >= 1000) {
    return `${Math.round(value / 1000)} K`;
  }
  return String(value);
}

function shortBookTitle(title: string) {
  return title.replace(/^Книга [IVX]+\. /, '');
}

function formatError(error: unknown, fallback: string) {
  return publicApiErrorMessage(error, fallback);
}
