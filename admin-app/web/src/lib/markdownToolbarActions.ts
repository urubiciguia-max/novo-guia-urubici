/**
 * Helpers de markdown que sobrevivem à migração pro editor rich-text
 * (TipTap) -- ver `components/MarkdownToolbar.tsx` e
 * `lib/markdownEditorExtensions.ts`.
 *
 * Até a v1 do WYSIWYG (ver `.agents/inbox/genilson.md`, spec "Editor WYSIWYG
 * no corpo do artigo/página"), este arquivo tinha um conjunto grande de
 * transformações puras de STRING + offset de cursor (`wrapInline`,
 * `applyHeading`, `applyLinePrefix`, `insertLinkMarkdown`...), porque a
 * toolbar manipulava um `<textarea>` cru. Esse mundo não existe mais: Negrito/
 * Itálico/Código/H2-H4/Lista/Lista numerada/Citação agora são comandos nativos
 * do editor (`editor.chain().focus().toggleBold().run()` etc, ver
 * `MarkdownToolbar.tsx`) -- não precisam (nem deveriam) de nenhuma função
 * aqui.
 *
 * O que SOBRA, e por quê:
 * - `resolveLinkHref`: normalização de URL (bare domain -> `https://`,
 *   bloqueia esquemas não-http(s) como `javascript:`) usada pelo `LinkDialog`
 *   antes de aplicar a marca `link` no editor -- mesma regra de sempre,
 *   movida de `markdownPreview.ts` (deletado nesta migração, era só o
 *   renderizador regex do Preview que não existe mais) pra aqui.
 * - `DestaqueType`/`buildDestaqueMarkdown`: o bloco "Destaque" (dica/atenção/
 *   importante) continua FORA do escopo de formatação ao vivo nesta entrega
 *   (SHOULD, não MUST -- ver spec) -- construímos a sintaxe `> [!TIPO]` como
 *   markdown puro e inserimos no editor via
 *   `editor.storage.markdown.parser.parse(...)` (o MESMO parser usado pra
 *   carregar o conteúdo inicial, ver `MarkdownToolbar.tsx`), em vez de
 *   reimplementar um nó de editor dedicado. Resultado: aparece como citação
 *   simples no editor (sem cor/ícone ao vivo), mas o markdown salvo é
 *   idêntico ao que `remark-destaque.mjs` já reconhece no site publicado --
 *   limitação documentada no handoff, não um bug.
 */

// Esquema explícito tipo `javascript:`, `data:`, `vbscript:` etc no início
// da string (RFC 3986: letra seguida de letras/dígitos/+/-/. até o `:`).
const URL_SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * Decide se uma URL digitada no `LinkDialog` é segura/normalizável antes de
 * virar a marca `link` do editor, e resolve o caso mais realista de usuário
 * não-técnico: URL colada sem protocolo (`guiaurubici.com.br/pagina`,
 * `www.site.com.br`) -- bug original reportado pela Marivone no QA da
 * toolbar v1 (antes do textarea), mesma regra preservada aqui.
 *
 * Allowlist por design: só `http(s)://` explícito ou NENHUM esquema (bare
 * domain, vira `https://` automaticamente). Qualquer outro esquema
 * (`javascript:`, `data:`, `vbscript:`, ...) é rejeitado -- devolve `null`,
 * quem chama decide o fallback (`MarkdownToolbar` usa a URL literal digitada
 * nesse caso; a própria extensão `@tiptap/extension-link` também valida o
 * esquema de novo antes de renderizar `<a>`, então não é a única camada).
 */
export function resolveLinkHref(rawUrl: string): string | null {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;

  const schemeMatch = URL_SCHEME_RE.exec(rawUrl);
  if (schemeMatch) return null; // esquema não-http(s): bloqueado

  return `https://${rawUrl}`;
}

export type DestaqueType = 'dica' | 'atencao' | 'importante';

// Keyword em maiúsculo/sem acento que vai dentro de `[!...]` -- mesma
// convenção travada pelo Jurandir (`remark-destaque.mjs`, lado do site) e
// reconhecida de volta pelo parser markdown ao recarregar o post (ver
// `remark-destaque.mjs` pra documentação completa da sintaxe).
const DESTAQUE_MARKER_KEYWORDS: Record<DestaqueType, string> = {
  dica: 'DICA',
  atencao: 'ATENCAO',
  importante: 'IMPORTANTE',
};

/** Monta a sintaxe `> [!TIPO]\n> linha1\n> linha2...` que `remark-destaque.mjs`
 *  (site publicado) reconhece como caixa "Destaque". Cada linha do corpo
 *  (inclusive uma linha vazia entre dois parágrafos, se o usuário digitou
 *  múltiplos) ganha o prefixo `> `. Resultado é markdown puro, pronto pra
 *  passar por `editor.storage.markdown.parser.parse(...)` e ser inserido no
 *  documento do editor (ver `MarkdownToolbar.tsx`, `handleDestaqueConfirm`). */
export function buildDestaqueMarkdown(type: DestaqueType, body: string): string {
  const markerLine = `[!${DESTAQUE_MARKER_KEYWORDS[type]}]`;
  const lines = [markerLine, ...body.split('\n')];
  return lines.map((line) => `> ${line}`).join('\n');
}
