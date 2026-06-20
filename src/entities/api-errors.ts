import { ApiStatusError, NetworkApiError } from '../shared/api';

export interface ApiStatusFailure {
  problem: {
    detail?: string;
    title?: string;
  };
  status: number;
}

export interface NetworkFailure {
  cause: unknown;
}

export interface PublicApiErrorMessages {
  conflict?: string;
  forbidden?: string;
  network?: string;
  server?: string;
  unauthorized?: string;
}

export function isApiStatusFailure(error: unknown): error is ApiStatusFailure {
  return error instanceof ApiStatusError;
}

export function isNetworkFailure(error: unknown): error is NetworkFailure {
  return error instanceof NetworkApiError;
}

export function publicApiErrorMessage(error: unknown, fallback: string, messages: PublicApiErrorMessages = {}) {
  if (isApiStatusFailure(error)) {
    if (error.status === 401) return messages.unauthorized ?? fallback;
    if (error.status === 403) return messages.forbidden ?? fallback;
    if (error.status === 409) return messages.conflict ?? fallback;
    if (error.status >= 500) return messages.server ?? 'Сервис временно недоступен. Попробуйте снова.';
    return fallback;
  }

  if (isNetworkFailure(error)) {
    return messages.network ?? 'Не удалось подключиться к серверу. Проверьте соединение и попробуйте снова.';
  }

  return fallback;
}
