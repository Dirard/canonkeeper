import type { ChatMessage, ReaderLocator } from '../../shared/api';

const inlineTriggerPattern = /\s*::ck-trigger\{kind=\\?"reader_references\\?"\s+artifactId=\\?"[^"\\}]+\\?"\}/g;

export function isReaderReferenceTrigger(trigger: unknown): trigger is { artifactId: string } {
  return typeof trigger === 'object' && trigger !== null && 'artifactId' in trigger && typeof trigger.artifactId === 'string';
}

export function getArtifactTriggerIds(message: ChatMessage) {
  return message.triggers.flatMap((trigger) => (isReaderReferenceTrigger(trigger) ? [trigger.artifactId] : []));
}

export function extractArtifactId(text: string) {
  return /artifactId=\\?"([^"\\]+)\\?"/.exec(text)?.[1] ?? null;
}

export function stripInlineTriggers(text: string) {
  return text.replace(inlineTriggerPattern, '').trimEnd();
}

export function sameLocator(left: ReaderLocator, right: ReaderLocator | null) {
  if (!right) {
    return false;
  }
  return left.projectId === right.projectId && left.bookId === right.bookId && left.chapterId === right.chapterId && left.paragraphId === right.paragraphId;
}
