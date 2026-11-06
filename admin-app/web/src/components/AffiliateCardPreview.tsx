import {
  badgeIconEmoji,
  BUTTON_COLOR_OPTIONS,
  type AffiliateCardFormValue,
} from '../lib/affiliateCardShared';

export interface AffiliateCardPreviewProps {
  value: AffiliateCardFormValue;
  /** Sobrescreve `value.image` quando presente -- usado pelo
   *  `AffiliateCardDialog` enquanto uma imagem recém-selecionada ainda não
   *  foi confirmada (object URL local do blob comprimido, mesmo padrão do
   *  `ImageDialog`). Sem isso, a prévia usaria `value.image`, que só é
   *  preenchido DEPOIS do upload terminar. */
  imageSrc?: string;
}

/**
 * Prévia visual do bloco "Card de Afiliado" -- COMPONENTE COMPARTILHADO
 * entre o `NodeView` do editor (`lib/affiliateCardNode.tsx`, prévia ao vivo
 * dentro do corpo rich-text) e o próprio `AffiliateCardDialog` (prévia
 * compacta enquanto o usuário preenche o formulário). Fidelidade visual aos
 * prints é requisito explícito do handoff -- NÃO é um placeholder cinza.
 *
 * Cores reais do SITE PUBLICADO (não do admin, que tem seu próprio sistema
 * roxo, ver topo de `src/styles/index.css`) -- ver `BUTTON_COLOR_OPTIONS` em
 * `lib/affiliateCardShared.ts` e o selo escuro abaixo (`#353b3e`, mesmo hex
 * de `--charcoal` em `src/styles/tokens.css` do site). Qualquer mudança de
 * marca lá precisa ser espelhada aqui manualmente (dois sistemas de design
 * distintos, admin x site publicado).
 */
export function AffiliateCardPreview({ value, imageSrc }: AffiliateCardPreviewProps) {
  const color = BUTTON_COLOR_OPTIONS.find((option) => option.value === value.button1Color) ?? BUTTON_COLOR_OPTIONS[0];
  const src = imageSrc ?? value.image;

  return (
    <div className={`affiliate-card-preview affiliate-card-preview--${value.layout}`}>
      <div className="affiliate-card-preview__media">
        {src ? (
          <img src={src} alt={value.imageAlt} />
        ) : (
          <span className="affiliate-card-preview__media-placeholder" aria-hidden="true">
            🖼️
          </span>
        )}
      </div>
      <div className="affiliate-card-preview__body">
        <span className="affiliate-card-preview__badge">
          <span aria-hidden="true">{badgeIconEmoji(value.badgeIcon)}</span>
          {value.badgeText || 'TEXTO DO SELO'}
        </span>
        <p className="affiliate-card-preview__title">{value.title || 'Título do card'}</p>
        <div className="affiliate-card-preview__actions">
          <span className="affiliate-card-preview__btn affiliate-card-preview__btn--primary" style={{ background: color.hex }}>
            {value.button1Text || 'Botão principal'}
          </span>
          {value.button2Text && <span className="affiliate-card-preview__btn affiliate-card-preview__btn--secondary">{value.button2Text}</span>}
        </div>
        {value.tip && (
          <p className="affiliate-card-preview__tip">
            <strong>Dica:</strong> {value.tip}
          </p>
        )}
      </div>
    </div>
  );
}
