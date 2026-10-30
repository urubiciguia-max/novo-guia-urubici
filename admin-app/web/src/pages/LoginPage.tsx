import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';

export function LoginPage() {
  const { login, status, error } = useAuth();
  const loggingIn = status === 'logging-in';

  return (
    <div className="login-screen">
      <div className="login-card card">
        <div className="login-card__logo">
          <span className="sidebar__logo-mark" aria-hidden="true">
            GU
          </span>
        </div>
        <h1>Painel de conteúdo</h1>
        <p className="login-card__subtitle">Guia Urubici — entre com sua conta do GitHub pra gerenciar os posts.</p>

        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="btn btn--primary btn--block" onClick={() => void login()} disabled={loggingIn}>
          {loggingIn ? <Spinner label="Abrindo login…" /> : 'Entrar com GitHub'}
        </button>

        <p className="login-card__hint">
          Uma janela de autenticação do GitHub vai abrir. Depois de autorizar, ela fecha sozinha e você volta pro
          painel.
        </p>
      </div>
    </div>
  );
}
