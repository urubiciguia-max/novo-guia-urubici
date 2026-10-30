import type { Category, PostFrontmatter, PostRecord } from '@admin-data/index.js';

export interface PostFormState {
  title: string;
  description: string;
  pubDate: string;
  updatedDate: string;
  tagsText: string;
  draft: boolean;
  author: string;
  category: Category | '';
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
    category: '',
    legacySlug: '',
    body: '',
  };
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
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
    category: (typeof fm.category === 'string' ? fm.category : '') as PostFormState['category'],
    legacySlug: routeSlug,
    body: record.body,
  };
}

/** Shape pro client -- a validação de verdade é `postFrontmatterSchema.safeParse` antes do submit, isto é só a conversão de forma. */
export function formStateToFrontmatter(form: PostFormState): PostFrontmatter {
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
    legacySlug: form.legacySlug,
  };
}
