import { useMemo } from 'react';
import { usePosts } from '../data/PostsContext';
import { StatCard } from '../components/StatCard';
import { ActionCard } from '../components/ActionCard';
import { Spinner } from '../components/Spinner';
import { ErrorBanner, InvalidPostsWarning } from '../components/ErrorBanner';
import { CategoryIcon, CheckIcon, DocIcon, DraftIcon, PlusIcon, PostsIcon, SettingsIcon } from '../components/icons';

export function DashboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { items, loading, error } = usePosts();

  const stats = useMemo(() => {
    const total = items.length;
    const published = items.filter((i) => !i.draft).length;
    const drafts = items.filter((i) => i.draft).length;
    // "Categorias" = quantidade de categorias DISTINTAS realmente em uso nos
    // posts (não o tamanho fixo do enum) -- pedido explícito do handoff.
    const categories = new Set(items.filter((i) => i.category).map((i) => i.category)).size;
    const invalid = items.filter((i) => !i.valid).length;
    return { total, published, drafts, categories, invalid };
  }, [items]);

  return (
    <div className="page">
      <h1>Dashboard</h1>

      {error ? (
        <ErrorBanner message={error} />
      ) : loading ? (
        <Spinner label="Carregando estatísticas…" />
      ) : (
        <>
          <InvalidPostsWarning count={stats.invalid} />

          <section aria-labelledby="stats-heading">
            <p id="stats-heading" className="section-label">
              Estatísticas
            </p>
            <div className="stat-grid">
              <StatCard icon={<DocIcon />} label="Total de artigos" value={stats.total} />
              <StatCard icon={<CheckIcon />} label="Publicados" value={stats.published} />
              <StatCard icon={<DraftIcon />} label="Rascunhos" value={stats.drafts} />
              <StatCard icon={<CategoryIcon />} label="Categorias" value={stats.categories} />
            </div>
          </section>

          <section aria-labelledby="actions-heading">
            <p id="actions-heading" className="section-label">
              Ações rápidas
            </p>
            <div className="action-grid">
              <ActionCard
                icon={<PlusIcon />}
                title="Novo Artigo"
                description="Criar um post novo do zero."
                primary
                onClick={() => onNavigate('/posts/novo')}
              />
              <ActionCard
                icon={<PostsIcon />}
                title="Ver Artigos"
                description="Buscar, filtrar e editar os posts existentes."
                onClick={() => onNavigate('/posts')}
              />
              <ActionCard
                icon={<SettingsIcon />}
                title="Configurações"
                description="Ainda não disponível nesta fase."
                disabled
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
