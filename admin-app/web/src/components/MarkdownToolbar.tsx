import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  applyHeading,
  applyLinePrefix,
  insertDestaqueMarkdown,
  insertLinkMarkdown,
  wrapInline,
  type DestaqueType,
  type SelectionResult,
} from '../lib/markdownToolbarActions';
import { DestaqueDialog } from './DestaqueDialog';
import { LinkDialog } from './LinkDialog';
import {
  BoldIcon,
  BulletListIcon,
  CalloutIcon,
  ChevronDownIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  ParagraphStyleIcon,
  PlusIcon,
  QuoteIcon,
} from './icons';

export interface MarkdownToolbarProps {
  /** Ref do `<textarea>` que a toolbar edita -- precisa ler `selectionStart`/
   *  `selectionEnd` ao vivo no momento do clique (por isso ref, não só o valor). */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  /** Devolve o resultado da transformação (texto novo + onde a seleção deve
   *  ficar) pro componente pai aplicar -- quem possui `form.body` e o
   *  reposicionamento de foco/cursor é o `PostFormPage`, não esta toolbar. */
  onApply: (result: SelectionResult) => void;
}

type Transform = (text: string, start: number, end: number) => SelectionResult;

interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

/**
 * Toolbar de formatação markdown acima do campo "Conteúdo do artigo" --
 * estilo editor do GitHub: insere sintaxe markdown na posição do cursor do
 * textarea (não é WYSIWYG contenteditable). Fica visível só no modo Editar
 * (`PostFormPage` não renderiza isto quando `previewMode` é true).
 */
export function MarkdownToolbar({ textareaRef, value, onApply }: MarkdownToolbarProps) {
  function runTransform(transform: Transform) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onApply(transform(value, start, end));
  }

  // Botão Link não insere direto -- abre o modal `LinkDialog` e só insere
  // no confirm. `linkSelectionRef` guarda a posição do cursor/seleção no
  // momento do CLIQUE (igual `runTransform` lê hoje), porque a inserção de
  // verdade só acontece depois, quando o usuário confirma o modal -- nesse
  // meio tempo a seleção ao vivo do textarea não é mais confiável (o campo
  // perde o foco pro modal).
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkInitialText, setLinkInitialText] = useState('');
  const linkSelectionRef = useRef({ start: 0, end: 0 });

  function openLinkDialog() {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    linkSelectionRef.current = { start, end };
    setLinkInitialText(value.slice(start, end));
    setLinkDialogOpen(true);
  }

  function handleLinkConfirm(label: string, url: string) {
    const { start, end } = linkSelectionRef.current;
    onApply(insertLinkMarkdown(value, start, end, label, url));
    setLinkDialogOpen(false);
  }

  // Item "Destaque (caixa colorida)" do dropdown Inserir -- mesmo padrão do
  // botão Link: não insere direto, abre o `DestaqueDialog` e só insere no
  // confirm. `insertTriggerRef` é o botão-gatilho do dropdown "Inserir" (não
  // o item "Destaque" em si, que desmonta junto com o menu no clique que
  // abre o modal) -- é pra ele que o foco volta quando o modal fecha.
  const [destaqueDialogOpen, setDestaqueDialogOpen] = useState(false);
  const [destaqueInitialText, setDestaqueInitialText] = useState('');
  const destaqueSelectionRef = useRef({ start: 0, end: 0 });
  const insertTriggerRef = useRef<HTMLButtonElement>(null);

  function openDestaqueDialog() {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    destaqueSelectionRef.current = { start, end };
    setDestaqueInitialText(value.slice(start, end));
    setDestaqueDialogOpen(true);
  }

  function handleDestaqueConfirm(type: DestaqueType, text: string) {
    const { start, end } = destaqueSelectionRef.current;
    onApply(insertDestaqueMarkdown(value, start, end, type, text));
    setDestaqueDialogOpen(false);
  }

  return (
    <>
      <div className="md-toolbar" role="toolbar" aria-label="Formatação do texto">
        <button
          type="button"
          className="md-toolbar__btn"
          aria-label="Negrito"
          onClick={() => runTransform((t, s, e) => wrapInline(t, s, e, '**'))}
        >
          <BoldIcon />
        </button>
        <button
          type="button"
          className="md-toolbar__btn"
          aria-label="Itálico"
          onClick={() => runTransform((t, s, e) => wrapInline(t, s, e, '*'))}
        >
          <ItalicIcon />
        </button>
        <button
          type="button"
          className="md-toolbar__btn"
          aria-label="Código inline"
          onClick={() => runTransform((t, s, e) => wrapInline(t, s, e, '`'))}
        >
          <InlineCodeIcon />
        </button>
        <button type="button" className="md-toolbar__btn" aria-label="Link" onClick={openLinkDialog}>
          <LinkIcon />
        </button>

        <span className="md-toolbar__separator" aria-hidden="true" />

        <ToolbarDropdown
          triggerLabel="Parágrafo"
          triggerIcon={<ParagraphStyleIcon />}
          ariaLabel="Estilo de parágrafo"
          items={[
            { label: 'Parágrafo', onSelect: () => runTransform((t, s) => applyHeading(t, s, 0)) },
            { label: 'Título H2', onSelect: () => runTransform((t, s) => applyHeading(t, s, 2)) },
            { label: 'Título H3', onSelect: () => runTransform((t, s) => applyHeading(t, s, 3)) },
            { label: 'Título H4', onSelect: () => runTransform((t, s) => applyHeading(t, s, 4)) },
          ]}
        />

        <ToolbarDropdown
          triggerRef={insertTriggerRef}
          triggerLabel="Inserir"
          triggerIcon={<PlusIcon />}
          ariaLabel="Inserir elemento"
          items={[
            {
              label: 'Lista com marcadores',
              icon: <BulletListIcon />,
              onSelect: () => runTransform((t, s, e) => applyLinePrefix(t, s, e, 'bullet')),
            },
            {
              label: 'Lista numerada',
              icon: <NumberedListIcon />,
              onSelect: () => runTransform((t, s, e) => applyLinePrefix(t, s, e, 'numbered')),
            },
            {
              label: 'Citação',
              icon: <QuoteIcon />,
              onSelect: () => runTransform((t, s, e) => applyLinePrefix(t, s, e, 'quote')),
            },
            {
              label: 'Destaque (caixa colorida)',
              icon: <CalloutIcon />,
              onSelect: openDestaqueDialog,
            },
          ]}
        />
      </div>

      <LinkDialog
        open={linkDialogOpen}
        initialText={linkInitialText}
        onConfirm={handleLinkConfirm}
        onCancel={() => setLinkDialogOpen(false)}
      />

      <DestaqueDialog
        open={destaqueDialogOpen}
        initialText={destaqueInitialText}
        returnFocusRef={insertTriggerRef}
        onConfirm={handleDestaqueConfirm}
        onCancel={() => setDestaqueDialogOpen(false)}
      />
    </>
  );
}

interface ToolbarDropdownProps {
  triggerLabel: string;
  /** Ícone mostrado sempre no gatilho -- em telas estreitas o texto do
   *  label some (ver `.md-toolbar__btn-label` em index.css) e só ícone +
   *  chevron ficam visíveis, então o gatilho precisa de um ícone próprio
   *  (diferente dos ícones dos itens do menu, que só aparecem abertos). */
  triggerIcon: ReactNode;
  ariaLabel: string;
  items: DropdownItem[];
  /** Ref opcional do botão-gatilho, exposto pro componente pai conseguir
   *  devolver o foco a ele depois que um modal aberto por um ITEM deste
   *  dropdown (ex: `DestaqueDialog`, aberto pelo item "Destaque") fechar --
   *  o próprio item que abriu o modal desmonta junto com o menu no mesmo
   *  clique, então não dá pra confiar em `document.activeElement` capturado
   *  nesse momento (ver `DestaqueDialog`). Sem isso, usa um ref interno. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Dropdown simples (disclosure pattern -- botão que revela um grupo de
 * botões comuns, não um `role="menu"` com navegação por seta). Escolha
 * deliberada: o critério de a11y pedido é "navegável via Tab + Enter/Space"
 * (ver handoff), que botões nativos já satisfazem sozinhos -- implementar
 * `role="menu"`/`menuitem` de verdade exigiria roving tabindex + setas pra
 * não violar WAI-ARIA Authoring Practices, o que é mais do que foi pedido.
 */
function ToolbarDropdown({
  triggerLabel,
  triggerIcon,
  ariaLabel,
  items,
  triggerRef: externalTriggerRef,
}: ToolbarDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = externalTriggerRef ?? internalTriggerRef;

  useEffect(() => {
    if (!open) return;

    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="md-toolbar__dropdown" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="md-toolbar__btn md-toolbar__btn--dropdown"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {triggerIcon}
        <span className="md-toolbar__btn-label">{triggerLabel}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="md-toolbar__menu" role="group" aria-label={ariaLabel}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="md-toolbar__menu-item"
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
