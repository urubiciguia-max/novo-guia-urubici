import { EmptyState } from '../components/EmptyState';

export function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="page">
      <EmptyState
        title="Página não encontrada"
        description="Essa rota não existe no admin."
        action={
          <button type="button" className="btn btn--primary" onClick={() => onNavigate('/dashboard')}>
            Voltar pro Dashboard
          </button>
        }
      />
    </div>
  );
}
