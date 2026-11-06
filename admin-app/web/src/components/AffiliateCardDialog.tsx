import { useEffect, useRef, useState, type RefObject } from 'react';
import { describeError } from '../lib/errorMessage';
import { compressCoverImage, formatBytes, validateImageFile } from '../lib/imageUpload';
import {
  BADGE_ICON_OPTIONS,
  BUTTON_COLOR_OPTIONS,
  type AffiliateCardBadgeIcon,
  type AffiliateCardButtonColor,
  type AffiliateCardFormValue,
  type AffiliateCardLayout,
} from '../lib/affiliateCardShared';
import { AffiliateCardPreview } from './AffiliateCardPreview';
import { UploadIcon } from './icons';

export type { AffiliateCardFormValue };

export interface AffiliateCardDialogProps {
  open: boolean;
  /** Valores pré-preenchidos ao abrir -- `DEFAULT_AFFILIATE_CARD_VALUE`
   *  (card.lib/affiliateCardShared.ts) no fluxo de INSERIR, os `attrs` do
   *  node existente no fluxo de EDITAR (botão "Editar" do
   *  `AffiliateCardView`, ver `lib/affiliateCardNode.tsx`). Só é lido
   *  quando `open` passa a `true` -- mesmo padrão do `LinkDialog`/
   *  `DestaqueDialog`/`HtmlBlockDialog` (extinto). */
  initialValue: AffiliateCardFormValue;
  /** Ref do botão-gatilho pra onde o foco volta ao fechar -- mesmo motivo
   *  do `ImageDialog`/`DestaqueDialog`: o chamador pode ser um botão que
   *  desmonta no mesmo clique que abre este diálogo. */
  returnFocusRef: RefObject<HTMLElement | null>;
  /**
   * Já amarrado ao slug certo pelo chamador (ver
   * `MarkdownToolbarProps['imageUpload']`) -- mesmo mecanismo de upload do
   * `ImageDialog` (valida magic bytes -> comprime -> sobe), reaproveitado
   * aqui como mais um campo do formulário em vez de um diálogo aninhado
   * (nenhum precedente de diálogo-dentro-de-diálogo neste admin).
   *
   * OPCIONAL: `undefined` no fluxo de EDITAR um card já inserido (botão
   * "Editar" do `AffiliateCardView`, ver `lib/affiliateCardNode.tsx`) --
   * o `NodeView` não tem acesso à função `upload` (ela só existe no
   * componente pai que monta `useEditor()`/`MarkdownToolbar`, ver
   * `PostFormPage.tsx`/`PageFormPage.tsx`, sem canal pra chegar até um
   * NodeView montado dentro do schema). Sem `upload`, o campo de imagem
   * mostra a imagem ATUAL como somente leitura (sem "Trocar imagem") --
   * ainda é possível editar todos os outros campos (texto/link/cor/dica/
   * layout) normalmente. Trocar a foto de um card já publicado exige
   * remover o bloco e inserir um novo (mesma limitação que imagens de
   * corpo comuns já têm hoje -- nenhum node de imagem deste editor permite
   * re-upload in-place).
   */
  upload?: (file: File) => Promise<{ path: string }>;
  /** "Inserir card de afiliado" (default) ou "Editar card de afiliado". */
  title?: string;
  /** "Inserir" (default) ou "Salvar". */
  confirmLabel?: string;
  onConfirm: (value: AffiliateCardFormValue) => void;
  onCancel: () => void;
}

type UploadStatus = 'idle' | 'compressing' | 'uploading' | 'done' | 'error';

/**
 * Modal "Inserir/Editar card de afiliado" -- mesmo padrão a11y dos outros
 * diálogos de formulário deste admin (backdrop, `role="dialog"`, Esc fecha,
 * clique no backdrop fecha, foco inicial no primeiro campo, foco volta pro
 * gatilho ao fechar). Maior que os demais (muitos campos) -- usa o
 * modificador `.dialog--wide` (ver `styles/index.css`) só pra respiro
 * horizontal extra, mesma base visual do `.dialog.dialog--form`.
 *
 * Campos (ver handoff do Genilson, 2026-11-06): layout (vertical/horizontal,
 * com prévia ao vivo via `AffiliateCardPreview`), imagem (upload inline,
 * mesmo mecanismo do `ImageDialog`), ícone do selo (6 opções fechadas),
 * texto do selo, título, botão 1 (texto/link/cor -- CTA primário/afiliado,
 * `rel="sponsored"` é aplicado no SITE publicado via `AffiliateButton.astro`,
 * não aqui), botão 2 (texto/link, sem cor -- estilo secundário fixo), dica
 * (rótulo fixo "Dica:", só o texto é editável).
 */
export function AffiliateCardDialog({
  open,
  initialValue,
  returnFocusRef,
  upload,
  title = 'Inserir card de afiliado',
  confirmLabel = 'Inserir',
  onConfirm,
  onCancel,
}: AffiliateCardDialogProps) {
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectImageButtonRef = useRef<HTMLButtonElement>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  const [layout, setLayout] = useState<AffiliateCardLayout>('vertical');
  const [imageAlt, setImageAlt] = useState('');
  const [badgeIcon, setBadgeIcon] = useState<AffiliateCardBadgeIcon>('estrela');
  const [badgeText, setBadgeText] = useState('');
  const [cardTitle, setCardTitle] = useState('');
  const [button1Text, setButton1Text] = useState('');
  const [button1Url, setButton1Url] = useState('');
  const [button1Color, setButton1Color] = useState<AffiliateCardButtonColor>('green');
  const [button2Text, setButton2Text] = useState('');
  const [button2Url, setButton2Url] = useState('');
  const [tip, setTip] = useState('');

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [objectPreviewUrl, setObjectPreviewUrl] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<{ width: number; height: number; bytes: number } | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);

  const imageBusy = uploadStatus === 'compressing' || uploadStatus === 'uploading';

  function resetFromInitialValue(value: AffiliateCardFormValue) {
    setLayout(value.layout);
    setImageAlt(value.imageAlt);
    setBadgeIcon(value.badgeIcon);
    setBadgeText(value.badgeText);
    setCardTitle(value.title);
    setButton1Text(value.button1Text);
    setButton1Url(value.button1Url);
    setButton1Color(value.button1Color);
    setButton2Text(value.button2Text);
    setButton2Url(value.button2Url);
    setTip(value.tip);

    setUploadError(null);
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    setObjectPreviewUrl(null);
    setPreviewInfo(null);
    // Fluxo de EDITAR: a imagem já foi enviada numa sessão anterior -- marca
    // como "done" direto (sem recomprimir/reenviar nada), mesmo path que já
    // estava salvo. Fluxo de INSERIR (`value.image === ''`): volta pro
    // estado "idle", aguardando seleção de arquivo.
    setUploadedPath(value.image || null);
    setUploadStatus(value.image ? 'done' : 'idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      resetFromInitialValue(initialValue);
      firstFieldRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      returnFocusRef.current?.focus();
    }
    // Só reage à abertura/fechamento (`open`) -- `initialValue` é lido uma
    // vez no momento em que o modal abre, mesmo cuidado dos outros diálogos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
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
    if (!file || !upload) return;
    setUploadError(null);
    setUploadedPath(null);

    const validation = await validateImageFile(file);
    if (!validation.ok) {
      setUploadError(validation.error);
      setUploadStatus('error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploadStatus('compressing');
    const compressed = await compressCoverImage(file);
    if (!compressed.ok) {
      setUploadError(compressed.error);
      setUploadStatus('error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
    const url = URL.createObjectURL(compressed.blob);
    previewObjectUrlRef.current = url;
    setObjectPreviewUrl(url);
    setPreviewInfo({ width: compressed.width, height: compressed.height, bytes: compressed.blob.size });

    setUploadStatus('uploading');
    try {
      const result = await upload(new File([compressed.blob], 'imagem-card-afiliado.jpg', { type: compressed.mimeType }));
      setUploadedPath(result.path);
      setUploadStatus('done');
    } catch (err) {
      setUploadError(describeError(err));
      setUploadStatus('error');
    }
  }

  const canSubmit =
    uploadStatus === 'done' &&
    uploadedPath !== null &&
    imageAlt.trim() !== '' &&
    badgeText.trim() !== '' &&
    cardTitle.trim() !== '' &&
    button1Text.trim() !== '' &&
    button1Url.trim() !== '';

  function handleConfirm() {
    if (!canSubmit || !uploadedPath) return;
    onConfirm({
      layout,
      image: uploadedPath,
      imageAlt: imageAlt.trim(),
      badgeIcon,
      badgeText: badgeText.trim(),
      title: cardTitle.trim(),
      button1Text: button1Text.trim(),
      button1Url: button1Url.trim(),
      button1Color,
      button2Text: button2Text.trim(),
      button2Url: button2Url.trim(),
      tip: tip.trim(),
    });
  }

  const previewValue: AffiliateCardFormValue = {
    layout,
    image: uploadedPath ?? '',
    imageAlt,
    badgeIcon,
    badgeText,
    title: cardTitle,
    button1Text,
    button1Url,
    button1Color,
    button2Text,
    button2Url,
    tip,
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog dialog--form dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="affiliate-card-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="affiliate-card-dialog-title" className="dialog__title">
          {title}
        </h2>

        <div className="affiliate-card-dialog__preview" aria-hidden="true">
          <AffiliateCardPreview value={previewValue} imageSrc={objectPreviewUrl ?? undefined} />
        </div>

        <fieldset className="form-field radio-group-field">
          <legend>Layout</legend>
          <div className="layout-toggle">
            <label className="layout-toggle__option">
              <input
                ref={firstFieldRef}
                type="radio"
                name="affiliate-card-layout"
                value="vertical"
                checked={layout === 'vertical'}
                onChange={() => setLayout('vertical')}
              />
              Vertical (imagem em cima)
            </label>
            <label className="layout-toggle__option">
              <input
                type="radio"
                name="affiliate-card-layout"
                value="horizontal"
                checked={layout === 'horizontal'}
                onChange={() => setLayout('horizontal')}
              />
              Horizontal (imagem do lado)
            </label>
          </div>
        </fieldset>

        <div className="form-field">
          <span>Imagem</span>
          {upload ? (
            <div className="cover-upload__controls">
              <button
                ref={selectImageButtonRef}
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={imageBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon /> {uploadedPath ? 'Trocar imagem' : 'Selecionar imagem'}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="affiliate-card-image-input"
                onChange={(e) => void handleFileSelected(e.target.files?.[0])}
              />

              {imageBusy && (
                <span className="cover-upload__status" role="status" aria-live="polite">
                  <span className="spinner spinner--sm" aria-hidden="true" />
                  {uploadStatus === 'compressing' ? 'Comprimindo…' : 'Enviando…'}
                </span>
              )}
            </div>
          ) : (
            <span className="field-hint">
              Imagem já definida -- pra trocar a foto, remova este bloco e insira um novo card.
            </span>
          )}

          {uploadError && (
            <span className="field-error" role="alert">
              {uploadError}
            </span>
          )}

          {previewInfo && (
            <span className="field-hint">
              {previewInfo.width}×{previewInfo.height}px, {formatBytes(previewInfo.bytes)}
            </span>
          )}
        </div>

        <label className="form-field">
          <span>Texto alternativo da imagem (alt)</span>
          <input
            type="text"
            value={imageAlt}
            onChange={(e) => setImageAlt(e.target.value)}
            placeholder="Descreva a imagem pra quem usa leitor de tela"
            disabled={!uploadedPath}
          />
        </label>

        <fieldset className="form-field radio-group-field">
          <legend>Ícone do selo</legend>
          <div className="badge-icon-grid">
            {BADGE_ICON_OPTIONS.map((option) => (
              <label key={option.value} className="badge-icon-grid__option">
                <input
                  type="radio"
                  name="affiliate-card-badge-icon"
                  value={option.value}
                  checked={badgeIcon === option.value}
                  onChange={() => setBadgeIcon(option.value)}
                />
                <span aria-hidden="true">{option.icon}</span> {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="form-field">
          <span>Texto do selo</span>
          <input
            type="text"
            value={badgeText}
            onChange={(e) => setBadgeText(e.target.value)}
            placeholder="Ex: Conforto & Charme"
            maxLength={40}
          />
          <span className="field-hint">
            Texto curto, tipo selo -- ex: "SEGURANÇA MÁXIMA". Pra recomendação mais longa, use o campo Dica (abaixo).
          </span>
        </label>

        <label className="form-field">
          <span>Título</span>
          <input
            type="text"
            value={cardTitle}
            onChange={(e) => setCardTitle(e.target.value)}
            placeholder="Ex: La Mansarda Hotel"
          />
        </label>

        <div className="form-field">
          <span>Botão 1 (principal, link de afiliado)</span>
        </div>
        <label className="form-field">
          <span>Texto do botão 1</span>
          <input
            type="text"
            value={button1Text}
            onChange={(e) => setButton1Text(e.target.value)}
            placeholder="Ex: 🏨 Reservar Agora"
          />
        </label>
        <label className="form-field">
          <span>Link do botão 1</span>
          <input
            type="text"
            value={button1Url}
            onChange={(e) => setButton1Url(e.target.value)}
            placeholder="https://..."
          />
        </label>
        <fieldset className="form-field radio-group-field">
          <legend>Cor do botão 1</legend>
          <div className="color-swatch-group">
            {BUTTON_COLOR_OPTIONS.map((option) => (
              <label key={option.value} className="color-swatch-group__option">
                <input
                  type="radio"
                  name="affiliate-card-button1-color"
                  value={option.value}
                  checked={button1Color === option.value}
                  onChange={() => setButton1Color(option.value)}
                />
                <span
                  className="color-swatch-group__swatch"
                  style={{ background: option.hex }}
                  aria-hidden="true"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-field">
          <span>Botão 2 (secundário, opcional)</span>
          <span className="field-hint">
            Não use link de afiliado aqui -- só o Botão 1 (acima) sai com rel=sponsored.
          </span>
        </div>
        <label className="form-field">
          <span>Texto do botão 2</span>
          <input
            type="text"
            value={button2Text}
            onChange={(e) => setButton2Text(e.target.value)}
            placeholder="Ex: 📍 Ver Localização"
          />
        </label>
        <label className="form-field">
          <span>Link do botão 2</span>
          <input type="text" value={button2Url} onChange={(e) => setButton2Url(e.target.value)} placeholder="https://..." />
        </label>

        <label className="form-field">
          <span>Dica: (opcional)</span>
          <textarea value={tip} onChange={(e) => setTip(e.target.value)} rows={2} />
        </label>

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" onClick={handleConfirm} disabled={!canSubmit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
