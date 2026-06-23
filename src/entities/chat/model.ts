import type { ChatMessage, ReaderLocator } from '../../shared/api';

export function isReaderArtifactReference(reference: unknown): reference is { artifactId: string } {
  return typeof reference === 'object' && reference !== null && 'artifactId' in reference && typeof reference.artifactId === 'string';
}

export function getArtifactReferenceIds(message: ChatMessage) {
  return message.references.flatMap((reference) => (isReaderArtifactReference(reference) ? [reference.artifactId] : []));
}

export function sameLocator(left: ReaderLocator, right: ReaderLocator | null) {
  if (!right) {
    return false;
  }
  return left.projectId === right.projectId && left.bookId === right.bookId && left.chapterId === right.chapterId && left.paragraphId === right.paragraphId;
}
