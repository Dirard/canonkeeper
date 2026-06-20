export type ReaderMode = 'open' | 'drawer' | 'fullscreen';
export type ModalMode = 'rename-chat' | 'delete-chat';

const maxVisibleStreamEvents = 6;

export function toReaderMode(value: string | null): ReaderMode | null {
  if (value === 'open' || value === 'drawer' || value === 'fullscreen') {
    return value;
  }
  return null;
}

export function toModalMode(value: string | null): ModalMode | null {
  if (value === 'rename-chat' || value === 'delete-chat') {
    return value;
  }
  return null;
}

export function resolveReaderMode(width: number): ReaderMode {
  if (width <= 700) {
    return 'fullscreen';
  }
  if (width <= 1100) {
    return 'drawer';
  }
  return 'open';
}

export function appendStreamEvent(current: string[], next: string) {
  return [...current, next].slice(-maxVisibleStreamEvents);
}
