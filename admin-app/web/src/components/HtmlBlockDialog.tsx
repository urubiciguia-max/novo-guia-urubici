import { useEffect, useRef, useState, type RefObject } from 'react';

export interface HtmlBlockDialogProps {
  open: boolean;
  /** HTML pré-preenchido no textarea ao abrir -- vazio no fluxo de INSERIR
   *  (item "Inserir HTML" do dropdown), o `node.attrs.html` atual no fluxo
   *  de EDITAR (botão "Editar" da prévia do bloco, ver `lib/rawHtmlNode.tsx`).
   *  Só é lido quando `open` passa a `true` -- mesmo padrão do
   *  `LinkDialog`/`DestaqueDialog`. */
  initialHtml: string;
  /**
   * Ref do botão-gatilho pra onde o foco volta ao fechar (confirmar ou
   * cancelar) -- sempre explícito (nunca `document.activeElement`
   * capturado), porque este diálogo tem DOIS chamadores com fiação
   * diferente: o item "Inserir HTML" do dropdown "Inserir" da
   * `MarkdownToolbar` (que desmonta no mesmo clique que abre o diálogo --
   * mesmo motivo documentado em `DestaqueDialog`) e o botão "Editar" de
   * cada `RawHtmlBlockView` (que NUNCA desmonta, mas é um botão DIFERENTE
   * por bloco de HTML no documento).
   */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** "Inserir HTML" (default, item do dropdown) ou "Editar HTML" (botão
   *  "Editar" de um bloco existente). */
  title?: string;
  /** "Inserir" (default) ou "Salvar" (editar um bloco existente). */
  confirmLabel?: string;
  onConfirm: (html: string) => void;
  onCancel: () => void;
}

/**
 * Modal "Inserir/Editar HTML" -- mesmo padrão visual/estrutural do
 * `LinkDialog`/`DestaqueDialog` (backdrop, `role="dialog"`, Esc fecha,
 * clique no backdrop fecha, foco inicial no campo principal, foco volta
 * pro gatilho ao fechar), com um `<textarea>` em vez de input de texto --
 * o usuário cola um bloco de HTML cru (embed de mapa, iframe, widget...)
 * que vira um node `rawHtmlBlock` dedicado (ver `lib/rawHtmlNode.tsx` pro
 * raciocínio completo de segurança: a prévia do bloco NUNCA renderiza esse
 * HTML de verdade, só mostra como texto).
 */
export function HtmlBlockDialog({
  open,
  initialHtml,
  returnFocusRef,
  title = 'Inserir HTML',
  confirmLabel = 'Inserir',
  onConfirm,
  onCancel,
}: HtmlBlockDialogProps) {
  const [html, setHtml] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Mesmo cuidado do `DestaqueDialog`: `returnFocusRef` vem de FORA já
  // apontando pra um botão real desde antes deste componente montar, então
  // só autoriza a devolução de foco na transição real `true -> false`.
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      setHtml(initialHtml);
      textareaRef.current?.focus();
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      returnFocusRef.current?.focus();
    }
    // Só reage à abertura/fechamento (`open`) -- `initialHtml` é lido uma
    // vez no momento em que o modal abre, não deve re-sincronizar enquanto
    // o usuário já está editando o campo (mesmo cuidado do `LinkDialog`).
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

  const canSubmit = html.trim() !== '';

  function handleConfirm() {
    if (!canSubmit) return;
    onConfirm(html);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog dialog--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="html-block-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="html-block-dialog-title" className="dialog__title">
          {title}
        </h2>

        <p className="dialog__description">
          Cole o HTML cru (embed de mapa, iframe, widget...). Aparece aqui no editor só como texto -- o site
          publicado é que de fato renderiza.
        </p>

        <label className="form-field">
          <span>HTML</span>
          <textarea
            ref={textareaRef}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={8}
            spellCheck={false}
            className="html-block-dialog__textarea"
          />
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
