import { describe, expect, it } from 'vitest';
import { postFrontmatterSchema } from '../src/schema.js';

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
