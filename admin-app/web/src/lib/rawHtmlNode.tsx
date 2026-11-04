import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { useRef, useState } from 'react';
import { HtmlBlockDialog } from '../components/HtmlBlockDialog';

/** Primeiros N caracteres mostrados na prévia (`<pre>`) dentro do editor --
 *  só pra identificar QUAL bloco é qual quando há mais de um no corpo, nunca
 *  o HTML inteiro (ver `RawHtmlBlockView`). */
const PREVIEW_CHARS = 150;

/**
 * `markdown.parse.setup`/`serialize` do node `rawHtmlBlock`, tipados via
 * `MarkdownNodeSpec` (exportado por `tiptap-markdown`, que por sua vez
 * importa os tipos de `markdown-it`/`prosemirror-markdown` -- cobre
 * `md.renderer.rules.html_block`/`html_inline` e `md.utils.escapeHtml`
 * sem precisar de `any` em nenhum parâmetro).
 *
 * Doc -> markdown (`serialize`): escreve `node.attrs.html` LITERAL como
 * bloco próprio -- diferente do `markdownHTMLNode` embutido do
 * `tiptap-markdown` (que re-renderiza o node pelo schema via
 * `getHTMLFromFragment`, perdendo a formatação original), aqui o texto que
 * sai é byte a byte o que o usuário colou no `HtmlBlockDialog`. Ver
 * `code-block.js` do `tiptap-markdown` como referência do mesmo padrão
 * (node que serializa texto bruto).
 *
 * Markdown -> doc (`parse.setup`): só roda quando
 * `Markdown.configure({ html: true })` liga as regras
 * `html_block`/`html_inline` do markdown-it (ver comentário grande em
 * `markdownEditorExtensions.ts`). Sobrescreve as duas pra NUNCA deixar
 * HTML cru virar DOM real durante o parse:
 *
 * - `html_block` (ex.: um `<iframe>` isolado, com linha em branco
 *   antes/depois -- o caso real de uso, "colar um bloco de HTML") vira um
 *   `<div data-raw-html="...">` vazio, que o `parseHTML` do node decodifica
 *   de volta pro `rawHtmlBlock`.
 * - `html_inline` (HTML cru em MEIO a um parágrafo, sem node dedicado
 *   nesta entrega) vira TEXTO VISÍVEL escapado -- mesmo resultado prático
 *   que `html: false` já dava pra esse caso (nunca existiu perda de
 *   conteúdo pra HTML inline, só nunca foi tratado como HTML de verdade;
 *   continua assim, mas agora de forma explícita em vez de depender da
 *   opção global).
 *
 * `encodeURIComponent`/`decodeURIComponent` (não escaping de entidade
 * HTML) evita qualquer ambiguidade no round-trip do atributo.
 */
const rawHtmlMarkdownSpec: MarkdownNodeSpec = {
  serialize(state, node) {
    state.write((node.attrs.html as string) ?? '');
    state.closeBlock(node);
  },
  parse: {
    setup(md) {
      md.renderer.rules.html_block = (tokens, idx) => {
        // `tokens[idx].content` sempre vem com UMA quebra de linha
        // sobrando no final (markdown-it usa `getLines(..., true)`, que
        // inclui o terminador de linha de TODA linha capturada, inclusive
        // a última) -- removemos exatamente uma, simétrico ao padrão que o
        // próprio `tiptap-markdown` já usa pra
        // `fence`/`code_block`/`hardbreak`/`softbreak`
        // (`MarkdownParser.js`, `withPatchedRenderer`).
        const raw = tokens[idx].content.replace(/\n$/, '');
        return `<div data-raw-html="${encodeURIComponent(raw)}"></div>`;
      };
      md.renderer.rules.html_inline = (tokens, idx) => md.utils.escapeHtml(tokens[idx].content);
    },
  },
};

/**
 * Node TipTap dedicado pra um bloco de HTML cru colado pelo usuário (embed
 * de mapa, iframe, widget...) -- ver comentário grande no topo de
 * `markdownEditorExtensions.ts` pro raciocínio completo de por que isso
 * existe como node PRÓPRIO (não o `markdownHTMLNode` que `tiptap-markdown`
 * já embute) e como o parse de um bloco já salvo é blindado contra HTML de
 * verdade chegar ao DOM do editor.
 *
 * `atom: true` -- sem conteúdo editável dentro (o HTML em si só é editável
 * via `HtmlBlockDialog`, nunca digitando direto no contenteditable).
 */
export const RawHtmlBlock = Node.create({
  name: 'rawHtmlBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      html: { default: '' },
    };
  },

  // Espelha o atributo `data-raw-html` que o override de
  // `md.renderer.rules.html_block` (ver `addStorage` abaixo) emite ao
  // carregar um post/página que já tem este bloco salvo -- `decodeURIComponent`
  // devolve o HTML ORIGINAL exato (ver `encodeURIComponent` no parse).
  parseHTML() {
    return [
      {
        tag: 'div[data-raw-html]',
        getAttrs: (dom) => ({
          html: decodeURIComponent((dom as HTMLElement).getAttribute('data-raw-html') ?? ''),
        }),
      },
    ];
  },

  // Simétrico ao `parseHTML` acima -- não é o caminho usado pra
  // salvar/carregar de verdade (isso é o `addStorage().markdown` abaixo),
  // só o `toDOM` padrão do schema ProseMirror (ex.: serialização de
  // clipboard ao copiar o node). NUNCA renderiza o HTML de verdade --
  // mesma regra do `NodeView` (ver `RawHtmlBlockView`).
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-raw-html': encodeURIComponent(node.attrs.html ?? '') })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RawHtmlBlockView);
  },

  addStorage() {
    return {
      markdown: rawHtmlMarkdownSpec,
    };
  },
});

function RawHtmlBlockView({ node, updateAttributes }: NodeViewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const html: string = node.attrs.html ?? '';
  const preview = html.length > PREVIEW_CHARS ? `${html.slice(0, PREVIEW_CHARS)}…` : html;

  return (
    <NodeViewWrapper className="raw-html-block" data-drag-handle>
      <div className="raw-html-block__header">
        <span className="raw-html-block__label">Bloco de HTML embutido</span>
        <button ref={editButtonRef} type="button" className="btn btn--ghost btn--sm" onClick={() => setDialogOpen(true)}>
          Editar
        </button>
      </div>
      {/* NUNCA `dangerouslySetInnerHTML` aqui -- sempre texto plano, mesmo
          que o HTML guardado contenha um `<script>`/`<iframe>` malicioso ou
          quebrado. Ver comentário no topo deste arquivo. */}
      <pre className="raw-html-block__preview">{preview || '(vazio)'}</pre>

      <HtmlBlockDialog
        open={dialogOpen}
        initialHtml={html}
        returnFocusRef={editButtonRef}
        title="Editar HTML"
        confirmLabel="Salvar"
        onConfirm={(value) => {
          updateAttributes({ html: value });
          setDialogOpen(false);
        }}
        onCancel={() => setDialogOpen(false)}
      />
    </NodeViewWrapper>
  );
}
