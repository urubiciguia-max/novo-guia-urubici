/**
 * Plugin remark (roda em build time, dentro do pipeline padrão do Astro
 * Content Collections — nunca no cliente, zero impacto em LCP/Core Web
 * Vitals) que transforma um blockquote marcado em "Destaque" (caixa de
 * callout: Dica / Atenção / Importante).
 *
 * Decisão de arquitetura (ver handoff completo em `.agents/inbox/genilson.md`
 * ou pede pro Jurandir): reaproveita blockquote em vez de introduzir sintaxe
 * custom (remark-directive, fence customizado) — zero dependência nova no
 * package.json, e o parser caseiro do admin (`markdownPreview.ts`) já lida
 * com blockquote nativamente, só precisa espelhar a MESMA regra de marcador
 * (ver abaixo) pra não divergir do que o site publicado renderiza.
 *
 * SINTAXE (igual nos dois lugares — admin preview e site publicado):
 *
 *   > [!DICA]
 *   > Leve calçado com boa aderência — o acesso tem trecho de barro.
 *
 *   > [!ATENCAO]
 *   > Em dias de chuva o acesso fica escorregadio.
 *
 *   > [!IMPORTANTE]
 *   > Esta trilha não tem sinalização oficial.
 *
 * Regras do marcador:
 * - Precisa ser a PRIMEIRA linha do blockquote, sozinho (texto do destaque
 *   começa na linha seguinte, ainda dentro do mesmo `>`).
 * - `[!DICA]` / `[!ATENCAO]` / `[!IMPORTANTE]` — case-insensitive, acento
 *   opcional (`ATENÇÃO` funciona igual a `ATENCAO`).
 * - Corpo suporta markdown normal (bold, itálico, link, múltiplos parágrafos)
 *   porque continua sendo um blockquote de verdade por baixo — não precisamos
 *   reimplementar parsing de inline, só removemos a linha do marcador.
 *
 * Por que essa sintaxe (e não emoji cru tipo `> 💡 **Dica:** texto`): um
 * blockquote de citação real poderia, por coincidência, começar com um
 * emoji ou com "Dica:" em bold (ex: alguém citando uma fonte que literalmente
 * diz isso) — virar "Destaque" sem querer. O padrão `[!TIPO]` sozinho na
 * primeira linha é o mesmo usado pelo GitHub/Obsidian pra callouts e não
 * colide com citação nenhuma em uso real no projeto (ver post de exemplo
 * `cachoeiras-secretas-urubici.md`, que já usa blockquote puro pra uma nota
 * editorial — continua intocado porque não bate o marcador).
 *
 * Blockquote sem o marcador (qualquer outro caso) passa reto, sem nenhuma
 * mudança — mantém 100% o comportamento/estilo de citação que já existe em
 * `.post-body :global(blockquote)`.
 */

const ICONS = {
  dica: '💡',
  atencao: '⚠️',
  importante: '❗',
};

const LABELS = {
  dica: 'Dica',
  atencao: 'Atenção',
  importante: 'Importante',
};

// Aceita qualquer conteúdo dentro de `[!...]` -- só vira Destaque se, depois
// de normalizado (acento removido, uppercase), bater com uma das 3 keywords
// abaixo. Qualquer outra coisa entre colchetes (ex: citação real que comece
// com "[Reuters]") não combina com nenhuma keyword e o blockquote fica como
// citação normal.
const MARKER_RE = /^\[!([^\]]+)\]\s*([\s\S]*)$/;

const MARKER_KEYWORDS = {
  DICA: 'dica',
  ATENCAO: 'atencao',
  IMPORTANTE: 'importante',
};

function stripAccents(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function transformDestaqueBlockquote(node) {
  const firstBlock = node.children[0];
  if (!firstBlock || firstBlock.type !== 'paragraph' || firstBlock.children.length === 0) return;

  const firstInline = firstBlock.children[0];
  if (firstInline.type !== 'text') return;

  const match = MARKER_RE.exec(firstInline.value);
  if (!match) return;

  const keyword = stripAccents(match[1]).toUpperCase().trim();
  const type = MARKER_KEYWORDS[keyword];
  if (!type) return; // `[!qualquercoisa]` que não é uma das 3 keywords -- ignora, fica citação normal

  const remainder = match[2];
  if (remainder) {
    // Marcador e começo do corpo na mesma linha física (lenient -- não é o
    // formato recomendado, mas não quebra o build por isso).
    firstInline.value = remainder;
  } else {
    firstBlock.children.shift();
    // Remove o quebra-de-linha (soft break) que ficou logo depois do
    // marcador, senão o corpo do destaque nasce com uma linha vazia na frente.
    if (firstBlock.children[0] && firstBlock.children[0].type === 'break') {
      firstBlock.children.shift();
    }
    if (firstBlock.children.length === 0) {
      node.children.shift(); // parágrafo do marcador ficou vazio -- remove
    }
  }

  // Linha de label (ícone + "Dica"/"Atenção"/"Importante") -- não vem do
  // markdown do autor, é gerada aqui a partir do tipo. Ícone como emoji
  // literal (aria-hidden) + texto visível ao lado -- mesmo padrão já usado
  // em `AffiliateBox.astro` (emoji + texto, sem SVG), não existe um sistema
  // de ícones SVG no site publicado hoje.
  const labelNode = {
    type: 'paragraph',
    children: [],
    data: {
      hName: 'p',
      hProperties: { className: ['destaque__label'] },
      hChildren: [
        {
          type: 'element',
          tagName: 'span',
          properties: { ariaHidden: 'true' },
          children: [{ type: 'text', value: ICONS[type] }],
        },
        { type: 'text', value: ` ${LABELS[type]}` },
      ],
    },
  };
  node.children.unshift(labelNode);

  // Vira `<div class="destaque destaque--dica">` em vez de `<blockquote>` --
  // CSS de citação normal (`.post-body :global(blockquote)`) não encosta
  // nisso porque a tag mudou, zero conflito de estilo.
  node.data = node.data || {};
  node.data.hName = 'div';
  node.data.hProperties = { className: ['destaque', `destaque--${type}`] };
}

/**
 * Visita blockquotes em qualquer profundidade da árvore (mdast). Não usamos
 * `unist-util-visit` de propósito: o pacote já existe transitivamente no
 * `node_modules` (dependência interna do pipeline de markdown do Astro),
 * mas não é uma dependência direta declarada no `package.json` -- confiar
 * nele sem declarar é frágil (o lockfile pode deixar de trazê-lo em uma
 * atualização futura do Astro). Pra um caso de uso tão pequeno, um
 * percurso manual evita adicionar qualquer dependência nova.
 */
function visitBlockquotes(node, fn) {
  if (!node || !Array.isArray(node.children)) return;
  for (const child of node.children) {
    if (child.type === 'blockquote') fn(child);
    visitBlockquotes(child, fn);
  }
}

export default function remarkDestaque() {
  return (tree) => {
    visitBlockquotes(tree, transformDestaqueBlockquote);
  };
}
