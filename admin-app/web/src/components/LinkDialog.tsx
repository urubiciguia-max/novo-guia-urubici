import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface LinkDialogProps {
  open: boolean;
  /** Texto pré-preenchido no campo "Texto" ao abrir -- a seleção do
   *  textarea no momento em que o botão Link foi clicado (vazio se não
   *  havia seleção). Só é lido quando `open` passa a `true`. */
  initialText: string;
  onConfirm: (text: string, url: string) => void;
  onCancel: () => void;
}

/**
 * Modal "Inserir link" da `MarkdownToolbar`. Reaproveita o padrão
 * visual/estrutural do `ConfirmDialog` (mesmas classes `.dialog-backdrop`/
 * `.dialog`/`.dialog__title`/`.dialog__actions`, mesmo padrão de Esc fecha +
 * clique no backdrop fecha + foco volta pro elemento que abriu o diálogo),
 * mas é um dialog de FORMULÁRIO, não de confirmação destrutiva:
 *  - `role="dialog"` (não `alertdialog` -- não há ação destrutiva aqui).
 *  - Foco inicial vai pro campo URL (não pro botão Cancelar -- não existe
 *    "ação segura por padrão" pra proteger quando não há nada destrutivo).
 *  - Tem campos de formulário (URL, Texto) em vez de só descrição + botões.
 */
export function LinkDialog({ open, initialText, onConfirm, onCancel }: LinkDialogProps) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
      setUrl('');
      setText(initialText);
      urlInputRef.current?.focus();
    } else if (triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus();
    }
    // Só reage à abertura/fechamento (`open`) -- `initialText` é lido uma
    // vez no momento em que o modal abre, não deve re-sincronizar enquanto
    // o usuário já está editando o campo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const canSubmit = url.trim() !== '' && text.trim() !== '';

  function handleConfirm() {
    if (!canSubmit) return;
    onConfirm(text, url);
  }

  // Enter num dos campos confirma o link -- e, crucialmente, NUNCA deve
  // deixar o evento virar submit do `<form>` do post (a toolbar/modal
  // vivem dentro dele): `preventDefault` corta isso na origem.
  function handleEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleConfirm();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog dialog--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="link-dialog-title" className="dialog__title">
          Inserir link
        </h2>

        <label className="form-field">
          <span>URL</span>
          <input
            ref={urlInputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleEnter}
            placeholder="https://exemplo.com"
          />
        </label>

        <label className="form-field">
          <span>Texto</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleEnter} />
        </label>

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
