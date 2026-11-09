import { useState } from 'react';
import { useComments } from '../data/CommentsContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { EmptyState } from '../components/EmptyState';
import { CheckIcon, TrashIcon } from '../components/icons';
import type { PendingComment } from '../lib/commentsClient';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Fila de moderação de comentários -- `GET /api/admin/comments?status=pending`
 * (ver `data/CommentsContext.tsx`/`lib/commentsClient.ts` pro contrato
 * completo, combinado com o Jurandir). Aprovar/Rejeitar aqui chamam
 * `POST .../approve` e `POST .../reject` -- sucesso remove o item da lista
 * (a `CommentsContext` já faz isso de forma otimista).
 *
 * Rejeitar passa por `ConfirmDialog` (regra do DS: ação destrutiva nunca
 * em 1 clique -- rejeitar descarta o comentário do visitante pra sempre).
 * Aprovar NÃO passa por confirmação -- é reversível em espírito (publica
 * algo, não destrói nada) e não existe fluxo de "despublicar" aqui, mesma
 * lógica de "Editar" vs. "Excluir" nas outras listas do admin.
 */
export function CommentsModerationPage() {
  const { items, loading, error, approve, reject } = useComments();
  const toast = useToast();
  const [pendingReject, setPendingReject] = useState<PendingComment | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null);

  async function handleApprove(comment: PendingComment) {
    setActingKey(comment.key);
    try {
      await approve(comment);
      toast.push(`Comentário de "${comment.name}" aprovado.`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível aprovar o comentário.';
      toast.push(message, message.includes('já foi moderado') ? 'info' : 'error');
    } finally {
      setActingKey(null);
    }
  }

  async function confirmReject() {
    if (!pendingReject) return;
    const comment = pendingReject;
    setActingKey(comment.key);
    try {
      await reject(comment);
      toast.push(`Comentário de "${comment.name}" rejeitado.`, 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Não foi possível rejeitar o comentário.', 'error');
    } finally {
      setActingKey(null);
      setPendingReject(null);
    }
  }

  return (
    <div className="page">
      <div className="page-header card">
        <div>
          <h1>Comentários</h1>
          <p className="page-header__count">
            {items.length === 0
              ? 'Nenhum comentário aguardando moderação'
              : items.length === 1
                ? '1 comentário aguardando moderação'
                : `${items.length} comentários aguardando moderação`}
          </p>
        </div>
      </div>

      {error ? (
        <ErrorBanner message={error} />
      ) : loading ? (
        <Spinner label="Carregando comentários…" />
      ) : items.length === 0 ? (
        <EmptyState title="Fila vazia" description="Não há comentários pendentes de moderação agora." />
      ) : (
        <div className="table-wrap card">
          <table className="posts-table comments-table">
            <thead>
              <tr>
                <th scope="col">Comentário</th>
                <th scope="col">Post</th>
                <th scope="col">Data</th>
                <th scope="col">
                  <span className="visually-hidden">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((comment) => (
                <tr key={comment.key}>
                  <td>
                    <p className="posts-table__title">{comment.name}</p>
                    <p className="comments-table__text">{comment.text}</p>
                  </td>
                  <td className="posts-table__slug">{comment.slug}</td>
                  <td>{dateFormatter.format(new Date(comment.createdAt))}</td>
                  <td>
                    <div className="posts-table__actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={actingKey === comment.key}
                        aria-label={`Aprovar comentário de "${comment.name}"`}
                        onClick={() => handleApprove(comment)}
                      >
                        <CheckIcon /> Aprovar
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={actingKey === comment.key}
                        aria-label={`Rejeitar comentário de "${comment.name}"`}
                        onClick={() => setPendingReject(comment)}
                      >
                        <TrashIcon /> Rejeitar
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
        open={pendingReject !== null}
        title="Rejeitar comentário"
        description={
          pendingReject
            ? `Tem certeza que quer rejeitar o comentário de "${pendingReject.name}"? Ele não vai aparecer no site e essa ação não pode ser desfeita.`
            : ''
        }
        confirmLabel="Rejeitar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={confirmReject}
        onCancel={() => setPendingReject(null)}
      />
    </div>
  );
}
