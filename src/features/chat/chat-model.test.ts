import { describe, expect, it } from 'vitest';
import type { ChatMessage, ReaderLocator } from '../../entities/chat/api';
import { extractArtifactId, getArtifactTriggerIds, sameLocator, stripInlineTriggers } from '../../entities/chat/model';
import { appendStreamEvent, resolveReaderMode, toModalMode, toReaderMode } from './chat-model';

describe('chat model', () => {
  it('extracts reader reference trigger ids from chat messages', () => {
    const message = {
      triggers: [{ kind: 'reader_references', artifactId: 'artifact-1' }, { kind: 'tool_call' }, { artifactId: 'artifact-2' }],
    } as unknown as ChatMessage;

    expect(getArtifactTriggerIds(message)).toEqual(['artifact-1', 'artifact-2']);
  });

  it('keeps stream activity bounded', () => {
    const events = ['one', 'two', 'three', 'four', 'five', 'six'];

    expect(appendStreamEvent(events, 'seven')).toEqual(['two', 'three', 'four', 'five', 'six', 'seven']);
  });

  it('parses modes and artifact ids deterministically', () => {
    expect(toReaderMode('drawer')).toBe('drawer');
    expect(toReaderMode('sidecar')).toBeNull();
    expect(toModalMode('rename-chat')).toBe('rename-chat');
    expect(toModalMode('unknown')).toBeNull();
    expect(resolveReaderMode(390)).toBe('fullscreen');
    expect(resolveReaderMode(1024)).toBe('drawer');
    expect(resolveReaderMode(1440)).toBe('open');
    expect(extractArtifactId('artifactId="artifact-reader-references-1"')).toBe('artifact-reader-references-1');
    expect(extractArtifactId('artifactId=\\"artifact-reader-references-2\\"')).toBe('artifact-reader-references-2');
  });

  it('removes internal trigger markers from visible stream text', () => {
    expect(stripInlineTriggers('Готово. ::ck-trigger{kind="reader_references" artifactId="artifact-reader-references-1"}')).toBe(
      'Готово.',
    );
    expect(stripInlineTriggers('Готово. ::ck-trigger{kind=\\"reader_references\\" artifactId=\\"artifact-reader-references-2\\"}')).toBe(
      'Готово.',
    );
  });

  it('compares reader locators including nullable paragraph ids', () => {
    const locator = { projectId: 'project-1', bookId: 'book-1', chapterId: 'chapter-1', paragraphId: 'p-1' } as ReaderLocator;

    expect(sameLocator(locator, { ...locator })).toBe(true);
    expect(sameLocator(locator, { ...locator, paragraphId: 'p-2' })).toBe(false);
    expect(sameLocator(locator, null)).toBe(false);
  });
});
