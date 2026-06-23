import { describe, expect, it } from 'vitest';
import type { ChatMessage, ReaderLocator } from '../../entities/chat/api';
import { getArtifactReferenceIds, sameLocator } from '../../entities/chat/model';
import { appendStreamEvent, resolveReaderMode, toModalMode, toReaderMode } from './chat-model';

describe('chat model', () => {
  it('extracts reader artifact reference ids from chat messages', () => {
    const message = {
      references: [{ kind: 'reader_reference_artifact', artifactId: 'artifact-1' }, { kind: 'tool_call' }, { artifactId: 'artifact-2' }],
    } as unknown as ChatMessage;

    expect(getArtifactReferenceIds(message)).toEqual(['artifact-1', 'artifact-2']);
  });

  it('keeps stream activity bounded', () => {
    const events = ['one', 'two', 'three', 'four', 'five', 'six'];

    expect(appendStreamEvent(events, 'seven')).toEqual(['two', 'three', 'four', 'five', 'six', 'seven']);
  });

  it('parses reader and modal modes deterministically', () => {
    expect(toReaderMode('drawer')).toBe('drawer');
    expect(toReaderMode('sidecar')).toBeNull();
    expect(toModalMode('rename-chat')).toBe('rename-chat');
    expect(toModalMode('unknown')).toBeNull();
    expect(resolveReaderMode(390)).toBe('fullscreen');
    expect(resolveReaderMode(1024)).toBe('drawer');
    expect(resolveReaderMode(1440)).toBe('open');
  });

  it('compares reader locators including nullable paragraph ids', () => {
    const locator = { projectId: 'project-1', bookId: 'book-1', chapterId: 'chapter-1', paragraphId: 'p-1' } as ReaderLocator;

    expect(sameLocator(locator, { ...locator })).toBe(true);
    expect(sameLocator(locator, { ...locator, paragraphId: 'p-2' })).toBe(false);
    expect(sameLocator(locator, null)).toBe(false);
  });
});
