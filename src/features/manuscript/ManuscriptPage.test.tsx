import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient } from '../../api/mock';
import { parseRoute } from '../../shared/navigation/app-route';
import { ManuscriptPage } from './ManuscriptPage';

type ManuscriptTestApi = ReturnType<typeof createMockApiClient>;

function makeRoute(search = '') {
  return parseRoute(new URL(`http://localhost/manuscript/books${search}`));
}

function renderManuscript(search = '', configureApi?: (api: ManuscriptTestApi) => void) {
  const api = createMockApiClient();
  configureApi?.(api);
  const navigate = vi.fn();
  const onLogout = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  const view = (nextSearch: string) => (
    <QueryClientProvider client={queryClient}>
      <ManuscriptPage api={api} navigate={navigate} onLogout={onLogout} route={makeRoute(nextSearch)} userName="Мира Волкова" />
    </QueryClientProvider>
  );
  const renderResult = render(view(search));

  return { api, navigate, onLogout, queryClient, rerenderWithRoute: (nextSearch: string) => renderResult.rerender(view(nextSearch)) };
}

describe('ManuscriptPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  it('renders the saga shelf and cancels indexing through the mock job boundary', async () => {
    renderManuscript('?indexing=active');

    expect(await screen.findByText('Книга III. Северный суд')).toBeTruthy();
    expect(screen.getByText(/9 из 14/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить индексацию' }));

    expect(await screen.findByText('Индексация отменена, контекст полки сохранен.')).toBeTruthy();
    expect((await screen.findAllByText(/Индексация отменена/)).length).toBeGreaterThan(1);
  });

  it('shows cancel errors without leaving the manuscript shelf', async () => {
    renderManuscript('?indexing=active', (api) => {
      vi.spyOn(api, 'cancelIndexingJob').mockRejectedValueOnce(new Error('Индексация уже завершилась.'));
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Отменить индексацию' }));

    expect(await screen.findByText('Не удалось отменить индексацию.')).toBeTruthy();
    expect(screen.getByText('Книга III. Северный суд')).toBeTruthy();
  });

  it('keeps workspace navigation on the shipped manuscript and chat surfaces', async () => {
    const { navigate } = renderManuscript();

    await screen.findByText('Книга II. Карта приливов');
    // Centralized sidebar nav is Рукопись + Чат only.
    expect(screen.queryByRole('button', { name: 'Обзор' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Материалы' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Читалка' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Чат' })[0]!);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/chat', expect.objectContaining({ chatId: 'chat-white-port', projectId: 'project-white-port' })),
    );
  });

  it('opens manuscript editor from book cards and keeps the anchored menu lightweight', async () => {
    const { navigate } = renderManuscript();

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть редактор Книга II. Карта приливов' }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        '/manuscript/books',
        expect.objectContaining({
          bookId: 'book-02',
          chapterId: 'chapter-12',
          mode: 'draft',
          projectId: 'project-white-port',
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Действия книги Книга II. Карта приливов' }));
    const menu = await screen.findByRole('menu', { name: 'Действия книги' });
    expect(menu).toBeTruthy();
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Изменить обложку' }));

    expect(await screen.findByText('Обложка обновлена.')).toBeTruthy();
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  it('closes the book action menu when clicking outside and exposes read/new-chapter actions', async () => {
    const { navigate } = renderManuscript();

    fireEvent.click(await screen.findByRole('button', { name: 'Действия книги Книга II. Карта приливов' }));
    const menu = await screen.findByRole('menu', { name: 'Действия книги' });
    expect(within(menu).getByRole('button', { name: 'Закрыть меню' })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'Открыть чтение' })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'Новая глава' })).toBeTruthy();

    fireEvent.click(within(menu).getByRole('button', { name: 'Новая глава' }));
    expect(navigate).toHaveBeenCalledWith(
      '/manuscript/books',
      expect.objectContaining({ bookId: 'book-02', mode: 'draft', newChapter: '1', projectId: 'project-white-port' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Действия книги Книга II. Карта приливов' }));
    const nextMenu = await screen.findByRole('menu', { name: 'Действия книги' });
    fireEvent.click(within(nextMenu).getByRole('button', { name: 'Закрыть меню' }));
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Действия книги' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Действия книги Книга II. Карта приливов' }));
    const outsideMenu = await screen.findByRole('menu', { name: 'Действия книги' });
    fireEvent.pointerDown(outsideMenu.parentElement!);
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Действия книги' })).toBeNull());
  });

  it('switches between shelf, reader and draft modes without changing hook order', async () => {
    const { rerenderWithRoute } = renderManuscript();

    expect(await screen.findByText('Книга II. Карта приливов')).toBeTruthy();

    rerenderWithRoute('?mode=read&projectId=project-white-port&bookId=book-02&chapterId=chapter-12&paragraphId=p-12-03');
    expect(await screen.findByText('Глава 12. Белый порт')).toBeTruthy();

    rerenderWithRoute('');
    expect(await screen.findByText('Книга III. Северный суд')).toBeTruthy();

    rerenderWithRoute('?mode=draft&projectId=project-white-port&bookId=book-02&chapterId=chapter-16');
    expect(await screen.findByRole('heading', { name: '16. Возвращение к записи' })).toBeTruthy();
  });

  it('reports export ready and error outcomes from export jobs', async () => {
    const { api } = renderManuscript('?bookMenu=open&bookId=book-02');
    const getExportJob = api.getExportJob.bind(api);
    vi.spyOn(api, 'getExportJob').mockImplementationOnce(async (id) => ({
      ...(await getExportJob(id)),
      status: 'ready',
      downloadUrl: '/mock-downloads/book.epub',
    }));

    await screen.findByRole('menu', { name: 'Действия книги' });
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт в EPUB' }));
    expect(await screen.findByText(/Экспорт EPUB готов/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Действия книги' })).toBeNull());

    vi.spyOn(api, 'getExportJob').mockImplementationOnce(async (id) => ({
      ...(await getExportJob(id)),
      status: 'failed',
      errorMessage: 'Экспорт временно недоступен.',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Действия книги Книга II. Карта приливов' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Экспорт в FB2' }));
    expect(await screen.findByText(/Экспорт FB2 не удался/)).toBeTruthy();
  });

  it('runs create, import and delete book transitions', async () => {
    renderManuscript();

    await screen.findByText('Книга II. Карта приливов');
    fireEvent.click(screen.getByRole('button', { name: 'Новая книга' }));
    expect(await screen.findByText('Новая книга создана в библиотеке.')).toBeTruthy();

    const importFile = new File(['<book/>'], 'northern-court.epub', { type: 'application/epub+zip' });
    fireEvent.change(screen.getByLabelText('Файл рукописи FB2 или EPUB'), { target: { files: [importFile] } });
    expect(await screen.findByText(/Импорт принят: .fb2, .epub до 50 MB/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /Действия книги/ }).at(-1)!);
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить книгу' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText(/Книга «Новая книга» удалена/)).toBeTruthy();
  });

  it('keeps import and delete failures inside the manuscript shelf', async () => {
    const { api } = renderManuscript();

    await screen.findByText('Книга II. Карта приливов');
    vi.spyOn(api, 'getImportConstraints').mockRejectedValueOnce(new Error('Не удалось импортировать книгу.'));
    const failedImportFile = new File(['<book/>'], 'northern-court.epub', { type: 'application/epub+zip' });
    fireEvent.change(screen.getByLabelText('Файл рукописи FB2 или EPUB'), { target: { files: [failedImportFile] } });

    expect(await screen.findByText('Не удалось импортировать книгу.')).toBeTruthy();
    expect(screen.getByText('Книга II. Карта приливов')).toBeTruthy();

    vi.spyOn(api, 'deleteBook').mockRejectedValueOnce(new Error('Не удалось удалить книгу.'));
    fireEvent.click(screen.getByRole('button', { name: 'Действия книги Книга II. Карта приливов' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить книгу' }));
    const deleteDialog = await screen.findByRole('dialog', { name: 'Удалить книгу' });
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText('Не удалось удалить книгу.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Удалить книгу' })).toBeTruthy();
    expect(screen.getByText('Книга II. Карта приливов')).toBeTruthy();
  });

  it('uses project chat session select and create through the API boundary', async () => {
    const { navigate } = renderManuscript();

    fireEvent.click(await screen.findByRole('button', { name: /Упоминания Мары/ }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/chat', expect.objectContaining({ chatId: 'chat-mara-mentions', projectId: 'project-white-port' })),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Новый чат' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/chat', expect.objectContaining({ chatId: 'chat-4', projectId: 'project-white-port' })));
  });

  it('shows project-chat and search fallbacks in context', async () => {
    const { api, navigate } = renderManuscript('', (client) => {
      vi.spyOn(client, 'getChatSession').mockRejectedValueOnce(new Error('Не удалось открыть чат.'));
    });

    fireEvent.click(await screen.findByRole('button', { name: /Упоминания Мары/ }));
    expect(await screen.findByText('Не удалось открыть чат.')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalledWith('/chat', expect.anything());

    navigate.mockClear();
    vi.spyOn(api, 'createChatSession').mockRejectedValueOnce(new Error('Не удалось создать чат.'));
    fireEvent.click(screen.getByRole('button', { name: 'Новый чат' }));
    expect(await screen.findByText('Не удалось создать чат.')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalledWith('/chat', expect.anything());

    vi.spyOn(api, 'searchProject').mockRejectedValueOnce(new Error('Поиск временно недоступен.'));

    fireEvent.click(screen.getByRole('button', { name: 'Глобальный поиск' }));
    fireEvent.change(screen.getByLabelText('Запрос поиска'), { target: { value: 'Белый порт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));

    expect(await screen.findByText('Поиск временно недоступен.')).toBeTruthy();
  });

  it('keeps book open and project switch failures on the shelf, but clears local logout on failure', async () => {
    const { api, navigate, onLogout } = renderManuscript();

    await screen.findByText('Книга II. Карта приливов');
    vi.spyOn(api, 'getBook').mockRejectedValueOnce(new Error('Не удалось открыть книгу.'));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть редактор Книга II. Карта приливов' }));

    expect(await screen.findByText('Не удалось открыть книгу.')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalledWith(expect.stringMatching(/^\/reader/), expect.anything());

    vi.spyOn(api, 'getProject').mockRejectedValueOnce(new Error('Не удалось сменить проект.'));
    fireEvent.click(screen.getByRole('button', { name: /Хроники Белого порта/ }));
    const projectButtons = await screen.findAllByRole('button', { name: /Хроники Белого порта/ });
    fireEvent.click(projectButtons.at(-1)!);

    expect(await screen.findByText('Не удалось сменить проект.')).toBeTruthy();

    vi.spyOn(api, 'logout').mockRejectedValueOnce(new Error('Не удалось выйти.'));
    fireEvent.click(screen.getByRole('button', { name: 'Личный кабинет' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });
});
