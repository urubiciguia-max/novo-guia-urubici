/**
 * Tipos da collection `posts`, espelhando `src/content/config.ts` (fonte de
 * verdade do schema -- ler lá antes de mudar aqui).
 *
 * Duas diferenças deliberadas em relação ao schema do Astro, documentadas
 * em `.agents/notes/jurandir.md`:
 *
 * 1. `cover`: no Astro usa o helper `image()` (pipeline de build, não existe
 *    fora do Astro). Aqui é só a string do caminho relativo gravado no
 *    frontmatter (ex: "./foto.jpg") -- a SPA não processa a imagem, só grava
 *    o path.
 * 2. `pubDate` / `updatedDate`: no Astro é `z.coerce.date()` (vira `Date` em
 *    build-time). Aqui ficam como `string` ("YYYY-MM-DD", o formato que o
 *    Decap já grava e que `date_format` em config.yml usa) -- o client lê e
 *    escreve texto YAML, nunca deveria carregar um `Date` nativo, porque ao
 *    serializar de volta isso reformata a data (ganha hora/timezone) e gera
 *    diff desnecessário no commit. A validação de formato é feita em
 *    `schema.ts` com um regex, não com coerção de tipo.
 */

export const CATEGORIES = ['Geral', 'Guia Prático', 'O Que Fazer', 'Onde Comer'] as const;
export type Category = (typeof CATEGORIES)[number];

export const AFFILIATE_PROVIDERS = ['amazon', 'booking', 'rentcars', 'mercadolivre', 'outro'] as const;
export type AffiliateProvider = (typeof AFFILIATE_PROVIDERS)[number];

export interface FaqItem {
  question: string;
  answer: string;
}

export interface AffiliateLink {
  label: string;
  url: string;
  provider: AffiliateProvider;
}

/** Shape completo do frontmatter de um post -- usado em create/update. */
export interface PostFrontmatter {
  title: string;
  description: string;
  /** "YYYY-MM-DD" */
  pubDate: string;
  /** "YYYY-MM-DD", opcional */
  updatedDate?: string;
  tags: string[];
  /** Caminho relativo gravado no frontmatter, ex: "./foto.jpg". */
  cover?: string;
  coverAlt?: string;
  draft: boolean;
  author: string;
  category: Category;
  faq?: FaqItem[];
  affiliates?: AffiliateLink[];
  relatedSlugs?: string[];
  legacySlug: string;
}

/**
 * Projeção leve de um post pra Dashboard (stats) e tabela de Artigos --
 * é o que `listPosts()` devolve. Não inclui `body` nem `faq`/`affiliates`
 * (a tabela/dashboard não precisa, e carregar tudo só pra listar seria
 * desperdício de payload).
 */
export interface PostListItem {
  /** Nome do arquivo sem `.md` -- é o `legacySlug`, por convenção do projeto. */
  slug: string;
  title: string;
  category: Category | null;
  author: string | null;
  pubDate: string | null;
  updatedDate?: string | null;
  draft: boolean;
  legacySlug: string | null;
  /** SHA do blob no git -- mesmo valor que `getPost`/update/delete esperam. */
  sha: string;
  /**
   * `false` quando o frontmatter do arquivo não passou na validação Zod
   * (arquivo escrito à mão, migração antiga, bug). A listagem NUNCA quebra
   * por causa de um post malformado -- ele aparece com `valid: false` e
   * `validationErrors`, pra UI avisar o editor em vez de derrubar o
   * dashboard inteiro. Ver decisão em `.agents/notes/jurandir.md`.
   */
  valid: boolean;
  validationErrors?: string[];
}

/** Retorno de `getPost()` -- post completo pronto pra edição. */
export interface PostRecord {
  slug: string;
  frontmatter: PostFrontmatter;
  body: string;
  /** SHA do blob -- obrigatório em `updatePost`/`deletePost` (otimistic lock). */
  sha: string;
  /** `false` quando o frontmatter não bateu com o schema -- post ainda é editável, mas a UI deve avisar antes de salvar. */
  valid: boolean;
  validationErrors?: string[];
}

export interface WriteResult {
  /** Novo SHA do blob, pra guardar e usar no próximo update. */
  sha: string;
  /** SHA do commit criado. */
  commitSha: string;
}
