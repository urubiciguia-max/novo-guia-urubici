import { useEffect, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { buildDestaqueMarkdown, resolveLinkHref, type DestaqueType } from '../lib/markdownToolbarActions';
import { HEADING_LEVELS, type AllowedHeadingLevel } from '../lib/markdownEditorExtensions';
import { computeSelectionMenuPosition, type FloatingMenuPosition } from '../lib/selectionMenuPosition';
import { DestaqueDialog } from './DestaqueDialog';
import { LinkDialog } from './LinkDialog';
import { ImageDialog } from './ImageDialog';
import { HtmlBlockDialog } from './HtmlBlockDialog';
import {
  BoldIcon,
  BulletListIcon,
  CalloutIcon,
  ChevronDownIcon,
  CodeBlockIcon,
  ImageIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  ParagraphStyleIcon,
  PlusIcon,
  QuoteIcon,
} from './icons';

export interface MarkdownToolbarImageUpload {
  /** `false` enquanto não há slug válido ainda pra decidir o nome do
   *  arquivo (post NOVO sem slug salvo) -- ver `PostFormPage.tsx`
   *  (`CoverImageUpload` usa o mesmo gate). `PageFormPage.tsx` passa sempre
   *  `true` (página é só edição, nunca criação, sempre tem slug). */
  ready: boolean;
  /** Já amarrado ao slug certo pelo chamador (`createContentImageUploader`,
   *  ver `lib/contentImageUpload.ts`) -- faz validação de magic bytes +
   *  compressão + upload (`uploadContentImage` de `usePosts()`/`usePages()`)
   *  e devolve o `path` pronto pra inserir no corpo. */
  upload: (file: File) => Promise<{ path: string }>;
}

export interface MarkdownToolbarProps {
  /** Instância do editor TipTap (`PostFormPage`/`PageFormPage` criam via
   *  `useEditor`) -- `null` só no instante inicial antes do editor montar
   *  (ver `immediatelyRender`/ciclo de vida do `useEditor`), a toolbar
   *  renderiza os botões desabilitados nesse meio tempo. */
  editor: Editor | null;
  /** Opcional -- item "Inserir imagem" do dropdown "Inserir" fica
   *  desabilitado (`ready: false`) sem esta prop, nunca quebra. Ver
   *  `MarkdownToolbarImageUpload`. */
  imageUpload?: MarkdownToolbarImageUpload | null;
}

interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** `title` (tooltip nativo) mostrado quando `disabled` -- explica o
   *  motivo em vez de só desabilitar sem contexto. */
  disabledReason?: string;
}

/**
 * Toolbar de formatação acima do corpo do artigo/página -- estilo
 * WordPress/Notion: os botões chamam comandos nativos do editor rich-text
 * (`editor.chain().focus().toggleBold().run()` etc), que atualizam o
 * documento ao vivo (sem alternância Editar/Preview, ver spec "Editor
 * WYSIWYG"). Substitui a v1 (29/10-02/11), que manipulava string num
 * `<textarea>` cru via `lib/markdownToolbarActions.ts` -- a camada VISUAL
 * (ícones, posição dos botões, menu flutuante, atalho Alt+Enter) sobrevive
 * quase 1:1, só a implementação por trás de cada botão mudou.
 */
export function MarkdownToolbar({ editor, imageUpload }: MarkdownToolbarProps) {
  // `useEditor` (nos componentes pai) não força re-render deste componente a
  // cada transação por padrão -- sem isso, `editor.isActive(...)` (estado
  // dos botões toggle) e a detecção de seleção pro menu flutuante ficariam
  // desatualizados enquanto o usuário digita/navega. A toolbar cuida da
  // própria reatividade, não depende de configuração do pai.
  const [, forceTick] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const onTransaction = () => forceTick();
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  function run(fn: (editor: Editor) => void) {
    if (!editor) return;
    fn(editor);
  }

  function isActive(name: string, attrs?: Record<string, unknown>): boolean {
    return editor?.isActive(name, attrs) ?? false;
  }

  // Botão Link não insere direto -- abre o modal `LinkDialog` e só aplica a
  // marca no confirm. `linkRangeRef` guarda a posição [from, to] do
  // documento no momento do CLIQUE, porque a aplicação de verdade só
  // acontece depois, quando o usuário confirma o modal -- nesse meio tempo o
  // editor perde o foco pro modal (a seleção ao vivo não é mais confiável).
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkInitialText, setLinkInitialText] = useState('');
  const linkRangeRef = useRef({ from: 0, to: 0 });

  function openLinkDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    linkRangeRef.current = { from, to };
    setLinkInitialText(editor.state.doc.textBetween(from, to));
    setLinkDialogOpen(true);
  }

  function handleLinkConfirm(label: string, url: string) {
    if (!editor) return;
    const { from, to } = linkRangeRef.current;
    const href = resolveLinkHref(url) ?? url;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from, to },
        { type: 'text', text: label || url, marks: [{ type: 'link', attrs: { href } }] },
      )
      .run();
    setLinkDialogOpen(false);
  }

  // Item "Destaque (caixa colorida)" do dropdown Inserir -- fora do escopo
  // de formatação AO VIVO nesta entrega (SHOULD, não MUST -- ver spec do
  // editor WYSIWYG). Continuamos montando a sintaxe `> [!TIPO]` como
  // markdown puro (`buildDestaqueMarkdown`) e inserindo via o MESMO parser
  // que carrega o conteúdo inicial do editor (`editor.storage.markdown.
  // parser`) -- aparece como citação simples no editor (sem cor/ícone), mas
  // o markdown salvo é idêntico ao que `remark-destaque.mjs` reconhece no
  // site publicado. Mesmo padrão de captura de posição do Link:
  // `destaqueRangeRef` guarda [from, to] no momento em que o item foi
  // escolhido no dropdown.
  const [destaqueDialogOpen, setDestaqueDialogOpen] = useState(false);
  const [destaqueInitialText, setDestaqueInitialText] = useState('');
  const destaqueRangeRef = useRef({ from: 0, to: 0 });
  const insertTriggerRef = useRef<HTMLButtonElement>(null);

  function openDestaqueDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    destaqueRangeRef.current = { from, to };
    setDestaqueInitialText(editor.state.doc.textBetween(from, to));
    setDestaqueDialogOpen(true);
  }

  function handleDestaqueConfirm(type: DestaqueType, text: string) {
    if (!editor) return;
    const { from, to } = destaqueRangeRef.current;
    const markdown = buildDestaqueMarkdown(type, text);
    // Passa o MARKDOWN cru pro `insertContentAt`, não HTML pré-processado --
    // `tiptap-markdown` já troca o comando `insertContentAt` por uma versão
    // que chama `editor.storage.markdown.parser.parse(content, ...)`
    // INTERNAMENTE (ver `node_modules/tiptap-markdown/src/Markdown.js`,
    // `addCommands`). Chamar `.parser.parse()` aqui também faria o parse
    // acontecer DUAS vezes -- a segunda vez (dentro do comando) trataria o
    // HTML já pronto da primeira como TEXTO cru (com `html: false` no
    // `Markdown.configure`, ver `markdownEditorExtensions.ts`), escapando
    // as tags inteiras pra dentro de um parágrafo em vez de criar o
    // blockquote de verdade. Bug descoberto escrevendo o teste deste botão
    // (`test/MarkdownToolbar.test.tsx`, "Destaque (SHOULD, não MUST)").
    editor.chain().focus().insertContentAt({ from, to }, markdown).run();
    setDestaqueDialogOpen(false);
  }

  // Item "Inserir imagem" do dropdown Inserir -- abre o `ImageDialog`
  // (seleciona arquivo -> valida/comprime -> sobe via `imageUpload.upload`
  // -> pede alt obrigatório) e só insere o node `image` de verdade no
  // CONFIRM, na posição [from, to] capturada no momento do clique -- mesmo
  // padrão de captura de range do Link/Destaque (o editor perde o foco pro
  // modal nesse meio tempo). Passamos o OBJETO do node (não uma string
  // markdown) pro `insertContentAt`: `tiptap-markdown` só chama
  // `parser.parse()` quando o conteúdo é string (ver `Markdown.js`,
  // `addCommands`) -- um objeto passa direto pro comando nativo do
  // ProseMirror, sem risco do bug de parse duplicado que o comentário do
  // Destaque documenta acima.
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const imageRangeRef = useRef({ from: 0, to: 0 });

  function openImageDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    imageRangeRef.current = { from, to };
    setImageDialogOpen(true);
  }

  function handleImageConfirm({ path, alt }: { path: string; alt: string }) {
    if (!editor) return;
    const { from, to } = imageRangeRef.current;
    editor.chain().focus().insertContentAt({ from, to }, { type: 'image', attrs: { src: path, alt } }).run();
    setImageDialogOpen(false);
  }

  // Item "Inserir HTML" do dropdown Inserir -- mesma lógica de range do
  // Link/Destaque/Imagem acima, mas insere o node `rawHtmlBlock` (ver
  // `lib/rawHtmlNode.tsx` pro design completo de segurança). Também passa o
  // OBJETO do node direto, nunca o HTML como string markdown -- isso NÃO
  // deve passar pelo parser de markdown (que só entra em jogo pra
  // CARREGAR um post que já tem este bloco salvo, ver comentário grande em
  // `markdownEditorExtensions.ts`).
  const [htmlDialogOpen, setHtmlDialogOpen] = useState(false);
  const htmlRangeRef = useRef({ from: 0, to: 0 });

  function openHtmlDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    htmlRangeRef.current = { from, to };
    setHtmlDialogOpen(true);
  }

  function handleHtmlConfirm(html: string) {
    if (!editor) return;
    const { from, to } = htmlRangeRef.current;
    editor.chain().focus().insertContentAt({ from, to }, { type: 'rawHtmlBlock', attrs: { html } }).run();
    setHtmlDialogOpen(false);
  }

  // Menu flutuante de seleção (estilo Medium/Notion): aparece acima de um
  // trecho selecionado no editor com botões H2/H3/H4 + Link, pra não
  // obrigar o usuário a ir até o dropdown "Parágrafo" lá no topo da toolbar
  // fixa toda vez que quiser transformar uma linha em título. O dropdown
  // "Parágrafo" continua existindo como fallback 100% por teclado/Tab, já
  // que o menu flutuante em si é posicionado com `position: fixed` fora da
  // ordem normal do DOM (não dá pra alcançar por Tab a partir do editor).
  //
  // `floatingPos`: null = escondido. Não-null = coordenadas calculadas pela
  // última seleção não vazia detectada.
  // `floatingDismissed`: true depois de Esc/clique fora -- a seleção pode
  // continuar a mesma, mas o usuário pediu pra fechar; só reabre se a
  // seleção mudar de novo OU se o atalho Alt+Enter for usado.
  const [floatingPos, setFloatingPos] = useState<FloatingMenuPosition | null>(null);
  const [floatingDismissed, setFloatingDismissed] = useState(false);
  const floatingMenuRef = useRef<HTMLDivElement>(null);
  const floatingFirstBtnRef = useRef<HTMLButtonElement>(null);

  const floatingMenuVisible = floatingPos !== null && !floatingDismissed;

  // Alt+Enter precisa focar o primeiro botão do menu DEPOIS que ele existir
  // no DOM -- `setState` não aplica sincronamente, então chamar `.focus()`
  // na mesma função que chama `setFloatingDismissed(false)` focaria um ref
  // ainda nulo (ou, se o menu já estava visível antes do Alt+Enter --
  // seleção feita via mouse/teclado já deixa `floatingMenuVisible` em
  // `true` por conta própria --, focaria um botão que ainda não existia
  // nesse frame específico).
  //
  // Por isso o gatilho do efeito abaixo NÃO é `floatingMenuVisible`
  // (booleano que pode já valer `true` antes do Alt+Enter, caso em que a
  // transição `false -> true` nunca ocorre e o efeito não reexecuta --
  // bug encontrado pela Marivone em QA, 2026-11-03: Alt+Enter só focava
  // depois de um Esc prévio, porque só o Esc forçava `floatingMenuVisible`
  // a passar por `false` antes). Em vez disso, cada Alt+Enter incrementa
  // este contador -- `Object.is` nunca considera dois valores
  // consecutivos iguais, então o efeito SEMPRE reexecuta depois do
  // próximo commit (já com o menu no DOM, porque os dois `setState` abaixo
  // batched junto com este são aplicados no mesmo render), seja essa a
  // primeira seleção ou a enésima. `0` é o valor inicial/sentinel -- nunca
  // dispara foco no mount, só a partir do primeiro Alt+Enter de verdade.
  const [focusRequestId, setFocusRequestId] = useState(0);

  useEffect(() => {
    if (focusRequestId === 0) return;
    floatingFirstBtnRef.current?.focus();
  }, [focusRequestId]);

  // Detecção de seleção: diferente da era textarea (que precisava de
  // listener nativo de mouseup/keyup porque textarea não emite nenhum
  // evento de "seleção mudou"), o ProseMirror por baixo do editor já tem
  // esse conceito de fábrica -- `editor.on('selectionUpdate', ...)` dispara
  // toda vez que a seleção muda, por mouse, teclado ou programaticamente.
  useEffect(() => {
    if (!editor) return;

    function syncFromSelection() {
      const { from, to } = editor!.state.selection;
      if (from === to) {
        setFloatingPos(null);
        return;
      }
      setFloatingPos(computeSelectionMenuPosition(editor!.view, from, to));
      setFloatingDismissed(false);
    }

    editor.on('selectionUpdate', syncFromSelection);
    return () => {
      editor.off('selectionUpdate', syncFromSelection);
    };
  }, [editor]);

  // Reposiciona o menu flutuante ao rolar a página (a seleção em si não
  // muda, só as coordenadas de viewport) -- diferente da era textarea (onde
  // o PRÓPRIO textarea tinha scroll interno), agora é a página em volta do
  // editor que rola, então o listener fica na window, não no editor.
  useEffect(() => {
    if (!floatingMenuVisible || !editor) return;

    function onScroll() {
      const { from, to } = editor!.state.selection;
      if (from === to) return;
      setFloatingPos(computeSelectionMenuPosition(editor!.view, from, to));
    }

    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [floatingMenuVisible, editor]);

  // Fecha ao clicar fora (o editor e o próprio menu contam como "dentro").
  useEffect(() => {
    if (!floatingMenuVisible || !editor) return;

    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      const insideMenu = floatingMenuRef.current?.contains(target);
      const insideEditor = editor!.view.dom.contains(target);
      if (!insideMenu && !insideEditor) {
        setFloatingDismissed(true);
      }
    }

    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [floatingMenuVisible, editor]);

  // Atalho de teclado: com uma seleção não vazia ativa, Alt+Enter leva o
  // foco pro primeiro botão do menu flutuante (abre/reabre mesmo se tinha
  // sido fechado com Esc). Esc, com foco no editor OU dentro do próprio
  // menu, fecha e devolve o foco pro editor.
  useEffect(() => {
    if (!editor) return;

    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement;
      const focusInEditor = !!active && editor!.view.dom.contains(active);
      const focusInMenu = !!floatingMenuRef.current?.contains(active);
      if (!focusInEditor && !focusInMenu) return;

      const { from, to } = editor!.state.selection;

      if (e.key === 'Enter' && e.altKey) {
        if (from === to) return;
        e.preventDefault();
        setFocusRequestId((id) => id + 1);
        setFloatingPos(computeSelectionMenuPosition(editor!.view, from, to));
        setFloatingDismissed(false);
      } else if (e.key === 'Escape' && floatingMenuVisible) {
        e.preventDefault();
        setFloatingDismissed(true);
        editor!.commands.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editor, floatingMenuVisible]);

  function applyFloatingHeading(level: AllowedHeadingLevel) {
    run((e) => e.chain().focus().setHeading({ level }).run());
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
          aria-pressed={isActive('bold')}
          disabled={!editor}
          onClick={() => run((e) => e.chain().focus().toggleBold().run())}
        >
          <BoldIcon />
        </button>
        <button
          type="button"
          className="md-toolbar__btn"
          aria-label="Itálico"
          aria-pressed={isActive('italic')}
          disabled={!editor}
          onClick={() => run((e) => e.chain().focus().toggleItalic().run())}
        >
          <ItalicIcon />
        </button>
        <button
          type="button"
          className="md-toolbar__btn"
          aria-label="Código inline"
          aria-pressed={isActive('code')}
          disabled={!editor}
          onClick={() => run((e) => e.chain().focus().toggleCode().run())}
        >
          <InlineCodeIcon />
        </button>
        <button
          type="button"
          className="md-toolbar__btn"
          aria-label="Link"
          aria-pressed={isActive('link')}
          disabled={!editor}
          onClick={openLinkDialog}
        >
          <LinkIcon />
        </button>

        <span className="md-toolbar__separator" aria-hidden="true" />

        <ToolbarDropdown
          triggerLabel="Parágrafo"
          triggerIcon={<ParagraphStyleIcon />}
          ariaLabel="Estilo de parágrafo"
          disabled={!editor}
          items={[
            { label: 'Parágrafo', onSelect: () => run((e) => e.chain().focus().setParagraph().run()) },
            ...HEADING_LEVELS.map((level) => ({
              label: `Título H${level}`,
              onSelect: () => run((e) => e.chain().focus().setHeading({ level }).run()),
            })),
          ]}
        />

        <ToolbarDropdown
          triggerRef={insertTriggerRef}
          triggerLabel="Inserir"
          triggerIcon={<PlusIcon />}
          ariaLabel="Inserir elemento"
          disabled={!editor}
          items={[
            {
              label: 'Lista com marcadores',
              icon: <BulletListIcon />,
              onSelect: () => run((e) => e.chain().focus().toggleBulletList().run()),
            },
            {
              label: 'Lista numerada',
              icon: <NumberedListIcon />,
              onSelect: () => run((e) => e.chain().focus().toggleOrderedList().run()),
            },
            {
              label: 'Citação',
              icon: <QuoteIcon />,
              onSelect: () => run((e) => e.chain().focus().toggleBlockquote().run()),
            },
            {
              label: 'Destaque (caixa colorida)',
              icon: <CalloutIcon />,
              onSelect: openDestaqueDialog,
            },
            {
              label: 'Inserir imagem',
              icon: <ImageIcon />,
              onSelect: openImageDialog,
              disabled: !imageUpload?.ready,
              disabledReason: 'Preencha o slug antes de enviar uma imagem no corpo.',
            },
            {
              label: 'Inserir HTML',
              icon: <CodeBlockIcon />,
              onSelect: openHtmlDialog,
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
            aria-pressed={isActive('heading', { level: 2 })}
            onClick={() => applyFloatingHeading(2)}
          >
            H2
          </button>
          <button
            type="button"
            className="md-toolbar__btn md-selection-menu__btn md-selection-menu__btn--h3"
            aria-label="Título H3"
            aria-pressed={isActive('heading', { level: 3 })}
            onClick={() => applyFloatingHeading(3)}
          >
            H3
          </button>
          <button
            type="button"
            className="md-toolbar__btn md-selection-menu__btn md-selection-menu__btn--h4"
            aria-label="Título H4"
            aria-pressed={isActive('heading', { level: 4 })}
            onClick={() => applyFloatingHeading(4)}
          >
            H4
          </button>
          <span className="md-toolbar__separator" aria-hidden="true" />
          <button
            type="button"
            className="md-toolbar__btn md-selection-menu__btn"
            aria-label="Link"
            aria-pressed={isActive('link')}
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

      {imageUpload && (
        <ImageDialog
          open={imageDialogOpen}
          returnFocusRef={insertTriggerRef}
          upload={imageUpload.upload}
          onConfirm={handleImageConfirm}
          onCancel={() => setImageDialogOpen(false)}
        />
      )}

      <HtmlBlockDialog
        open={htmlDialogOpen}
        initialHtml=""
        returnFocusRef={insertTriggerRef}
        onConfirm={handleHtmlConfirm}
        onCancel={() => setHtmlDialogOpen(false)}
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
  disabled?: boolean;
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
 * deliberada: o critério de a11y pedido é "navegável via Tab + Enter/Space",
 * que botões nativos já satisfazem sozinhos -- implementar `role="menu"`/
 * `menuitem` de verdade exigiria roving tabindex + setas pra não violar
 * WAI-ARIA Authoring Practices, o que é mais do que foi pedido.
 */
function ToolbarDropdown({
  triggerLabel,
  triggerIcon,
  ariaLabel,
  items,
  disabled,
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
        disabled={disabled}
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
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
              onClick={() => {
                if (item.disabled) return;
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
