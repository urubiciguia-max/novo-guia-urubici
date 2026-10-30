import { DashboardIcon, LogoutIcon, PostsIcon, SiteIcon } from './icons';
import { SITE_URL } from '../lib/env';

export interface SidebarProps {
  active: 'dashboard' | 'posts';
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

/**
 * Só com os itens que têm tela/função real no MVP (Dashboard, Artigos) --
 * sem links mortos pra Menu/Páginas/Equipe (não existem nesta fase). Ver
 * regra 6 do escopo na task do Genilson.
 */
export function Sidebar({ active, onNavigate, onLogout }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__logo">
        <span className="sidebar__logo-mark" aria-hidden="true">
          GU
        </span>
        <span>Admin CMS</span>
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
          Dashboard
        </button>
        <button
          type="button"
          className={`sidebar__link${active === 'posts' ? ' sidebar__link--active' : ''}`}
          aria-current={active === 'posts' ? 'page' : undefined}
          onClick={() => onNavigate('/posts')}
        >
          <PostsIcon />
          Artigos
        </button>
      </nav>

      <div className="sidebar__footer">
        <a className="sidebar__link" href={SITE_URL} target="_blank" rel="noopener noreferrer">
          <SiteIcon />
          Ver site
        </a>
        <button type="button" className="sidebar__link" onClick={onLogout}>
          <LogoutIcon />
          Sair
        </button>
      </div>
    </aside>
  );
}
