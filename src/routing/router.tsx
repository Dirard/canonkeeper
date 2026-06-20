import { type QueryClient } from '@tanstack/react-query';
import {
  RouterProvider,
  createRoute,
  createRootRouteWithContext,
  createRouter,
  redirect,
  useRouter,
  useRouterState,
  type RouterHistory,
} from '@tanstack/react-router';
import { z } from 'zod';
import { App } from '../App';
import { currentUserQueryOptions } from '../entities/session/api';
import type { CanonKeeperApiClient } from '../shared/api';
import { canonicalizeNavigationTarget, createAppRoute, toHref, type RouteNavigate } from '../shared/navigation/app-route';

export interface CanonKeeperRouterContext {
  api: CanonKeeperApiClient;
  queryClient: QueryClient;
}

const searchValue = z.string().min(1).max(200).optional();
const authSearchSchema = z.object({ returnTo: z.string().startsWith('/').max(200).optional() }).catch({});
const chatSearchSchema = z
  .object({
    projectId: searchValue,
    bookId: searchValue,
    chapterId: searchValue,
    paragraphId: searchValue,
    chatId: searchValue,
    reader: z.enum(['open']).optional(),
    modal: z.enum(['search', 'project']).optional(),
    menu: z.enum(['open']).optional(),
    actions: z.enum(['open']).optional(),
  })
  .catch({});
const manuscriptSearchSchema = z
  .object({
    projectId: searchValue,
    bookId: searchValue,
    chatId: searchValue,
    bookMenu: z.enum(['open']).optional(),
    bookActions: z.enum(['sheet']).optional(),
    menu: z.enum(['open']).optional(),
    indexing: z.enum(['active']).optional(),
    mode: z.enum(['read', 'draft']).optional(),
    chapterId: searchValue,
    paragraphId: searchValue,
    pane: searchValue,
    note: z.enum(['add', 'edit', 'delete']).optional(),
    annotationId: searchValue,
    chapters: z.enum(['open']).optional(),
    notes: z.enum(['open']).optional(),
    newChapter: z.enum(['1']).optional(),
  })
  .catch({});
const legacySearchSchema = z
  .object({
    projectId: searchValue,
    bookId: searchValue,
    chatId: searchValue,
    pane: searchValue,
    paragraphId: searchValue,
    annotationId: searchValue,
  })
  .catch({});

const rootRoute = createRootRouteWithContext<CanonKeeperRouterContext>()({
  component: RouterAppHost,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(currentUserQueryOptions(context.api)).catch(() => null);
  },
  notFoundComponent: RouterAppHost,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/manuscript/books', search });
  },
});

const authLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/login',
  validateSearch: authSearchSchema.parse,
});

const authRegisterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/register',
  validateSearch: authSearchSchema.parse,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  validateSearch: chatSearchSchema.parse,
});

const manuscriptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/manuscript/books',
  validateSearch: manuscriptSearchSchema.parse,
});

const legacyReaderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reader/chapter/$chapterId',
  validateSearch: legacySearchSchema.parse,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/manuscript/books', search: { ...search, mode: 'read', chapterId: params.chapterId } });
  },
});

const legacyDraftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/draft/chapter/$chapterId',
  validateSearch: legacySearchSchema.parse,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/manuscript/books', search: { ...search, mode: 'draft', chapterId: params.chapterId } });
  },
});

const legacyNewDraftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/draft/new-chapter',
  validateSearch: legacySearchSchema.parse,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/manuscript/books', search: { ...search, mode: 'draft', newChapter: '1' } });
  },
});

const legacyAgentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agent/chapter/$chapterId',
  validateSearch: legacySearchSchema.parse,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/chat', search: { ...search, chapterId: params.chapterId } });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  authLoginRoute,
  authRegisterRoute,
  chatRoute,
  manuscriptRoute,
  legacyReaderRoute,
  legacyDraftRoute,
  legacyNewDraftRoute,
  legacyAgentRoute,
]);

export function createCanonKeeperRouter(
  context: CanonKeeperRouterContext,
  history?: RouterHistory,
) {
  return createRouter({
    context,
    history,
    routeTree,
  });
}

export function CanonKeeperRouterProvider({
  router,
}: {
  router: ReturnType<typeof createCanonKeeperRouter>;
}) {
  return <RouterProvider router={router} />;
}

function RouterAppHost() {
  const { api } = rootRoute.useRouteContext();
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const route = createAppRoute(location.pathname, new URLSearchParams(location.searchStr));
  const navigate: RouteNavigate = (path, query) => {
    const target = canonicalizeNavigationTarget(path, query);
    router.history.push(toHref(target.path, target.query));
  };

  return <App api={api} navigate={navigate} route={route} />;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createCanonKeeperRouter>;
  }
}
