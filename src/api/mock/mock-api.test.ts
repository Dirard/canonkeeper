import { describe, expect, it } from 'vitest';
import { createMockApiClient, MockApiError } from './index';

async function collect<T>(iterable: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
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

  it('streams typed SSE events and exposes reader-reference trigger artifacts', async () => {
    const api = createMockApiClient();
    const events = await collect(api.sendChatMessage('chat-white-port', { content: 'Проверь порт', stream: true }));

    expect(events.map((event) => event.type)).toEqual([
      'reasoning_delta',
      'text_delta',
      'tool_call',
      'tool_result',
      'completed',
    ]);
    expect(JSON.stringify(events)).toContain('reader_references');

    const artifact = await api.getChatArtifact('artifact-reader-references-1');
    expect(artifact.readerReferences?.[0]?.locator.paragraphId).toBe('p-12-03');
  });

  it('supports backend-created agent suggestion approve and reject transitions', async () => {
    const api = createMockApiClient();

    const approved = await api.approveAgentSuggestion('suggestion-punctuation-1', { expectedChapterRevision: 9 });
    expect(approved.suggestion.status).toBe('accepted');

    api.reset();
    const rejected = await api.rejectAgentSuggestion('suggestion-punctuation-1');
    expect(rejected.suggestion.status).toBe('rejected');
  });

  it('injects deterministic fallback scenarios through the API boundary', async () => {
    const api = createMockApiClient();

    api.setScenario({ preset: 'auth-401' });
    await expect(api.getCurrentUser()).rejects.toMatchObject({ status: 401 });
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
    await expect(api.cancelIndexingJob('index-job-1')).rejects.toMatchObject({ operationId: 'cancelIndexingJob' });

    api.setScenario({ preset: 'export-ready' });
    const exportJob = await api.createBookExport('book-02', { format: 'epub' });
    await expect(api.getExportJob(exportJob.id)).resolves.toMatchObject({ status: 'ready' });

    api.setScenario({ preset: 'export-error' });
    await expect(api.getExportJob(exportJob.id)).resolves.toMatchObject({ status: 'failed' });
  });
});
