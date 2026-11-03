import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { PageFrontmatter } from '@admin-data/index.js';
import { PageNotFoundError, PageShaConflictError, ValidationError, pageFrontmatterSchema } from '@admin-data/index.js';
// `zodIssuesToErrors` não é exportado pelo barrel (`index.ts`) -- só por `schema.ts` direto.
import { zodIssuesToErrors } from '@admin-data/schema.js';
import { usePages } from '../data/PagesContext';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errorMessage';
import { recordToPageFormState, pageFormStateToFrontmatter, type PageFormState } from '../lib/pageForm';
import { renderMarkdownPreview } from '../lib/markdownPreview';
import type { SelectionResult } from '../lib/markdownToolbarActions';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { EmptyState } from '../components/EmptyState';
import { MarkdownToolbar } from '../components/MarkdownToolbar';

export interface PageFormPageProps {
  slug: string;
  onNavigate: (path: string) => void;
}

const EMPTY_FORM: PageFormState = { title: '', description: '', body: '' };

/**
 * Editor de uma página institucional -- SEM categoria/capa/autor/draft/data
 * (essa página não tem nada disso, diferente de Artigos). Sempre edição
 * nunca criação: `slug` vem fixo da rota (`/pages/:slug`), não existe
 * `/pages/novo`. Reaproveita a mesma `MarkdownToolbar` e o mesmo
 * `renderMarkdownPreview` do corpo de Artigos -- mesmo comportamento de
 * foco/cursor depois de uma ação da toolbar (ver comentário em
 * `PostFormPage.tsx`).
 */
export function PageFormPage({ slug, onNavigate }: PageFormPageProps) {
  const { getPage, updatePage, refresh } = usePages();
  const toast = useToast();

  const [form, setForm] = useState<PageFormState>(EMPTY_FORM);
  const [sha, setSha] = useState<string | null>(null);
  const [initialValid, setInitialValid] = useState(true);
  const [initialValidationErrors, setInitialValidationErrors] = useState<string[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [shaConflictOpen, setShaConflictOpen] = useState(false);

  // Guarda o último frontmatter validado que tentou salvar -- usado pra
  // "Sobrescrever" depois de um 409 (ver `resolveShaConflict`).
  const lastAttemptRef = useRef<PageFrontmatter | null>(null);

  // Mesmo padrão de `PostFormPage.tsx`: `bodyRef` dá pra `MarkdownToolbar`
  // ler `selectionStart`/`selectionEnd` ao vivo, `pendingSelectionRef`
  // guarda onde o cursor deveria ficar depois que o textarea é recriado
  // com o novo `value`, aplicado pelo `useLayoutEffect` antes do navegador
  // pintar o novo frame.
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    const el = bodyRef.current;
    if (!pending || !el) return;
    el.focus();
    el.setSelectionRange(pending.start, pending.end);
    pendingSelectionRef.current = null;
  }, [form.body]);

  function applyToolbarResult(result: SelectionResult) {
    pendingSelectionRef.current = { start: result.selectionStart, end: result.selectionEnd };
    updateField('body', result.text);
  }

  const loadFromServer = useCallback(async () => {
    setLoadingInitial(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const record = await getPage(slug);
      setForm(recordToPageFormState(record));
      setSha(record.sha);
      setInitialValid(record.valid);
      setInitialValidationErrors(record.validationErrors ?? []);
    } catch (err) {
      if (err instanceof PageNotFoundError) {
        setNotFound(true);
      } else {
        setLoadError(describeError(err));
      }
    } finally {
      setLoadingInitial(false);
    }
  }, [slug, getPage]);

  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  function updateField<K extends keyof PageFormState>(key: K, value: PageFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(frontmatter: PageFrontmatter, opts?: { forceSha?: string }) {
    setSubmitting(true);
    try {
      const currentSha = opts?.forceSha ?? sha;
      if (!currentSha) throw new Error('Página sem SHA carregado -- recarregue a página.');
      const result = await updatePage(slug, frontmatter, form.body, currentSha);
      setSha(result.sha);
      toast.push('Página atualizada.', 'success');
      await refresh();
      onNavigate('/pages');
    } catch (err) {
      if (err instanceof ValidationError) {
        const errors: Record<string, string> = {};
        for (const issue of err.issues) errors[issue.path || '(raiz)'] = issue.message;
        setFieldErrors(errors);
        toast.push('Corrija os campos destacados antes de salvar.', 'error');
      } else if (err instanceof PageShaConflictError) {
        setShaConflictOpen(true);
      } else {
        toast.push(describeError(err), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const frontmatter = pageFormStateToFrontmatter(form);
    const parsed = pageFrontmatterSchema.safeParse(frontmatter);
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
    toast.push('Recarregando a versão mais recente da página…', 'info');
    await loadFromServer();
  }

  async function resolveShaConflictOverwrite() {
    setShaConflictOpen(false);
    if (!lastAttemptRef.current) return;
    try {
      const latest = await getPage(slug);
      await submit(lastAttemptRef.current, { forceSha: latest.sha });
    } catch (err) {
      toast.push(describeError(err), 'error');
    }
  }

  if (notFound) {
    return (
      <div className="page">
        <EmptyState
          title="Página não encontrada"
          description={`Não existe nenhuma página com o slug "${slug}" no repositório.`}
          action={
            <button type="button" className="btn btn--primary" onClick={() => onNavigate('/pages')}>
              Voltar pra Páginas
            </button>
          }
        />
      </div>
    );
  }

  if (loadingInitial) {
    return (
      <div className="page">
        <Spinner label="Carregando página…" />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header card">
        <h1>Editar página</h1>
      </div>

      {loadError && <ErrorBanner message={loadError} />}

      {!initialValid && (
        <div className="warning-banner" role="status">
          Esta página tem frontmatter inválido ({initialValidationErrors.join('; ') || 'erro desconhecido'}). Revise
          os campos abaixo antes de salvar -- salvar aqui corrige o arquivo.
        </div>
      )}

      <form className="post-form card" onSubmit={handleSubmit}>
        <div className="form-section">
          <h2 className="section-label">SEO</h2>

          <div className="form-row">
            <label className="form-field">
              <span>
                Título <span className="field-hint">({form.title.length}/90)</span>
              </span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                maxLength={90}
                required
              />
              <span className="field-hint">Vira o &lt;title&gt; da aba do navegador E o título mostrado na página.</span>
              {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
            </label>
          </div>

          <div className="form-row">
            <label className="form-field">
              <span>
                Descrição (meta/SEO) <span className="field-hint">({form.description.length}/160)</span>
              </span>
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
        </div>

        <div className="form-row">
          <div className="form-field">
            <div className="post-form__body-header">
              <span id="page-body-label">Corpo (markdown)</span>
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
                id="page-body"
                aria-labelledby="page-body-label"
                // eslint-disable-next-line react/no-danger -- conteúdo escapado em `renderMarkdownPreview` antes de qualquer transformação.
                dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(form.body) || '<p><em>Vazio.</em></p>' }}
              />
            ) : (
              <>
                <MarkdownToolbar textareaRef={bodyRef} value={form.body} onApply={applyToolbarResult} />
                <textarea
                  ref={bodyRef}
                  className="post-form__body"
                  id="page-body"
                  aria-labelledby="page-body-label"
                  value={form.body}
                  onChange={(e) => updateField('body', e.target.value)}
                  rows={16}
                />
              </>
            )}
          </div>
        </div>

        <div className="post-form__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onNavigate('/pages')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={shaConflictOpen}
        title="Página modificada em outro lugar"
        description="Alguém (ou outra aba) salvou esta página depois que você abriu pra editar. Recarregar descarta suas mudanças e mostra a versão mais recente; sobrescrever salva do seu jeito por cima da versão mais recente."
        confirmLabel="Sobrescrever"
        cancelLabel="Recarregar"
        destructive
        onConfirm={() => void resolveShaConflictOverwrite()}
        onCancel={() => void resolveShaConflictReload()}
      />
    </div>
  );
}
