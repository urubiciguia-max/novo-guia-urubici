import type { PageFrontmatter, PageRecord } from '@admin-data/index.js';

/**
 * Estado do form de página institucional -- bem mais simples que
 * `PostFormState` (ver `postForm.ts`): sem categoria/capa/autor/draft/data,
 * essa página não tem nada disso (ver spec do Carlito/Genilson). Só os 3
 * campos que `PageFrontmatter` + corpo markdown de fato têm.
 */
export interface PageFormState {
  title: string;
  description: string;
  body: string;
}

/**
 * Converte um `PageRecord` (frontmatter pode estar parcialmente inválido --
 * ver `record.valid`) no estado do form. Mesma coerção defensiva campo a
 * campo do `recordToFormState` de posts, pelo mesmo motivo: quando
 * `valid === false` o shape vindo do client é o YAML cru parseado, não o
 * `PageFrontmatter` validado.
 */
export function recordToPageFormState(record: PageRecord): PageFormState {
  const fm = record.frontmatter as Partial<PageFrontmatter> & Record<string, unknown>;
  return {
    title: typeof fm.title === 'string' ? fm.title : '',
    description: typeof fm.description === 'string' ? fm.description : '',
    body: record.body,
  };
}

/** Shape pro client -- a validação de verdade é `pageFrontmatterSchema.safeParse` antes do submit, isto é só a conversão de forma. */
export function pageFormStateToFrontmatter(form: PageFormState): PageFrontmatter {
  return {
    title: form.title,
    description: form.description,
  };
}
