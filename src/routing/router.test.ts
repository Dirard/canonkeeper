import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { createMockApiClient } from '../api/mock';
import { canonicalizeNavigationTarget, canonicalProductRoutes, createAppRoute, legacyRouteRedirect, toHref } from '../shared/navigation/app-route';
import { createCanonKeeperRouter } from './router';

function createTestRouter(path = '/chat') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createCanonKeeperRouter(
    {
      api: createMockApiClient(),
      queryClient: new QueryClient(),
    },
    history,
  );
  return router;
}

describe('CanonKeeper TanStack Router', () => {
  it('exposes exactly the canonical product navigation routes', () => {
    expect(canonicalProductRoutes().map((route) => route.label)).toEqual(['Рукопись', 'Чат']);
    expect(canonicalProductRoutes().map((route) => route.path)).toEqual(['/manuscript/books', '/chat']);
  });

  it('maps erroneous standalone route identities to canonical product routes', () => {
    expect(legacyRouteRedirect('/reader/chapter/chapter-12')).toBe('/manuscript/books');
    expect(legacyRouteRedirect('/draft/chapter/chapter-16')).toBe('/manuscript/books');
    expect(legacyRouteRedirect('/agent/chapter/chapter-16')).toBe('/chat');
    expect(canonicalizeNavigationTarget('/reader/chapter/chapter-12', { projectId: 'project-white-port' })).toEqual({
      path: '/manuscript/books',
      query: { chapterId: 'chapter-12', mode: 'read', projectId: 'project-white-port' },
    });
    expect(canonicalizeNavigationTarget('/draft/chapter/chapter-16', { bookId: 'book-02' })).toEqual({
      path: '/manuscript/books',
      query: { bookId: 'book-02', chapterId: 'chapter-16', mode: 'draft' },
    });
  });

  it('keeps route-visible search state typed and private-payload-free', () => {
    const route = createAppRoute('/chat', new URLSearchParams('projectId=project-white-port&prompt=private&menu=open'));

    expect(route.query.get('projectId')).toBe('project-white-port');
    expect(route.query.get('menu')).toBe('open');
    expect(route.query.has('prompt')).toBe(false);
    expect(toHref('/chat', { projectId: 'project-white-port', prompt: 'private' })).toBe('/chat?projectId=project-white-port');
  });

  it('boots canonical routes through a TanStack Router instance', async () => {
    const router = createTestRouter('/manuscript/books?projectId=project-white-port');

    await router.load();

    expect(router.state.location.pathname).toBe('/manuscript/books');
    expect(router.state.matches.map((match) => match.pathname)).toContain('/manuscript/books');
  });

  it('keeps auth return targets as supporting route state', async () => {
    const route = createAppRoute('/auth/login', new URLSearchParams('returnTo=/manuscript/books&prompt=private'));
    const router = createTestRouter('/auth/login?returnTo=/manuscript/books');

    await router.load();

    expect(route.surface).toBe('auth');
    expect(route.query.get('returnTo')).toBe('/manuscript/books');
    expect(route.query.has('prompt')).toBe(false);
    expect(router.state.location.pathname).toBe('/auth/login');
    expect(canonicalProductRoutes().map((item) => item.path)).not.toContain('/auth/login');
  });

  it('keeps unknown paths on the fallback surface without private search state', async () => {
    const route = createAppRoute('/missing-route', new URLSearchParams('projectId=project-white-port&prompt=private'));
    const router = createTestRouter('/missing-route?projectId=project-white-port');

    await router.load();

    expect(route.surface).toBe('unknown');
    expect([...route.query.entries()]).toEqual([]);
    expect(router.state.location.pathname).toBe('/missing-route');
  });
});
