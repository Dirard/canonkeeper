export type Surface = 'auth' | 'chat' | 'manuscript' | 'reader' | 'draft' | 'agent' | 'unknown';

export interface AppRoute {
  path: string;
  surface: Surface;
  params: Record<string, string>;
  query: URLSearchParams;
  overlay?: string;
}

export type RouteNavigate = (path: string, query?: Record<string, string | undefined>) => void;

const urlBase = 'http://canonkeeper.local';
const overlayKeys = ['modal', 'reader', 'menu', 'actions'] as const;
const allowedSearchKeysBySurface: Record<Surface, ReadonlySet<string>> = {
  auth: new Set(['returnTo']),
  chat: new Set(['projectId', 'bookId', 'chapterId', 'paragraphId', 'chatId', 'reader', 'modal', 'menu', 'actions', 'long']),
  manuscript: new Set([
    'projectId',
    'bookId',
    'chatId',
    'bookMenu',
    'bookActions',
    'menu',
    'indexing',
    'mode',
    'chapterId',
    'paragraphId',
    'pane',
    'note',
    'annotationId',
    'chapters',
    'notes',
    'newChapter',
  ]),
  reader: new Set(['projectId', 'bookId', 'chatId', 'pane', 'paragraphId', 'note', 'annotationId', 'chapters', 'notes', 'menu']),
  draft: new Set(['projectId', 'bookId', 'chatId', 'pane']),
  agent: new Set(['projectId', 'bookId', 'chatId', 'pane']),
  unknown: new Set(),
};

export function parseRoute(url: string | URL): AppRoute {
  const parsed = typeof url === 'string' ? new URL(url, urlBase) : url;
  return createAppRoute(parsed.pathname, parsed.searchParams);
}

export function createAppRoute(path: string, search: URLSearchParams | Record<string, string | undefined> = {}) {
  const surface = surfaceFromPath(path);
  const query = sanitizeSearch(surface, search);
  const overlay = overlayKeys.map((key) => query.get(key)).find((value): value is string => Boolean(value));

  return {
    path,
    surface,
    params: paramsFromPath(path),
    query,
    overlay,
  } satisfies AppRoute;
}

export function toHref(path: string, query?: Record<string, string | undefined>) {
  const next = new URL(path, urlBase);
  const surface = surfaceFromPath(next.pathname);
  const sanitized = sanitizeSearch(surface, query ?? {});
  for (const [key, value] of sanitized.entries()) {
    next.searchParams.set(key, value);
  }
  return `${next.pathname}${next.search}`;
}

export function canonicalProductRoutes() {
  return [
    { label: 'Рукопись', path: '/manuscript/books' },
    { label: 'Чат', path: '/chat' },
  ] as const;
}

export function legacyRouteRedirect(path: string) {
  if (path === '/') {
    return '/manuscript/books';
  }
  if (path.startsWith('/reader') || path.startsWith('/draft')) {
    return '/manuscript/books';
  }
  if (path.startsWith('/agent')) {
    return '/chat';
  }
  return null;
}

export function canonicalizeNavigationTarget(path: string, query: Record<string, string | undefined> = {}) {
  const readerMatch = path.match(/^\/reader\/chapter\/([^/]+)$/);
  if (readerMatch) {
    return { path: '/manuscript/books', query: { ...query, mode: 'read', chapterId: readerMatch[1] } };
  }
  const draftMatch = path.match(/^\/draft\/chapter\/([^/]+)$/);
  if (draftMatch) {
    return { path: '/manuscript/books', query: { ...query, mode: 'draft', chapterId: draftMatch[1] } };
  }
  if (path === '/draft/new-chapter') {
    return { path: '/manuscript/books', query: { ...query, mode: 'draft', newChapter: '1' } };
  }
  const agentMatch = path.match(/^\/agent\/chapter\/([^/]+)$/);
  if (agentMatch) {
    return { path: '/chat', query: { ...query, chapterId: agentMatch[1] } };
  }
  const redirectTarget = legacyRouteRedirect(path);
  return { path: redirectTarget ?? path, query };
}

function sanitizeSearch(surface: Surface, search: URLSearchParams | Record<string, string | undefined>) {
  const allowedKeys = allowedSearchKeysBySurface[surface];
  const entries = search instanceof URLSearchParams ? search.entries() : Object.entries(search);
  const query = new URLSearchParams();

  for (const [key, rawValue] of entries) {
    if (!allowedKeys.has(key) || rawValue === undefined) {
      continue;
    }
    const value = String(rawValue);
    if (value.length > 200) {
      continue;
    }
    query.set(key, value);
  }

  return query;
}

function surfaceFromPath(path: string): Surface {
  const [surfaceKey] = path.split('/').filter(Boolean);
  if (surfaceKey === 'auth' || surfaceKey === 'chat' || surfaceKey === 'manuscript' || surfaceKey === 'reader' || surfaceKey === 'draft' || surfaceKey === 'agent') {
    return surfaceKey;
  }
  return 'unknown';
}

function paramsFromPath(path: string): Record<string, string> {
  const parts = path.split('/').filter(Boolean);
  const id = parts.at(2);
  return id ? { id } : {};
}

