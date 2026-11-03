import { describe, expect, it } from 'vitest';
import { buildDestaqueMarkdown, resolveLinkHref } from '../src/lib/markdownToolbarActions';

/**
 * A maior parte dos testes que viviam aqui (wrapInline/applyHeading/
 * applyLinePrefix/insertLinkMarkdown/insertDestaqueMarkdown) testava
 * manipulação de STRING num textarea cru -- esse código foi deletado na
 * migração pro editor WYSIWYG (ver `lib/markdownToolbarActions.ts`,
 * cabeçalho do arquivo). O comportamento equivalente (negrito/itálico/
 * heading/lista/citação) agora é testado end-to-end contra o editor de
 * verdade em `test/markdownRoundtrip.test.ts` e `test/MarkdownToolbar.test.tsx`.
 */

describe('resolveLinkHref', () => {
  it('URL já com protocolo http(s) passa intacta', () => {
    expect(resolveLinkHref('https://example.com')).toBe('https://example.com');
    expect(resolveLinkHref('http://example.com')).toBe('http://example.com');
  });

  it('bare domain (sem protocolo) ganha https:// automaticamente', () => {
    expect(resolveLinkHref('guiaurubici.com.br/pagina')).toBe('https://guiaurubici.com.br/pagina');
    expect(resolveLinkHref('www.site.com.br')).toBe('https://www.site.com.br');
  });

  it('esquema explícito não-http(s) é bloqueado (devolve null)', () => {
    expect(resolveLinkHref('javascript:alert(1)')).toBeNull();
    expect(resolveLinkHref('data:text/html,<script>1</script>')).toBeNull();
  });

  it('mailto: é um esquema explícito -- bloqueado por ESTA função (allowlist é só http/https/bare domain)', () => {
    // Nota: `resolveLinkHref` é só a normalização usada pelo LinkDialog pra
    // decidir se adiciona `https://` -- quem efetivamente permite `mailto:`
    // no documento é a própria extensão `@tiptap/extension-link` (allowlist
    // mais ampla, ver `markdownEditorExtensions.ts`). `MarkdownToolbar`
    // já trata esse `null` como "usa a URL literal digitada" (ver
    // `handleLinkConfirm`), não como "bloqueia a inserção".
    expect(resolveLinkHref('mailto:contato@example.com')).toBeNull();
  });
});

describe('buildDestaqueMarkdown', () => {
  it('monta o marcador + corpo numa linha só, cada linha prefixada com "> "', () => {
    expect(buildDestaqueMarkdown('dica', 'Leve calçado com boa aderência.')).toBe(
      '> [!DICA]\n> Leve calçado com boa aderência.',
    );
  });

  it('usa a keyword certa pra cada tipo (sem acento, maiúsculo, igual remark-destaque.mjs)', () => {
    expect(buildDestaqueMarkdown('atencao', 'x')).toBe('> [!ATENCAO]\n> x');
    expect(buildDestaqueMarkdown('importante', 'x')).toBe('> [!IMPORTANTE]\n> x');
  });

  it('corpo multi-linha: cada linha ganha seu próprio prefixo "> "', () => {
    expect(buildDestaqueMarkdown('dica', 'linha um\nlinha dois')).toBe('> [!DICA]\n> linha um\n> linha dois');
  });

  it('corpo com múltiplos parágrafos (linha vazia entre eles): linha vazia também ganha "> "', () => {
    expect(buildDestaqueMarkdown('dica', 'parágrafo um\n\nparágrafo dois')).toBe(
      '> [!DICA]\n> parágrafo um\n> \n> parágrafo dois',
    );
  });
});
