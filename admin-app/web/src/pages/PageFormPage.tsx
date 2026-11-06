import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { PageFrontmatter } from '@admin-data/index.js';
import { PageNotFoundError, PageShaConflictError, ValidationError, pageFrontmatterSchema } from '@admin-data/index.js';
// `zodIssuesToErrors` não é exportado pelo barrel (`index.ts`) -- só por `schema.ts` direto.
import { zodIssuesToErrors } from '@admin-data/schema.js';
import { usePages } from '../data/PagesContext';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errorMessage';
import { recordToPageFormState, pageFormStateToFrontmatter, type PageFormState } from '../lib/pageForm';
import { createMarkdownEditorExtensions } from '../lib/markdownEditorExtensions';
import { createContentImageUploader } from '../lib/contentImageUpload';
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
 * Classe de cor do contador "(X/max)" perto do label -- puramente
 * apresentação (não valida nada, `maxLength` do input já impede passar do
 * limite). `--near-limit` nos últimos 10%, `--limit` ao atingir o máximo.
 * Ver `.field-hint--near-limit`/`.field-hint--limit` em `index.css`.
 */
function charCountHintClass(length: number, max: number): string {
  if (length >= max) return ' field-hint--limit';
  if (length >= max * 0.9) return ' field-hint--near-limit';
  return '';
}

/**
 * Editor de uma página institucional -- SEM categoria/capa/autor/draft/data
 * (essa página não tem nada disso, diferente de Artigos). Sempre edição
 * nunca criação: `slug` vem fixo da rota (`/pages/:slug`), não existe
 * `/pages/novo`. Reaproveita o mesmo editor rich-text (`MarkdownToolbar` +
 * `createMarkdownEditorExtensions`) do corpo de Artigos -- mesmo
 * comportamento (ver comentário em `PostFormPage.tsx`).
 */
export function PageFormPage({ slug, onNavigate }: PageFormPageProps) {
  const { getPage, updatePage, refresh, uploadContentImage } = usePages();
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
  const [shaConflictOpen, setShaConflictOpen] = useState(false);

  // Guarda o último frontmatter validado que tentou salvar -- usado pra
  // "Sobrescrever" depois de um 409 (ver `resolveShaConflict`).
  const lastAttemptRef = useRef<PageFrontmatter | null>(null);

  // Mesmo padrão de `PostFormPage.tsx`: editor rich-text do corpo (ver spec
  // "Editor WYSIWYG no corpo do artigo/página") -- `onUpdate` mantém
  // `form.body` sincronizado como markdown puro a cada edição.
  const editor = useEditor({
    extensions: createMarkdownEditorExtensions('Escreva o conteúdo da página...'),
    content: '',
    editorProps: {
      attributes: {
        class: 'post-form__body',
        id: 'page-body',
        'aria-labelledby': 'page-body-label',
      },
    },
    onUpdate: ({ editor }) => {
      updateField('body', editor.storage.markdown.getMarkdown());
    },
  });

  const loadFromServer = useCallback(async () => {
    setLoadingInitial(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const record = await getPage(slug);
      setForm(recordToPageFormState(record));
      editor?.commands.setContent(record.body, { emitUpdate: false });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `editor` do
    // `useEditor` é estável entre renders (ver nota equivalente em
    // `PostFormPage.tsx`).
  }, [slug, getPage]);

  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  function updateField<K extends keyof PageFormState>(key: K, value: PageFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Prop `imageUpload` da `MarkdownToolbar` -- `ready: true` sempre
  // (diferente de `PostFormPage.tsx`): página nunca é criada por aqui, só
  // editada (`slug` vem fixo da rota), então sempre tem um slug válido pra
  // decidir o nome do arquivo de imagem de corpo.
  const imageUpload = useMemo(
    () => ({ ready: true, upload: createContentImageUploader(uploadContentImage, slug) }),
    [slug, uploadContentImage],
  );

  // Sincroniza pro storage da extension `AffiliateCard` (ver
  // `addStorage()` em `lib/affiliateCardNode.tsx`) -- é o único canal pelo
  // qual a NodeView de um card JÁ INSERIDO no corpo (botão "Editar") chega
  // na mesma função de upload que o fluxo de INSERIR usa via prop direta
  // (`MarkdownToolbar` -> `imageUpload`). Mesma nota equivalente em
  // `PostFormPage.tsx`.
  useEffect(() => {
    if (!editor) return;
    editor.storage.affiliateCard.imageUpload = imageUpload;
  }, [editor, imageUpload]);

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
                Título{' '}
                <span className={`field-hint${charCountHintClass(form.title.length, 90)}`}>
                  ({form.title.length}/90)
                </span>
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
                Descrição (meta/SEO){' '}
                <span className={`field-hint${charCountHintClass(form.description.length, 160)}`}>
                  ({form.description.length}/160)
                </span>
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
              <span id="page-body-label">Corpo</span>
            </div>
            <MarkdownToolbar editor={editor} imageUpload={imageUpload} />
            <EditorContent editor={editor} />
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
