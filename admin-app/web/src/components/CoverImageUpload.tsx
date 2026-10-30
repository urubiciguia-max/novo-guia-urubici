import { useEffect, useRef, useState } from 'react';
import { usePosts } from '../data/PostsContext';
import { describeError } from '../lib/errorMessage';
import { blobToBase64, compressCoverImage, formatBytes, validateImageFile } from '../lib/imageUpload';
import { UploadIcon } from './icons';

type UploadStatus = 'idle' | 'compressing' | 'uploading' | 'error';

export interface CoverImageUploadProps {
  /** Nome do arquivo final é `<legacySlug>-capa.jpg` -- sem slug ainda não dá pra decidir o nome, upload fica desabilitado. */
  legacySlug: string;
  /** Valor atual de `form.cover` -- só pra mostrar o path já salvo, nunca editável aqui. */
  currentPath: string;
  onUploaded: (path: string) => void;
}

/**
 * Substitui o antigo input de texto de `cover` (TRACK B da spec, ver
 * `.agents/inbox/genilson.md`). Fluxo: seleciona arquivo -> valida magic
 * bytes real (`validateImageFile`) -> comprime no canvas
 * (`compressCoverImage`) -> preview do resultado comprimido -> converte pra
 * base64 -> chama `uploadCoverImage()` (contrato do Jurandir em
 * `GitHubPostsClient`) -> preenche `cover` automaticamente com o path
 * devolvido. Nenhuma etapa deixa o usuário editar o caminho na mão.
 */
export function CoverImageUpload({ legacySlug, currentPath, onUploaded }: CoverImageUploadProps) {
  const { uploadCoverImage } = usePosts();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [status, setStatus] = useState<UploadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<{ width: number; height: number; bytes: number } | null>(null);

  const slugReady = legacySlug.trim() !== '';
  const busy = status === 'compressing' || status === 'uploading';

  // Revoga a object URL da preview ao desmontar -- evita vazar memória se o
  // usuário sair da tela no meio do fluxo.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function setPreview(blob: Blob | null, info: { width: number; height: number } | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (!blob || !info) {
      setPreviewUrl(null);
      setPreviewInfo(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setPreviewInfo({ width: info.width, height: info.height, bytes: blob.size });
  }

  async function handleFileSelected(file: File | undefined) {
    if (!file) return;
    setError(null);

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

    setPreview(compressed.blob, { width: compressed.width, height: compressed.height });

    setStatus('uploading');
    try {
      const base64Content = await blobToBase64(compressed.blob);
      const result = await uploadCoverImage(legacySlug, {
        name: `${legacySlug}-capa.jpg`,
        mimeType: compressed.mimeType,
        base64Content,
      });
      onUploaded(result.path);
      setStatus('idle');
    } catch (err) {
      setError(describeError(err));
      setStatus('error');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="cover-upload">
      <div className="cover-upload__controls">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!slugReady || busy}
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon /> {currentPath ? 'Trocar imagem' : 'Enviar imagem'}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="cover-upload-input"
          onChange={(e) => void handleFileSelected(e.target.files?.[0])}
        />

        {busy && (
          <span className="cover-upload__status" role="status" aria-live="polite">
            <span className="spinner spinner--sm" aria-hidden="true" />
            {status === 'compressing' ? 'Comprimindo…' : 'Enviando…'}
          </span>
        )}
      </div>

      {!slugReady && (
        <span className="field-hint">Preencha o slug legado antes de enviar a imagem de capa.</span>
      )}

      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}

      {previewUrl && (
        <figure className="cover-upload__preview">
          <img src={previewUrl} alt="Pré-visualização da imagem de capa comprimida" />
          {previewInfo && (
            <figcaption className="field-hint">
              {previewInfo.width}×{previewInfo.height}px, {formatBytes(previewInfo.bytes)}
            </figcaption>
          )}
        </figure>
      )}

      {currentPath && (
        <span className="field-hint">
          Caminho salvo: <code>{currentPath}</code>
        </span>
      )}
    </div>
  );
}
