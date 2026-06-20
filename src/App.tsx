import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CanonKeeperApiClient } from './shared/api';
import { type AuthShellStatus, useAuthShellStore } from './app/auth-store';
import { classifyAuthFailure, clearCanonKeeperQueryCache, setSessionUser, useCurrentUserQuery, useLogoutMutation } from './entities/session/api';
import { AuthPage } from './features/auth/AuthPage';
import { authModeFromPath, resolveAuthRedirect } from './features/auth/auth-model';
import { canonicalProductRoutes, type AppRoute, type RouteNavigate } from './shared/navigation/app-route';
import styles from './App.module.css';

// Route-level code splitting: the heavy product surfaces (chat, and the
// manuscript editor which pulls in TipTap) load as separate chunks so the
// initial/auth bundle stays small. Importers are shared with the prefetch
// effect below so navigating between surfaces never shows a Suspense flash.
const importChatPage = () => import('./features/chat/ChatPage');
const importManuscriptPage = () => import('./features/manuscript/ManuscriptPage');
const ChatPage = lazy(() => importChatPage().then((module) => ({ default: module.ChatPage })));
const ManuscriptPage = lazy(() => importManuscriptPage().then((module) => ({ default: module.ManuscriptPage })));

function RouteFallback() {
  return <div aria-hidden="true" className={styles.routeFallback} />;
}

interface AppProps {
  api: CanonKeeperApiClient;
  navigate: RouteNavigate;
  route: AppRoute;
}

export function App({ api, navigate, route }: AppProps) {
  const { clearAuthMessage, errorMessage, requestedPath, setFailure, setRequestedPath } = useAuthShellStore();
  const queryClient = useQueryClient();
  const currentUserQuery = useCurrentUserQuery(api);
  const logoutMutation = useLogoutMutation(api);
  const sessionFailure = useMemo(
    () =>
      currentUserQuery.error
        ? classifyAuthFailure(currentUserQuery.error, 'Не удалось проверить сессию.')
        : null,
    [currentUserQuery.error],
  );
  const user = currentUserQuery.data ?? null;
  const status: AuthShellStatus = currentUserQuery.isPending
    ? 'checking'
    : user
      ? 'authenticated'
      : sessionFailure?.kind === 'unauthorized'
        ? 'anonymous'
        : sessionFailure
          ? 'error'
          : 'anonymous';

  useEffect(() => {
    if (sessionFailure && sessionFailure.kind !== 'unauthorized') {
      setFailure(sessionFailure.kind, sessionFailure.message);
      return;
    }
    clearAuthMessage();
  }, [clearAuthMessage, sessionFailure, setFailure]);

  useEffect(() => {
    if (status === 'checking') {
      return;
    }
    const redirect = resolveAuthRedirect(status === 'authenticated' && Boolean(user), route.path);
    if (redirect) {
      setRequestedPath(route.path);
      navigate('/auth/login', { returnTo: route.path });
    }
  }, [navigate, route.path, setRequestedPath, status, user]);

  // Warm both product chunks once authenticated so switching between chat and
  // manuscript is instant and the Suspense fallback never flashes on navigation.
  useEffect(() => {
    if (status === 'authenticated') {
      void importChatPage();
      void importManuscriptPage();
    }
  }, [status]);

  function finishLogout() {
    clearCanonKeeperQueryCache(queryClient);
    clearAuthMessage();
    navigate('/auth/login');
  }

  function logoutThroughApi() {
    void logoutMutation.mutateAsync().finally(() => {
      finishLogout();
    });
  }

  if (route.surface === 'auth' || status !== 'authenticated' || !user) {
    const returnTo = route.query.get('returnTo') ?? requestedPath;
    return (
      <AuthPage
        api={api}
        mode={authModeFromPath(route.path)}
        onModeChange={(mode) => navigate(`/auth/${mode}`)}
        onSuccess={(nextSession) => {
          setSessionUser(queryClient, nextSession.user);
          clearAuthMessage();
          navigate(returnTo.startsWith('/auth') ? '/manuscript/books' : returnTo);
        }}
        requestedPath={returnTo}
        sessionExpired={status === 'anonymous' && route.surface !== 'auth'}
        statusMessage={status === 'error' ? errorMessage : undefined}
      />
    );
  }

  let surfaceContent: ReactNode;
  if (route.surface === 'chat') {
    surfaceContent = (
      <ChatPage
        api={api}
        onLogout={finishLogout}
        route={route}
        navigate={navigate}
        userName={user.displayName}
      />
    );
  } else if (route.surface === 'manuscript') {
    surfaceContent = (
      <ManuscriptPage
        api={api}
        onLogout={finishLogout}
        route={route}
        navigate={navigate}
        userName={user.displayName}
      />
    );
  } else {
    surfaceContent = (
      <main className={styles.appShell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Canon Keeper</p>
          <h1>Рабочее место Canon Keeper</h1>
        </div>
        <nav className={styles.nav} aria-label="Основная навигация">
          {canonicalProductRoutes().map((item) => (
            <button
              className={route.path === item.path ? styles.activeNav : styles.navButton}
              key={item.path}
              onClick={() => navigate(item.path)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button
          className={styles.navButton}
          onClick={logoutThroughApi}
          type="button"
        >
          Выйти
        </button>
      </header>

      <section className={styles.panel} aria-labelledby="route-not-found-title">
        <p className={styles.eyebrow}>Маршрут недоступен</p>
        <h2 id="route-not-found-title">Раздел не найден</h2>
        <dl className={styles.routeGrid}>
          <div>
            <dt>Раздел</dt>
            <dd>{route.surface}</dd>
          </div>
          <div>
            <dt>Путь</dt>
            <dd>{route.path}</dd>
          </div>
          <div>
            <dt>Состояние</dt>
            <dd>{route.overlay ?? 'обычный режим'}</dd>
          </div>
        </dl>
        <p className={styles.copy}>
          Этот раздел пока не открыт. Вернитесь к рукописи или чату через основную навигацию.
        </p>
      </section>
      </main>
    );
  }

  return <Suspense fallback={<RouteFallback />}>{surfaceContent}</Suspense>;
}
