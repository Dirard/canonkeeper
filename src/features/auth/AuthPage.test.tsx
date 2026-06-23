import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MockApiError } from '../../api/mock/scenarios';
import { createCanonKeeperApiClient } from '../../shared/api';
import { createAuthHandlers, mswApiBaseUrl } from '../../test/msw/handlers';
import { mswServer } from '../../test/msw/server';
import { AuthPage } from './AuthPage';

function createTestApi() {
  return createCanonKeeperApiClient({
    baseUrl: mswApiBaseUrl,
    fetch: async (request) => {
      const headers = new Headers(request.headers);
      headers.set('origin', 'http://localhost:3000');
      return fetch(request, { headers });
    },
  });
}

function validPassphrase() {
  return 'white-port-12';
}

function renderAuth(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('AuthPage', () => {
  it('switches between login and registration through visible controls', () => {
    const onModeChange = vi.fn();
    renderAuth(<AuthPage api={createTestApi()} mode="login" onModeChange={onModeChange} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
    expect(onModeChange).toHaveBeenCalledWith('register');
  });

  it('keeps login action clickable and reports missing credentials', () => {
    renderAuth(<AuthPage api={createTestApi()} mode="login" onModeChange={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(screen.getByRole('button', { name: 'Войти' })).toHaveProperty('disabled', false);
    expect(screen.getByText('Введите email и пароль.')).toBeTruthy();
  });

  it('passes rememberMe through login using MSW network handlers', async () => {
    const onSuccess = vi.fn();
    const loginRequests: Array<{ rememberMe?: unknown }> = [];
    mswServer.use(...createAuthHandlers({ onLogin: (body) => loginRequests.push(body) }));
    renderAuth(<AuthPage api={createTestApi()} mode="login" onModeChange={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'mira@example.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: validPassphrase() } });
    fireEvent.click(screen.getByLabelText('Запомнить меня'));
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(loginRequests).toEqual([{ rememberMe: false }]);
  });

  it('submits login with a short non-empty password and surfaces auth failure', async () => {
    const onSuccess = vi.fn();
    const loginRequests: Array<{ rememberMe?: unknown }> = [];
    mswServer.use(...createAuthHandlers({ onLogin: (body) => loginRequests.push(body) }));
    renderAuth(<AuthPage api={createTestApi()} mode="login" onModeChange={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'mira@example.com' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(screen.getByText('Неверный email или пароль.')).toBeTruthy());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(loginRequests).toEqual([{ rememberMe: true }]);
  });

  it('gates registration on accepted terms using MSW network handlers', async () => {
    const onSuccess = vi.fn();
    const registerRequests: Array<{ acceptedTerms?: unknown; displayName?: unknown }> = [];
    mswServer.use(...createAuthHandlers({ onRegister: (body) => registerRequests.push(body) }));
    renderAuth(<AuthPage api={createTestApi()} mode="register" onModeChange={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
    expect(screen.getByRole('button', { name: 'Создать аккаунт' })).toHaveProperty('disabled', false);
    expect(registerRequests).toEqual([]);
    expect(screen.getByText('Примите условия и заполните поля регистрации.')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Принимаю условия работы с черновиками'));
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Мира Волкова' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new-author@example.test' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: validPassphrase() } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(registerRequests).toEqual([{ acceptedTerms: true, displayName: 'Мира Волкова' }]);
  });

  it('uses registration copy for registration failures', async () => {
    const onSuccess = vi.fn();
    mswServer.use(...createAuthHandlers({
      onRegister: () => {
        throw new MockApiError(409, 'Registration could not be completed.', 'registerUser', 'registration_conflict');
      },
    }));
    renderAuth(<AuthPage api={createTestApi()} mode="register" onModeChange={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByLabelText('Принимаю условия работы с черновиками'));
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Мира Волкова' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new-author@example.test' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: validPassphrase() } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByText('Не удалось создать аккаунт. Проверьте данные и попробуйте снова.')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
