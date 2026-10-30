import { useMemo, useState } from 'react';
import type { PostListItem } from '@admin-data/index.js';
import { CATEGORIES } from '@admin-data/index.js';
import { usePosts } from '../data/PostsContext';
import { EMPTY_FILTER, filterPosts, type PostsFilter } from '../lib/filterPosts';
import { describeError } from '../lib/errorMessage';
import { SITE_URL } from '../lib/env';
import { StatusBadge, CategoryBadge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { EditIcon, PlusIcon, PreviewIcon, SearchIcon, TrashIcon } from '../components/icons';

export function PostsListPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { items, loading, error, deletePost, refresh } = usePosts();
  const toast = useToast();
  const [filter, setFilter] = useState<PostsFilter>(EMPTY_FILTER);
  const [pendingDelete, setPendingDelete] = useState<PostListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => filterPosts(items, filter), [items, filter]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deletePost(pendingDelete.slug, pendingDelete.sha);
      toast.push(`Post "${pendingDelete.title}" excluído.`, 'success');
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      toast.push(describeError(err), 'error');
      // SHA pode ter mudado (conflito) ou o post já ter sido removido por
      // outra aba -- recarrega a lista pra refletir o estado real do repo
      // antes do usuário tentar de novo.
      await refresh();
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header card">
        <div>
          <h1>Artigos do Blog</h1>
          <p className="page-header__count">{items.length} posts no total</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => onNavigate('/posts/novo')}>
          <PlusIcon /> Novo Artigo
        </button>
      </div>

      <div className="filters-bar">
        <label className="filters-bar__search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Buscar por título…"
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            aria-label="Buscar por título"
          />
        </label>
        <label className="filters-bar__select">
          <span className="visually-hidden">Filtrar por status</span>
          <select
            value={filter.status}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as PostsFilter['status'] }))}
          >
            <option value="all">Todos os status</option>
            <option value="published">Publicado</option>
            <option value="draft">Rascunho</option>
          </select>
        </label>
        <label className="filters-bar__select">
          <span className="visually-hidden">Filtrar por categoria</span>
          <select value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))}>
            <option value="all">Todas as categorias</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <Spinner label="Carregando posts…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? 'Nenhum post ainda' : 'Nenhum post encontrado'}
          description={
            items.length === 0
              ? 'Crie o primeiro artigo do blog.'
              : 'Ajuste a busca ou os filtros pra encontrar o que procura.'
          }
          action={
            items.length === 0 ? (
              <button type="button" className="btn btn--primary" onClick={() => onNavigate('/posts/novo')}>
                <PlusIcon /> Novo Artigo
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap card">
          <table className="posts-table">
            <thead>
              <tr>
                <th scope="col">Título</th>
                <th scope="col">Categoria</th>
                <th scope="col">Autor</th>
                <th scope="col">Data</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((post) => (
                <tr key={post.slug} className={post.valid ? undefined : 'posts-table__row--invalid'}>
                  <td>
                    <p className="posts-table__title">{post.title}</p>
                    <p className="posts-table__slug">{post.slug}</p>
                    {!post.valid && <span className="badge badge--warning">Frontmatter inválido</span>}
                  </td>
                  <td>
                    <CategoryBadge category={post.category} />
                  </td>
                  <td>{post.author ?? '—'}</td>
                  <td>{post.pubDate ?? '—'}</td>
                  <td>
                    <StatusBadge draft={post.draft} />
                  </td>
                  <td>
                    <div className="posts-table__actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Editar "${post.title}"`}
                        onClick={() => onNavigate(`/posts/${encodeURIComponent(post.slug)}/editar`)}
                      >
                        <EditIcon />
                      </button>
                      <a
                        className={`icon-btn${!post.legacySlug ? ' icon-btn--disabled' : ''}`}
                        aria-label={`Pré-visualizar "${post.title}"`}
                        href={post.legacySlug ? `${SITE_URL}/${post.legacySlug}` : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={!post.legacySlug}
                        onClick={(e) => {
                          if (!post.legacySlug) e.preventDefault();
                        }}
                      >
                        <PreviewIcon />
                      </a>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        aria-label={`Excluir "${post.title}"`}
                        onClick={() => setPendingDelete(post)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Excluir artigo"
        description={
          pendingDelete
            ? `Tem certeza que quer excluir "${pendingDelete.title}"? Essa ação remove o arquivo do repositório e não pode ser desfeita.`
            : ''
        }
        confirmLabel={deleting ? 'Excluindo…' : 'Excluir'}
        cancelLabel="Cancelar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
