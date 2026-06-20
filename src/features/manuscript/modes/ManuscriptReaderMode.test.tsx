import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiStatusError, NetworkApiError, type ApiProblem } from '../../../shared/api';
import { createMockApiClient } from '../../../api/mock';
import {
  LEGACY_READER_PREFERENCES_STORAGE_KEY,
  MANUSCRIPT_DISPLAY_PREFERENCES_STORAGE_KEY,
  useReaderPreferencesStore,
} from '../../../entities/manuscript/display-preferences-store';
import { parseRoute } from '../../../shared/navigation/app-route';
import { ManuscriptReaderMode } from './ManuscriptReaderMode';

type ReaderTestApi = ReturnType<typeof createMockApiClient>;

function makeRoute(search = '?mode=read&chapterId=chapter-12', path = '/manuscript/books') {
  return parseRoute(new URL(`http://localhost${path}${search}`));
}

function renderReader(search = '', configureApi?: (api: ReaderTestApi) => void, path?: string) {
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

  const view = render(
    <QueryClientProvider client={queryClient}>
      <ManuscriptReaderMode api={api} navigate={navigate} onLogout={onLogout} route={makeRoute(search, path)} userName="Мира Волкова" />
    </QueryClientProvider>,
  );

  return { api, navigate, onLogout, queryClient, ...view };
}

function statusError(status: number, title: string) {
  return new ApiStatusError(status, { type: 'about:blank', title, status } as ApiProblem, new Response(null, { status }));
}

describe('ManuscriptReaderMode', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    localStorage.clear();
    useReaderPreferencesStore.getState().resetReaderPreferences();
  });

  it('renders the exact reader locator and preserves project/book context across chapter navigation', async () => {
    const { navigate } = renderReader('?projectId=project-white-port&bookId=book-02&paragraphId=p-12-03');

    expect((await screen.findAllByRole('heading', { name: 'Глава 12. Белый порт' })).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(document.querySelector('[data-paragraph-id="p-12-03"] mark')?.textContent).toBe('Мара первой заметила дым с северной пристани.'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Следующая глава' }));

    expect(navigate).toHaveBeenCalledWith(
      '/manuscript/books',
      expect.objectContaining({
        bookId: 'book-02',
        chapterId: 'chapter-13',
        mode: 'read',
        projectId: 'project-white-port',
      }),
    );
  });

  it('creates and edits paragraph-linked notes through the annotation API boundary', async () => {
    renderReader('?pane=notes&paragraphId=p-12-03');

    expect(await screen.findByText('Проверить, кто первым назвал порт Белым.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить заметку' }));

    const addDialog = await screen.findByRole('dialog', { name: 'Новая заметка' });
    expect(within(addDialog).getByText('Локатор: p-12-03')).toBeTruthy();
    fireEvent.change(within(addDialog).getByLabelText('Текст заметки'), { target: { value: 'Запомнить белую пыль у канатов.' } });
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Заметка сохранена на выбранном фрагменте.')).toBeTruthy();
    expect(await screen.findByText('Запомнить белую пыль у канатов.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать заметку annotation-2' }));
    const editDialog = await screen.findByRole('dialog', { name: 'Редактировать заметку' });
    fireEvent.change(within(editDialog).getByLabelText('Текст заметки'), { target: { value: 'Сверить белую пыль с ранней главой.' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Заметка обновлена без потери привязки к абзацу.')).toBeTruthy();
    expect(await screen.findByText('Сверить белую пыль с ранней главой.')).toBeTruthy();
  });

  it('keeps delete note overlays dismissible and restores scroll lock after confirm', async () => {
    renderReader('?pane=notes&note=delete&paragraphId=p-12-03');

    const deleteDialog = await screen.findByRole('dialog', { name: 'Удалить заметку' });
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(deleteDialog, { key: 'Escape' });

    await waitFor(() => expect(document.body.style.overflow).toBe(''));
    expect(screen.queryByRole('dialog', { name: 'Удалить заметку' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить заметку annotation-1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText('Заметка удалена, чтение осталось на том же абзаце.')).toBeTruthy();
    expect(screen.queryByText('Проверить, кто первым назвал порт Белым.')).toBeNull();
  });

  it('keeps note save and delete failures visible in the reader context', async () => {
    const { api } = renderReader('?pane=notes&paragraphId=p-12-03');

    expect(await screen.findByText('Проверить, кто первым назвал порт Белым.')).toBeTruthy();
    vi.spyOn(api, 'updateReaderAnnotation').mockRejectedValueOnce(new Error('Не удалось сохранить заметку.'));
    fireEvent.click((await screen.findAllByRole('button', { name: /Редактировать заметку/ }))[0]!);
    const editDialog = await screen.findByRole('dialog', { name: 'Редактировать заметку' });
    fireEvent.change(within(editDialog).getByLabelText('Текст заметки'), { target: { value: 'Ошибка сохранения остается в читалке.' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Не удалось сохранить заметку.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Редактировать заметку' })).toBeTruthy();

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Редактировать заметку' })).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Редактировать заметку' })).toBeNull());

    vi.spyOn(api, 'deleteReaderAnnotation').mockRejectedValueOnce(new Error('Не удалось удалить заметку.'));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить заметку annotation-1' }));
    const deleteDialog = await screen.findByRole('dialog', { name: 'Удалить заметку' });
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText('Не удалось удалить заметку.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Удалить заметку' })).toBeTruthy();
    expect(screen.getByText('Проверить, кто первым назвал порт Белым.')).toBeTruthy();
  });

  it('keeps project chat create and select failures inside the reader surface', async () => {
    const { api } = renderReader('?projectId=project-white-port&bookId=book-02&paragraphId=p-12-03');

    expect((await screen.findAllByRole('heading', { name: 'Глава 12. Белый порт' })).length).toBeGreaterThan(0);
    vi.spyOn(api, 'getChatSession').mockRejectedValueOnce(new Error('Не удалось открыть чат.'));
    fireEvent.click(screen.getByRole('button', { name: /Упоминания Мары/ }));
    expect(await screen.findByText('Не удалось открыть чат.')).toBeTruthy();

    vi.spyOn(api, 'createChatSession').mockRejectedValueOnce(new Error('Не удалось создать чат.'));
    fireEvent.click(screen.getByRole('button', { name: 'Новый чат' }));
    expect(await screen.findByText('Не удалось создать чат.')).toBeTruthy();
  });

  it('shows canonical forbidden fallback and routes back to books', async () => {
    const { navigate } = renderReader('', (client) => {
      vi.spyOn(client, 'getChapter').mockRejectedValueOnce(statusError(403, 'Нет доступа к этой главе.'));
    });

    expect(await screen.findByRole('heading', { name: 'Нет доступа к этой главе' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к книгам' }));

    expect(navigate).toHaveBeenCalledWith('/manuscript/books', expect.objectContaining({ projectId: 'project-white-port' }));
  });

  it('shows reader loading, empty, 401, 500 and network states without route scenarios', async () => {
    const emptyView = renderReader('', (api) => {
      vi.spyOn(api, 'listChapters').mockResolvedValueOnce({ data: [] });
    });
    expect(await screen.findByText('В проекте пока нет доступных глав для чтения.')).toBeTruthy();
    emptyView.unmount();

    const unauthorizedView = renderReader('', (api) => {
      vi.spyOn(api, 'getChapter').mockRejectedValueOnce(statusError(401, 'Unauthorized'));
    });
    expect(await screen.findByText('Сессия истекла. Войдите снова, и мы вернем вас к главе.')).toBeTruthy();
    unauthorizedView.unmount();

    const serverView = renderReader('', (api) => {
      vi.spyOn(api, 'getChapter').mockRejectedValueOnce(statusError(500, 'Server error'));
    });
    expect(await screen.findByText('Сервис временно недоступен. Попробуйте снова.')).toBeTruthy();
    serverView.unmount();

    const networkView = renderReader('', (api) => {
      vi.spyOn(api, 'getChapter').mockRejectedValueOnce(new NetworkApiError(new Error('offline')));
    });
    expect(await screen.findByText('Не удалось подключиться к серверу. Проверьте соединение и попробуйте снова.')).toBeTruthy();
    networkView.unmount();
  });

  it('persists reader preferences through the allowlisted localStorage payload', async () => {
    const firstView = renderReader('?paragraphId=p-12-03');

    expect((await screen.findAllByRole('heading', { name: 'Глава 12. Белый порт' })).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Сепия' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Размер текста' }));

    await waitFor(() => expect(document.querySelector('[data-display-theme="sepia"]')).toBeTruthy());
    expect(document.querySelector('[data-display-size="large"]')).toBeTruthy();

    const stored = localStorage.getItem(MANUSCRIPT_DISPLAY_PREFERENCES_STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toEqual({ version: 1, displaySize: 'large', displayTheme: 'sepia' });
    expect(stored).not.toMatch(/ck_session|auth|session|draft|manuscript|chat|project|password/i);

    firstView.unmount();
    useReaderPreferencesStore.setState({ displaySize: 'normal', displayTheme: 'light' });
    renderReader('?paragraphId=p-12-03');

    expect((await screen.findAllByRole('heading', { name: 'Глава 12. Белый порт' })).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelector('[data-display-theme="sepia"]')).toBeTruthy());
    expect(document.querySelector('[data-display-size="large"]')).toBeTruthy();
  });

  it('survives corrupted or denied preference storage', () => {
    localStorage.setItem(MANUSCRIPT_DISPLAY_PREFERENCES_STORAGE_KEY, '{bad-json');
    useReaderPreferencesStore.getState().hydrateReaderPreferences();
    expect(useReaderPreferencesStore.getState()).toMatchObject({ displaySize: 'normal', displayTheme: 'light' });

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Denied');
    });

    expect(() => useReaderPreferencesStore.getState().setDisplayTheme('dark')).not.toThrow();
    expect(useReaderPreferencesStore.getState().displayTheme).toBe('dark');
    setItem.mockRestore();
  });

  it('migrates legacy reader preferences into manuscript display preferences', async () => {
    localStorage.setItem(
      LEGACY_READER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, displaySize: 'large', displayTheme: 'dark' }),
    );

    renderReader();
    await screen.findByText('Глава 12. Белый порт');

    expect(localStorage.getItem(LEGACY_READER_PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MANUSCRIPT_DISPLAY_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, displaySize: 'large', displayTheme: 'dark' }),
    );
  });

  it('opens mobile chapters and project search without leaving the reader surface', async () => {
    const { navigate } = renderReader('?chapters=open&paragraphId=p-12-03');

    expect(await screen.findByRole('dialog', { name: 'Главы' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Белый порт/ }));
    expect(navigate).toHaveBeenCalledWith(
      '/manuscript/books',
      expect.objectContaining({ chapterId: 'chapter-12', mode: 'read', projectId: 'project-white-port' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть панель' }));
    expect(screen.queryByRole('button', { name: 'Агент' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Глобальный поиск' }));
    fireEvent.change(screen.getByLabelText('Запрос поиска'), { target: { value: 'Карта' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    fireEvent.click(await screen.findByRole('button', { name: /Карта приливов/ }));

    expect(navigate).toHaveBeenCalledWith(
      '/manuscript/books',
      expect.objectContaining({ chapterId: 'chapter-12', mode: 'read', paragraphId: 'p-12-03' }),
    );
  });

  it('keeps project switch failures inside the reader surface, but clears local logout on failure', async () => {
    const { api, onLogout } = renderReader('?projectId=project-white-port&bookId=book-02&paragraphId=p-12-03');

    expect((await screen.findAllByRole('heading', { name: 'Глава 12. Белый порт' })).length).toBeGreaterThan(0);
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
