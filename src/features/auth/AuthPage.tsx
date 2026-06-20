import { useEffect, useState } from 'react';
import { Feather } from 'lucide-react';
import { type AuthSession, classifyAuthFailure, type SessionAuthClient, useLoginMutation, useRegisterMutation } from '../../entities/session/api';
import type { AuthMode } from './auth-model';
import styles from './AuthPage.module.css';

interface AuthPageProps {
  api: SessionAuthClient;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSuccess: (session: AuthSession) => void;
  requestedPath?: string;
  sessionExpired?: boolean;
  statusMessage?: string;
}

export function AuthPage({
  api,
  mode,
  onModeChange,
  onSuccess,
  requestedPath,
  sessionExpired = false,
  statusMessage,
}: AuthPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [message, setMessage] = useState(
    statusMessage ?? (sessionExpired ? 'Сессия истекла. Войдите снова, и мы вернем вас к рабочему месту.' : ''),
  );
  const [placeholder, setPlaceholder] = useState('');
  const loginMutation = useLoginMutation(api);
  const registerMutation = useRegisterMutation(api);

  const isRegister = mode === 'register';
  const pending = loginMutation.isPending || registerMutation.isPending;
  const normalizedEmail = email.trim();
  const canSubmit = isRegister
    ? normalizedEmail.includes('@') && password.length >= 8 && acceptedTerms
    : normalizedEmail.length > 0 && password.length > 0;
  const pitch = isRegister
    ? 'Вся ваша вселенная — проиндексирована и готова отвечать.'
    : 'Спросите свой канон — и получите ответ со ссылкой на первоисточник.';

  useEffect(() => {
    setMessage(statusMessage ?? (sessionExpired ? 'Сессия истекла. Войдите снова, и мы вернем вас к рабочему месту.' : ''));
  }, [sessionExpired, statusMessage]);

  // Clear the contextual placeholder (e.g. "Google sign-in unavailable") when
  // switching between login and register so it never leaks onto the other mode.
  useEffect(() => {
    setPlaceholder('');
  }, [mode]);

  async function handleSubmit() {
    if (!canSubmit || pending) {
      setMessage(isRegister ? 'Примите условия и заполните поля регистрации.' : 'Введите email и пароль.');
      return;
    }
    setMessage('');
    try {
      const session = isRegister
        ? await registerMutation.mutateAsync({ displayName, email: normalizedEmail, password, acceptedTerms: true })
        : await loginMutation.mutateAsync({ email: normalizedEmail, password, rememberMe });
      setMessage(requestedPath ? `Готово. Возвращаемся: ${requestedPath}` : 'Готово. Открываем рабочее место.');
      onSuccess(session);
    } catch (error) {
      setMessage(classifyAuthFailure(error, 'Не удалось войти. Проверьте данные и попробуйте снова.').message);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel} aria-label="Canon Keeper">
        <p className={styles.logo}>
          <Feather aria-hidden="true" size={22} />
          <span>Canon Keeper</span>
        </p>
        <div className={styles.pitch}>
          <h1>{pitch}</h1>
          <p className={styles.brandMeta}>ПАМЯТЬ ВАШЕЙ САГИ</p>
        </div>
      </section>

      <section className={styles.formPanel} aria-labelledby="auth-title">
        <div className={styles.formCard}>
          <div className={styles.head}>
            <h2 id="auth-title">{isRegister ? 'Создать аккаунт' : 'С возвращением'}</h2>
            <p className={styles.subcopy}>
              {isRegister ? 'Начните вести канон своей саги.' : 'Войдите, чтобы продолжить работу над сагой.'}
            </p>
          </div>

          {isRegister ? (
            <label className={styles.field}>
              <span>Имя</span>
              <input onChange={(event) => setDisplayName(event.target.value)} type="text" value={displayName} />
            </label>
          ) : null}

          <label className={styles.field}>
            <span>Email</span>
            <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </label>

          <label className={styles.field}>
            <span>Пароль</span>
            <input autoComplete={isRegister ? 'new-password' : 'current-password'} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
          </label>

          {isRegister ? (
            <label className={styles.checkbox}>
              <input checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} type="checkbox" />
              <span>Принимаю условия работы с черновиками</span>
            </label>
          ) : (
            <div className={styles.inlineRow}>
              <label className={styles.checkbox}>
                <input checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" />
                <span>Запомнить меня</span>
              </label>
              <button className={styles.linkButton} onClick={() => setPlaceholder('Восстановление пароля пока недоступно. Обратитесь к администратору рабочего места.')} type="button">
                Забыли пароль?
              </button>
            </div>
          )}

          <button className={styles.primaryButton} disabled={pending} onClick={handleSubmit} type="button">
            {pending ? 'Проверяем...' : isRegister ? 'Создать аккаунт' : 'Войти'}
          </button>

          {!isRegister ? (
            <>
              <div className={styles.orRow} aria-hidden="true">
                <span />
                <strong>или</strong>
                <span />
              </div>
              <button className={styles.secondaryButton} onClick={() => setPlaceholder('Вход через Google пока недоступен. Используйте email и пароль.')} type="button">
                Продолжить с Google
              </button>
            </>
          ) : null}

          <p className={styles.modeSwitch}>
            {isRegister ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}{' '}
            <button onClick={() => onModeChange(isRegister ? 'login' : 'register')} type="button">
              {isRegister ? 'Войти' : 'Зарегистрироваться'}
            </button>
          </p>

          {message ? <p className={styles.status}>{message}</p> : null}
          {placeholder ? <p className={styles.status}>{placeholder}</p> : null}
        </div>
      </section>
    </main>
  );
}
