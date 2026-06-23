import { describe, expect, it } from 'vitest';
import { createMockApiClient, MockApiError } from './index';

async function collect<T>(iterable: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

function nextFrom<T>(iterable: AsyncIterable<T>) {
  return iterable[Symbol.asyncIterator]().next();
}

function importFileFixture(content: string): File {
  const bytes = new TextEncoder().encode(content);
  return {
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    lastModified: 1,
    name: 'same.epub',
    size: bytes.byteLength,
    type: 'application/epub+zip',
  } as File;
}

describe('mock API repository', () => {
  it('keeps state in memory and resets to seeded data', async () => {
    const api = createMockApiClient();
    const created = await api.createChatSession('project-white-port', { title: 'Новая ветка' });

    expect(created.title).toBe('Новая ветка');
    expect((await api.listChatSessions('project-white-port')).data).toHaveLength(4);

    api.reset();
    expect((await api.listChatSessions('project-white-port')).data).toHaveLength(3);
  });

  it('streams typed SSE events and exposes reader-reference artifacts', async () => {
    const api = createMockApiClient();
    const turn = await api.createChatTurn('chat-white-port', { content: 'Проверь порт', contextLocators: [] }, { idempotencyKey: 'idem-direct-chat-events' });
    const beforeStream = await api.getChatTurn(turn.turnId);
    expect(beforeStream.latestEventId).toBeNull();
    expect(beforeStream.messages.map((message) => message.id)).toEqual([turn.userMessageId]);

    await expect(nextFrom(api.streamChatTurnEvents(turn.turnId, { afterEventId: '' }))).rejects.toMatchObject({ status: 400 });
    await expect(nextFrom(api.streamChatTurnEvents(turn.turnId, { lastEventId: '' }))).rejects.toMatchObject({ status: 400 });

    const events = await collect(api.streamChatTurnEvents(turn.turnId, { afterEventId: beforeStream.latestEventId ?? undefined }));

    expect(events.map((event) => event.data.type)).toEqual([
      'job.progress',
      'assistant.delta',
      'artifact.ready',
      'turn.completed',
    ]);
    expect(JSON.stringify(events)).toContain('reader_reference_artifact');

    const artifact = await api.getChatArtifact('artifact-reader-references-1');
    expect(artifact.readerReferences?.[0]?.locator.paragraphId).toBe('p-12-03');
    await expect(api.getChatTurn(turn.turnId)).resolves.toMatchObject({ latestEventId: 'evt_004' });
  });

  it('completes concurrent chat turn streams idempotently', async () => {
    const api = createMockApiClient();
    const turn = await api.createChatTurn('chat-white-port', { content: 'Проверь повтор потока', contextLocators: [] }, { idempotencyKey: 'idem-direct-chat-concurrent-stream' });

    const [firstEvents, secondEvents] = await Promise.all([
      collect(api.streamChatTurnEvents(turn.turnId)),
      collect(api.streamChatTurnEvents(turn.turnId)),
    ]);

    expect(firstEvents.at(-1)?.data.type).toBe('turn.completed');
    expect(secondEvents.at(-1)?.data.type).toBe('turn.completed');
    const snapshot = await api.getChatTurn(turn.turnId);
    expect(snapshot.messages.map((message) => message.id)).toEqual([turn.userMessageId, `message-assistant-${turn.turnId}`]);
    expect(snapshot.artifacts.map((artifact) => artifact.id)).toEqual(['artifact-reader-references-1']);
    expect(snapshot.suggestions).toEqual([]);
  });

  it('rejects non-chat job ids on chat turn snapshot and stream endpoints', async () => {
    const api = createMockApiClient();

    await expect(api.getChatTurn('index-job-1')).rejects.toMatchObject({
      message: 'Resource not found.',
      operationId: 'getChatTurn',
      status: 404,
    });
    await expect(collect(api.streamChatTurnEvents('index-job-1'))).rejects.toMatchObject({
      message: 'Resource not found.',
      operationId: 'streamChatTurnEvents',
      status: 404,
    });
  });

  it('makes deleted book content immediately invisible from derived mock surfaces', async () => {
    const api = createMockApiClient();
    const exportRun = await api.createBookExport('book-02', { format: 'epub' }, { idempotencyKey: 'idem-direct-deleted-book-export' });

    await api.deleteBook('book-02');

    await expect(api.getBook('book-02')).rejects.toMatchObject({ operationId: 'getBook', status: 404 });
    await expect(api.getChapter('chapter-12')).rejects.toMatchObject({ operationId: 'getChapter', status: 404 });
    await expect(api.deleteReaderAnnotation('annotation-1')).rejects.toMatchObject({ operationId: 'deleteReaderAnnotation', status: 404 });
    await expect(api.getAgentSuggestion('suggestion-punctuation-1')).rejects.toMatchObject({ operationId: 'getAgentSuggestion', status: 404 });
    await expect(api.getChatArtifact('artifact-reader-references-1')).rejects.toMatchObject({ operationId: 'getChatArtifact', status: 404 });
    await expect(api.getJob(exportRun.jobId)).rejects.toMatchObject({ operationId: 'getJob', status: 404 });

    const search = await api.searchProject('project-white-port', 'порт');
    expect(search.data).toEqual([]);
  });

  it('makes deleted chat sessions immediately invisible from turn and event-log reads', async () => {
    const api = createMockApiClient();
    const turn = await api.createChatTurn('chat-white-port', { content: 'Проверь удаление чата', contextLocators: [] }, { idempotencyKey: 'idem-direct-deleted-chat-turn' });

    await api.deleteChatSession('chat-white-port');

    await expect(api.getChatSession('chat-white-port')).rejects.toMatchObject({ operationId: 'getChatSession', status: 404 });
    await expect(api.getChatTurn(turn.turnId)).rejects.toMatchObject({ operationId: 'getChatTurn', status: 404 });
    await expect(collect(api.streamChatTurnEvents(turn.turnId))).rejects.toMatchObject({ operationId: 'streamChatTurnEvents', status: 404 });
    await expect(api.getChatArtifact('artifact-reader-references-1')).rejects.toMatchObject({ operationId: 'getChatArtifact', status: 404 });

    const chatJobs = await api.listProjectJobs('project-white-port', { kind: 'chat_turn' });
    expect(chatJobs.data).toEqual([]);
  });

  it('rejects protected direct repository operations after logout', async () => {
    const api = createMockApiClient();

    await expect(api.listProjects()).resolves.toMatchObject({ data: expect.any(Array) });
    await api.logout();

    await expect(api.getCurrentUser()).rejects.toMatchObject({ operationId: 'getCurrentUser', status: 401 });
    await expect(api.listProjects()).rejects.toMatchObject({ operationId: 'listProjects', status: 401 });
    await expect(api.createBook('project-white-port', { title: 'После выхода' })).rejects.toMatchObject({ operationId: 'createBook', status: 401 });

    api.setScenario({ preset: 'forbidden-403' });
    await expect(api.listProjects()).rejects.toMatchObject({ operationId: 'listProjects', status: 401 });
    api.setScenario({ preset: 'request-error' });
    await expect(api.createBook('project-white-port', { title: 'После выхода' })).rejects.toMatchObject({ operationId: 'createBook', status: 401 });

    api.setScenario({ preset: 'normal' });
    await api.login({ email: 'mira@example.com', password: 'white-port-12', rememberMe: false });
    await expect(api.listProjects()).resolves.toMatchObject({ data: expect.any(Array) });
  });

  it('filters and paginates shared project jobs by kind', async () => {
    const api = createMockApiClient();
    await api.startProjectIndexing('project-white-port', { scope: 'project' }, { idempotencyKey: 'idem-direct-jobs-index' });
    await api.createChatTurn('chat-white-port', { content: 'Проверь список задач', contextLocators: [] }, { idempotencyKey: 'idem-direct-jobs-chat' });

    const firstIndexingPage = await api.listProjectJobs('project-white-port', { kind: 'indexing', limit: 1 });
    expect(firstIndexingPage.data).toHaveLength(1);
    expect(firstIndexingPage.data.every((job) => job.kind === 'indexing')).toBe(true);
    expect(firstIndexingPage.meta.hasMore).toBe(true);
    if (!firstIndexingPage.meta.nextCursor) {
      throw new Error('Expected indexing jobs to return a next cursor.');
    }

    const secondIndexingPage = await api.listProjectJobs('project-white-port', {
      cursor: firstIndexingPage.meta.nextCursor,
      kind: 'indexing',
      limit: 1,
    });
    expect(secondIndexingPage.data).toHaveLength(1);
    expect(secondIndexingPage.data.every((job) => job.kind === 'indexing')).toBe(true);
    expect(secondIndexingPage.meta.hasMore).toBe(false);

    const chatJobs = await api.listProjectJobs('project-white-port', { kind: 'chat_turn', limit: 5 });
    expect(chatJobs.data.length).toBeGreaterThan(0);
    expect(chatJobs.data.every((job) => job.kind === 'chat_turn')).toBe(true);
    await expect(api.listProjectJobs('project-white-port', {
      cursor: firstIndexingPage.meta.nextCursor,
      kind: 'chat_turn',
      limit: 1,
    })).rejects.toMatchObject({ operationId: 'listProjectJobs', status: 400 });
  });

  it('paginates contract list endpoints and rejects stale annotation locator revisions', async () => {
    const api = createMockApiClient();

    const firstBooksPage = await api.listBooks('project-white-port', { limit: 1 });
    expect(firstBooksPage.data).toHaveLength(1);
    expect(firstBooksPage.meta.nextCursor).toBeTruthy();
    const secondBooksPage = await api.listBooks('project-white-port', {
      cursor: firstBooksPage.meta.nextCursor,
      limit: 1,
    });
    expect(secondBooksPage.data[0]?.id).not.toBe(firstBooksPage.data[0]?.id);

    await expect(api.listChapterAnnotations('chapter-12', { cursor: 'bad-cursor', limit: 1 })).rejects.toMatchObject({
      operationId: 'listChapterAnnotations',
      status: 400,
    });
    await expect(api.listAgentSuggestions('chapter-16', { limit: 1, status: 'pending' })).resolves.toMatchObject({
      data: [expect.objectContaining({ status: 'pending' })],
    });
    await expect(api.createChapterAnnotation('chapter-12', {
      body: 'Старая привязка',
      kind: 'note',
      locator: {
        bookId: 'book-02',
        chapterId: 'chapter-12',
        paragraphId: 'p-12-03',
        projectId: 'project-white-port',
        range: null,
        revision: 0,
        targetView: 'published',
      },
      quote: null,
      tags: [],
    })).rejects.toMatchObject({
      message: 'Annotation locator revision is stale.',
      operationId: 'createChapterAnnotation',
      status: 409,
    });
  });

  it('validates import file controls and keeps book reorder commands out of book resources', async () => {
    const api = createMockApiClient();

    await expect(
      api.importBookFile(
        'project-white-port',
        { file: new File(['binary'], 'draft.exe', { type: 'application/octet-stream' }) },
        { idempotencyKey: 'idem-direct-bad-import-type' },
      ),
    ).rejects.toMatchObject({
      message: 'Import file type is not supported.',
      operationId: 'importBookFile',
      status: 415,
    });

    const moved = await api.updateBook('book-02', { afterBookId: null });
    expect(moved).not.toHaveProperty('afterBookId');
    expect(moved).toMatchObject({
      displayNumber: 'I',
      order: 1,
    });

    const books = await api.listBooks('project-white-port');
    expect(books.data.map((book) => book.id).slice(0, 2)).toEqual(['book-02', 'book-01']);
    expect(books.data.every((book) => !Object.hasOwn(book, 'afterBookId'))).toBe(true);
  });

  it('inserts chapters by afterChapterId without leaking duplicate ids or orders', async () => {
    const api = createMockApiClient();

    await expect(api.createChapter('book-02', { title: 'Потерянная вставка', afterChapterId: 'chapter-missing' })).rejects.toMatchObject({
      message: 'Resource not found.',
      operationId: 'createChapter',
      status: 404,
    });

    const first = await api.createChapter('book-02', { title: 'Вставка 1', afterChapterId: 'chapter-12' });
    const second = await api.createChapter('book-02', { title: 'Вставка 2', afterChapterId: 'chapter-12' });
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ order: 13, contentVariant: 'draft' });
    expect(second).toMatchObject({ order: 13, contentVariant: 'draft' });

    const chapters = await api.listChapters('book-02');
    const orders = chapters.data.map((chapter) => chapter.order);
    const ids = chapters.data.map((chapter) => chapter.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(orders).size).toBe(orders.length);
    expect(chapters.data.map((chapter) => chapter.id).slice(0, 3)).toEqual(['chapter-12', second.id, first.id]);
  });

  it('enforces direct repository idempotency replay, mismatch and creator cancel semantics', async () => {
    const api = createMockApiClient();
    const body = { content: 'Проверь порт', contextLocators: [] };

    await expect(api.createChatTurn('chat-white-port', body, undefined as never)).rejects.toMatchObject({
      operationId: 'createChatTurn',
      status: 400,
    });
    const firstTurn = await api.createChatTurn('chat-white-port', body, { idempotencyKey: 'idem-direct-chat' });
    const replayedTurn = await api.createChatTurn('chat-white-port', body, { idempotencyKey: 'idem-direct-chat' });
    expect(replayedTurn).toMatchObject({ jobId: firstTurn.jobId, turnId: firstTurn.turnId, userMessageId: firstTurn.userMessageId });
    await expect(api.createChatTurn('chat-white-port', { ...body, content: 'Другой запрос' }, { idempotencyKey: 'idem-direct-chat' })).rejects.toMatchObject({
      operationId: 'createChatTurn',
      status: 409,
    });

    const importInput = {
      file: importFileFixture('aaaa'),
      metadata: { title: 'Same import' },
      options: { importMode: 'append' as const },
    };
    const firstImport = await api.importBookFile('project-white-port', importInput, { idempotencyKey: 'idem-direct-import-file' });
    const replayedImport = await api.importBookFile('project-white-port', importInput, { idempotencyKey: 'idem-direct-import-file' });
    expect(replayedImport.jobId).toBe(firstImport.jobId);
    await expect(api.importBookFile('project-white-port', {
      ...importInput,
      file: importFileFixture('bbbb'),
    }, { idempotencyKey: 'idem-direct-import-file' })).rejects.toMatchObject({
      operationId: 'importBookFile',
      status: 409,
    });

    api.setScenario({ preset: 'normal', actorRole: 'editor' });
    const indexRun = await api.startProjectIndexing('project-white-port', { scope: 'project' }, { idempotencyKey: 'idem-direct-index' });
    expect(indexRun.job).toMatchObject({ canCancel: true, status: 'queued' });
    await expect(api.cancelJob(indexRun.jobId)).resolves.toMatchObject({ status: 'canceling' });

    api.setScenario({ preset: 'normal', actorRole: 'owner' });
    const exportRun = await api.createBookExport('book-02', { format: 'epub' }, { idempotencyKey: 'idem-direct-export' });
    expect(exportRun.job).toMatchObject({ canCancel: true, status: 'running' });
    await expect(api.cancelJob(exportRun.jobId)).resolves.toMatchObject({ status: 'canceling' });
    const canceledExport = await api.getJob(exportRun.jobId);
    expect(canceledExport.status).toBe('canceled');
    expect(canceledExport.canCancel).toBe(false);
    expect(JSON.stringify(canceledExport.result)).not.toContain('/mock-downloads/');
    await expect(api.getBook('book-02')).resolves.toMatchObject({
      status: 'ready',
      indexing: expect.objectContaining({ status: 'ready' }),
    });

    api.setScenario({ preset: 'export-ready', actorRole: 'owner' });
    const finishedExport = await api.createBookExport('book-02', { format: 'epub' }, { idempotencyKey: 'idem-direct-export-finished' });
    expect(finishedExport.job).toMatchObject({ canCancel: false, status: 'succeeded' });
  });

  it('supports backend-created agent suggestion approve and reject transitions', async () => {
    const api = createMockApiClient();

    const approved = await api.approveAgentSuggestion('suggestion-punctuation-1', { expectedChapterRevision: 9 });
    expect(approved.suggestion.status).toBe('accepted');
    await expect(api.approveAgentSuggestion('suggestion-punctuation-1', { expectedChapterRevision: 10 })).rejects.toMatchObject({
      operationId: 'approveAgentSuggestion',
      status: 409,
    });

    api.reset();
    await expect(api.rejectAgentSuggestion('suggestion-punctuation-1', { expectedChapterRevision: 8 })).rejects.toMatchObject({
      operationId: 'rejectAgentSuggestion',
      status: 409,
    });
    const rejected = await api.rejectAgentSuggestion('suggestion-punctuation-1', { expectedChapterRevision: 9 });
    expect(rejected.suggestion.status).toBe('rejected');
    await expect(api.rejectAgentSuggestion('suggestion-punctuation-1', { expectedChapterRevision: 9 })).rejects.toMatchObject({
      operationId: 'rejectAgentSuggestion',
      status: 409,
    });
  });

  it('enforces owner governance for project deletion and membership changes', async () => {
    const api = createMockApiClient();

    api.setScenario({ preset: 'normal', actorRole: 'editor' });
    await expect(api.deleteProject('project-white-port')).rejects.toMatchObject({ operationId: 'deleteProject', status: 403 });

    api.setScenario({ preset: 'normal', actorRole: 'owner' });
    await expect(api.updateProjectMemberRole('project-white-port', 'member-owner', { role: 'viewer' })).rejects.toMatchObject({
      operationId: 'updateProjectMemberRole',
      status: 409,
    });
    await expect(api.removeProjectMember('project-white-port', 'member-owner')).rejects.toMatchObject({
      operationId: 'removeProjectMember',
      status: 409,
    });
    await expect(api.updateProject('project-white-port', { id: 'project-hijack', title: 'Нельзя менять id' } as never)).rejects.toMatchObject({
      operationId: 'updateProject',
      status: 400,
    });
    await expect(api.getProject('project-white-port')).resolves.toMatchObject({ id: 'project-white-port' });
    await expect(api.updateProjectMemberRole('project-white-port', 'member-collaborator', { role: 'owner' } as never)).rejects.toMatchObject({
      operationId: 'updateProjectMemberRole',
      status: 400,
    });
    await expect(api.updateProjectMemberRole('project-white-port', 'member-collaborator', { role: 'viewer' })).resolves.toMatchObject({
      id: 'member-collaborator',
      role: 'viewer',
    });
    await expect(api.removeProjectMember('project-white-port', 'member-collaborator')).resolves.toBeUndefined();
  });

  it('enforces invitation acceptance email, lifecycle and replay state in the direct repository', async () => {
    const api = createMockApiClient();

    api.setScenario({ preset: 'normal', actorRole: 'non_member', verifiedEmail: 'mira@example.com' });
    await expect(api.listMyProjectInvitations({ limit: 10 })).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'invitation-mira',
          project: { id: 'project-white-port', title: 'Белый порт' },
          inviter: { displayName: 'Мира Волкова', email: 'mira@example.com' },
        }),
      ],
    });
    await expect(api.acceptProjectInvitation('invitation-mira')).resolves.toMatchObject({
      id: 'member-invitation-mira',
      email: 'mira@example.com',
      role: 'editor',
      status: 'active',
      userId: 'user-mira',
    });
    await expect(api.getProject('project-white-port')).resolves.toMatchObject({
      currentMembership: expect.objectContaining({ role: 'editor', userId: 'user-mira' }),
      id: 'project-white-port',
    });
    api.setScenario({ preset: 'normal', actorRole: 'owner' });
    await expect(api.listProjectMembers('project-white-port')).resolves.toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({ email: 'mira@example.com', id: 'member-invitation-mira', role: 'editor', status: 'active', userId: 'user-mira' }),
      ]),
    });
    api.setScenario({ preset: 'normal', actorRole: 'non_member', verifiedEmail: 'mira@example.com' });
    await expect(api.acceptProjectInvitation('invitation-mira')).rejects.toMatchObject({
      message: 'Invitation is not pending.',
      operationId: 'acceptProjectInvitation',
      status: 409,
    });

    api.reset();
    api.setScenario({ preset: 'normal', actorRole: 'editor', verifiedEmail: 'mira@example.com' });
    await expect(api.acceptProjectInvitation('invitation-mira')).rejects.toMatchObject({
      message: 'Нет доступа к этому проекту.',
      operationId: 'acceptProjectInvitation',
      status: 403,
    });

    api.setScenario({ preset: 'normal', actorRole: 'non_member', verifiedEmail: 'other@example.com' });
    await expect(api.acceptProjectInvitation('invitation-mira')).rejects.toMatchObject({
      message: 'Resource not found.',
      operationId: 'acceptProjectInvitation',
      status: 404,
    });
    await expect(api.acceptProjectInvitation('invitation-accepted')).rejects.toMatchObject({
      message: 'Resource not found.',
      operationId: 'acceptProjectInvitation',
      status: 404,
    });
    await expect(api.acceptProjectInvitation('invitation-canceled')).rejects.toMatchObject({
      message: 'Resource not found.',
      operationId: 'acceptProjectInvitation',
      status: 404,
    });

    api.setScenario({ preset: 'normal', actorRole: 'non_member', emailVerified: false, verifiedEmail: 'mira@example.com' });
    await expect(api.acceptProjectInvitation('invitation-mira')).rejects.toMatchObject({
      message: 'Resource not found.',
      operationId: 'acceptProjectInvitation',
      status: 404,
    });

    api.setScenario({ preset: 'normal', actorRole: 'non_member' });
    await expect(api.acceptProjectInvitation('invitation-1')).rejects.toMatchObject({ status: 404 });
    await expect(api.acceptProjectInvitation('invitation-accepted')).rejects.toMatchObject({ status: 404 });
    await expect(api.acceptProjectInvitation('invitation-canceled')).rejects.toMatchObject({ status: 404 });
    await expect(api.acceptProjectInvitation('invitation-missing-123')).rejects.toMatchObject({
      message: 'Resource not found.',
      operationId: 'acceptProjectInvitation',
      status: 404,
    });
  });

  it('rejects registration when accepted terms are missing or false', async () => {
    const api = createMockApiClient();

    await expect(
      api.register({ acceptedTerms: false, displayName: 'Новый автор', email: 'new-author@example.test', password: 'white-port-12' } as never),
    ).rejects.toMatchObject({ operationId: 'registerUser', status: 400 });
    await expect(api.register({ displayName: 'Новый автор', email: 'new-author@example.test', password: 'white-port-12' } as never)).rejects.toMatchObject({
      operationId: 'registerUser',
      status: 400,
    });
  });

  it('rejects non-canonical chat and agent command fields in the direct repository', async () => {
    const api = createMockApiClient();

    await expect(
      api.createChatTurn(
        'chat-white-port',
        { agentOptions: { scope: 'chapter' }, content: 'Проверь сцену', contextLocators: [], stream: true } as never,
        { idempotencyKey: 'idem-direct-chat-extra-field' },
      ),
    ).rejects.toMatchObject({ operationId: 'createChatTurn', status: 400 });
    await expect(api.createChatTurn('chat-white-port', { content: 'Проверь сцену', contextLocators: [] }, { idempotencyKey: 'short' })).rejects.toMatchObject({
      operationId: 'createChatTurn',
      status: 400,
    });
    await expect(
      api.createChatTurn('chat-white-port', { content: 'Проверь сцену', contextLocators: [] }, { idempotencyKey: 'x'.repeat(129) }),
    ).rejects.toMatchObject({
      operationId: 'createChatTurn',
      status: 400,
    });

    await expect(
      api.startAgentRun(
        'chapter-16',
        { expectedChapterRevision: 9, prompt: 'Проверь сцену', selectionQuote: 'x'.repeat(501) },
        { idempotencyKey: 'idem-direct-agent-long-selection' },
      ),
    ).rejects.toMatchObject({ operationId: 'startAgentRun', status: 400 });
  });

  it('replays direct agent run idempotency before revision conflict for the same payload', async () => {
    const api = createMockApiClient();
    const body = { expectedChapterRevision: 9, prompt: 'Проверь сцену' };
    const options = { idempotencyKey: 'idem-direct-agent-replay' };

    const first = await api.startAgentRun('chapter-16', body, options);
    await api.updateChapter('chapter-16', { expectedRevision: 9, title: 'Обновленная глава' });

    await expect(api.startAgentRun('chapter-16', body, options)).resolves.toMatchObject({ runId: first.runId, jobId: first.jobId });
    await expect(api.startAgentRun('chapter-16', { ...body, prompt: 'Другой запрос' }, options)).rejects.toMatchObject({
      operationId: 'startAgentRun',
      status: 409,
    });
    await expect(api.startAgentRun('chapter-16', body, { idempotencyKey: 'idem-direct-agent-new' })).rejects.toMatchObject({
      operationId: 'startAgentRun',
      status: 409,
    });
  });

  it('keeps direct-id miss messages generic and rejects unsupported search filters', async () => {
    const api = createMockApiClient();

    await expect(api.getJob('job-missing-123')).rejects.toMatchObject({
      message: 'Resource not found.',
      operationId: 'getJob',
      status: 404,
    });
    await expect(api.searchProject('project-white-port', 'port', 'all', { filters: { unsupported: true } as never })).rejects.toMatchObject({
      message: 'Search filters contain unsupported keys.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(api.searchProject('project-white-port', 'x'.repeat(501), 'all')).rejects.toMatchObject({
      message: 'Search query must be 500 characters or fewer.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(api.searchProject('project-white-port', '', 'all')).rejects.toMatchObject({
      message: 'Search query must be a non-empty string.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(api.searchProject('project-white-port', 'port', 'bad-scope' as never)).rejects.toMatchObject({
      message: 'Search scope is invalid.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(api.searchProject('project-white-port', 'port', 'all', { limit: 51 })).rejects.toMatchObject({
      message: 'Search limit must be an integer between 1 and 50.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(api.searchProject('project-white-port', 'port', 'all', { filters: { bookId: 123 } as never })).rejects.toMatchObject({
      message: 'Search ID filters must be non-empty strings.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(api.searchProject('project-white-port', 'port', 'all', { filters: { chapterId: false } as never })).rejects.toMatchObject({
      message: 'Search ID filters must be non-empty strings.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(api.searchProject('project-white-port', 'port', 'all', { filters: { resultKinds: ['chapter', 'chapter'] } as never })).rejects.toMatchObject({
      message: 'Search resultKinds filter is invalid.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(
      api.searchProject('project-white-port', 'port', 'all', {
        filters: { resultKinds: ['chapter', 'annotation', 'unknown-kind'] } as never,
      }),
    ).rejects.toMatchObject({
      message: 'Search resultKinds filter is invalid.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(api.searchProject('project-white-port', 'port', 'all', { unsupported: true } as never)).rejects.toMatchObject({
      message: 'Search request contains unsupported keys.',
      operationId: 'searchProject',
      status: 400,
    });
    await expect(api.searchProject('project-white-port', 'port', 'all', { signal: new AbortController().signal })).resolves.toMatchObject({ query: 'port' });
  });

  it('injects deterministic fallback scenarios through the API boundary', async () => {
    const api = createMockApiClient();

    api.setScenario({ preset: 'auth-401' });
    await expect(api.getCurrentUser()).rejects.toMatchObject({ status: 401 });
    await expect(api.listMyProjectInvitations()).rejects.toMatchObject({ operationId: 'listMyProjectInvitations', status: 401 });
    await expect(api.createBook('project-white-port', { title: 'Закрытая книга' })).rejects.toMatchObject({ operationId: 'createBook', status: 401 });
    await expect(api.createChatSession('project-white-port', { title: 'Закрытый чат' })).rejects.toMatchObject({
      operationId: 'createChatSession',
      status: 401,
    });
    await expect(api.getChatArtifact('artifact-reader-references-1')).rejects.toMatchObject({ operationId: 'getChatArtifact', status: 401 });

    api.setScenario({ preset: 'forbidden-403' });
    await expect(api.deleteBook('book-02')).rejects.toMatchObject({ operationId: 'deleteBook', status: 403 });
    await expect(api.updateReaderAnnotation('annotation-1', { body: 'x', kind: 'note' })).rejects.toMatchObject({
      operationId: 'updateReaderAnnotation',
      status: 403,
    });

    api.setScenario({ preset: 'empty-lists' });
    await expect(api.listProjects()).resolves.toMatchObject({ data: [] });

    api.setScenario({ preset: 'normal', actorRole: 'non_member' });
    await expect(api.listProjects()).resolves.toMatchObject({ data: [] });

    api.setScenario({ preset: 'normal', actorRole: 'editor' });
    await expect(api.cancelJob('index-job-1')).rejects.toMatchObject({ operationId: 'cancelJob', status: 403 });

    api.setScenario({ preset: 'failed-create' });
    await expect(api.createChatSession('project-white-port', { title: 'x' })).rejects.toBeInstanceOf(MockApiError);

    api.setScenario({ preset: 'failed-select' });
    await expect(api.getChatSession('chat-white-port')).rejects.toMatchObject({ operationId: 'getChatSession' });

    api.setScenario({ preset: 'artifact-failure' });
    await expect(api.getChatArtifact('artifact-reader-references-1')).rejects.toMatchObject({ operationId: 'getChatArtifact' });

    api.setScenario({ preset: 'suggestion-failure' });
    await expect(api.listAgentSuggestions('chapter-16')).rejects.toMatchObject({ operationId: 'listAgentSuggestions' });

    api.setScenario({ preset: 'suggestion-empty' });
    await expect(api.listAgentSuggestions('chapter-16')).resolves.toMatchObject({ data: [] });

    api.setScenario({ preset: 'conflict' });
    await expect(api.updateChapter('chapter-12', { expectedRevision: 8 })).rejects.toMatchObject({ status: 409 });

    api.setScenario({ preset: 'indexing-cancel-error' });
    await expect(api.cancelJob('index-job-1')).resolves.toMatchObject({ status: 'canceling' });

    api.setScenario({ preset: 'export-ready' });
    const exportJob = await api.createBookExport('book-02', { format: 'epub' }, { idempotencyKey: 'idem-direct-export-ready' });
    await expect(api.getJob(exportJob.jobId)).resolves.toMatchObject({ status: 'succeeded' });

    api.setScenario({ preset: 'export-error' });
    const failedExport = await api.createBookExport('book-02', { format: 'fb2' }, { idempotencyKey: 'idem-direct-export-error' });
    await expect(api.getJob(failedExport.jobId)).resolves.toMatchObject({ status: 'failed' });
  });
});
