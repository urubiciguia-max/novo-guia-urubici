import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { PostFrontmatter } from '@admin-data/index.js';
import { CATEGORIES, PostAlreadyExistsError, PostNotFoundError, ShaConflictError, ValidationError } from '@admin-data/index.js';
import { postFrontmatterSchema } from '@admin-data/index.js';
// `zodIssuesToErrors` não é exportado pelo barrel (`index.ts`) -- só por `schema.ts` direto.
import { zodIssuesToErrors } from '@admin-data/schema.js';
import { usePosts } from '../data/PostsContext';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errorMessage';
import { emptyFormState, formStateToFrontmatter, recordToFormState, type PostFormState } from '../lib/postForm';
import { renderMarkdownPreview } from '../lib/markdownPreview';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { EmptyState } from '../components/EmptyState';
import { TrashIcon } from '../components/icons';

export interface PostFormPageProps {
  /** `null` = criar. String = editar (nome do arquivo, vem da rota -- ver `useHashRoute`). */
  slug: string | null;
  onNavigate: (path: string) => void;
}

export function PostFormPage({ slug, onNavigate }: PostFormPageProps) {
  const isEdit = slug !== null;
  const { getPost, createPost, updatePost, deletePost, refresh } = usePosts();
  const toast = useToast();

  const [form, setForm] = useState<PostFormState>(emptyFormState);
  const [sha, setSha] = useState<string | null>(null);
  const [initialValid, setInitialValid] = useState(true);
  const [initialValidationErrors, setInitialValidationErrors] = useState<string[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [shaConflictOpen, setShaConflictOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Guarda o último frontmatter validado que tentou salvar -- usado pra
  // "Sobrescrever" depois de um 409 (ver `resolveShaConflict`).
  const lastAttemptRef = useRef<PostFrontmatter | null>(null);

  const loadFromServer = useCallback(async () => {
    if (!slug) return;
    setLoadingInitial(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const record = await getPost(slug);
      setForm(recordToFormState(record, slug));
      setSha(record.sha);
      setInitialValid(record.valid);
      setInitialValidationErrors(record.validationErrors ?? []);
    } catch (err) {
      if (err instanceof PostNotFoundError) {
        setNotFound(true);
      } else {
        setLoadError(describeError(err));
      }
    } finally {
      setLoadingInitial(false);
    }
  }, [slug, getPost]);

  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  function updateField<K extends keyof PostFormState>(key: K, value: PostFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(frontmatter: PostFrontmatter, opts?: { forceSha?: string }) {
    setSubmitting(true);
    try {
      if (isEdit) {
        const currentSha = opts?.forceSha ?? sha;
        if (!currentSha) throw new Error('Post sem SHA carregado -- recarregue a página.');
        const result = await updatePost(slug!, frontmatter, form.body, currentSha);
        setSha(result.sha);
        toast.push('Post atualizado.', 'success');
        await refresh();
        onNavigate('/posts');
      } else {
        await createPost(frontmatter.legacySlug, frontmatter, form.body);
        toast.push('Post criado.', 'success');
        await refresh();
        onNavigate('/posts');
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        const errors: Record<string, string> = {};
        for (const issue of err.issues) errors[issue.path || '(raiz)'] = issue.message;
        setFieldErrors(errors);
        toast.push('Corrija os campos destacados antes de salvar.', 'error');
      } else if (err instanceof ShaConflictError) {
        setShaConflictOpen(true);
      } else if (err instanceof PostAlreadyExistsError) {
        setFieldErrors({ legacySlug: err.message });
        toast.push(err.message, 'error');
      } else {
        toast.push(describeError(err), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const frontmatter = formStateToFrontmatter(form);
    const parsed = postFrontmatterSchema.safeParse(frontmatter);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of zodIssuesToErrors(parsed.error.issues)) errors[issue.path || '(raiz)'] = issue.message;
      setFieldErrors(errors);
      toast.push('Corrija os campos destacados antes de salvar.', 'error');
      return;
    }
    setFieldErrors({});
    lastAttemptRef.current = parsed.data;
    void submit(parsed.data);
  }

  async function resolveShaConflictReload() {
    setShaConflictOpen(false);
    toast.push('Recarregando a versão mais recente do post…', 'info');
    await loadFromServer();
  }

  async function resolveShaConflictOverwrite() {
    setShaConflictOpen(false);
    if (!slug || !lastAttemptRef.current) return;
    try {
      const latest = await getPost(slug);
      await submit(lastAttemptRef.current, { forceSha: latest.sha });
    } catch (err) {
      toast.push(describeError(err), 'error');
    }
  }

  async function confirmDelete() {
    if (!slug || !sha) return;
    setDeleting(true);
    try {
      await deletePost(slug, sha);
      toast.push('Post excluído.', 'success');
      await refresh();
      onNavigate('/posts');
    } catch (err) {
      toast.push(describeError(err), 'error');
      setDeleteDialogOpen(false);
      await loadFromServer();
    } finally {
      setDeleting(false);
    }
  }

  if (notFound) {
    return (
      <div className="page">
        <EmptyState
          title="Post não encontrado"
          description={`Não existe nenhum post com o slug "${slug}" no repositório.`}
          action={
            <button type="button" className="btn btn--primary" onClick={() => onNavigate('/posts')}>
              Voltar pra Artigos
            </button>
          }
        />
      </div>
    );
  }

  if (loadingInitial) {
    return (
      <div className="page">
        <Spinner label="Carregando post…" />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header card">
        <h1>{isEdit ? 'Editar artigo' : 'Novo artigo'}</h1>
        {isEdit && (
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <TrashIcon /> Excluir
          </button>
        )}
      </div>

      {loadError && <ErrorBanner message={loadError} />}

      {isEdit && !initialValid && (
        <div className="warning-banner" role="status">
          Este post tem frontmatter inválido ({initialValidationErrors.join('; ') || 'erro desconhecido'}). Revise os
          campos abaixo antes de salvar -- salvar aqui corrige o arquivo.
        </div>
      )}

      <form className="post-form card" onSubmit={handleSubmit}>
        <div className="form-row">
          <label className="form-field">
            <span>Título</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
              maxLength={90}
              required
            />
            {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
          </label>
        </div>

        <div className="form-row">
          <label className="form-field">
            <span>Descrição (meta/SEO)</span>
            <textarea
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              maxLength={160}
              rows={2}
              required
            />
            {fieldErrors.description && <span className="field-error">{fieldErrors.description}</span>}
          </label>
        </div>

        <div className="form-row form-row--split">
          <label className="form-field">
            <span>Data de publicação</span>
            <input type="date" value={form.pubDate} onChange={(e) => updateField('pubDate', e.target.value)} required />
            {fieldErrors.pubDate && <span className="field-error">{fieldErrors.pubDate}</span>}
          </label>
          <label className="form-field">
            <span>Data de atualização (opcional)</span>
            <input
              type="date"
              value={form.updatedDate}
              onChange={(e) => updateField('updatedDate', e.target.value)}
            />
            {fieldErrors.updatedDate && <span className="field-error">{fieldErrors.updatedDate}</span>}
          </label>
        </div>

        <div className="form-row form-row--split">
          <label className="form-field">
            <span>Autor</span>
            <input type="text" value={form.author} onChange={(e) => updateField('author', e.target.value)} />
          </label>
          <label className="form-field">
            <span>Categoria</span>
            <select value={form.category} onChange={(e) => updateField('category', e.target.value as PostFormState['category'])} required>
              <option value="" disabled>
                Selecione uma categoria
              </option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {fieldErrors.category && <span className="field-error">{fieldErrors.category}</span>}
          </label>
        </div>

        <div className="form-row">
          <label className="form-field">
            <span>Tags (separadas por vírgula)</span>
            <input
              type="text"
              value={form.tagsText}
              onChange={(e) => updateField('tagsText', e.target.value)}
              placeholder="cachoeiras, trilhas, roteiro"
            />
          </label>
        </div>

        <div className="form-row">
          <label className="form-field form-field--checkbox">
            <input type="checkbox" checked={form.draft} onChange={(e) => updateField('draft', e.target.checked)} />
            <span>Rascunho (não publica no site)</span>
          </label>
        </div>

        <div className="form-row">
          <label className="form-field">
            <span>Slug legado (WordPress) -- define o nome do arquivo e a URL final</span>
            <input
              type="text"
              value={form.legacySlug}
              onChange={(e) => updateField('legacySlug', e.target.value)}
              placeholder="cachoeiras-secretas-urubici"
              disabled={isEdit}
              required
              pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
            />
            {isEdit ? (
              <span className="field-hint">
                Travado em edição -- mudar isso sem renomear o arquivo quebraria a URL/SEO. O nome do arquivo é{' '}
                <code>{slug}.md</code>.
              </span>
            ) : (
              <span className="field-hint">
                Vira o nome do arquivo: <code>src/content/posts/{form.legacySlug || '<slug>'}.md</code>. Só minúsculas,
                números e hífen.
              </span>
            )}
            {fieldErrors.legacySlug && <span className="field-error">{fieldErrors.legacySlug}</span>}
          </label>
        </div>

        <div className="form-row">
          <div className="form-field">
            <div className="post-form__body-header">
              <span>Corpo (markdown)</span>
              <div className="tabs" role="tablist" aria-label="Alternar editor/preview">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!previewMode}
                  className={`tabs__tab${!previewMode ? ' tabs__tab--active' : ''}`}
                  onClick={() => setPreviewMode(false)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode}
                  className={`tabs__tab${previewMode ? ' tabs__tab--active' : ''}`}
                  onClick={() => setPreviewMode(true)}
                >
                  Preview
                </button>
              </div>
            </div>
            {previewMode ? (
              <div
                className="post-form__preview"
                // eslint-disable-next-line react/no-danger -- conteúdo escapado em `renderMarkdownPreview` antes de qualquer transformação.
                dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(form.body) || '<p><em>Vazio.</em></p>' }}
              />
            ) : (
              <textarea
                className="post-form__body"
                value={form.body}
                onChange={(e) => updateField('body', e.target.value)}
                rows={16}
              />
            )}
          </div>
        </div>

        <div className="post-form__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onNavigate('/posts')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Criar post'}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={shaConflictOpen}
        title="Post modificado em outro lugar"
        description="Alguém (ou outra aba) salvou este post depois que você abriu pra editar. Recarregar descarta suas mudanças e mostra a versão mais recente; sobrescrever salva do seu jeito por cima da versão mais recente."
        confirmLabel="Sobrescrever"
        cancelLabel="Recarregar"
        destructive
        onConfirm={() => void resolveShaConflictOverwrite()}
        onCancel={() => void resolveShaConflictReload()}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Excluir artigo"
        description={`Tem certeza que quer excluir "${form.title || slug}"? Essa ação remove o arquivo do repositório e não pode ser desfeita.`}
        confirmLabel={deleting ? 'Excluindo…' : 'Excluir'}
        cancelLabel="Cancelar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </div>
  );
}
