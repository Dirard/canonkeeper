import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, type RequestHandler } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanonKeeperApiClient } from '../../shared/api';
import { parseRoute } from '../../shared/navigation/app-route';
import { createChatHandlers, mswApiBaseUrl } from '../../test/msw/handlers';
import { mswServer } from '../../test/msw/server';
import { ChatPage } from './ChatPage';

function makeRoute(search = '') {
  return parseRoute(new URL(`http://localhost/chat${search}`));
}

function problem(status: number, title: string) {
  return HttpResponse.json({ detail: title, status, title, type: 'about:blank' }, { status });
}

function cancelingChatJob(jobId: string) {
  return {
    id: jobId,
    kind: 'chat_turn',
    status: 'canceling',
    progress: 0.2,
    subject: { type: 'chat_turn', id: 'turn-canceling', projectId: 'project-white-port' },
    result: { type: 'chat_turn', chatId: 'chat-white-port', turnId: 'turn-canceling', userMessageId: 'message-user-canceling', artifactId: null },
    error: null,
    canCancel: false,
    expiresAt: null,
    createdAt: '2026-06-16T05:00:00.000Z',
    updatedAt: '2026-06-16T05:00:00.000Z',
    links: { self: `/api/v1/jobs/${jobId}`, cancel: null, result: null },
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

async function authenticatedFetch(request: Request) {
  const headers = new Headers(request.headers);
  headers.set('cookie', 'ck_session=mock-session');
  headers.set('origin', 'http://localhost:3000');
  return fetch(request, { headers });
}

function renderChat(search = '', options: Parameters<typeof createChatHandlers>[0] = {}, extraHandlers: RequestHandler[] = []) {
  mswServer.use(...createChatHandlers(options));
  if (extraHandlers.length > 0) {
    mswServer.use(...extraHandlers);
  }
  const api = createCanonKeeperApiClient({ baseUrl: mswApiBaseUrl, fetch: authenticatedFetch });
  const navigate = vi.fn();
  const onLogout = vi.fn();
  const queryClient = createTestQueryClient();

  render(
    <QueryClientProvider client={queryClient}>
      <ChatPage api={api} navigate={navigate} onLogout={onLogout} route={makeRoute(search)} userName="Мира Волкова" />
    </QueryClientProvider>,
  );

  return { navigate, onLogout, queryClient };
}

describe('ChatPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  it('loads project sessions, switches current chat and uses account logout through MSW', async () => {
    const { onLogout } = renderChat();

    expect((await screen.findByRole('button', { name: /Пожар в Белом порту/ })).getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('button', { name: /Упоминания Мары/ }));

    const selected = await screen.findByRole('button', { name: /Упоминания Мары/ });
    expect(selected.getAttribute('aria-current')).toBe('page');
    expect(await screen.findByText(/Мара появляется в главах/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Хроники Белого порта/ }));
    expect(screen.getAllByText(/Хроники Белого порта/).length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Личный кабинет' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });

  it('hides draft assistance panel on plain chat routes', async () => {
    renderChat();

    await screen.findByRole('heading', { name: /Пожар в Белом порту/ });
    expect(screen.queryByText('Для этого черновика нет открытых предложений.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать чат' })).toBeNull();
  });

  it('keeps project viewer chat access read-only', async () => {
    renderChat('', { scenario: { preset: 'normal', actorRole: 'viewer' } });

    await screen.findByRole('heading', { name: /Пожар в Белом порту/ });
    expect(screen.getByRole('button', { name: 'Новый чат' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Переименовать чат' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Удалить чат' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Сообщение')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Сообщение')).toHaveProperty('placeholder', 'У вас доступ только для чтения');
    expect(screen.getByRole('button', { name: 'Отправить' })).toHaveProperty('disabled', true);
  });

  it('routes the desktop manuscript nav to the shipped manuscript surface', async () => {
    const { navigate } = renderChat();

    await screen.findByRole('button', { name: /Пожар в Белом порту/ });
    expect(screen.queryByRole('button', { name: 'Обзор' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Материалы' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Читалка' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Рукопись' })[0]!);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/manuscript/books', expect.objectContaining({ projectId: 'project-white-port' })));
  });

  it('keeps the mobile menu nav on the shipped chat and manuscript surfaces', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const { navigate } = renderChat('?menu=open');

    const drawer = await screen.findByRole('dialog', { name: 'Меню чата' });
    await within(drawer).findByRole('button', { name: /Пожар в Белом порту/ });

    expect(within(drawer).queryByRole('button', { name: 'Обзор' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Материалы' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Читалка' })).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Чат' })).toBeTruthy();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Рукопись' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/manuscript/books', expect.objectContaining({ projectId: 'project-white-port' })));
  });

  it('sends composer text through the SSE stream and fetches reader-reference artifacts', async () => {
    renderChat();

    const input = await screen.findByLabelText('Сообщение');
    fireEvent.change(input, { target: { value: 'Проверь, кто первым увидел дым' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(await screen.findByText(/Нашел фрагмент и подготовил ссылку/)).toBeTruthy();
    expect((await screen.findAllByText(/Мара первой заметила дым/)).length).toBeGreaterThan(0);
  });

  it('cancels the backend chat job when stopping an active stream', async () => {
    const cancelRequests: string[] = [];
    const encoder = new TextEncoder();
    renderChat('', {}, [
      http.get(`${mswApiBaseUrl}/chat-turns/:turnId/events`, () => {
        const progressEvent = {
          eventId: 'evt_waiting',
          sequence: 1,
          turnId: 'turn-waiting',
          jobId: 'chat-job-waiting',
          type: 'job.progress',
          data: { progress: 0.2, label: 'Задерживаем ответ' },
        };
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(progressEvent)}\n\n`));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }),
      http.post(`${mswApiBaseUrl}/jobs/:jobId/cancel`, ({ params }) => {
        const jobId = String(params.jobId);
        cancelRequests.push(jobId);
        return HttpResponse.json(cancelingChatJob(jobId));
      }),
    ]);

    const input = await screen.findByLabelText('Сообщение');
    fireEvent.change(input, { target: { value: 'Останови этот ответ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(await screen.findByText('Задерживаем ответ')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Остановить ответ' }));

    await waitFor(() => expect(cancelRequests).toHaveLength(1));
    expect(cancelRequests[0]).toMatch(/^chat-job-/);
    expect(await screen.findByText('Ответ остановлен.')).toBeTruthy();
  });

  it('cancels an active stream before switching to another chat', async () => {
    const cancelRequests: string[] = [];
    const encoder = new TextEncoder();
    renderChat('', {}, [
      http.get(`${mswApiBaseUrl}/chat-turns/:turnId/events`, () => {
        const progressEvent = {
          eventId: 'evt_waiting_switch',
          sequence: 1,
          turnId: 'turn-waiting-switch',
          jobId: 'chat-job-waiting-switch',
          type: 'job.progress',
          data: { progress: 0.2, label: 'Задерживаем ответ' },
        };
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(progressEvent)}\n\n`));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }),
      http.post(`${mswApiBaseUrl}/jobs/:jobId/cancel`, ({ params }) => {
        const jobId = String(params.jobId);
        cancelRequests.push(jobId);
        return HttpResponse.json(cancelingChatJob(jobId));
      }),
    ]);

    const input = await screen.findByLabelText('Сообщение');
    fireEvent.change(input, { target: { value: 'Останови перед переключением' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(await screen.findByText('Задерживаем ответ')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Упоминания Мары/ }));

    await waitFor(() => expect(cancelRequests).toHaveLength(1));
    expect(await screen.findByText(/Мара появляется в главах/)).toBeTruthy();
    expect(screen.queryByText('Задерживаем ответ')).toBeNull();
  });

  it('recovers an expired chat stream from the turn snapshot', async () => {
    renderChat('', {}, [
      http.get(`${mswApiBaseUrl}/chat-turns/:turnId/events`, () => problem(410, 'Chat turn event log expired.')),
      http.get(`${mswApiBaseUrl}/chat-turns/:turnId`, ({ params }) => {
        const turnId = String(params.turnId);
        const chatId = 'chat-white-port';
        return HttpResponse.json({
          turnId,
          job: {
            ...cancelingChatJob('chat-job-recovered'),
            id: 'chat-job-recovered',
            status: 'succeeded',
            progress: 1,
            subject: { type: 'chat_turn', id: turnId, projectId: 'project-white-port' },
            result: { type: 'chat_turn', chatId, turnId, userMessageId: 'message-user-recovered', artifactId: null },
            updatedAt: '2026-06-16T05:00:03.000Z',
          },
          status: 'completed',
          latestEventId: 'evt_recovered',
          messages: [
            {
              id: 'message-assistant-recovered',
              chatId,
              role: 'assistant',
              content: 'Восстановленный ответ из snapshot.',
              parts: [{ type: 'text', text: 'Восстановленный ответ из snapshot.', sequence: 1, status: 'completed' }],
              references: [],
              createdAt: '2026-06-16T05:00:03.000Z',
            },
          ],
          artifacts: [],
          suggestions: [],
          links: { events: `/chat-turns/${turnId}/events` },
        });
      }),
    ]);

    const input = await screen.findByLabelText('Сообщение');
    fireEvent.change(input, { target: { value: 'Восстанови истекший поток' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(await screen.findByText('Восстановленный ответ из snapshot.')).toBeTruthy();
    expect(screen.queryByText('Не удалось восстановить ответ. Обновите чат.')).toBeNull();
  });

  it('surfaces terminal chat turn failures as stream errors', async () => {
    renderChat('', {}, [
      http.get(`${mswApiBaseUrl}/chat-turns/:turnId/events`, () => {
        const failedEvent = {
          eventId: 'evt_failed',
          sequence: 1,
          turnId: 'turn-failed',
          jobId: 'chat-job-failed',
          type: 'turn.failed',
          data: { code: 'provider_failed' },
        };
        return new Response(`data: ${JSON.stringify(failedEvent)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      }),
    ]);

    const input = await screen.findByLabelText('Сообщение');
    fireEvent.change(input, { target: { value: 'Сломай поток' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect((await screen.findAllByText('Не удалось завершить ответ.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeTruthy();
  });

  it('opens exact reader targets from chat source cards and search results', async () => {
    const { navigate } = renderChat();

    const sourceButtons = await screen.findAllByRole('button', { name: /Открыть/ });
    fireEvent.click(sourceButtons[0]!);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/chat', expect.objectContaining({ reader: 'open' })));
    const reader = await screen.findByRole('document');
    expect(within(reader).getByText('Мара первой заметила дым с северной пристани.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть читалку' }));
    await waitFor(() => expect(document.activeElement).toBe(sourceButtons[0]));

    fireEvent.click(screen.getByRole('button', { name: 'Глобальный поиск' }));
    fireEvent.change(screen.getByLabelText('Запрос поиска'), { target: { value: 'Белый порт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    const searchResult = await screen.findByRole('button', { name: /Белый порт/ });
    fireEvent.click(searchResult);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/chat', expect.objectContaining({ reader: 'open' })));
    expect(within(await screen.findByRole('document')).getByText('Мара первой заметила дым с северной пристани.')).toBeTruthy();
  });

  it('renames and deletes the active chat through modal overlays', async () => {
    renderChat();

    await screen.findByRole('button', { name: /Пожар в Белом порту/ });
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать чат' }));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Переименовать чат' }), { key: 'Escape' });
    await waitFor(() => expect(document.body.style.overflow).toBe(''));

    fireEvent.click(screen.getByRole('button', { name: 'Переименовать чат' }));
    fireEvent.change(screen.getByDisplayValue('Пожар в Белом порту'), { target: { value: 'Новая линия пожара' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('button', { name: /Новая линия пожара/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить чат' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    const selected = await screen.findByRole('button', { name: /Упоминания Мары/ });
    expect(selected.getAttribute('aria-current')).toBe('page');
  });

  it('shows rename and delete failures, but clears local logout on failure', async () => {
    const { onLogout } = renderChat();

    await screen.findByRole('button', { name: /Пожар в Белом порту/ });
    mswServer.use(http.patch(`${mswApiBaseUrl}/chats/:chatId`, () => problem(500, 'Не удалось переименовать чат.')));
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать чат' }));
    const renameDialog = await screen.findByRole('dialog', { name: 'Переименовать чат' });
    fireEvent.change(within(renameDialog).getByDisplayValue('Пожар в Белом порту'), { target: { value: 'Сломанное имя' } });
    fireEvent.click(within(renameDialog).getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Сервис временно недоступен. Попробуйте снова.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Переименовать чат' })).toBeTruthy();

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Переименовать чат' })).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Переименовать чат' })).toBeNull());

    mswServer.use(http.delete(`${mswApiBaseUrl}/chats/:chatId`, () => problem(500, 'Не удалось удалить чат.')));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить чат' }));
    const deleteDialog = await screen.findByRole('dialog', { name: 'Удалить чат' });
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Удалить' }));

    expect(await screen.findByText('Сервис временно недоступен. Попробуйте снова.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Удалить чат' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Удалить чат' })).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Удалить чат' })).toBeNull());

    mswServer.use(http.post(`${mswApiBaseUrl}/auth/logout`, () => problem(500, 'Не удалось выйти.')));
    fireEvent.click(screen.getByRole('button', { name: 'Личный кабинет' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });

  it('covers search loading, empty and error states through MSW handlers', async () => {
    renderChat();

    await screen.findByRole('button', { name: /Пожар в Белом порту/ });
    mswServer.use(
      http.post(`${mswApiBaseUrl}/projects/:projectId/search`, async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
        return HttpResponse.json({ query: 'дым', scope: 'all', data: [], snippetPolicy: 'bounded_240_chars' });
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Глобальный поиск' }));
    fireEvent.change(screen.getByLabelText('Запрос поиска'), { target: { value: 'дым' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));

    expect(screen.getByText('Ищем...')).toBeTruthy();
    expect(await screen.findByText('Ничего не найдено в текущем проекте.')).toBeTruthy();

    mswServer.use(http.post(`${mswApiBaseUrl}/projects/:projectId/search`, () => problem(500, 'Поиск временно недоступен.')));
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));

    expect(await screen.findByText('Сервис временно недоступен. Попробуйте снова.')).toBeTruthy();
  });

  it('covers workspace loading, empty and auth/server/network failures at the API boundary', async () => {
    renderChat('', {}, [http.get(`${mswApiBaseUrl}/projects`, () => new Promise(() => {}))]);
    expect(screen.getByText('Загружаем чат...')).toBeTruthy();
    cleanup();

    renderChat('', { preset: 'empty-lists' });
    expect((await screen.findAllByText('В проекте пока нет чатов.')).length).toBeGreaterThan(0);
    cleanup();

    renderChat('', {}, [http.get(`${mswApiBaseUrl}/projects`, () => problem(401, 'Unauthorized'))]);
    expect(await screen.findByText('Сессия истекла. Войдите снова, и мы вернем вас к чату.')).toBeTruthy();
    cleanup();

    renderChat('', {}, [http.get(`${mswApiBaseUrl}/projects`, () => problem(403, 'Forbidden'))]);
    expect(await screen.findByText('Нет доступа к этому чату.')).toBeTruthy();
    cleanup();

    renderChat('', {}, [http.get(`${mswApiBaseUrl}/projects`, () => problem(500, 'Server error'))]);
    expect(await screen.findByText('Сервис временно недоступен. Попробуйте снова.')).toBeTruthy();
    cleanup();

    renderChat('', {}, [http.get(`${mswApiBaseUrl}/projects`, () => HttpResponse.error())]);
    expect(await screen.findByText('Не удалось подключиться к серверу. Проверьте соединение и попробуйте снова.')).toBeTruthy();
  });

  it('keeps the composer disabled when the selected project has no chats', async () => {
    renderChat('', {}, [
      http.get(`${mswApiBaseUrl}/projects/:projectId/chats`, () => HttpResponse.json({ data: [], meta: { hasMore: false, nextCursor: null } })),
    ]);

    expect((await screen.findAllByText('В проекте пока нет чатов.')).length).toBeGreaterThan(1);
    expect(screen.queryByText('В этом чате пока нет сообщений.')).toBeNull();
    expect(screen.getByLabelText('Сообщение')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Отправить' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Создать чат' })).toBeTruthy();
  });

  it('keeps stream errors recoverable before and during SSE rendering', async () => {
    renderChat();
    await screen.findByRole('button', { name: /Пожар в Белом порту/ });
    mswServer.use(http.post(`${mswApiBaseUrl}/chats/:chatId/turns`, () => problem(500, 'Stream failed')));

    const input = await screen.findByLabelText('Сообщение');
    fireEvent.change(input, { target: { value: 'Проверь связь источника' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(await screen.findByText('Сервис временно недоступен. Попробуйте снова.')).toBeTruthy();
    expect(screen.queryByText('Ответ остановлен')).toBeNull();
    cleanup();

    renderChat();
    await screen.findByRole('button', { name: /Пожар в Белом порту/ });
    mswServer.use(
      http.get(`${mswApiBaseUrl}/chat-turns/:turnId/events`, () => {
        const frames = Array.from({ length: 10 }, (_item, index) => {
          return `data: ${JSON.stringify({ eventId: `evt_${index}`, sequence: index + 1, turnId: 'turn-1', jobId: 'job-1', type: 'job.progress', data: { label: `stream step ${index}` } })}\n\n`;
        });
        frames.push('data: {"type":"assistant.delta"\n\n');
        return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } });
      }),
    );

    const nextInput = await screen.findByLabelText('Сообщение');
    fireEvent.change(nextInput, { target: { value: 'Проверь поток' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(await screen.findByText('Не удалось завершить ответ.')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/stream step/)).toHaveLength(6));
    expect(screen.queryByText('stream step 0')).toBeNull();
    expect(screen.getByLabelText('Сообщение')).toBeTruthy();
  });

  it('renders artifact retrieval failures from MSW without raw payload proof', async () => {
    renderChat('', {}, [http.get(`${mswApiBaseUrl}/chat-artifacts/:artifactId`, () => problem(500, 'Артефакт временно недоступен.'))]);

    expect(await screen.findByText('Сервис временно недоступен. Попробуйте снова.')).toBeTruthy();
  });

  it('owns draft assistance suggestions inside chat and preserves manuscript handoff context', async () => {
    const { navigate } = renderChat('?projectId=project-white-port&bookId=book-02&chapterId=chapter-16&paragraphId=p-16-04');

    expect(await screen.findByRole('heading', { name: '16. Возвращение к записи' })).toBeTruthy();
    expect(await screen.findByText('Добавить запятую после «молчал»')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(await screen.findByText('Предложение применено к черновику.')).toBeTruthy();
    expect(await screen.findByText('Принято')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Создать чат' }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        '/chat',
        expect.objectContaining({
          bookId: 'book-02',
          chapterId: 'chapter-16',
          chatId: 'chat-4',
          paragraphId: 'p-16-04',
          projectId: 'project-white-port',
        }),
      ),
    );
  });

  it('rejects draft assistance suggestions without leaving chat', async () => {
    renderChat('?projectId=project-white-port&bookId=book-02&chapterId=chapter-16');

    expect(await screen.findByText('Добавить запятую после «молчал»')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    expect(await screen.findByText('Предложение отклонено.')).toBeTruthy();
    expect(await screen.findByText('Отклонено')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Пожар в Белом порту/ })).toBeTruthy();
  });
});
