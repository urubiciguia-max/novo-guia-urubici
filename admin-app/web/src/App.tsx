import { AuthProvider, useAuth } from './auth/AuthContext';
import { PostsProvider } from './data/PostsContext';
import { PagesProvider } from './data/PagesContext';
import { ToastProvider } from './components/Toast';
import { useHashRoute, matchEditRoute, matchPageEditRoute } from './lib/useHashRoute';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PostsListPage } from './pages/PostsListPage';
import { PostFormPage } from './pages/PostFormPage';
import { PagesListPage } from './pages/PagesListPage';
import { PageFormPage } from './pages/PageFormPage';
import { NotFoundPage } from './pages/NotFoundPage';

function AuthenticatedApp() {
  const { logout } = useAuth();
  const [path, navigate] = useHashRoute();
  const editSlug = matchEditRoute(path);
  const pageSlug = matchPageEditRoute(path);

  const active: 'dashboard' | 'posts' | 'pages' = path.startsWith('/posts')
    ? 'posts'
    : path.startsWith('/pages')
      ? 'pages'
      : 'dashboard';

  let content;
  if (path === '/dashboard') {
    content = <DashboardPage onNavigate={navigate} />;
  } else if (path === '/posts') {
    content = <PostsListPage onNavigate={navigate} />;
  } else if (path === '/posts/novo') {
    content = <PostFormPage slug={null} onNavigate={navigate} />;
  } else if (editSlug) {
    content = <PostFormPage slug={editSlug} onNavigate={navigate} />;
  } else if (path === '/pages') {
    content = <PagesListPage onNavigate={navigate} />;
  } else if (pageSlug) {
    content = <PageFormPage slug={pageSlug} onNavigate={navigate} />;
  } else {
    content = <NotFoundPage onNavigate={navigate} />;
  }

  return (
    <PostsProvider>
      <PagesProvider>
        <div className="app-shell">
          <Sidebar active={active} onNavigate={navigate} onLogout={logout} />
          <main className="app-shell__main">{content}</main>
        </div>
      </PagesProvider>
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
