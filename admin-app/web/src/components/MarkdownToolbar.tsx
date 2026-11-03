import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  applyHeading,
  applyLinePrefix,
  insertDestaqueMarkdown,
  insertLinkMarkdown,
  wrapInline,
  type DestaqueType,
  type HeadingLevel,
  type SelectionResult,
} from '../lib/markdownToolbarActions';
import { computeSelectionMenuPosition, type FloatingMenuPosition } from '../lib/textareaCaretPosition';
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

  // Menu flutuante de seleção (estilo Medium/Notion): aparece acima de um
  // trecho selecionado no textarea com botões H2/H3/H4 + Link, pra não
  // obrigar o usuário a ir até o dropdown "Parágrafo" lá no topo da toolbar
  // fixa toda vez que quiser transformar uma linha em título (pedido do
  // handoff). O dropdown "Parágrafo" continua existindo -- ver comentário
  // dele mais abaixo -- como fallback 100% por teclado/Tab, já que o menu
  // flutuante em si é posicionado com `position: fixed` fora da ordem normal
  // do DOM (não dá pra alcançar por Tab a partir do textarea).
  //
  // `floatingPos`: null = escondido. Não-null = coordenadas calculadas pela
  // última seleção não vazia detectada.
  // `floatingDismissed`: true depois de Esc/clique fora -- a seleção pode
  // continuar a mesma, mas o usuário pediu pra fechar; só reabre se a seleção
  // mudar de novo OU se o atalho Alt+Enter for usado (ver efeito de teclado).
  const [floatingPos, setFloatingPos] = useState<FloatingMenuPosition | null>(null);
  const [floatingDismissed, setFloatingDismissed] = useState(false);
  const floatingMenuRef = useRef<HTMLDivElement>(null);
  const floatingFirstBtnRef = useRef<HTMLButtonElement>(null);

  const floatingMenuVisible = floatingPos !== null && !floatingDismissed;

  // Alt+Enter precisa focar o primeiro botão do menu DEPOIS que ele existir
  // no DOM -- `setState` não aplica sincronamente, então chamar `.focus()`
  // na mesma função que chama `setFloatingDismissed(false)` focaria um ref
  // ainda nulo (o menu só remonta no próximo commit). Esta flag registra a
  // intenção e o efeito abaixo foca assim que `floatingMenuVisible` virar
  // true por causa dela -- seleção feita via mouse/teclado normal NUNCA seta
  // essa flag, então nunca rouba o foco do textarea à toa.
  const focusMenuOnShowRef = useRef(false);

  useEffect(() => {
    if (floatingMenuVisible && focusMenuOnShowRef.current) {
      focusMenuOnShowRef.current = false;
      floatingFirstBtnRef.current?.focus();
    }
  }, [floatingMenuVisible]);

  // Detecção de seleção: igual ao pedido do handoff, via `mouseup`/`keyup`
  // no textarea (não `onSelect` do React -- a toolbar não é quem renderiza o
  // `<textarea>`, só recebe a ref dele via prop, então precisa de listener
  // nativo). Recalcula a posição toda vez que a seleção deixa de estar vazia
  // e também reabre o menu se o usuário tinha fechado (ex: voltou a apertar
  // Shift depois de um Esc) -- ver nota no `floatingDismissed` acima.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function syncFromSelection(skipKeys?: Set<string>, key?: string) {
      if (key && skipKeys?.has(key)) return;
      const start = el!.selectionStart ?? 0;
      const end = el!.selectionEnd ?? 0;
      if (start === end) {
        setFloatingPos(null);
        return;
      }
      setFloatingPos(computeSelectionMenuPosition(el!, start, end));
      setFloatingDismissed(false);
    }

    // Escape é tratado só pelo listener de teclado global (fecha o menu) --
    // sem este filtro, o `keyup` do PRÓPRIO Escape (disparado pelo navegador
    // ao soltar a tecla, depois do `keydown` já ter fechado) reabriria o menu
    // imediatamente, já que a seleção em si não muda com Esc.
    const SKIP_ON_KEYUP = new Set(['Escape']);

    function onMouseUp() {
      syncFromSelection();
    }
    function onKeyUp(e: KeyboardEvent) {
      syncFromSelection(SKIP_ON_KEYUP, e.key);
    }
    function onScroll() {
      const start = el!.selectionStart ?? 0;
      const end = el!.selectionEnd ?? 0;
      if (start === end) return;
      setFloatingPos(computeSelectionMenuPosition(el!, start, end));
    }

    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('scroll', onScroll);
    return () => {
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('scroll', onScroll);
    };
  }, [textareaRef]);

  // Fecha ao clicar fora (textarea e o próprio menu contam como "dentro"),
  // ao perder a seleção não se aplica aqui -- já é coberto pelo efeito acima.
  useEffect(() => {
    if (!floatingMenuVisible) return;

    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      const insideMenu = floatingMenuRef.current?.contains(target);
      const insideTextarea = textareaRef.current?.contains(target);
      if (!insideMenu && !insideTextarea) {
        setFloatingDismissed(true);
      }
    }

    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [floatingMenuVisible, textareaRef]);

  // Atalho de teclado pedido no handoff: com uma seleção não vazia ativa,
  // Alt+Enter leva o foco pro primeiro botão do menu flutuante (abre/reabre
  // mesmo se tinha sido fechado com Esc) -- cobre o caso "Shift+setas pra
  // selecionar, depois um atalho pra abrir o menu" sem depender de ordem de
  // Tab (o menu é `position: fixed`, fora do fluxo normal do DOM). Esc, com
  // foco no textarea OU dentro do próprio menu, fecha e devolve o foco pro
  // textarea (que preserva a seleção/cursor internos mesmo sem estar
  // focado -- mesma garantia que `LinkDialog`/`DestaqueDialog` já assumem).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = textareaRef.current;
      if (!el) return;
      const active = document.activeElement;
      const focusInTextarea = active === el;
      const focusInMenu = !!floatingMenuRef.current?.contains(active);
      if (!focusInTextarea && !focusInMenu) return;

      if (e.key === 'Enter' && e.altKey) {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        if (start === end) return;
        e.preventDefault();
        focusMenuOnShowRef.current = true;
        setFloatingPos(computeSelectionMenuPosition(el, start, end));
        setFloatingDismissed(false);
      } else if (e.key === 'Escape' && floatingMenuVisible) {
        e.preventDefault();
        setFloatingDismissed(true);
        el.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [textareaRef, floatingMenuVisible]);

  function applyFloatingHeading(level: HeadingLevel) {
    runTransform((t, s) => applyHeading(t, s, level));
    setFloatingPos(null);
  }

  function openLinkDialogFromFloatingMenu() {
    setFloatingPos(null);
    openLinkDialog();
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

      {floatingMenuVisible && floatingPos && (
        <div
          ref={floatingMenuRef}
          className="md-selection-menu"
          role="group"
          aria-label="Formatação rápida da seleção"
          style={{ top: floatingPos.top, left: floatingPos.left }}
        >
          <button
            ref={floatingFirstBtnRef}
            type="button"
            className="md-toolbar__btn md-selection-menu__btn md-selection-menu__btn--h2"
            aria-label="Título H2"
            onClick={() => applyFloatingHeading(2)}
          >
            H2
          </button>
          <button
            type="button"
            className="md-toolbar__btn md-selection-menu__btn md-selection-menu__btn--h3"
            aria-label="Título H3"
            onClick={() => applyFloatingHeading(3)}
          >
            H3
          </button>
          <button
            type="button"
            className="md-toolbar__btn md-selection-menu__btn md-selection-menu__btn--h4"
            aria-label="Título H4"
            onClick={() => applyFloatingHeading(4)}
          >
            H4
          </button>
          <span className="md-toolbar__separator" aria-hidden="true" />
          <button
            type="button"
            className="md-toolbar__btn md-selection-menu__btn"
            aria-label="Link"
            onClick={openLinkDialogFromFloatingMenu}
          >
            <LinkIcon />
          </button>
        </div>
      )}

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
