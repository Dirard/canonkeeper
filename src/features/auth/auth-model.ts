export type AuthMode = 'login' | 'register';

export function authModeFromPath(path: string): AuthMode {
  return path.includes('/register') ? 'register' : 'login';
}

export function resolveAuthRedirect(isAuthenticated: boolean, path: string) {
  if (isAuthenticated || path.startsWith('/auth')) {
    return null;
  }
  return `/auth/login?returnTo=${encodeURIComponent(path)}`;
}
