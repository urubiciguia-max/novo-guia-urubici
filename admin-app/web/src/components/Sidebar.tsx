import { CommentIcon, DashboardIcon, DocIcon, LogoutIcon, PostsIcon, SiteIcon } from './icons';
import { SITE_URL } from '../lib/env';
import { useComments } from '../data/CommentsContext';

export interface SidebarProps {
  active: 'dashboard' | 'posts' | 'pages' | 'comments';
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

/**
 * "Páginas" fica numa seção própria ("Conteúdo institucional"), separada
 * de "Principal" (Dashboard/Artigos) -- separação visual deliberada pedida
 * na spec (páginas institucionais fixas, sem publicação/categoria, não são
 * "mais um tipo de post"). Ícone `DocIcon` (documento simples) em vez de
 * `PostsIcon` (que já carrega a semântica de "artigo de blog com linhas de
 * texto") pra reforçar a diferença à primeira vista.
 */
export function Sidebar({ active, onNavigate, onLogout }: SidebarProps) {
  const { items: pendingComments } = useComments();

  return (
    <aside className="sidebar">
      <div className="sidebar__logo">
        <span className="sidebar__logo-mark" aria-hidden="true">
          GU
        </span>
        <span className="sidebar__logo-text">Admin CMS</span>
      </div>

      <nav className="sidebar__nav" aria-label="Navegação principal">
        <p className="sidebar__section-label">Principal</p>
        <button
          type="button"
          className={`sidebar__link${active === 'dashboard' ? ' sidebar__link--active' : ''}`}
          aria-current={active === 'dashboard' ? 'page' : undefined}
          onClick={() => onNavigate('/dashboard')}
        >
          <DashboardIcon />
          <span className="sidebar__link-label">Dashboard</span>
        </button>
        <button
          type="button"
          className={`sidebar__link${active === 'posts' ? ' sidebar__link--active' : ''}`}
          aria-current={active === 'posts' ? 'page' : undefined}
          onClick={() => onNavigate('/posts')}
        >
          <PostsIcon />
          <span className="sidebar__link-label">Artigos</span>
        </button>
        <button
          type="button"
          className={`sidebar__link${active === 'comments' ? ' sidebar__link--active' : ''}`}
          aria-current={active === 'comments' ? 'page' : undefined}
          onClick={() => onNavigate('/comments')}
        >
          <CommentIcon />
          <span className="sidebar__link-label">Comentários</span>
          {pendingComments.length > 0 && (
            <span className="sidebar__link-count" aria-label={`${pendingComments.length} pendentes`}>
              {pendingComments.length}
            </span>
          )}
        </button>

        <p className="sidebar__section-label">Conteúdo institucional</p>
        <button
          type="button"
          className={`sidebar__link${active === 'pages' ? ' sidebar__link--active' : ''}`}
          aria-current={active === 'pages' ? 'page' : undefined}
          onClick={() => onNavigate('/pages')}
        >
          <DocIcon />
          <span className="sidebar__link-label">Páginas</span>
        </button>
      </nav>

      <div className="sidebar__footer">
        <a className="sidebar__link" href={SITE_URL} target="_blank" rel="noopener noreferrer">
          <SiteIcon />
          <span className="sidebar__link-label">Ver site</span>
        </a>
        <button type="button" className="sidebar__link" onClick={onLogout}>
          <LogoutIcon />
          <span className="sidebar__link-label">Sair</span>
        </button>
      </div>
    </aside>
  );
}
