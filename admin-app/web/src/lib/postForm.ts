import type { AffiliateLink, AffiliateProvider, Category, FaqItem, PostFrontmatter, PostRecord } from '@admin-data/index.js';

/**
 * Shape de afiliado no form -- igual a `AffiliateLink`, exceto `provider`
 * que aceita `''` enquanto a linha está sem seleção (select vazio). A
 * validação de verdade (`provider` precisa ser um dos `AFFILIATE_PROVIDERS`)
 * acontece no `postFrontmatterSchema.safeParse` no submit, não aqui.
 */
export interface AffiliateFormItem {
  label: string;
  url: string;
  provider: AffiliateProvider | '';
}

export interface PostFormState {
  title: string;
  description: string;
  pubDate: string;
  updatedDate: string;
  tagsText: string;
  draft: boolean;
  author: string;
  category: Category | '';
  cover: string;
  coverAlt: string;
  coverCredit: string;
  faq: FaqItem[];
  affiliates: AffiliateFormItem[];
  relatedSlugsText: string;
  legacySlug: string;
  body: string;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyFormState(): PostFormState {
  return {
    title: '',
    description: '',
    pubDate: todayIso(),
    updatedDate: '',
    tagsText: '',
    draft: true,
    author: 'Equipe Guia de Urubici',
    // Post novo: UI de categoria saiu do form (V3), então o default fixo é
    // decidido aqui -- "Geral" é valor válido do enum (ver `CATEGORIES`) e
    // não afeta nenhuma listagem (`guia-pratico`/`o-que-fazer` filtram por
    // categoria específica, nenhuma página lista especificamente "Geral").
    category: 'Geral',
    cover: '',
    coverAlt: '',
    coverCredit: '',
    faq: [],
    affiliates: [],
    relatedSlugsText: '',
    legacySlug: '',
    body: '',
  };
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Leitura defensiva de um item de `faq` vindo de YAML cru -- mesma lógica de "filtra, não assume shape" já usada pra `tags`. */
function isFaqItem(value: unknown): value is FaqItem {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).question === 'string' &&
    typeof (value as Record<string, unknown>).answer === 'string'
  );
}

/** Idem, pra item de `affiliates`. `provider` só precisa ser string aqui -- validação do enum é no zod do submit. */
function isAffiliateItem(value: unknown): value is { label: string; url: string; provider: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).label === 'string' &&
    typeof (value as Record<string, unknown>).url === 'string' &&
    typeof (value as Record<string, unknown>).provider === 'string'
  );
}

/**
 * Converte um `PostRecord` (frontmatter pode estar parcialmente inválido --
 * ver `record.valid`) no estado do form. Coerção defensiva campo a campo
 * porque, quando `valid === false`, o shape vindo do client é o YAML cru
 * parseado, não o `PostFrontmatter` validado -- qualquer campo pode faltar
 * ou ter o tipo errado.
 *
 * `routeSlug` SEMPRE vence pro campo `legacySlug` em edição -- é o nome do
 * arquivo (imutável nesta tela), não o que porventura esteja gravado (e
 * possivelmente errado/vazio) no frontmatter. Ver nota de integridade em
 * `PostFormPage.tsx`.
 */
export function recordToFormState(record: PostRecord, routeSlug: string): PostFormState {
  const fm = record.frontmatter as Partial<PostFrontmatter> & Record<string, unknown>;
  return {
    title: str(fm.title),
    description: str(fm.description),
    pubDate: str(fm.pubDate, todayIso()),
    updatedDate: str(fm.updatedDate),
    tagsText: Array.isArray(fm.tags) ? fm.tags.filter((t): t is string => typeof t === 'string').join(', ') : '',
    draft: typeof fm.draft === 'boolean' ? fm.draft : false,
    author: str(fm.author, 'Equipe Guia de Urubici'),
    // Post existente: preserva a categoria atual do frontmatter (sem UI de
    // edição) -- só cai pro default "Geral" se o post legado estiver sem
    // categoria válida (frontmatter quebrado), nunca sobrescreve uma
    // categoria já publicada (ex: "Onde Comer").
    category: (typeof fm.category === 'string' ? fm.category : 'Geral') as PostFormState['category'],
    cover: str(fm.cover),
    coverAlt: str(fm.coverAlt),
    coverCredit: str(fm.coverCredit),
    faq: Array.isArray(fm.faq)
      ? fm.faq.filter(isFaqItem).map((item) => ({ question: item.question, answer: item.answer }))
      : [],
    affiliates: Array.isArray(fm.affiliates)
      ? fm.affiliates.filter(isAffiliateItem).map((item) => ({
          label: item.label,
          url: item.url,
          provider: item.provider as AffiliateFormItem['provider'],
        }))
      : [],
    relatedSlugsText: Array.isArray(fm.relatedSlugs)
      ? fm.relatedSlugs.filter((s): s is string => typeof s === 'string').join(', ')
      : '',
    legacySlug: routeSlug,
    body: record.body,
  };
}

/** Shape pro client -- a validação de verdade é `postFrontmatterSchema.safeParse` antes do submit, isto é só a conversão de forma. */
export function formStateToFrontmatter(form: PostFormState): PostFrontmatter {
  const relatedSlugs = form.relatedSlugsText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    title: form.title,
    description: form.description,
    pubDate: form.pubDate,
    updatedDate: form.updatedDate.trim() === '' ? undefined : form.updatedDate.trim(),
    tags: form.tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    draft: form.draft,
    author: form.author,
    category: form.category as PostFrontmatter['category'],
    cover: form.cover.trim() === '' ? undefined : form.cover.trim(),
    coverAlt: form.coverAlt.trim() === '' ? undefined : form.coverAlt.trim(),
    coverCredit: form.coverCredit.trim() === '' ? undefined : form.coverCredit.trim(),
    faq: form.faq.length === 0 ? undefined : form.faq,
    affiliates: form.affiliates.length === 0 ? undefined : (form.affiliates as AffiliateLink[]),
    relatedSlugs: relatedSlugs.length === 0 ? undefined : relatedSlugs,
    legacySlug: form.legacySlug,
  };
}
