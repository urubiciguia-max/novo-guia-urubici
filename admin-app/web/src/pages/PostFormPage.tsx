import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { PostFrontmatter, RenamePostResult } from '@admin-data/index.js';
import {
  PostAlreadyExistsError,
  PostNotFoundError,
  ShaConflictError,
  ValidationError,
} from '@admin-data/index.js';
import { postFrontmatterSchema } from '@admin-data/index.js';
// `zodIssuesToErrors` não é exportado pelo barrel (`index.ts`) -- só por `schema.ts` direto.
import { zodIssuesToErrors } from '@admin-data/schema.js';
import { usePosts } from '../data/PostsContext';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/errorMessage';
import {
  emptyFormState,
  formStateToFrontmatter,
  isSlugRename,
  recordToFormState,
  type PostFormState,
} from '../lib/postForm';
import { createMarkdownEditorExtensions } from '../lib/markdownEditorExtensions';
import { createContentImageUploader } from '../lib/contentImageUpload';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { CoverImageUpload } from '../components/CoverImageUpload';
import { MarkdownToolbar } from '../components/MarkdownToolbar';
import { PlusIcon, TrashIcon } from '../components/icons';

export interface PostFormPageProps {
  /** `null` = criar. String = editar (nome do arquivo, vem da rota -- ver `useHashRoute`). */
  slug: string | null;
  onNavigate: (path: string) => void;
}

export function PostFormPage({ slug, onNavigate }: PostFormPageProps) {
  const isEdit = slug !== null;
  const { getPost, createPost, updatePost, renamePost, deletePost, refresh, uploadContentImage } = usePosts();
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
  const [shaConflictOpen, setShaConflictOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Confirmação explícita antes de salvar um rename de slug (muda a URL
  // pública) -- ver handoff "rename-post-slug". Só abre quando o usuário
  // mudou `legacySlug` em relação ao slug original da rota.
  const [renameConfirmOpen, setRenameConfirmOpen] = useState(false);

  // Guarda o último frontmatter validado que tentou salvar -- usado pra
  // "Sobrescrever" depois de um 409 (ver `resolveShaConflict`) e pro
  // confirm de rename. `submit()` decide update-vs-rename sozinho a partir
  // de `isSlugRename(frontmatter, slug)`, então não precisa de um ref extra
  // só pra lembrar "era rename" -- o próprio frontmatter guardado já contém
  // o `legacySlug` tentado.
  const lastAttemptRef = useRef<PostFrontmatter | null>(null);

  // Editor rich-text do corpo (ver spec "Editor WYSIWYG no corpo do artigo/
  // página", `.agents/inbox/genilson.md`) -- substitui o par
  // `<textarea>` + toggle Editar/Preview. `onUpdate` mantém `form.body`
  // sincronizado (sempre como MARKDOWN puro, via `tiptap-markdown`) a cada
  // edição -- o editor em si é a fonte da verdade do conteúdo, `form.body`
  // é só o espelho que `submit()` já lia antes.
  const editor = useEditor({
    extensions: createMarkdownEditorExtensions('Escreva o conteúdo do artigo...'),
    content: '',
    // `editorProps.attributes` vai pro elemento contenteditable DE VERDADE
    // (`editor.view.dom`) -- diferente de passar `id`/`className` pro
    // `<EditorContent>` JSX, que só chegariam na DIV wrapper que o
    // `@tiptap/react` usa como ponto de montagem (ver `PureEditorContent`).
    // O rótulo (`aria-labelledby`) só funciona pra leitor de tela se estiver
    // no elemento que de fato recebe foco/tem `role` de textbox.
    editorProps: {
      attributes: {
        class: 'post-form__body',
        id: 'post-body',
        'aria-labelledby': 'post-body-label',
      },
    },
    onUpdate: ({ editor }) => {
      updateField('body', editor.storage.markdown.getMarkdown());
    },
  });

  const loadFromServer = useCallback(async () => {
    if (!slug) return;
    setLoadingInitial(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const record = await getPost(slug);
      setForm(recordToFormState(record, slug));
      // `{ emitUpdate: false }` -- carregar o post não deve re-disparar
      // `onUpdate` (acima) com o MESMO conteúdo que acabou de vir do
      // servidor; evita um round-trip markdown->doc->markdown redundante
      // logo na carga (inofensivo, mas sem propósito).
      editor?.commands.setContent(record.body, { emitUpdate: false });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `editor` do
    // `useEditor` já é estável entre renders (mesma instância, não recria
    // por mudança de conteúdo); incluir na lista só adicionaria ruído sem
    // mudar quando este callback é recriado.
  }, [slug, getPost]);

  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  function updateField<K extends keyof PostFormState>(key: K, value: PostFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Prop `imageUpload` da `MarkdownToolbar` (item "Inserir imagem") -- mesmo
  // gate do `CoverImageUpload` (`legacySlug.trim() !== ''`): post NOVO sem
  // slug ainda não tem como decidir o nome do arquivo de imagem de corpo
  // (`uploadContentImage` exige um slug válido, ver handoff do Jurandir).
  const imageUpload = useMemo(
    () => ({
      ready: form.legacySlug.trim() !== '',
      upload: createContentImageUploader(uploadContentImage, form.legacySlug),
    }),
    [form.legacySlug, uploadContentImage],
  );

  function addFaqItem() {
    setForm((f) => ({ ...f, faq: [...f.faq, { question: '', answer: '' }] }));
  }

  function updateFaqItem(index: number, field: 'question' | 'answer', value: string) {
    setForm((f) => ({
      ...f,
      faq: f.faq.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  }

  function removeFaqItem(index: number) {
    setForm((f) => ({ ...f, faq: f.faq.filter((_, i) => i !== index) }));
  }

  // `affiliates`/`relatedSlugsText`/`author`/`tagsText` não têm mais widget de
  // edição nesta tela (V3 -- ver spec) mas continuam em `PostFormState`,
  // carregados por `recordToFormState` e devolvidos intactos por
  // `formStateToFrontmatter` no save. Preservação silenciosa, não remoção de
  // dados -- NÃO tirar esses campos do objeto de save (reintroduziria o bug
  // de perda de dados corrigido em `c2dfdd1`).

  async function submit(frontmatter: PostFrontmatter, opts?: { forceSha?: string }) {
    setSubmitting(true);
    try {
      if (isEdit) {
        const currentSha = opts?.forceSha ?? sha;
        if (!currentSha) throw new Error('Post sem SHA carregado -- recarregue a página.');
        const renaming = isSlugRename(frontmatter, slug);
        const result = renaming
          ? await renamePost(slug!, frontmatter.legacySlug, frontmatter, form.body, currentSha)
          : await updatePost(slug!, frontmatter, form.body, currentSha);
        setSha(result.sha);
        // Só vem preenchido quando a capa seguia a convenção `${oldSlug}-capa.<ext>`
        // e foi copiada pro nome novo (ver `GitHubPostsClient.renamePost`) --
        // sem isso o form continuaria apontando pro caminho de capa antigo.
        // `renaming` (não `'coverPath' in result`) decide o narrowing aqui --
        // só `renamePost` devolve `RenamePostResult`, `updatePost` nunca tem
        // essa propriedade.
        const coverPath = renaming ? (result as RenamePostResult).coverPath : undefined;
        if (coverPath) {
          updateField('cover', coverPath);
        }
        toast.push(
          renaming ? `Post renomeado para "${frontmatter.legacySlug}" e atualizado.` : 'Post atualizado.',
          'success'
        );
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
    if (isSlugRename(parsed.data, slug)) {
      // Muda a URL pública -- pede confirmação explícita ANTES de chamar
      // `renamePost` (ver `ConfirmDialog` de rename mais abaixo no JSX).
      setRenameConfirmOpen(true);
      return;
    }
    void submit(parsed.data);
  }

  function confirmRename() {
    setRenameConfirmOpen(false);
    if (!lastAttemptRef.current) return;
    void submit(lastAttemptRef.current);
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
        <div className="form-section">
          <h2 className="section-label">SEO</h2>

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

          <div className="form-row">
            <label className="form-field">
              <span>Slug legado (WordPress) -- define o nome do arquivo e a URL final</span>
              <input
                type="text"
                value={form.legacySlug}
                onChange={(e) => updateField('legacySlug', e.target.value)}
                placeholder="ex.: nome-do-artigo-aqui"
                required
                pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
              />
              {isEdit ? (
                // Comparação direta com `form.legacySlug` (não `formStateToFrontmatter`
                // inteiro) -- é o mesmo valor 1:1, sem transformação nenhuma
                // entre form e frontmatter nesse campo (ver `formStateToFrontmatter`).
                form.legacySlug !== slug ? (
                  <span className="field-hint field-hint--near-limit">
                    Ao salvar, a URL pública deste post muda de <code>/{slug}</code> para{' '}
                    <code>/{form.legacySlug}</code>. Um redirecionamento 301 automático garante que links antigos
                    continuem funcionando.
                  </span>
                ) : (
                  <span className="field-hint">
                    Mudar isso muda a URL pública deste post -- um redirecionamento é criado automaticamente, mas
                    evite trocar sem necessidade.
                  </span>
                )
              ) : (
                <span className="field-hint">
                  Vira o nome do arquivo: <code>src/content/posts/{form.legacySlug || '<slug>'}.md</code>. Só minúsculas,
                  números e hífen.
                  {!form.legacySlug && (
                    <>
                      {' '}
                      <strong>Campo ainda vazio</strong> -- é por isso que o botão de enviar imagem (mais abaixo)
                      está desabilitado.
                    </>
                  )}
                </span>
              )}
              {fieldErrors.legacySlug && <span className="field-error">{fieldErrors.legacySlug}</span>}
            </label>
          </div>
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

        <div className="form-row">
          <label className="form-field form-field--checkbox">
            <input type="checkbox" checked={form.draft} onChange={(e) => updateField('draft', e.target.checked)} />
            <span>Rascunho (não publica no site)</span>
          </label>
        </div>

        <div className="form-section">
          <h2 className="section-label">Imagem de destaque</h2>

          <div className="form-row">
            <div className="form-field">
              <span>Imagem</span>
              <CoverImageUpload
                legacySlug={form.legacySlug}
                currentPath={form.cover}
                onUploaded={(path) => updateField('cover', path)}
              />
              {fieldErrors.cover && <span className="field-error">{fieldErrors.cover}</span>}
            </div>
          </div>

          <div className="form-row">
            <label className="form-field">
              <span>Texto alternativo (alt)</span>
              <input
                type="text"
                value={form.coverAlt}
                onChange={(e) => updateField('coverAlt', e.target.value)}
                placeholder="Cachoeira cercada de mata nativa em Urubici"
              />
              {fieldErrors.coverAlt && <span className="field-error">{fieldErrors.coverAlt}</span>}
            </label>
          </div>

          <div className="form-row">
            <label className="form-field">
              <span>Crédito da foto (opcional)</span>
              <input
                type="text"
                value={form.coverCredit}
                onChange={(e) => updateField('coverCredit', e.target.value)}
                placeholder='Ex: "Foto: João Silva/Unsplash"'
              />
              <span className="field-hint">Quando preenchido, aparece como legenda pequena embaixo da imagem de destaque.</span>
              {fieldErrors.coverCredit && <span className="field-error">{fieldErrors.coverCredit}</span>}
            </label>
          </div>
        </div>

        <div className="form-row">
          <div className="form-field">
            <div className="post-form__body-header">
              <span id="post-body-label">Corpo</span>
            </div>
            <MarkdownToolbar editor={editor} imageUpload={imageUpload} />
            <EditorContent editor={editor} />
          </div>
        </div>

        <div className="form-section">
          <h2 className="section-label">FAQ</h2>

          {form.faq.length === 0 && <p className="field-hint">Nenhuma pergunta ainda.</p>}

          {form.faq.map((item, index) => (
            <div className="repeatable-item" key={index}>
              <div className="repeatable-item__fields repeatable-item__fields--faq">
                <div className="repeatable-item__header">
                  <Badge variant="neutral">Pergunta {index + 1}</Badge>
                </div>
                <label className="form-field">
                  <span>Pergunta</span>
                  <input
                    type="text"
                    value={item.question}
                    onChange={(e) => updateFaqItem(index, 'question', e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Resposta</span>
                  <textarea
                    value={item.answer}
                    onChange={(e) => updateFaqItem(index, 'answer', e.target.value)}
                    rows={2}
                  />
                </label>
              </div>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                aria-label={`Remover pergunta ${index + 1}`}
                onClick={() => removeFaqItem(index)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}

          <button type="button" className="btn btn--primary btn--sm" onClick={addFaqItem}>
            <PlusIcon /> Adicionar pergunta
          </button>
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
        open={renameConfirmOpen}
        title="Mudar a URL pública deste post?"
        description={`A URL vai mudar de "/${slug}" para "/${form.legacySlug}". Um redirecionamento 301 automático é criado -- links e compartilhamentos antigos continuam funcionando -- mas é uma ação que muda algo já publicado.`}
        confirmLabel="Mudar URL e salvar"
        cancelLabel="Cancelar"
        destructive={false}
        onConfirm={confirmRename}
        onCancel={() => setRenameConfirmOpen(false)}
      />

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
