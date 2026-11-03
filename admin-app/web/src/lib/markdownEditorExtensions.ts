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
 * - `html: false` -- fecha o schema (sem nó de HTML cru); nenhum conteúdo
 *   real do projeto depende de HTML embutido no corpo, e um schema aberto
 *   pra isso é superfície de risco que não precisamos aqui.
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
import { Markdown } from 'tiptap-markdown';
import type { AnyExtension } from '@tiptap/core';

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
    Markdown.configure({
      html: false,
      linkify: false,
      breaks: false,
      tightLists: true,
      bulletListMarker: '-',
    }),
  ];
}
