import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiStatusError, NetworkApiError, type ApiProblem } from '../../../shared/api';
import { createMockApiClient } from '../../../api/mock/repository';
import type { ManuscriptApiClient } from '../../../entities/manuscript/api';
import type { AppRoute } from '../../../shared/navigation/app-route';
import { ManuscriptDraftMode } from './ManuscriptDraftMode';

function route(path = '/manuscript/books', query: Record<string, string> = { mode: 'draft', chapterId: 'chapter-16' }): AppRoute {
  return {
    path,
    surface: 'manuscript',
    params: {},
    query: new URLSearchParams(query),
  };
}

function renderDraft(path?: string, query?: Record<string, string>, configureApi?: (api: ManuscriptApiClient) => void) {
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
  render(
    <QueryClientProvider client={queryClient}>
      <ManuscriptDraftMode api={api} navigate={navigate} onLogout={onLogout} route={route(path, query)} userName="Мира Волкова" />
    </QueryClientProvider>,
  );
  return { api, navigate, onLogout, queryClient };
}

function apiProblem(status: number, title: string): ApiProblem {
  return { type: 'about:blank', title, status };
}

function statusError(status: number, title: string) {
  return new ApiStatusError(status, apiProblem(status, title), new Response(null, { status }));
}

function storedKeys() {
  return {
    local: Array.from({ length: localStorage.length }, (_item, index) => localStorage.key(index)).filter(Boolean),
    session: Array.from({ length: sessionStorage.length }, (_item, index) => sessionStorage.key(index)).filter(Boolean),
  };
}

async function replaceEditorText(editor: HTMLElement, value: string) {
  await act(async () => {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.keyDown(editor, { code: 'KeyA', ctrlKey: true, key: 'a' });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? value : ''),
      },
    });
    await Promise.resolve();
  });
}

function editorText(editor: HTMLElement) {
  return editor.textContent?.replace(/\u00a0/g, ' ').trim() ?? '';
}

describe('ManuscriptDraftMode', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('renders the Pencil-backed desktop draft shell and switches to reader mode with context', async () => {
    const { navigate } = renderDraft();

    expect(await screen.findByRole('heading', { name: '16. Возвращение к записи' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Глобальный поиск' })).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: 'Форматирование черновика' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Структура' }).getAttribute('aria-selected')).toBe('true');

    // Чтение/Черновик — режимы одного редактора (readonly/wysiwyg), а не переход на отдельную страницу.
    fireEvent.click(screen.getByRole('button', { name: 'Чтение' }));

    expect(screen.getByRole('button', { name: 'Чтение' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('toolbar', { name: 'Форматирование черновика' })).toBeNull();
    expect(navigate).not.toHaveBeenCalledWith('/manuscript/books', expect.objectContaining({ mode: 'read' }));

    fireEvent.click(screen.getByRole('button', { name: 'Черновик' }));
    expect(screen.getByRole('toolbar', { name: 'Форматирование черновика' })).toBeTruthy();
  });

  it('opens a new chapter draft from the editor structure rail', async () => {
    const { navigate } = renderDraft();

    expect(await screen.findByRole('heading', { name: '16. Возвращение к записи' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Новая глава' }));

    expect(navigate).toHaveBeenCalledWith(
      '/manuscript/books',
      expect.objectContaining({ bookId: 'book-02', mode: 'draft', newChapter: '1', projectId: 'project-white-port' }),
    );
  });

  it('keeps the editor agent beside the draft and routes saga chats to the standalone chat page', async () => {
    const { api, navigate } = renderDraft();

    expect(await screen.findByRole('heading', { name: '16. Возвращение к записи' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Чат' }));

    const sendChatMessage = vi.spyOn(api, 'sendChatMessage');
    const requestAgentSuggestion = vi.spyOn(api, 'requestAgentSuggestion');
    expect(await screen.findByText('Редакторский агент')).toBeTruthy();
    expect(screen.getByText('Работает с текущей главой и выделенным фрагментом. Чаты саги открываются отдельно на странице «Чат».')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Сообщение по главе' })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение редакторскому агенту' }), { target: { value: 'Что важно проверить в этой сцене?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить редакторскому агенту' }));

    expect(await screen.findByText(/Подготовил точечную правку/)).toBeTruthy();
    expect(requestAgentSuggestion).toHaveBeenCalled();
    expect(sendChatMessage).not.toHaveBeenCalled();

    navigate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Упоминания Мары/ }));

    expect(navigate).toHaveBeenCalledWith('/chat', { projectId: 'project-white-port', chatId: 'chat-mara-mentions' });

    navigate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Новый чат' }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        '/chat',
        expect.objectContaining({ chatId: 'chat-4', projectId: 'project-white-port' }),
      ),
    );
  });

  it('formats, saves with Ctrl+S, and publishes the active draft', async () => {
    renderDraft();
    const editor = await screen.findByRole('textbox', { name: 'Текст черновика' });
    await replaceEditorText(editor, 'Сава молчал');

    expect(screen.getByText('Есть несохранённые правки')).toBeTruthy();

    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    expect(await screen.findByText('Черновик сохранён.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    expect(await screen.findByText('Глава опубликована из актуального черновика.')).toBeTruthy();
  });

  it('keeps conflict inline on save without leaving the draft surface', async () => {
    const { api } = renderDraft();
    vi.spyOn(api, 'updateChapter').mockRejectedValueOnce(statusError(409, 'Черновик изменился в другом окне.'));
    const editor = await screen.findByRole('textbox', { name: 'Текст черновика' });

    await replaceEditorText(editor, 'Новая конфликтная строка');
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });

    expect(await screen.findByText('Черновик изменился в другом окне.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '16. Возвращение к записи' })).toBeTruthy();
    expect(editorText(editor)).toBe('Новая конфликтная строка');
  });

  it('autosaves one settled edit through the API and does not flood requests', async () => {
    const { api } = renderDraft();
    const editor = await screen.findByRole('textbox', { name: 'Текст черновика' });
    const updateChapter = vi.spyOn(api, 'updateChapter');
    vi.useFakeTimers();

    await replaceEditorText(editor, 'Первая быстрая правка');
    await replaceEditorText(editor, 'Вторая быстрая правка');
    await replaceEditorText(editor, 'Третья быстрая правка');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(updateChapter).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(updateChapter).toHaveBeenCalledTimes(1);
    expect(updateChapter).toHaveBeenCalledWith('chapter-16', expect.objectContaining({ expectedRevision: 9 }));
    expect(storedKeys()).toEqual({ local: [], session: [] });
  });

  it('manual save cancels a pending autosave timer', async () => {
    const { api } = renderDraft();
    const editor = await screen.findByRole('textbox', { name: 'Текст черновика' });
    const updateChapter = vi.spyOn(api, 'updateChapter');
    vi.useFakeTimers();

    await replaceEditorText(editor, 'Ручное сохранение отменяет таймер');
    await act(async () => {
      fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
      await Promise.resolve();
    });

    expect(updateChapter).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(updateChapter).toHaveBeenCalledTimes(1);
  });

  it('keeps newer local text when an older save response arrives late', async () => {
    const { api } = renderDraft();
    const originalUpdateChapter = api.updateChapter.bind(api);
    let releaseSave: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    vi.spyOn(api, 'updateChapter').mockImplementationOnce(async (chapterId, body) => {
      await saveGate;
      return originalUpdateChapter(chapterId, body);
    });
    const editor = await screen.findByRole('textbox', { name: 'Текст черновика' });

    await replaceEditorText(editor, 'Первый вариант');
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    expect(await screen.findByText('Сохраняем...')).toBeTruthy();

    await replaceEditorText(editor, 'Второй вариант после задержки');
    releaseSave();

    await waitFor(() => expect(screen.getByText('Есть несохранённые правки')).toBeTruthy());
    expect(editorText(editor)).toBe('Второй вариант после задержки');
  });

  it('keeps draft typing local until autosave or explicit save', async () => {
    const { api } = renderDraft();
    const updateChapter = vi.spyOn(api, 'updateChapter');
    const editor = await screen.findByRole('textbox', { name: 'Текст черновика' });

    await replaceEditorText(editor, 'Локальная правка без немедленного сетевого сохранения');

    expect(updateChapter).not.toHaveBeenCalled();
    expect(screen.getByText('Есть несохранённые правки')).toBeTruthy();
    expect(storedKeys()).toEqual({ local: [], session: [] });
  });

  it('renders empty draft state when the project list is empty', async () => {
    renderDraft(undefined, undefined, (api) => {
      vi.spyOn(api, 'listProjects').mockResolvedValueOnce({ data: [], meta: { hasMore: false, nextCursor: null } });
    });

    expect(await screen.findByText('В проекте пока нет глав для черновика.')).toBeTruthy();
  });

  it.each([
    [401, 'Сессия истекла. Войдите снова, и мы вернем вас к черновику.'],
    [403, 'Нет доступа к этому черновику.'],
    [500, 'Сервис временно недоступен. Попробуйте снова.'],
  ])('maps API load status %i to a distinct draft state', async (status, message) => {
    renderDraft(undefined, undefined, (api) => {
      vi.spyOn(api, 'getChapter').mockRejectedValueOnce(statusError(status, message));
    });

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('maps network load failure to a recoverable draft error', async () => {
    renderDraft(undefined, undefined, (api) => {
      vi.spyOn(api, 'getChapter').mockRejectedValueOnce(new NetworkApiError(new TypeError('offline')));
    });

    expect(await screen.findByText('Не удалось подключиться к серверу. Проверьте соединение и попробуйте снова.')).toBeTruthy();
  });

  it('renders the unified project sidebar and surfaces saga chat creation failures in the sidebar', async () => {
    const { api, navigate } = renderDraft();

    expect(await screen.findByRole('heading', { name: '16. Возвращение к записи' })).toBeTruthy();
    // The draft uses the same shared ProjectSidebar — nav is Рукопись + Чат only.
    expect(screen.queryByRole('button', { name: 'Обзор' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Материалы' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Чат' }));
    expect(navigate).toHaveBeenCalledWith('/chat', { projectId: 'project-white-port', chatId: 'chat-white-port' });

    vi.spyOn(api, 'createChatSession').mockRejectedValueOnce(new Error('Не удалось создать чат.'));
    fireEvent.click(screen.getByRole('button', { name: 'Новый чат' }));
    expect(await screen.findByText('Не удалось создать чат.')).toBeTruthy();
  });

  it('clears local logout even if server logout fails in the draft shell', async () => {
    const { api, onLogout } = renderDraft();

    expect(await screen.findByRole('heading', { name: '16. Возвращение к записи' })).toBeTruthy();
    vi.spyOn(api, 'logout').mockRejectedValueOnce(new Error('Не удалось выйти.'));
    fireEvent.click(screen.getByRole('button', { name: 'Личный кабинет' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });

  it('creates a new chapter from manuscript draft mode and routes to the created draft', async () => {
    const { navigate } = renderDraft('/manuscript/books', {
      bookId: 'book-02',
      mode: 'draft',
      newChapter: '1',
      projectId: 'project-white-port',
    });
    const editor = await screen.findByRole('textbox', { name: 'Текст черновика' });

    expect(screen.getByRole('heading', { name: '17. Новая глава' })).toBeTruthy();
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        '/manuscript/books',
        expect.objectContaining({ bookId: 'book-02', chapterId: 'chapter-02-17', mode: 'draft' }),
      ),
    );
  });

  it('renders the mobile draft toolbar and keeps formatting scoped to the editor', async () => {
    vi.stubGlobal('innerWidth', 390);
    const { navigate } = renderDraft();

    const editor = await screen.findByRole('textbox', { name: 'Текст черновика' });
    await replaceEditorText(editor, 'мобильная строка');
    fireEvent.click(screen.getByRole('button', { name: 'Жирный' }));

    expect(editorText(editor)).toBe('мобильная строка');
    expect(screen.queryByRole('button', { name: 'Агент' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Чтение' }));
    expect(screen.getByRole('button', { name: 'Чтение' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Жирный' })).toBeNull();
    expect(navigate).not.toHaveBeenCalledWith('/manuscript/books', expect.objectContaining({ mode: 'read' }));
  });
});
