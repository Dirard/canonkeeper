import { mutationOptions, queryOptions, useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  ApiStatusError,
  NetworkApiError,
  type ApiRequestOptions,
  type CanonKeeperApiClient,
  type OperationRequest,
  type OperationResponse,
} from '../../../shared/api';
import { publicApiErrorMessage } from '../../api-errors';

export type CurrentUser = OperationResponse<'getCurrentUser', '200'>;
export type AuthSession = OperationResponse<'loginUser', '200'>;
export type LoginRequest = OperationRequest<'loginUser'>;
export type RegisterRequest = OperationRequest<'registerUser'>;
export type AuthFailureKind = 'unauthorized' | 'forbidden' | 'server' | 'network' | 'unknown';
export type SessionAuthClient = Pick<CanonKeeperApiClient, 'login' | 'register'>;
export type SessionLogoutClient = Pick<CanonKeeperApiClient, 'logout'>;

export interface AuthFailure {
  kind: AuthFailureKind;
  message: string;
}

export const canonKeeperQueryKeys = {
  all: ['canonkeeper'] as const,
};

export const sessionQueryKeys = {
  all: [...canonKeeperQueryKeys.all, 'session'] as const,
  currentUser: () => [...sessionQueryKeys.all, 'currentUser'] as const,
};

interface CurrentUserQueryMeta extends Record<string, unknown> {
  canonKeeperApi: CanonKeeperApiClient;
}

function currentUserQueryMeta(api: CanonKeeperApiClient): CurrentUserQueryMeta {
  return { canonKeeperApi: api };
}

function apiFromQueryMeta(meta: unknown) {
  const queryMeta = meta as Partial<CurrentUserQueryMeta> | undefined;
  if (!queryMeta?.canonKeeperApi) {
    throw new Error('Current user query is missing CanonKeeper API client metadata.');
  }
  return queryMeta.canonKeeperApi;
}

export function currentUserQueryOptions(api: CanonKeeperApiClient) {
  return queryOptions({
    queryKey: sessionQueryKeys.currentUser(),
    queryFn: ({ meta, signal }) => apiFromQueryMeta(meta).getCurrentUser({ signal } satisfies ApiRequestOptions),
    meta: currentUserQueryMeta(api),
    retry: false,
    staleTime: 30 * 1000,
  });
}

export function loginMutationOptions(api: SessionAuthClient) {
  return mutationOptions({
    mutationFn: (body: LoginRequest) => api.login(body),
  });
}

export function registerMutationOptions(api: SessionAuthClient) {
  return mutationOptions({
    mutationFn: (body: RegisterRequest) => api.register(body),
  });
}

export function logoutMutationOptions(api: SessionLogoutClient) {
  return mutationOptions({
    mutationFn: () => api.logout(),
  });
}

export function classifyAuthFailure(error: unknown, fallback: string): AuthFailure {
  if (error instanceof ApiStatusError) {
    if (error.status === 401) {
      if (error.problem.code === 'auth_failed') {
        return { kind: 'unauthorized', message: 'Неверный email или пароль.' };
      }
      return { kind: 'unauthorized', message: 'Сессия истекла. Войдите снова, и мы вернем вас к рабочему месту.' };
    }
    if (error.status === 403) {
      return { kind: 'forbidden', message: 'Нет доступа к этому рабочему месту.' };
    }
    if (error.status >= 500) {
      return { kind: 'server', message: 'Сервис временно недоступен. Попробуйте снова.' };
    }
    return { kind: 'unknown', message: publicApiErrorMessage(error, fallback) };
  }

  if (error instanceof NetworkApiError) {
    return { kind: 'network', message: 'Не удалось подключиться к серверу. Проверьте соединение и попробуйте снова.' };
  }

  return { kind: 'unknown', message: fallback };
}

export function useCurrentUserQuery(api: CanonKeeperApiClient) {
  return useQuery(currentUserQueryOptions(api));
}

export function useLoginMutation(api: SessionAuthClient) {
  return useMutation(loginMutationOptions(api));
}

export function useRegisterMutation(api: SessionAuthClient) {
  return useMutation(registerMutationOptions(api));
}

export function useLogoutMutation(api: SessionLogoutClient) {
  return useMutation(logoutMutationOptions(api));
}

export function setSessionUser(queryClient: QueryClient, user: CurrentUser) {
  queryClient.setQueryData(sessionQueryKeys.currentUser(), user);
}

export function clearCanonKeeperQueryCache(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: canonKeeperQueryKeys.all });
}
