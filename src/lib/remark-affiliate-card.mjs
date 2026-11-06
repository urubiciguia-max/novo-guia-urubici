/**
 * Plugin remark (roda em build time, dentro do pipeline padrão do Astro
 * Content Collections -- nunca no cliente, zero impacto em LCP/Core Web
 * Vitals) que transforma o bloco "Card de Afiliado" inserido pelo editor do
 * admin (ver `admin-app/web/src/lib/affiliateCardNode.tsx`) no HTML real do
 * `src/components/AffiliateCard.astro` -- mesmo padrão arquitetural de
 * `remark-destaque.mjs` (plugin dedicado, zero dependência nova).
 *
 * SINTAXE: bloco de código CERCADO com info string própria, corpo em JSON
 * (decisão de arquitetura documentada em
 * `admin-app/web/src/lib/affiliateCardShared.ts`):
 *
 *   ```affiliate-card
 *   {
 *     "layout": "vertical",
 *     "image": "./la-mansarda-img-abc123.jpg",
 *     "imageAlt": "Fachada do La Mansarda Hotel",
 *     "badgeIcon": "coracao",
 *     "badgeText": "Conforto & Charme",
 *     "title": "La Mansarda Hotel",
 *     "button1Text": "🏨 Reservar Agora",
 *     "button1Url": "https://booking.example.com/la-mansarda",
 *     "button1Color": "green",
 *     "button2Text": "📍 Ver Localização",
 *     "button2Url": "https://maps.example.com/la-mansarda",
 *     "tip": "Fica a 5 minutos do centro, com vista pra serra."
 *   }
 *   ```
 *
 * Por que bloco de código cercado (e não blockquote, como o Destaque, ou
 * HTML cru): fence com info string é sintaxe CommonMark padrão, parseada
 * IDÊNTICO pelos dois motores de markdown deste projeto (`markdown-it` no
 * editor, `micromark`/`mdast` aqui no build) -- nenhum parsing customizado
 * necessário em NENHUM dos dois lados só pra RECONHECER o bloco (cada lado
 * só precisa decidir o que fazer com ele depois, ver `affiliateCardNode.tsx`
 * pro lado do editor). JSON como corpo é inequívoco pra parsear de volta.
 *
 * NÃO instancia `AffiliateCard.astro` -- remark roda na camada mdast/hast,
 * não existe jeito de invocar um componente `.astro` (que passa por um
 * compilador próprio) a partir de um plugin remark. Em vez disso, este
 * plugin emite o MESMO HTML/classes que `AffiliateCard.astro` produziria --
 * as duas rotas convergem pro mesmo visual porque o CSS que estiliza essas
 * classes é GLOBAL (`.affiliate-card*` em `src/styles/tokens.css`), nunca
 * duplicado/escopado por componente. Ver também `src/components/
 * AffiliateButton.astro` (`<style is:global>`, mesmo motivo) pro botão 1.
 *
 * A IMAGEM (`data.image`, caminho relativo tipo `./slug-img-abc.jpg`,
 * mesma convenção de qualquer imagem de corpo inserida pelo editor) é
 * reconstruída aqui como um node mdast `image` DE VERDADE (não um elemento
 * hast cru) -- validado empiricamente (build real, descartado depois) que
 * isso recebe a MESMA otimização automática do pipeline de Content
 * Collections do Astro (AVIF/WebP, width/height, lazy loading) que uma
 * imagem markdown nativa `![alt](src)` receberia, mesmo sendo sintetizada
 * por este plugin em vez de já existir no markdown original, e mesmo
 * aninhada dentro do wrapper `data.hName` do card.
 *
 * Bloco de código cercado SEM a info string `affiliate-card` (``` js, ```
 * sem linguagem) passa reto, sem nenhuma mudança -- só intercepta quando o
 * marcador bate E o corpo é JSON válido; qualquer um dos dois falhando,
 * vira bloco de código normal (nunca quebra o build por um JSON malformado
 * num `.md` editado à mão).
 */

const BADGE_ICON_EMOJI = {
  cama: '🛏️',
  coracao: '🤍',
  escudo: '🛡️',
  estrela: '⭐',
  local: '📍',
  carro: '🚗',
};

const VALID_LAYOUTS = new Set(['vertical', 'horizontal']);
const VALID_BUTTON_COLORS = new Set(['green', 'blue-dark', 'orange', 'red']);

function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function textEl(tagName, properties, text) {
  return { type: 'element', tagName, properties, children: [{ type: 'text', value: text }] };
}

function transformAffiliateCardCode(node) {
  let data;
  try {
    const parsed = JSON.parse(node.value);
    if (!parsed || typeof parsed !== 'object') return;
    data = parsed;
  } catch {
    return; // JSON malformado -- deixa como bloco de código normal, nunca quebra o build.
  }

  const layout = VALID_LAYOUTS.has(data.layout) ? data.layout : 'vertical';
  const image = str(data.image);
  const imageAlt = str(data.imageAlt);
  const badgeIcon = BADGE_ICON_EMOJI[data.badgeIcon] ?? BADGE_ICON_EMOJI.estrela;
  const badgeText = str(data.badgeText);
  const title = str(data.title);
  const button1Text = str(data.button1Text);
  const button1Url = str(data.button1Url);
  const button1Color = VALID_BUTTON_COLORS.has(data.button1Color) ? data.button1Color : 'green';
  const button2Text = str(data.button2Text);
  const button2Url = str(data.button2Url);
  const tip = str(data.tip);

  const hasButton1 = Boolean(button1Text && button1Url);
  const hasButton2 = Boolean(button2Text && button2Url);

  const badgeEl = {
    type: 'element',
    tagName: 'span',
    properties: { className: ['affiliate-card__badge'] },
    children: [
      { type: 'element', tagName: 'span', properties: { ariaHidden: 'true' }, children: [{ type: 'text', value: badgeIcon }] },
      { type: 'text', value: ` ${badgeText}` },
    ],
  };

  const titleEl = textEl('h3', { className: ['affiliate-card__title'] }, title);

  const actionButtons = [];
  if (hasButton1) {
    actionButtons.push(
      textEl(
        'a',
        {
          href: button1Url,
          rel: 'sponsored noopener noreferrer',
          target: '_blank',
          className: ['btn', 'affiliate-btn', `affiliate-btn--${button1Color}`, 'affiliate-card__btn', 'affiliate-card__btn--primary'],
        },
        button1Text,
      ),
    );
  }
  if (hasButton2) {
    actionButtons.push(
      textEl(
        'a',
        {
          href: button2Url,
          rel: 'noopener noreferrer',
          target: '_blank',
          className: ['affiliate-card__btn', 'affiliate-card__btn--secondary'],
        },
        button2Text,
      ),
    );
  }

  const bodyChildren = [badgeEl, titleEl];
  if (actionButtons.length > 0) {
    bodyChildren.push({
      type: 'element',
      tagName: 'div',
      properties: {
        className: actionButtons.length === 1 ? ['affiliate-card__actions', 'affiliate-card__actions--single'] : ['affiliate-card__actions'],
      },
      children: actionButtons,
    });
  }
  if (tip) {
    bodyChildren.push({
      type: 'element',
      tagName: 'p',
      properties: { className: ['affiliate-card__tip'] },
      children: [textEl('strong', {}, 'Dica:'), { type: 'text', value: ` ${tip}` }],
    });
  }

  // Wrapper do corpo -- `hChildren` pré-pronto (igual ao `labelNode` de
  // `remark-destaque.mjs`): nenhum dos elementos acima precisa passar pela
  // otimização de imagem do Astro, então vira hast puro direto, sem review
  // de mais nenhum node mdast.
  const bodyWrapper = {
    type: 'paragraph',
    children: [],
    data: { hName: 'div', hProperties: { className: ['affiliate-card__body'] }, hChildren: bodyChildren },
  };

  // Wrapper da mídia -- ESTE precisa ser mdast de verdade (node `image`
  // real como filho), não hast pré-pronto, pra Astro conseguir otimizar a
  // imagem (ver doc grande no topo do arquivo). Omitido quando não há
  // imagem (defensivo -- a UI do admin sempre exige uma, isso só cobre
  // JSON editado à mão/incompleto).
  const mediaWrapper = image
    ? {
        type: 'paragraph',
        children: [{ type: 'image', url: image, alt: imageAlt }],
        data: { hName: 'div', hProperties: { className: ['affiliate-card__media'] } },
      }
    : null;

  // Muta o node `code` em-place -- vira um node mdast genérico (tipo
  // `paragraph`, só pra ter `children`; a TAG real vem de `data.hName`
  // abaixo) com os dois wrappers como filhos.
  node.type = 'paragraph';
  delete node.value;
  delete node.lang;
  delete node.meta;
  node.children = mediaWrapper ? [mediaWrapper, bodyWrapper] : [bodyWrapper];
  node.data = { hName: 'div', hProperties: { className: ['affiliate-card', `affiliate-card--${layout}`] } };
}

/**
 * Visita blocos de código em qualquer profundidade da árvore (mdast) --
 * mesmo motivo de `remark-destaque.mjs` não usar `unist-util-visit`: evita
 * dependência nova pra um caso de uso pequeno.
 */
function visitCodeBlocks(node, fn) {
  if (!node || !Array.isArray(node.children)) return;
  for (const child of node.children) {
    if (child.type === 'code' && child.lang === 'affiliate-card') fn(child);
    visitCodeBlocks(child, fn);
  }
}

export default function remarkAffiliateCard() {
  return (tree) => {
    visitCodeBlocks(tree, transformAffiliateCardCode);
  };
}
