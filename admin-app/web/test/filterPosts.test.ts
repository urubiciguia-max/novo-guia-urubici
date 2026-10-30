import { describe, expect, it } from 'vitest';
import type { PostListItem } from '@admin-data/index.js';
import { EMPTY_FILTER, filterPosts } from '../src/lib/filterPosts';

function item(partial: Partial<PostListItem>): PostListItem {
  return {
    slug: 'slug',
    title: 'Título',
    category: 'Geral',
    author: 'Equipe',
    pubDate: '2026-01-01',
    draft: false,
    legacySlug: 'slug',
    sha: 'sha-1',
    valid: true,
    ...partial,
  };
}

const items: PostListItem[] = [
  item({ slug: 'cachoeiras', title: 'Cachoeiras secretas de Urubici', category: 'O Que Fazer', draft: false }),
  item({ slug: 'restaurantes', title: 'Onde comer em Urubici', category: 'Onde Comer', draft: false }),
  item({ slug: 'neve', title: 'Quando ir pra ver neve', category: 'Guia Prático', draft: true }),
];

describe('filterPosts', () => {
  it('sem filtro devolve tudo', () => {
    expect(filterPosts(items, EMPTY_FILTER)).toHaveLength(3);
  });

  it('busca por título é case-insensitive e parcial', () => {
    const result = filterPosts(items, { ...EMPTY_FILTER, search: 'CACHOEIRA' });
    expect(result.map((i) => i.slug)).toEqual(['cachoeiras']);
  });

  it('filtra por categoria', () => {
    const result = filterPosts(items, { ...EMPTY_FILTER, category: 'Onde Comer' });
    expect(result.map((i) => i.slug)).toEqual(['restaurantes']);
  });

  it('filtra por status publicado', () => {
    const result = filterPosts(items, { ...EMPTY_FILTER, status: 'published' });
    expect(result.map((i) => i.slug)).toEqual(['cachoeiras', 'restaurantes']);
  });

  it('filtra por status rascunho', () => {
    const result = filterPosts(items, { ...EMPTY_FILTER, status: 'draft' });
    expect(result.map((i) => i.slug)).toEqual(['neve']);
  });

  it('combina busca + categoria + status', () => {
    const result = filterPosts(items, { search: 'neve', category: 'Guia Prático', status: 'draft' });
    expect(result.map((i) => i.slug)).toEqual(['neve']);
  });

  it('sem resultado devolve array vazio, não lança', () => {
    const result = filterPosts(items, { ...EMPTY_FILTER, search: 'nada-disso-existe' });
    expect(result).toEqual([]);
  });
});
