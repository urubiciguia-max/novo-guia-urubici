/**
 * Round-trip markdown -> doc do editor (TipTap) -> markdown de volta.
 *
 * Este é o teste mais crítico desta entrega (ver spec "Editor WYSIWYG no
 * corpo do artigo/página", `.agents/inbox/genilson.md`): a troca de
 * textarea cru por um editor rich-text contenteditable é a mesma classe de
 * risco do bug P0 de perda de dados que já aconteceu uma vez nesta tela
 * (ver memória do projeto). Cobre dois níveis:
 *
 * 1. **Os 5 posts reais** de `src/content/posts/*.md` -- critério de aceite
 *    explícito: "salvar sem alterar nada produz diff vazio (ou só
 *    cosmético) no markdown". Testado contra as MESMAS funções
 *    `parsePostFile`/`serializePostFile` que `GitHubPostsClient` usa de
 *    verdade (`@admin-data`), não uma reimplementação -- se o corpo mudar
 *    um caractere que não seja whitespace puro, o teste quebra.
 *
 * 2. **Padrões sintéticos** (negrito, itálico, headings H2-H4, link,
 *    código inline, lista/lista numerada, citação) cobrindo cada sintaxe
 *    que a toolbar insere, incluindo casos de borda documentados como
 *    limitação conhecida (bloco "Destaque", H1 fora de escopo).
 *
 * Nota de ambiente: `@admin-data` (alias pra `admin-app/src`, ver
 * `vitest.config.ts`) importa `js-yaml` -- precisa de
 * `npm install --prefix admin-app` rodado pelo menos uma vez (o script raiz
 * `build:admin` já faz isso; rodar `npm test` aqui standalone sem isso
 * instalado antes falha na resolução do módulo, não é bug deste teste).
 */
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parsePageFile, parsePostFile, serializePostFile } from '@admin-data/index.js';
import { createMarkdownEditorExtensions } from '../src/lib/markdownEditorExtensions';

function markdownToMarkdown(markdown: string): string {
  const editor = new Editor({ extensions: createMarkdownEditorExtensions(''), content: markdown });
  const out = editor.storage.markdown.getMarkdown();
  editor.destroy();
  return out;
}

const postsDir = join(__dirname, '../../../src/content/posts');
const pagesDir = join(__dirname, '../../../src/content/pages');

describe('round-trip nos 5 posts reais (src/content/posts/*.md)', () => {
  const files = readdirSync(postsDir).filter((f) => f.endsWith('.md'));

  // Trava de sanidade: se alguém mexer na pasta e sobrar menos de 5 posts,
  // o teste "critério de aceite" perde sentido silenciosamente -- melhor
  // falhar alto.
  it('a pasta ainda tem os 5 posts esperados', () => {
    expect(files.length).toBe(5);
  });

  for (const file of files) {
    it(`${file}: abrir sem alterar nada e salvar produz BODY idêntico`, () => {
      const raw = readFileSync(join(postsDir, file), 'utf-8');
      const { body } = parsePostFile(raw);
      const roundtripBody = markdownToMarkdown(body);
      // Igualdade ESTRITA no corpo -- não "cosmético", não "aceitável":
      // os 5 posts reais não usam nenhuma sintaxe (itálico com `_`, soft
      // line break dentro de parágrafo) que o editor normalizaria. Ver
      // `describe` de páginas abaixo pra onde a normalização cosmética
      // documentada de fato aparece.
      expect(roundtripBody).toBe(body.trim());
    });

    it(`${file}: arquivo completo (frontmatter + body) só muda na formatação do YAML, nunca no corpo`, () => {
      const raw = readFileSync(join(postsDir, file), 'utf-8');
      const { frontmatter, body } = parsePostFile(raw);
      const roundtripBody = markdownToMarkdown(body);
      const newRaw = serializePostFile(frontmatter, roundtripBody);

      // O `js-yaml.dump` de `serializePostFile` já re-formata estilo de
      // aspas/array do YAML (ex: `"X"` -> `X`, `["a","b"]` -> lista com
      // `- `) TODA VEZ que salva, independente de qualquer mudança no
      // corpo -- comportamento pré-existente de `admin-app/src/markdown.ts`,
      // o mesmo aconteceria salvando pelo textarea antigo sem tocar no
      // corpo. Não é uma regressão desta migração, por isso o teste separa
      // "corpo" (acima, igualdade estrita) de "arquivo inteiro" (aqui, só
      // document que a única fonte de diff é o bloco `---...---`).
      const [, , newBodyBlock] = /^(---[\s\S]*?---\n\n)([\s\S]*)$/.exec(newRaw) ?? [];
      expect(newBodyBlock?.trimEnd()).toBe(body.trim());
      // confere que o diff do arquivo completo, se houver, nunca é no corpo
      expect(newRaw.endsWith(`${body.trim()}\n`)).toBe(true);
    });
  }
});

describe('round-trip nas 4 páginas institucionais (src/content/pages/*.md) -- diffs cosméticos conhecidos', () => {
  const files = readdirSync(pagesDir).filter((f) => f.endsWith('.md'));

  it('a pasta ainda tem as 4 páginas esperadas', () => {
    expect(files.length).toBe(4);
  });

  for (const file of files) {
    it(`${file}: round-trip não perde nenhuma palavra do corpo`, () => {
      const raw = readFileSync(join(pagesDir, file), 'utf-8');
      const { body } = parsePageFile(raw);
      const roundtripBody = markdownToMarkdown(body);

      // Não exigimos igualdade byte-a-byte aqui (ver testes específicos
      // abaixo pra documentar POR QUÊ) -- só que nenhuma palavra do texto
      // tenha sido perdida. Normaliza pontuação/marcadores de ênfase pra
      // comparar só o conteúdo textual.
      const words = (s: string) => s.replace(/[*_`[\]()>#-]/g, ' ').split(/\s+/).filter(Boolean);
      expect(words(roundtripBody).join(' ')).toBe(words(body).join(' '));
    });
  }

  it(
    'diff cosmético CONHECIDO #1: parágrafo "soft-wrapped" (múltiplas linhas físicas sem linha em branco) ' +
      'colapsa pra uma linha só -- renderização idêntica (HTML colapsa espaço em branco), igual a um link que já rondou em QA',
    () => {
      const original = 'Dúvidas gerais, sugestão de pauta ou correção de informação:\n[contato](mailto:a@b.com)';
      const result = markdownToMarkdown(original);
      expect(result).toBe('Dúvidas gerais, sugestão de pauta ou correção de informação: [contato](mailto:a@b.com)');
    },
  );

  it(
    'diff cosmético CONHECIDO #2: ênfase com `_sublinhado_` normaliza pra `*asterisco*' +
      '` -- mesmo <em> na renderização, só a sintaxe-fonte muda (afeta `politica-de-privacidade.md`/`termos-de-uso.md`, nenhum dos 5 posts reais usa `_..._`)',
    () => {
      const original = '_Texto institucional de exemplo._';
      const result = markdownToMarkdown(original);
      expect(result).toBe('*Texto institucional de exemplo.*');
    },
  );
});

describe('padrões sintéticos: cada sintaxe que a toolbar insere', () => {
  it('negrito', () => {
    expect(markdownToMarkdown('isso é **negrito** aqui')).toBe('isso é **negrito** aqui');
  });

  it('itálico (produzido pela toolbar, sempre com asterisco)', () => {
    expect(markdownToMarkdown('isso é *itálico* aqui')).toBe('isso é *itálico* aqui');
  });

  it('código inline', () => {
    expect(markdownToMarkdown('use `npm install` aqui')).toBe('use `npm install` aqui');
  });

  it('heading H2/H3/H4 (sem H1 -- fora de escopo por design)', () => {
    expect(markdownToMarkdown('## Título H2')).toBe('## Título H2');
    expect(markdownToMarkdown('### Título H3')).toBe('### Título H3');
    expect(markdownToMarkdown('#### Título H4')).toBe('#### Título H4');
  });

  it('link com protocolo http(s)', () => {
    expect(markdownToMarkdown('[cachoeira](https://example.com)')).toBe('[cachoeira](https://example.com)');
  });

  it('link mailto: e link relativo (usados nas páginas institucionais reais)', () => {
    expect(markdownToMarkdown('[contato](mailto:contato@guiaurubici.com.br)')).toBe(
      '[contato](mailto:contato@guiaurubici.com.br)',
    );
    expect(markdownToMarkdown('[Guia Prático](/guia-pratico)')).toBe('[Guia Prático](/guia-pratico)');
  });

  it('lista com marcadores', () => {
    expect(markdownToMarkdown('- item um\n- item dois')).toBe('- item um\n- item dois');
  });

  it('lista numerada', () => {
    expect(markdownToMarkdown('1. primeiro\n2. segundo\n3. terceiro')).toBe('1. primeiro\n2. segundo\n3. terceiro');
  });

  it('citação simples (usada pelos 5 posts reais como nota editorial)', () => {
    expect(markdownToMarkdown('> uma nota qualquer')).toBe('> uma nota qualquer');
  });
});

describe('casos de borda documentados (limitações conhecidas, não regressões)', () => {
  it(
    'bloco "Destaque" (`> [!DICA]`): SEM formatação ao vivo nesta entrega (SHOULD, não MUST) -- ' +
      'mas o conteúdo NUNCA é perdido, e o marcador `[!TIPO]` continua reconhecível por `remark-destaque.mjs` ' +
      '(que opera no texto já resolvido do AST, não na sintaxe crua -- `\\[` escapado resolve pra `[` de novo no parse)',
    () => {
      const original = '> [!DICA]\n> Leve roupa de frio mesmo no verão.';
      const result = markdownToMarkdown(original);
      // vira UMA linha de blockquote (soft break colapsado, igual qualquer
      // blockquote multi-linha) com os colchetes do marcador ESCAPADOS
      // (`\[`/`\]`) -- comportamento padrão do serializer markdown pra texto
      // puro que contém caracteres com significado especial. Isso é seguro:
      // um parser CommonMark (inclusive o `remark` do site publicado) resolve
      // `\[` de volta pra `[` literal ao reler -- não há perda de conteúdo,
      // só uma troca de representação textual equivalente.
      expect(result).toBe('> \\[!DICA\\] Leve roupa de frio mesmo no verão.');
      // a palavra "DICA" (keyword do marcador) nunca desaparece
      expect(result).toContain('DICA');
      expect(result).toContain('Leve roupa de frio mesmo no verão.');
    },
  );

  it(
    'H1 cru no corpo (não deveria existir -- H1 é do frontmatter via [...slug].astro, ' +
      'não é opção na toolbar): demovido pra parágrafo normal, texto preservado, sem erro',
    () => {
      const result = markdownToMarkdown('# Título H1 indevido\n\nparágrafo normal');
      expect(result).toBe('Título H1 indevido\n\nparágrafo normal');
      expect(result).not.toContain('#');
    },
  );

  it('corpo vazio não quebra', () => {
    expect(markdownToMarkdown('')).toBe('');
  });
});

describe('node de imagem (bloco próprio): regressão do bug de linha em branco faltando', () => {
  // Bug real encontrado em `src/content/posts/o-que-fazer.md`: a imagem de
  // corpo é um node de BLOCO PRÓPRIO (`inline: false`, ver
  // `markdownEditorExtensions.ts`), mas o `serialize` padrão que o
  // `tiptap-markdown` registra por nome pro node `image` vem do schema
  // INLINE original do `prosemirror-markdown` e não chama
  // `state.closeBlock(node)` -- resultado: abrir um post com imagem seguida
  // de heading e salvar sem alterar nada colava os dois num parágrafo só
  // (`![alt](src)### Heading`), fazendo o heading sumir. `BlockImage`
  // (`markdownEditorExtensions.ts`) corrige isso com um `markdown.serialize`
  // próprio que adiciona o `closeBlock` faltante.

  it('imagem de bloco seguida de heading precisa de linha em branco entre os dois', () => {
    const original =
      '![Cavaleiro guiando cavalo por trilha de campo](./cavalgada.jpg)\n\n### Vale a pena fazer cavalgada em Urubici?';
    const result = markdownToMarkdown(original);
    expect(result).toBe(original);
    // trava explícita do bug: o `###` nunca pode colar direto na imagem
    expect(result).not.toContain(')###');
  });

  it('imagem de bloco seguida de parágrafo normal precisa de linha em branco entre os dois', () => {
    const original = '![Trilha na serra](./trilha.jpg)\n\nVale, principalmente para quem busca imersão na natureza.';
    const result = markdownToMarkdown(original);
    expect(result).toBe(original);
    expect(result).not.toContain(')Vale');
  });

  it('duas imagens de bloco em sequência mantêm linha em branco entre elas', () => {
    const original = '![Primeira imagem](./a.jpg)\n\n![Segunda imagem](./b.jpg)';
    const result = markdownToMarkdown(original);
    expect(result).toBe(original);
  });
});
