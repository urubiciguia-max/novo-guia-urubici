import { describe, expect, it } from 'vitest';
import type { PostRecord } from '@admin-data/index.js';
import { emptyFormState, formStateToFrontmatter, recordToFormState } from '../src/lib/postForm';

describe('recordToFormState', () => {
  it('converte um PostRecord válido pro form, forçando legacySlug = slug da rota', () => {
    const record: PostRecord = {
      slug: 'cachoeiras-secretas-urubici',
      frontmatter: {
        title: 'Cachoeiras secretas',
        description: 'desc',
        pubDate: '2026-01-15',
        tags: ['cachoeiras', 'trilhas'],
        draft: false,
        author: 'Equipe',
        category: 'O Que Fazer',
        legacySlug: 'cachoeiras-secretas-urubici',
      },
      body: '## corpo',
      sha: 'sha-1',
      valid: true,
    };

    const form = recordToFormState(record, 'cachoeiras-secretas-urubici');
    expect(form.title).toBe('Cachoeiras secretas');
    expect(form.tagsText).toBe('cachoeiras, trilhas');
    expect(form.legacySlug).toBe('cachoeiras-secretas-urubici');
    expect(form.body).toBe('## corpo');
  });

  it('tolera frontmatter inválido/parcial sem lançar (post legado quebrado)', () => {
    const record: PostRecord = {
      slug: 'post-legado',
      // Simula o shape cru que `getPost` devolve quando `valid: false`.
      frontmatter: { title: 'Só o título', tags: 'nao-e-array' } as never,
      body: 'corpo legado',
      sha: 'sha-1',
      valid: false,
      validationErrors: ['category: Required'],
    };

    expect(() => recordToFormState(record, 'post-legado')).not.toThrow();
    const form = recordToFormState(record, 'post-legado');
    expect(form.title).toBe('Só o título');
    expect(form.tagsText).toBe(''); // tags não é array -> cai pro default seguro
    expect(form.category).toBe('');
    expect(form.legacySlug).toBe('post-legado'); // sempre o slug da rota, nunca o do frontmatter quebrado
  });
});

describe('formStateToFrontmatter', () => {
  it('converte tagsText em array, trimando e removendo vazios', () => {
    const form = emptyFormState();
    form.tagsText = ' cachoeiras ,, trilhas ,roteiro ';
    const fm = formStateToFrontmatter(form);
    expect(fm.tags).toEqual(['cachoeiras', 'trilhas', 'roteiro']);
  });

  it('updatedDate vazio vira undefined, não string vazia', () => {
    const form = emptyFormState();
    form.updatedDate = '   ';
    expect(formStateToFrontmatter(form).updatedDate).toBeUndefined();
  });
});
