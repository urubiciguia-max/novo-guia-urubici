import { describe, expect, it } from 'vitest';
import { renderMarkdownPreview } from '../src/lib/markdownPreview';

describe('renderMarkdownPreview', () => {
  it('escapa HTML antes de qualquer transformação (nunca injeta script)', () => {
    const html = renderMarkdownPreview('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('converte cabeçalhos', () => {
    expect(renderMarkdownPreview('# Título\n## Subtítulo')).toBe('<h1>Título</h1>\n<h2>Subtítulo</h2>');
  });

  it('converte H4 (não deixa "####" cru nem para no H3)', () => {
    expect(renderMarkdownPreview('#### Um subtítulo menor')).toBe('<h4>Um subtítulo menor</h4>');
  });

  it('converte bold e itálico', () => {
    const html = renderMarkdownPreview('isto é **forte** e isto é *itálico*');
    expect(html).toContain('<strong>forte</strong>');
    expect(html).toContain('<em>itálico</em>');
  });

  it('bug Marivone: negrito vazio (****, botão Negrito sem seleção antes de digitar) não produz HTML quebrado', () => {
    // Antes da correção, "****" não casava o regex de bold (exigia 1+ char
    // de conteúdo) e sobrava pro regex de itálico casar só 3 dos 4
    // asteriscos, produzindo `<em>*</em>*` -- renderização ERRADA, não só
    // crua. Com o fix, bold casa o marcador vazio inteiro primeiro.
    const html = renderMarkdownPreview('****');
    expect(html).not.toBe('<p><em>*</em>*</p>');
    expect(html).toBe('<p><strong></strong></p>');
  });

  it('itálico vazio (**, botão Itálico sem seleção) não produz HTML quebrado', () => {
    const html = renderMarkdownPreview('**');
    expect(html).toBe('<p><em></em></p>');
  });

  it('converte link http(s) com rel seguro', () => {
    const html = renderMarkdownPreview('[clique aqui](https://exemplo.com)');
    expect(html).toContain('href="https://exemplo.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('bug Marivone: placeholder do botão Link ([texto do link](https://url)) renderiza como <a>', () => {
    // Antes da correção o placeholder nascia como `(url)` (sem protocolo) e
    // o regex de link só reconhecia `https?://` explícito -- o Preview
    // mostrava a sintaxe crua em vez de um link, mesmo logo depois de clicar
    // no botão Link sem trocar nada.
    const html = renderMarkdownPreview('[texto do link](https://url)');
    expect(html).toBe('<p><a href="https://url" target="_blank" rel="noopener noreferrer">texto do link</a></p>');
  });

  it('bug Marivone: URL colada sem protocolo (cenário realista de usuário não-técnico) também vira <a>', () => {
    const semProtocolo = renderMarkdownPreview('[cachoeira](guiaurubici.com.br/pagina)');
    expect(semProtocolo).toBe(
      '<p><a href="https://guiaurubici.com.br/pagina" target="_blank" rel="noopener noreferrer">cachoeira</a></p>',
    );

    const comWww = renderMarkdownPreview('[site](www.site.com.br)');
    expect(comWww).toBe('<p><a href="https://www.site.com.br" target="_blank" rel="noopener noreferrer">site</a></p>');
  });

  it('bloqueia esquemas perigosos (javascript:) -- nunca vira href, fica cru como texto', () => {
    const html = renderMarkdownPreview('[clique](javascript:evil)');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href="javascript:');
    expect(html).toBe('<p>[clique](javascript:evil)</p>');
  });

  it('agrupa linhas em parágrafos separados por linha vazia', () => {
    const html = renderMarkdownPreview('linha um\nlinha dois\n\nsegundo parágrafo');
    expect(html).toBe('<p>linha um linha dois</p>\n<p>segundo parágrafo</p>');
  });

  it('código inline vazio (``, botão Código sem seleção) fica cru, sem renderizar errado', () => {
    const html = renderMarkdownPreview('``');
    expect(html).toBe('<p>``</p>');
  });

  it('converte código inline', () => {
    const html = renderMarkdownPreview('roda `npm run build` antes de subir');
    expect(html).toContain('<code>npm run build</code>');
  });

  it('código inline não é afetado por bold/itálico dentro dele', () => {
    // best-effort: código processado antes de bold/itálico (ver comentário
    // no próprio arquivo) -- asteriscos dentro de crases não viram <em>/<strong>.
    const html = renderMarkdownPreview('`*não é itálico*`');
    expect(html).toContain('<code>*não é itálico*</code>');
  });

  it('converte lista com marcadores', () => {
    const html = renderMarkdownPreview('- primeiro\n- segundo');
    expect(html).toBe('<ul><li>primeiro</li><li>segundo</li></ul>');
  });

  it('converte lista numerada', () => {
    const html = renderMarkdownPreview('1. primeiro\n2. segundo');
    expect(html).toBe('<ol><li>primeiro</li><li>segundo</li></ol>');
  });

  it('converte citação', () => {
    const html = renderMarkdownPreview('> uma citação');
    expect(html).toBe('<blockquote><p>uma citação</p></blockquote>');
  });

  it('não mistura lista e parágrafo adjacentes', () => {
    const html = renderMarkdownPreview('texto antes\n- item\ntexto depois');
    expect(html).toBe('<p>texto antes</p>\n<ul><li>item</li></ul>\n<p>texto depois</p>');
  });

  it('escapa HTML dentro de citação (marcador > vira &gt; antes do parse, não quebra a detecção)', () => {
    const html = renderMarkdownPreview('> <script>alert(1)</script>');
    expect(html).toContain('<blockquote><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></blockquote>');
  });

  describe('Destaque (blockquote com marcador [!TIPO] -- mesma convenção do remark-destaque.mjs)', () => {
    it('[!DICA] vira caixa "destaque--dica" com ícone/label gerados, sem a linha do marcador', () => {
      const html = renderMarkdownPreview('> [!DICA]\n> Leve calçado com boa aderência.');
      expect(html).toBe(
        '<div class="destaque destaque--dica">' +
          '<p class="destaque__label"><span aria-hidden="true">💡</span> Dica</p>' +
          '<p>Leve calçado com boa aderência.</p>' +
          '</div>',
      );
    });

    it('[!ATENCAO] vira "destaque--atencao" com ícone/label de Atenção', () => {
      const html = renderMarkdownPreview('> [!ATENCAO]\n> Em dias de chuva o acesso fica escorregadio.');
      expect(html).toBe(
        '<div class="destaque destaque--atencao">' +
          '<p class="destaque__label"><span aria-hidden="true">⚠️</span> Atenção</p>' +
          '<p>Em dias de chuva o acesso fica escorregadio.</p>' +
          '</div>',
      );
    });

    it('[!IMPORTANTE] vira "destaque--importante" com ícone/label de Importante', () => {
      const html = renderMarkdownPreview('> [!IMPORTANTE]\n> Guia local é recomendado.');
      expect(html).toBe(
        '<div class="destaque destaque--importante">' +
          '<p class="destaque__label"><span aria-hidden="true">❗</span> Importante</p>' +
          '<p>Guia local é recomendado.</p>' +
          '</div>',
      );
    });

    it('marcador é case-insensitive e aceita sem acento ([!atencao] == [!ATENÇÃO])', () => {
      const semAcentoMinusculo = renderMarkdownPreview('> [!atencao]\n> cuidado');
      const comAcentoMaiusculo = renderMarkdownPreview('> [!ATENÇÃO]\n> cuidado');
      expect(semAcentoMinusculo).toContain('destaque--atencao');
      expect(comAcentoMaiusculo).toContain('destaque--atencao');
      expect(semAcentoMinusculo).toBe(comAcentoMaiusculo);
    });

    it('corpo do Destaque aceita markdown normal (bold/itálico/link), igual citação', () => {
      const html = renderMarkdownPreview('> [!DICA]\n> **Leve** um *guia* e veja [o mapa](https://example.com)');
      expect(html).toContain('<strong>Leve</strong>');
      expect(html).toContain('<em>guia</em>');
      expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">o mapa</a>');
      expect(html).toContain('destaque--dica');
    });

    it('[Reuters] (citação real com colchete, sem "!") continua citação normal, não vira Destaque', () => {
      const html = renderMarkdownPreview('> [Reuters] algo foi dito');
      expect(html).toBe('<blockquote><p>[Reuters] algo foi dito</p></blockquote>');
    });

    it('[!algumacoisa] que bate o padrão [!...] mas não é uma das 3 keywords continua citação normal', () => {
      const html = renderMarkdownPreview('> [!ALGUMACOISA]\n> texto qualquer');
      expect(html).toBe('<blockquote><p>[!ALGUMACOISA] texto qualquer</p></blockquote>');
    });

    it('blockquote sem marcador nenhum continua citação normal (comportamento 100% inalterado)', () => {
      const html = renderMarkdownPreview('> uma citação qualquer');
      expect(html).toBe('<blockquote><p>uma citação qualquer</p></blockquote>');
    });

    it('marcador sozinho, sem corpo depois, não gera <p> vazio', () => {
      const html = renderMarkdownPreview('> [!DICA]');
      expect(html).toBe(
        '<div class="destaque destaque--dica"><p class="destaque__label"><span aria-hidden="true">💡</span> Dica</p></div>',
      );
    });

    it('integração toolbar -> preview: markdown montado por insertDestaqueMarkdown (DestaqueDialog) renderiza a caixa certa', () => {
      // Mesma sintaxe que `insertDestaqueMarkdown` (markdownToolbarActions.ts)
      // produz ao confirmar o modal "Inserir destaque" -- garante que as duas
      // pontas (toolbar insere / preview reconhece) continuam alinhadas.
      const html = renderMarkdownPreview('> [!IMPORTANTE]\n> Esta trilha não tem sinalização oficial.');
      expect(html).toContain('destaque--importante');
      expect(html).toContain('❗');
      expect(html).toContain('Importante');
      expect(html).toContain('Esta trilha não tem sinalização oficial.');
    });
  });
});
