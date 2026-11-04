import { useEffect, useRef, useState, type RefObject } from 'react';
import { describeError } from '../lib/errorMessage';
import { compressCoverImage, formatBytes, validateImageFile } from '../lib/imageUpload';
import { UploadIcon } from './icons';

export interface ImageDialogUploadResult {
  path: string;
}

export interface ImageDialogProps {
  open: boolean;
  /** Ref do botão-gatilho ("Inserir" do dropdown) pra onde o foco volta ao
   *  fechar -- mesmo motivo do `HtmlBlockDialog`/`DestaqueDialog`: o item
   *  do dropdown que abre este diálogo desmonta no mesmo clique. */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Já amarrado ao slug certo pelo chamador (`PostFormPage`/`PageFormPage`
   *  via `MarkdownToolbarProps['imageUpload']`) -- este componente não sabe
   *  (nem precisa saber) de post/página/slug. */
  upload: (file: File) => Promise<ImageDialogUploadResult>;
  onConfirm: (result: { path: string; alt: string }) => void;
  onCancel: () => void;
}

type UploadStatus = 'idle' | 'compressing' | 'uploading' | 'done' | 'error';

/**
 * Modal "Inserir imagem" do item "Inserir imagem" no dropdown "Inserir" da
 * `MarkdownToolbar` -- mesmo padrão a11y do `LinkDialog`/`DestaqueDialog`
 * (backdrop, `role="dialog"`, Esc fecha, clique no backdrop fecha, foco
 * volta pro gatilho), mas o fluxo em si é o do `CoverImageUpload.tsx`:
 * seleciona arquivo -> valida magic bytes real (`validateImageFile`) ->
 * comprime no canvas (`compressCoverImage`) -> sobe (`upload`, já amarrado
 * ao `uploadContentImage`/slug pelo chamador) -> só então libera o campo
 * "Texto alternativo (alt)", OBRIGATÓRIO, e o botão "Inserir".
 *
 * Diferente do `CoverImageUpload` (que fica sempre montado na tela e só
 * atualiza um path), aqui a imagem só é de fato inserida no editor quando o
 * usuário confirma -- se cancelar depois de já ter subido o arquivo, o
 * upload fica órfão no repositório (mesmo trade-off aceito pela capa: o
 * usuário pode trocar de imagem de capa e nunca salvar o post).
 */
export function ImageDialog({ open, returnFocusRef, upload, onConfirm, onCancel }: ImageDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  const [status, setStatus] = useState<UploadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<{ width: number; height: number; bytes: number } | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [alt, setAlt] = useState('');

  const busy = status === 'compressing' || status === 'uploading';
  const canSubmit = status === 'done' && uploadedPath !== null && alt.trim() !== '';

  function resetState() {
    setStatus('idle');
    setError(null);
    setUploadedPath(null);
    setAlt('');
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewInfo(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      resetState();
      selectButtonRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      returnFocusRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Revoga a object URL da preview ao desmontar -- mesmo cuidado do
  // `CoverImageUpload`.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  async function handleFileSelected(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploadedPath(null);

    const validation = await validateImageFile(file);
    if (!validation.ok) {
      setError(validation.error);
      setStatus('error');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setStatus('compressing');
    const compressed = await compressCoverImage(file);
    if (!compressed.ok) {
      setError(compressed.error);
      setStatus('error');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(compressed.blob);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setPreviewInfo({ width: compressed.width, height: compressed.height, bytes: compressed.blob.size });

    setStatus('uploading');
    try {
      // `upload` (prop já amarrada pelo chamador a `uploadContentImage` +
      // slug certo, ver `MarkdownToolbarProps['imageUpload']`) é quem
      // decide como converter pra base64 e montar o nome/mimeType do PUT --
      // este componente só entrega o `Blob` já comprimido, embrulhado em
      // `File` pra bater com a assinatura esperada.
      const result = await upload(new File([compressed.blob], 'imagem-conteudo.jpg', { type: compressed.mimeType }));
      setUploadedPath(result.path);
      setStatus('done');
    } catch (err) {
      setError(describeError(err));
      setStatus('error');
    }
  }

  function handleConfirm() {
    if (!canSubmit || !uploadedPath) return;
    onConfirm({ path: uploadedPath, alt: alt.trim() });
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog dialog--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="image-dialog-title" className="dialog__title">
          Inserir imagem
        </h2>

        <div className="form-field">
          <span>Arquivo</span>
          <div className="cover-upload__controls">
            <button
              ref={selectButtonRef}
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <UploadIcon /> {uploadedPath ? 'Trocar imagem' : 'Selecionar imagem'}
            </button>

            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="content-image-input"
              onChange={(e) => void handleFileSelected(e.target.files?.[0])}
            />

            {busy && (
              <span className="cover-upload__status" role="status" aria-live="polite">
                <span className="spinner spinner--sm" aria-hidden="true" />
                {status === 'compressing' ? 'Comprimindo…' : 'Enviando…'}
              </span>
            )}
          </div>

          {error && (
            <span className="field-error" role="alert">
              {error}
            </span>
          )}

          {previewUrl && (
            <figure className="cover-upload__preview">
              <img src={previewUrl} alt="Pré-visualização da imagem comprimida" />
              {previewInfo && (
                <figcaption className="field-hint">
                  {previewInfo.width}×{previewInfo.height}px, {formatBytes(previewInfo.bytes)}
                </figcaption>
              )}
            </figure>
          )}
        </div>

        <div className="form-field">
          <label>
            <span>Texto alternativo (alt)</span>
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Descreva a imagem pra quem usa leitor de tela"
              disabled={!uploadedPath}
            />
          </label>
          {!uploadedPath && <span className="field-hint">Envie uma imagem pra liberar este campo.</span>}
        </div>

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" onClick={handleConfirm} disabled={!canSubmit}>
            Inserir
          </button>
        </div>
      </div>
    </div>
  );
}
