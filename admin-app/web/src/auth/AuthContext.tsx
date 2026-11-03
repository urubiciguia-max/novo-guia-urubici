import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { loginWithGitHub } from './popupLogin';
import { clearToken, loadToken, saveToken } from '../lib/session';
import { createPostsClient, type PostsClient } from '../lib/postsClient';
import { createPagesClient, type PagesClient } from '../lib/pagesClient';

interface AuthState {
  status: 'logged-out' | 'logging-in' | 'logged-in';
  client: PostsClient | null;
  /** Mesma sessão/token de `client`, só que pro client de páginas
   *  institucionais (ver `lib/pagesClient.ts`) -- instanciado aqui junto,
   *  pra `PagesProvider` não precisar reimplementar leitura de token. */
  pagesClient: PagesClient | null;
  error: string | null;
  login: () => Promise<void>;
  logout: () => void;
  /**
   * Chamado pela camada de dados quando uma chamada à API volta com 401
   * (token inválido/expirado/revogado) -- força logout e deixa a UI
   * redirecionar pra tela de login (não tenta renovar sozinho, "re-login
   * silencioso" aqui significaria reabrir o popup sem o usuário pedir, o
   * que a maioria dos navegadores bloqueia de qualquer forma fora de um
   * clique direto do usuário).
   */
  handleUnauthorized: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialToken = useMemo(() => loadToken(), []);
  const [token, setToken] = useState<string | null>(initialToken);
  const [status, setStatus] = useState<AuthState['status']>(initialToken ? 'logged-in' : 'logged-out');
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async () => {
    setStatus('logging-in');
    setError(null);
    try {
      const newToken = await loginWithGitHub();
      saveToken(newToken);
      setToken(newToken);
      setStatus('logged-in');
    } catch (err) {
      setStatus('logged-out');
      setError(err instanceof Error ? err.message : 'Falha desconhecida ao autenticar.');
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    setStatus('logged-out');
  }, []);

  const handleUnauthorized = useCallback(() => {
    clearToken();
    setToken(null);
    setStatus('logged-out');
    setError('Sua sessão expirou ou o token perdeu acesso. Entre novamente.');
  }, []);

  const client = useMemo(() => (token ? createPostsClient(token) : null), [token]);
  const pagesClient = useMemo(() => (token ? createPagesClient(token) : null), [token]);

  const value: AuthState = { status, client, pagesClient, error, login, logout, handleUnauthorized };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return ctx;
}
