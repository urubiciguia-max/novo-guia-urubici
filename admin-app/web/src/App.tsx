import { AuthProvider, useAuth } from './auth/AuthContext';
import { PostsProvider } from './data/PostsContext';
import { ToastProvider } from './components/Toast';
import { useHashRoute, matchEditRoute } from './lib/useHashRoute';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PostsListPage } from './pages/PostsListPage';
import { PostFormPage } from './pages/PostFormPage';
import { NotFoundPage } from './pages/NotFoundPage';

function AuthenticatedApp() {
  const { logout } = useAuth();
  const [path, navigate] = useHashRoute();
  const editSlug = matchEditRoute(path);

  const active: 'dashboard' | 'posts' = path.startsWith('/posts') ? 'posts' : 'dashboard';

  let content;
  if (path === '/dashboard') {
    content = <DashboardPage onNavigate={navigate} />;
  } else if (path === '/posts') {
    content = <PostsListPage onNavigate={navigate} />;
  } else if (path === '/posts/novo') {
    content = <PostFormPage slug={null} onNavigate={navigate} />;
  } else if (editSlug) {
    content = <PostFormPage slug={editSlug} onNavigate={navigate} />;
  } else {
    content = <NotFoundPage onNavigate={navigate} />;
  }

  return (
    <PostsProvider>
      <div className="app-shell">
        <Sidebar active={active} onNavigate={navigate} onLogout={logout} />
        <main className="app-shell__main">{content}</main>
      </div>
    </PostsProvider>
  );
}

function Root() {
  const { status } = useAuth();
  if (status !== 'logged-in') {
    return <LoginPage />;
  }
  return <AuthenticatedApp />;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ToastProvider>
  );
}
