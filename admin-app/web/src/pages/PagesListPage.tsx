import { usePages } from '../data/PagesContext';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { EmptyState } from '../components/EmptyState';
import { EditIcon } from '../components/icons';

/**
 * Lista as 4 páginas institucionais (sobre-nos, contato,
 * politica-de-privacidade, termos-de-uso). SEM botão "criar nova página" --
 * lista fechada, diferente de Artigos (ver spec). Sem busca/filtro/paginação
 * por padrão porque são sempre exatamente 4 itens fixos, nunca crescem --
 * esses controles existem pra listagem que cresce (Artigos), não fazem
 * sentido aqui.
 */
export function PagesListPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { items, loading, error } = usePages();

  return (
    <div className="page">
      <div className="page-header card">
        <div>
          <h1>Páginas institucionais</h1>
          <p className="page-header__count">{items.length} páginas</p>
        </div>
      </div>

      {error ? (
        <ErrorBanner message={error} />
      ) : loading ? (
        <Spinner label="Carregando páginas…" />
      ) : items.length === 0 ? (
        <EmptyState title="Nenhuma página encontrada" description="Não foi possível carregar as páginas institucionais." />
      ) : (
        <div className="table-wrap card">
          <table className="posts-table">
            <thead>
              <tr>
                <th scope="col">Título</th>
                <th scope="col">Descrição</th>
                <th scope="col">
                  <span className="visually-hidden">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((page) => (
                <tr key={page.slug} className={page.valid ? undefined : 'posts-table__row--invalid'}>
                  <td>
                    <p className="posts-table__title">{page.title}</p>
                    <p className="posts-table__slug">/{page.slug}</p>
                    {!page.valid && <span className="badge badge--warning">Frontmatter inválido</span>}
                  </td>
                  <td>{page.description}</td>
                  <td>
                    <div className="posts-table__actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Editar "${page.title}"`}
                        onClick={() => onNavigate(`/pages/${encodeURIComponent(page.slug)}`)}
                      >
                        <EditIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
