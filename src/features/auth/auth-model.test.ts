import { describe, expect, it } from 'vitest';
import { authModeFromPath, resolveAuthRedirect } from './auth-model';

describe('auth model', () => {
  it('detects auth mode from route path', () => {
    expect(authModeFromPath('/auth/register')).toBe('register');
    expect(authModeFromPath('/auth/login')).toBe('login');
  });

  it('redirects unauthenticated workspace routes to auth flow', () => {
    expect(resolveAuthRedirect(false, '/chat')).toBe('/auth/login?returnTo=%2Fchat');
    expect(resolveAuthRedirect(false, '/auth/login')).toBeNull();
    expect(resolveAuthRedirect(true, '/chat')).toBeNull();
  });
});
