/**
 * Fonte única de verdade do bloco "Card de Afiliado" -- tipos, opções fixas
 * (ícone do selo / cor do botão 1) e serialização JSON compartilhados entre
 * o node TipTap (`lib/affiliateCardNode.tsx`), o diálogo de inserção/edição
 * (`components/AffiliateCardDialog.tsx`) e a prévia ao vivo
 * (`components/AffiliateCardPreview.tsx`).
 *
 * Decisão de arquitetura (handoff do Genilson, 2026-11-06): o bloco vira,
 * no markdown salvo, um bloco de código cercado com info string própria --
 * ```` ```affiliate-card ```` seguido de um JSON -- em vez de HTML cru ou
 * sintaxe tipo diretiva feita à mão. Por quê:
 *
 * - Fence cercado (```lang) é sintaxe CommonMark padrão, parseada IDÊNTICO
 *   pelos dois motores de markdown deste projeto: `markdown-it` (editor, via
 *   `tiptap-markdown`) e `micromark`/`mdast` (build do Astro, via remark) --
 *   zero parsing customizado necessário em QUALQUER um dos dois lados pra
 *   simplesmente RECONHECER o bloco (só precisamos interceptar o que fazer
 *   com ele depois de reconhecido, ver `affiliateCardNode.tsx` e
 *   `src/lib/remark-affiliate-card.mjs`).
 * - JSON como corpo é inequívoco pra PARSEAR de volta (sem heurística de
 *   regex em texto livre) e trivialmente "pretty" (`JSON.stringify(_, null, 2)`)
 *   pra quem abrir o `.md` cru no GitHub conseguir ler o que tem ali.
 * - Validado empiricamente (build real do Astro, descartado depois) que uma
 *   imagem referenciada por caminho relativo DENTRO do JSON, quando o
 *   plugin remark reconstrói um node mdast `image` de verdade a partir
 *   dela, continua recebendo OTIMIZAÇÃO AUTOMÁTICA completa (AVIF/WebP,
 *   width/height, lazy loading) do pipeline de Content Collections do
 *   Astro -- mesmo tratamento que uma imagem teria se tivesse sido escrita
 *   como `![alt](src)` direto no markdown. Ver `src/lib/
 *   remark-affiliate-card.mjs` pra onde isso é reconstruído.
 *
 * `button1Color` usa as MESMAS chaves do `Variant` de
 * `src/components/AffiliateButton.astro` (`green`/`blue-dark`/`orange`/`red`)
 * de propósito -- o valor vai direto pra prop `variant` sem camada de
 * tradução nenhuma.
 */

export type AffiliateCardLayout = 'vertical' | 'horizontal';

export type AffiliateCardBadgeIcon = 'cama' | 'coracao' | 'escudo' | 'estrela' | 'local' | 'carro';

export type AffiliateCardButtonColor = 'green' | 'blue-dark' | 'orange' | 'red';

/**
 * Shape completo do bloco -- usado como `attrs` do node TipTap, como
 * "value" controlado do `AffiliateCardDialog`, e como payload serializado
 * pro markdown (ver `buildAffiliateCardPayload`/`serializeAffiliateCard`).
 * TODOS os campos são string/enum simples (nunca `undefined`) de propósito:
 * simplifica o round-trip JSON (sem diferenciar "campo ausente" de "campo
 * vazio") e o `ProseMirror` exige defaults primitivos em `addAttributes()`.
 */
export interface AffiliateCardFormValue {
  layout: AffiliateCardLayout;
  image: string;
  imageAlt: string;
  badgeIcon: AffiliateCardBadgeIcon;
  badgeText: string;
  title: string;
  button1Text: string;
  button1Url: string;
  button1Color: AffiliateCardButtonColor;
  button2Text: string;
  button2Url: string;
  tip: string;
}

/** Ordem CANÔNICA dos campos no JSON serializado -- sempre a mesma, pra
 *  `JSON.stringify` produzir o MESMO texto toda vez que o mesmo valor for
 *  serializado (round-trip byte a byte, ver `test/AffiliateCardNode.test.tsx`).
 *  Nunca espalhe `...value` direto num literal pra montar o payload -- a
 *  ordem de inserção de `...spread` depende da ordem das CHAVES DE ORIGEM,
 *  não desta lista; sempre passe por `buildAffiliateCardPayload`. */
function buildAffiliateCardPayload(value: AffiliateCardFormValue): AffiliateCardFormValue {
  return {
    layout: value.layout,
    image: value.image,
    imageAlt: value.imageAlt,
    badgeIcon: value.badgeIcon,
    badgeText: value.badgeText,
    title: value.title,
    button1Text: value.button1Text,
    button1Url: value.button1Url,
    button1Color: value.button1Color,
    button2Text: value.button2Text,
    button2Url: value.button2Url,
    tip: value.tip,
  };
}

export const DEFAULT_AFFILIATE_CARD_VALUE: AffiliateCardFormValue = {
  layout: 'vertical',
  image: '',
  imageAlt: '',
  badgeIcon: 'estrela',
  badgeText: '',
  title: '',
  button1Text: '',
  button1Url: '',
  button1Color: 'green',
  button2Text: '',
  button2Url: '',
  tip: '',
};

/** Serializa pro corpo do bloco de código cercado -- 2 espaços de indentação
 *  só por legibilidade de quem abrir o `.md` cru (não afeta o `JSON.parse`
 *  de volta). */
export function serializeAffiliateCard(value: AffiliateCardFormValue): string {
  return JSON.stringify(buildAffiliateCardPayload(value), null, 2);
}

const BADGE_ICON_VALUES: readonly AffiliateCardBadgeIcon[] = ['cama', 'coracao', 'escudo', 'estrela', 'local', 'carro'];
const BUTTON_COLOR_VALUES: readonly AffiliateCardButtonColor[] = ['green', 'blue-dark', 'orange', 'red'];
const LAYOUT_VALUES: readonly AffiliateCardLayout[] = ['vertical', 'horizontal'];

function isOneOf<T extends string>(values: readonly T[], input: unknown): input is T {
  return typeof input === 'string' && (values as readonly string[]).includes(input);
}

function str(input: unknown, fallback: string): string {
  return typeof input === 'string' ? input : fallback;
}

/**
 * Parse defensivo -- nunca lança. Usado tanto pelo `parseHTML`/`parse.setup`
 * do node (ver `affiliateCardNode.tsx`, bloco já salvo sendo recarregado)
 * quanto por qualquer teste que precise ler o JSON de volta. Cada campo cai
 * pro default individualmente se faltar ou tiver tipo/valor fora do enum --
 * nunca descarta o bloco inteiro por um campo malformado (ex.: um `.md`
 * editado manualmente com um typo num enum).
 */
export function parseAffiliateCard(raw: string): AffiliateCardFormValue {
  let parsed: Record<string, unknown> = {};
  try {
    const result = JSON.parse(raw);
    if (result && typeof result === 'object') parsed = result as Record<string, unknown>;
  } catch {
    // JSON malformado -- devolve os defaults (ver doc acima).
  }

  return {
    layout: isOneOf(LAYOUT_VALUES, parsed.layout) ? parsed.layout : DEFAULT_AFFILIATE_CARD_VALUE.layout,
    image: str(parsed.image, DEFAULT_AFFILIATE_CARD_VALUE.image),
    imageAlt: str(parsed.imageAlt, DEFAULT_AFFILIATE_CARD_VALUE.imageAlt),
    badgeIcon: isOneOf(BADGE_ICON_VALUES, parsed.badgeIcon) ? parsed.badgeIcon : DEFAULT_AFFILIATE_CARD_VALUE.badgeIcon,
    badgeText: str(parsed.badgeText, DEFAULT_AFFILIATE_CARD_VALUE.badgeText),
    title: str(parsed.title, DEFAULT_AFFILIATE_CARD_VALUE.title),
    button1Text: str(parsed.button1Text, DEFAULT_AFFILIATE_CARD_VALUE.button1Text),
    button1Url: str(parsed.button1Url, DEFAULT_AFFILIATE_CARD_VALUE.button1Url),
    button1Color: isOneOf(BUTTON_COLOR_VALUES, parsed.button1Color)
      ? parsed.button1Color
      : DEFAULT_AFFILIATE_CARD_VALUE.button1Color,
    button2Text: str(parsed.button2Text, DEFAULT_AFFILIATE_CARD_VALUE.button2Text),
    button2Url: str(parsed.button2Url, DEFAULT_AFFILIATE_CARD_VALUE.button2Url),
    tip: str(parsed.tip, DEFAULT_AFFILIATE_CARD_VALUE.tip),
  };
}

export interface BadgeIconOption {
  value: AffiliateCardBadgeIcon;
  icon: string;
  label: string;
}

/** 6 ícones prontos pro selo -- lista fechada (sem campo livre de
 *  emoji/texto), pedido explícito do handoff. Conjunto pensado pro contexto
 *  de turismo/afiliados deste site (hospedagem, conforto, segurança,
 *  destaque, localização, transporte) -- mesma convenção 100% emoji (sem
 *  SVG) já usada em `DestaqueDialog`/`AffiliateBox.astro`. */
export const BADGE_ICON_OPTIONS: readonly BadgeIconOption[] = [
  { value: 'cama', icon: '🛏️', label: 'Cama / Hospedagem' },
  { value: 'coracao', icon: '🤍', label: 'Coração / Conforto' },
  { value: 'escudo', icon: '🛡️', label: 'Escudo / Segurança' },
  { value: 'estrela', icon: '⭐', label: 'Estrela / Destaque' },
  { value: 'local', icon: '📍', label: 'Localização' },
  { value: 'carro', icon: '🚗', label: 'Carro / Transporte' },
];

export function badgeIconEmoji(value: AffiliateCardBadgeIcon): string {
  return BADGE_ICON_OPTIONS.find((option) => option.value === value)?.icon ?? '';
}

export interface ButtonColorOption {
  value: AffiliateCardButtonColor;
  label: string;
  /** Hex real do token do SITE (`src/styles/tokens.css`) -- usado só pro
   *  swatch do picker e pra prévia ao vivo no editor (admin tem seu PRÓPRIO
   *  sistema de cor, roxo, ver `src/styles/index.css`; o card precisa
   *  mostrar a cor REAL que vai aparecer no site publicado, não a cor de
   *  marca do admin). Mantenha em sincronia com `tokens.css` se um valor
   *  mudar lá. */
  hex: string;
}

/** 4 cores prontas pro botão 1 (CTA primário/afiliado) -- lista fechada
 *  (sem campo de código de cor livre), pedido explícito do handoff. */
export const BUTTON_COLOR_OPTIONS: readonly ButtonColorOption[] = [
  { value: 'green', label: 'Verde', hex: '#0f5934' },
  { value: 'blue-dark', label: 'Azul escuro', hex: '#1d3557' },
  { value: 'orange', label: 'Laranja', hex: '#c2410c' },
  { value: 'red', label: 'Vermelho', hex: '#c0392b' },
];
