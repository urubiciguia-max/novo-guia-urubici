/**
 * Configuração central do editor rich-text (TipTap) usado no corpo de
 * Artigos/Páginas -- `PostFormPage.tsx` e `PageFormPage.tsx` chamam
 * `createMarkdownEditorExtensions()` pra montar o `useEditor()`, e
 * `MarkdownToolbar.tsx` reusa as mesmas constantes (ex: níveis de heading)
 * pra não divergir do que o editor de fato aceita.
 *
 * Decisão de arquitetura (ver spec completa em `.agents/inbox/genilson.md`):
 * `tiptap-markdown` (markdown-it por baixo) faz a conversão markdown<->doc
 * nos dois sentidos -- continuamos salvando markdown puro no GitHub
 * (`PostsClient`/`PagesClient`, intocados), só a CAMADA DE EDIÇÃO virou
 * rich-text. Testado manualmente contra os 5 posts reais + as 4 páginas
 * institucionais antes de escrever este arquivo: corpo dos 5 posts
 * round-tripa BYTE A BYTE (ver `test/markdownRoundtrip.test.ts`); as páginas
 * têm 2 diffs cosméticos conhecidos, documentados lá.
 *
 * Opções do `Markdown` escolhidas (e por quê):
 * - `html: true` -- EXCEÇÃO deliberada, contida (ver `lib/rawHtmlNode.tsx`
 *   pro design completo). Até a entrega "Inserir HTML no corpo"
 *   (`.agents/inbox/francisgleydisson.md`, 2026-11-04), isto era
 *   `html: false` DE PROPÓSITO -- schema fechado, zero nó de HTML cru,
 *   porque ligar `html:true` ingenuamente tem dois riscos: (1) qualquer
 *   HTML que o `markdown-it` reconheça via `html_block`/`html_inline` mas
 *   que NENHUM node do schema aceite via `parseDOM` (ex.: `<iframe>`, `<div
 *   class="x">`) seria DESCARTADO SILENCIOSAMENTE ao carregar um post
 *   existente -- perda de conteúdo; (2) o node `markdownHTMLNode` que o
 *   `tiptap-markdown` já embute serializa via `getHTMLFromFragment`
 *   (re-renderiza pelo schema), não devolve o texto original literal --
 *   não preserva o HTML byte a byte.
 *
 *   A exceção é CONTIDA inteiramente dentro do node `rawHtmlBlock`
 *   (`lib/rawHtmlNode.tsx`): o `addStorage().markdown.parse.setup(md)`
 *   dele SOBRESCREVE `md.renderer.rules.html_block`/`html_inline` pra
 *   NUNCA deixar HTML cru virar DOM real -- `html_block` (o caso real de
 *   uso: um bloco isolado, "colar um embed de mapa/iframe/widget") vira um
 *   `<div data-raw-html="...">` vazio que só o `rawHtmlBlock` sabe
 *   decodificar; `html_inline` (HTML cru em meio a um parágrafo, sem node
 *   dedicado) vira TEXTO VISÍVEL escapado -- mesmo resultado prático que
 *   `html:false` já dava, sem nenhum caminho novo de risco. Com essa
 *   sobrescrita em vigor, `html:true` fica seguro pro resto do schema: a
 *   opção `html` do markdown-it só ativa/desativa as regras
 *   `html_block`/`html_inline`, nenhuma outra (heading/lista/link/
 *   imagem/código) depende dela. Confirmado na prática: os 5 posts + 4
 *   páginas reais (nenhum tem HTML cru) continuam round-tripando
 *   idêntico (ver `test/markdownRoundtrip.test.ts`).
 * - `linkify: false` -- não autolinka URL solta digitada/colada; nenhum
 *   conteúdo real tem URL crua no corpo (afiliados ficam no frontmatter, não
 *   no corpo), e autolink mudaria conteúdo existente sem o usuário pedir.
 * - `breaks: false` -- igual ao CommonMark padrão que o site publicado
 *   (Astro/remark) já usa: quebra de linha simples dentro de um parágrafo
 *   NÃO vira `<br>`. Sem isso o round-trip de parágrafos "soft-wrapped"
 *   (múltiplas linhas físicas, sem linha em branco) ficaria inconsistente
 *   com a renderização real do site.
 * - `bulletListMarker: '-'` + `tightLists: true` -- bate com o estilo que os
 *   5 posts reais já usam (`- item`, sem linha em branco entre itens).
 *
 * Heading travado em [2, 3, 4] -- SEM H1: `src/pages/[...slug].astro` já
 * renderiza `<h1>{post.data.title}</h1>` a partir do frontmatter, H1 no
 * corpo duplicaria hierarquia (mesma regra desde o handoff da toolbar v1).
 * Testado: um `# ` solto que porventura exista num markdown carregado não
 * quebra o editor -- vira parágrafo normal (texto preservado, só perde a
 * semântica de heading), nunca gera erro nem perda de conteúdo.
 */
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import type { AnyExtension } from '@tiptap/core';
import { RawHtmlBlock } from './rawHtmlNode';

export const HEADING_LEVELS = [2, 3, 4] as const;
export type AllowedHeadingLevel = (typeof HEADING_LEVELS)[number];

export function createMarkdownEditorExtensions(placeholder: string): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [...HEADING_LEVELS] },
      // `@tiptap/starter-kit` v3 já embute `Link` (não precisa de pacote
      // separado) -- só configuramos: dentro do editor um clique num link
      // deve posicionar o cursor, não navegar pra fora do admin
      // (`openOnClick: false`), e não autolinkar texto digitado/colado
      // (`autolink: false` -- nenhum conteúdo real tem URL crua no corpo,
      // ver nota de `linkify` abaixo).
      link: {
        openOnClick: false,
        autolink: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: null },
      },
      // Underline e Strike também vêm por padrão no StarterKit v3, mas
      // nenhum dos dois está no escopo pedido (nem tem botão na toolbar) --
      // desligados de propósito em vez de deixar um atalho de teclado
      // "fantasma" (ex: Ctrl+U) sem afinidade visual nenhuma. Underline em
      // particular NEM TEM sintaxe markdown padrão -- se ficasse ligado,
      // qualquer sublinhado aplicado seria perdido silenciosamente ao salvar
      // (`tiptap-markdown` não tem serializer pra essa marca).
      underline: false,
      strike: false,
    }),
    Placeholder.configure({ placeholder }),
    // Imagem inserida no CORPO (toolbar, "Inserir imagem") -- sempre bloco
    // próprio, nunca dentro de um parágrafo (`inline: false`, bate com o
    // uso real dos posts: a imagem de capa já é um campo separado, uma
    // imagem de corpo nunca aparece "no meio de uma frase"). `tiptap-markdown`
    // já tem suporte nativo de markdown pro node `image` POR NOME
    // (`node_modules/tiptap-markdown/src/extensions/nodes/image.js`) --
    // serialize/parse funcionam sozinhos, não precisa de nenhum `addStorage`
    // próprio aqui.
    Image.configure({ inline: false }),
    // Bloco de HTML cru colado pelo usuário ("Inserir HTML") -- ver
    // comentário grande acima (opção `html: true` do `Markdown.configure`
    // abaixo) e o arquivo do node pro design completo de segurança.
    RawHtmlBlock,
    Markdown.configure({
      html: true,
      linkify: false,
      breaks: false,
      tightLists: true,
      bulletListMarker: '-',
    }),
  ];
}
