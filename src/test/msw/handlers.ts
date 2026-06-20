import { http, HttpResponse } from 'msw';
import { MockRepository } from '../../api/mock/repository';
import { MockApiError, type MockScenarioControl, type MockScenarioPreset } from '../../api/mock/scenarios';
import type { OperationRequest } from '../../shared/api';
import { createAuthSession, mswUser } from './fixtures';

export const mswApiBaseUrl = 'http://localhost/api/v1';

type JsonObject = Record<string, unknown>;

interface AuthHandlersOptions {
  onLogin?: (body: { rememberMe?: unknown }) => void;
  onRegister?: (body: { acceptedTerms?: unknown; displayName?: unknown }) => void;
}

interface ChatHandlersOptions {
  preset?: MockScenarioPreset;
  scenario?: MockScenarioControl;
}

async function readJson(request: Request): Promise<JsonObject> {
  const body = await request.json();
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as JsonObject) : {};
}

export function createAuthHandlers(options: AuthHandlersOptions = {}) {
  return [
    http.post(`${mswApiBaseUrl}/auth/login`, async ({ request }) => {
      const body = await readJson(request);
      options.onLogin?.({ rememberMe: body.rememberMe });
      return HttpResponse.json(createAuthSession());
    }),
    http.post(`${mswApiBaseUrl}/auth/register`, async ({ request }) => {
      const body = await readJson(request);
      options.onRegister?.({ acceptedTerms: body.acceptedTerms, displayName: body.displayName });
      const displayName = typeof body.displayName === 'string' && body.displayName.length > 0 ? body.displayName : mswUser.displayName;
      return HttpResponse.json(createAuthSession({ ...mswUser, displayName }), { status: 201 });
    }),
  ];
}

export function createChatHandlers(options: ChatHandlersOptions = {}) {
  const repository = new MockRepository();
  repository.setScenario(options.scenario ?? { preset: options.preset ?? 'normal' });

  return [
    http.get(`${mswApiBaseUrl}/projects`, () => jsonResponse(() => repository.listProjects())),
    http.get(`${mswApiBaseUrl}/projects/:projectId`, ({ params }) => jsonResponse(() => repository.getProject(oneParam(params.projectId)))),
    http.get(`${mswApiBaseUrl}/projects/:projectId/books`, ({ params }) => jsonResponse(() => repository.listBooks(oneParam(params.projectId)))),
    http.get(`${mswApiBaseUrl}/books/:bookId/chapters`, ({ params }) => jsonResponse(() => repository.listChapters(oneParam(params.bookId)))),
    http.get(`${mswApiBaseUrl}/chapters/:chapterId`, ({ params }) => jsonResponse(() => repository.getChapter(oneParam(params.chapterId)))),
    http.get(`${mswApiBaseUrl}/projects/:projectId/chats`, ({ params }) => jsonResponse(() => repository.listChatSessions(oneParam(params.projectId)))),
    http.post(`${mswApiBaseUrl}/projects/:projectId/chats`, async ({ params, request }) =>
      jsonResponse(async () => repository.createChatSession(oneParam(params.projectId), (await readJson(request)) as OperationRequest<'createChatSession'>), {
        status: 201,
      }),
    ),
    http.get(`${mswApiBaseUrl}/chats/:chatId`, ({ params }) => jsonResponse(() => repository.getChatSession(oneParam(params.chatId)))),
    http.patch(`${mswApiBaseUrl}/chats/:chatId`, async ({ params, request }) =>
      jsonResponse(async () => repository.renameChatSession(oneParam(params.chatId), (await readJson(request)) as OperationRequest<'renameChatSession'>)),
    ),
    http.delete(`${mswApiBaseUrl}/chats/:chatId`, ({ params }) => emptyResponse(() => repository.deleteChatSession(oneParam(params.chatId)))),
    http.get(`${mswApiBaseUrl}/chats/:chatId/messages`, ({ params }) => jsonResponse(() => repository.listChatMessages(oneParam(params.chatId)))),
    http.post(`${mswApiBaseUrl}/chats/:chatId/messages`, async ({ params, request }) =>
      streamResponse(async () => repository.sendChatMessage(oneParam(params.chatId), (await readJson(request)) as OperationRequest<'sendChatMessage'>)),
    ),
    http.get(`${mswApiBaseUrl}/chat-artifacts/:artifactId`, ({ params }) => jsonResponse(() => repository.getChatArtifact(oneParam(params.artifactId)))),
    http.get(`${mswApiBaseUrl}/projects/:projectId/search`, ({ params, request }) => {
      const query = new URL(request.url).searchParams.get('q') ?? '';
      return jsonResponse(() => repository.searchProject(oneParam(params.projectId), query));
    }),
    http.get(`${mswApiBaseUrl}/chapters/:chapterId/agent-suggestions`, ({ params }) =>
      jsonResponse(() => repository.listAgentSuggestions(oneParam(params.chapterId))),
    ),
    http.get(`${mswApiBaseUrl}/agent-suggestions/:suggestionId`, ({ params }) =>
      jsonResponse(() => repository.getAgentSuggestion(oneParam(params.suggestionId))),
    ),
    http.post(`${mswApiBaseUrl}/agent-suggestions/:suggestionId/approve`, async ({ params, request }) =>
      jsonResponse(async () =>
        repository.approveAgentSuggestion(oneParam(params.suggestionId), (await readJson(request)) as OperationRequest<'approveAgentSuggestion'>),
      ),
    ),
    http.post(`${mswApiBaseUrl}/agent-suggestions/:suggestionId/reject`, ({ params }) =>
      jsonResponse(() => repository.rejectAgentSuggestion(oneParam(params.suggestionId))),
    ),
    http.post(`${mswApiBaseUrl}/auth/logout`, () => new Response(null, { status: 204 })),
  ];
}

function oneParam(value: string | readonly string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

async function jsonResponse<T>(load: () => Promise<T>, init?: ResponseInit) {
  try {
    const headers = new Headers(init?.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(await load()), { ...init, headers });
  } catch (error) {
    return problemResponse(error);
  }
}

async function emptyResponse(load: () => Promise<void>) {
  try {
    await load();
    return new Response(null, { status: 204 });
  } catch (error) {
    return problemResponse(error);
  }
}

async function streamResponse(load: () => Promise<AsyncIterable<unknown>>) {
  try {
    const frames: string[] = [];
    for await (const event of await load()) {
      frames.push(`data: ${JSON.stringify(event)}\n\n`);
    }
    return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } });
  } catch (error) {
    return problemResponse(error);
  }
}

function problemResponse(error: unknown) {
  if (error instanceof MockApiError) {
    return HttpResponse.json(
      {
        detail: error.message,
        status: error.status,
        title: error.message,
        type: 'about:blank',
      },
      { status: error.status },
    );
  }

  return HttpResponse.json(
    {
      detail: error instanceof Error ? error.message : 'Request failed',
      status: 500,
      title: 'Request failed',
      type: 'about:blank',
    },
    { status: 500 },
  );
}
