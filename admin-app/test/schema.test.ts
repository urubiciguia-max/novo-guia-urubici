import { describe, expect, it } from 'vitest';
import { pageFrontmatterSchema, postFrontmatterSchema } from '../src/schema.js';

const VALID = {
  title: 'Título válido',
  description: 'Descrição válida',
  pubDate: '2026-01-15',
  tags: ['a'],
  draft: false,
  author: 'Equipe Guia de Urubici',
  category: 'Geral',
  legacySlug: 'slug-valido',
};

describe('postFrontmatterSchema', () => {
  it('aceita um frontmatter válido mínimo', () => {
    const result = postFrontmatterSchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it('rejeita category fora do enum', () => {
    const result = postFrontmatterSchema.safeParse({ ...VALID, category: 'Inexistente' });
    expect(result.success).toBe(false);
  });

  it('rejeita pubDate fora do formato YYYY-MM-DD', () => {
    const result = postFrontmatterSchema.safeParse({ ...VALID, pubDate: '15/01/2026' });
    expect(result.success).toBe(false);
  });

  it('rejeita legacySlug com maiúscula/acento/espaço', () => {
    expect(postFrontmatterSchema.safeParse({ ...VALID, legacySlug: 'Slug Errado' }).success).toBe(false);
    expect(postFrontmatterSchema.safeParse({ ...VALID, legacySlug: 'slug-ótimo' }).success).toBe(false);
  });

  it('rejeita title acima de 90 caracteres', () => {
    const result = postFrontmatterSchema.safeParse({ ...VALID, title: 'a'.repeat(91) });
    expect(result.success).toBe(false);
  });

  it('aceita cover como string simples (não usa o helper image() do Astro)', () => {
    const result = postFrontmatterSchema.safeParse({ ...VALID, cover: './foto.jpg' });
    expect(result.success).toBe(true);
  });

  it('aceita coverCredit como string opcional', () => {
    const result = postFrontmatterSchema.safeParse({
      ...VALID,
      cover: './foto.jpg',
      coverAlt: 'Vista da cachoeira',
      coverCredit: 'Foto: João Silva/Unsplash',
    });
    expect(result.success).toBe(true);
  });

  it('aceita frontmatter sem coverCredit (campo opcional, igual coverAlt)', () => {
    const result = postFrontmatterSchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it('valida affiliates.url como URL http(s)', () => {
    const result = postFrontmatterSchema.safeParse({
      ...VALID,
      affiliates: [{ label: 'Compre', url: 'not-a-url', provider: 'amazon' }],
    });
    expect(result.success).toBe(false);
  });
});

const VALID_PAGE = {
  title: 'Sobre o Guia Urubici',
  description: 'Conheça o Guia Urubici.',
};

describe('pageFrontmatterSchema', () => {
  it('aceita um frontmatter de página válido mínimo', () => {
    expect(pageFrontmatterSchema.safeParse(VALID_PAGE).success).toBe(true);
  });

  it('rejeita title vazio', () => {
    expect(pageFrontmatterSchema.safeParse({ ...VALID_PAGE, title: '' }).success).toBe(false);
  });

  it('rejeita title acima de 90 caracteres', () => {
    expect(pageFrontmatterSchema.safeParse({ ...VALID_PAGE, title: 'a'.repeat(91) }).success).toBe(false);
  });

  it('rejeita description acima de 160 caracteres', () => {
    expect(pageFrontmatterSchema.safeParse({ ...VALID_PAGE, description: 'a'.repeat(161) }).success).toBe(false);
  });

  it('rejeita frontmatter sem description', () => {
    const { description, ...withoutDescription } = VALID_PAGE;
    expect(pageFrontmatterSchema.safeParse(withoutDescription).success).toBe(false);
  });

  it('não aceita campos de post (pubDate/category/legacySlug não fazem parte do schema, mas não são obrigatórios aqui)', () => {
    // pageFrontmatterSchema não tem .strict() -- campos extras são ignorados
    // pelo zod por padrão, então isso só confirma que title+description bastam.
    const result = pageFrontmatterSchema.safeParse(VALID_PAGE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toEqual(['title', 'description']);
    }
  });
});
