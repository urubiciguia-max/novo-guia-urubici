import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { useRef, useState } from 'react';
import {
  DEFAULT_AFFILIATE_CARD_VALUE,
  parseAffiliateCard,
  serializeAffiliateCard,
  type AffiliateCardFormValue,
} from './affiliateCardShared';
import { AffiliateCardDialog } from '../components/AffiliateCardDialog';
import { AffiliateCardPreview } from '../components/AffiliateCardPreview';

/**
 * `markdown.parse.setup`/`serialize` do node `affiliateCard`, no MESMO
 * padrão arquitetural do extinto `rawHtmlBlock` (ver histórico do arquivo
 * removido, `lib/rawHtmlNode.tsx` -- node TipTap dedicado via `Node.create()`
 * com `addNodeView()` -> `ReactNodeViewRenderer` pra preview ao vivo dentro
 * do editor, e `addStorage()` com `serialize`/`parse.setup` pro round-trip
 * markdown<->doc, testado byte a byte em `test/AffiliateCardNode.test.tsx`).
 *
 * Diferença de design em relação ao `rawHtmlBlock`: a sintaxe markdown aqui
 * é um bloco de código CERCADO com info string própria
 * (```` ```affiliate-card ````, corpo em JSON) em vez de HTML cru -- ver
 * `lib/affiliateCardShared.ts` pro raciocínio completo de por que essa
 * escolha (CommonMark padrão, parseado idêntico por `markdown-it` aqui E
 * por `micromark`/remark no build do Astro, sem precisar de `html: true`).
 *
 * Doc -> markdown (`serialize`): monta `JSON.stringify(_, null, 2)` via
 * `serializeAffiliateCard` e escreve como corpo de um fence
 * ```affiliate-card. `state.text(json, false)` -- o `false` desliga o
 * escape de markdown (asteriscos/underscores/etc dentro do JSON, ex. numa
 * URL ou num texto de dica, NÃO podem ser escapados, isso corromperia o
 * JSON) -- mesmo parâmetro que o serializer nativo de `code_block` do
 * `prosemirror-markdown` usa (`state.text(node.textContent, false)`).
 *
 * Markdown -> doc (`parse.setup`): sobrescreve `md.renderer.rules.fence`
 * (análogo ao `html_block`/`html_inline` que o `rawHtmlBlock` sobrescrevia)
 * -- só intercepta quando `info` bate com `affiliate-card`; qualquer OUTRO
 * fence (``` js, ``` sem linguagem, etc -- o `CodeBlock` comum do
 * `StarterKit`) passa direto pro renderer padrão, capturado em
 * `defaultFenceRenderer` ANTES da sobrescrita. Vira um
 * `<div data-affiliate-card="...">` vazio, que o `parseHTML` do node
 * decodifica de volta.
 */
const affiliateCardMarkdownSpec: MarkdownNodeSpec = {
  serialize(state, node) {
    const json = serializeAffiliateCard(node.attrs as AffiliateCardFormValue);
    state.write('```affiliate-card\n');
    state.text(json, false);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock(node);
  },
  parse: {
    setup(md) {
      const defaultFenceRenderer = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const info = (token.info || '').trim();
        if (info === 'affiliate-card') {
          // Mesmo cuidado de `\n` sobrando do `rawHtmlBlock` extinto --
          // `token.content` de um fence sempre vem com uma quebra de linha
          // extra no final (ver `markdown-it/lib/rules_block/fence.mjs`,
          // `state.getLines()`).
          const raw = token.content.replace(/\n$/, '');
          return `<div data-affiliate-card="${encodeURIComponent(raw)}"></div>`;
        }
        return defaultFenceRenderer
          ? defaultFenceRenderer(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
      };
    },
  },
};

/**
 * Node TipTap pro bloco "Card de Afiliado" -- card com imagem + selo + título
 * + até 2 botões de CTA + dica, nos layouts vertical/horizontal (ver
 * `AffiliateCardPreview` pro visual, fiel aos prints do handoff).
 *
 * `atom: true` -- sem conteúdo editável dentro do contenteditable (todos os
 * campos só são editáveis via `AffiliateCardDialog`, aberto pelo botão
 * "Editar" da própria prévia), mesmo padrão do extinto `rawHtmlBlock`.
 */
export const AffiliateCard = Node.create({
  name: 'affiliateCard',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      layout: { default: DEFAULT_AFFILIATE_CARD_VALUE.layout },
      image: { default: DEFAULT_AFFILIATE_CARD_VALUE.image },
      imageAlt: { default: DEFAULT_AFFILIATE_CARD_VALUE.imageAlt },
      badgeIcon: { default: DEFAULT_AFFILIATE_CARD_VALUE.badgeIcon },
      badgeText: { default: DEFAULT_AFFILIATE_CARD_VALUE.badgeText },
      title: { default: DEFAULT_AFFILIATE_CARD_VALUE.title },
      button1Text: { default: DEFAULT_AFFILIATE_CARD_VALUE.button1Text },
      button1Url: { default: DEFAULT_AFFILIATE_CARD_VALUE.button1Url },
      button1Color: { default: DEFAULT_AFFILIATE_CARD_VALUE.button1Color },
      button2Text: { default: DEFAULT_AFFILIATE_CARD_VALUE.button2Text },
      button2Url: { default: DEFAULT_AFFILIATE_CARD_VALUE.button2Url },
      tip: { default: DEFAULT_AFFILIATE_CARD_VALUE.tip },
    };
  },

  // Espelha o atributo `data-affiliate-card` que o override de
  // `md.renderer.rules.fence` (ver `affiliateCardMarkdownSpec` acima) emite
  // ao carregar um post/página que já tem este bloco salvo --
  // `decodeURIComponent` + `parseAffiliateCard` (parse defensivo, nunca
  // lança, ver `lib/affiliateCardShared.ts`) devolvem os atributos de volta.
  parseHTML() {
    return [
      {
        tag: 'div[data-affiliate-card]',
        getAttrs: (dom) => {
          const raw = decodeURIComponent((dom as HTMLElement).getAttribute('data-affiliate-card') ?? '');
          return parseAffiliateCard(raw);
        },
      },
    ];
  },

  // Simétrico ao `parseHTML` acima -- não é o caminho usado pra
  // salvar/carregar de verdade (isso é o `addStorage().markdown` abaixo),
  // só o `toDOM` padrão do schema ProseMirror (ex.: serialização de
  // clipboard ao copiar o node).
  renderHTML({ node, HTMLAttributes }) {
    const json = serializeAffiliateCard(node.attrs as AffiliateCardFormValue);
    return ['div', mergeAttributes(HTMLAttributes, { 'data-affiliate-card': encodeURIComponent(json) })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AffiliateCardView);
  },

  addStorage() {
    return {
      markdown: affiliateCardMarkdownSpec,
    };
  },
});

function AffiliateCardView({ node, updateAttributes }: NodeViewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const value = node.attrs as AffiliateCardFormValue;

  return (
    <NodeViewWrapper className="affiliate-card-nodeview" data-drag-handle>
      <div className="affiliate-card-nodeview__header">
        <span className="affiliate-card-nodeview__label">Card de Afiliado</span>
        <button ref={editButtonRef} type="button" className="btn btn--ghost btn--sm" onClick={() => setDialogOpen(true)}>
          Editar
        </button>
      </div>

      <AffiliateCardPreview value={value} />

      {/* Sem `upload` -- o NodeView não tem acesso à função de upload do
          post/página (só existe no componente pai, ver comentário grande em
          `AffiliateCardDialog`'s prop `upload`). Editar aqui cobre todos os
          campos exceto trocar a foto. */}
      <AffiliateCardDialog
        open={dialogOpen}
        initialValue={value}
        returnFocusRef={editButtonRef}
        title="Editar card de afiliado"
        confirmLabel="Salvar"
        onConfirm={(next) => {
          updateAttributes(next);
          setDialogOpen(false);
        }}
        onCancel={() => setDialogOpen(false)}
      />
    </NodeViewWrapper>
  );
}
