import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PageRecord } from '@admin-data/index.js';
import { parsePageFile, serializePageFile } from '@admin-data/index.js';
import { pageFormStateToFrontmatter, recordToPageFormState } from '../src/lib/pageForm';

describe('recordToPageFormState', () => {
  it('converte um PageRecord válido pro form', () => {
    const record: PageRecord = {
      slug: 'sobre-nos',
      frontmatter: { title: 'Sobre o Guia Urubici', description: 'desc' },
      body: '## corpo',
      sha: 'sha-1',
      valid: true,
    };

    const form = recordToPageFormState(record);
    expect(form.title).toBe('Sobre o Guia Urubici');
    expect(form.description).toBe('desc');
    expect(form.body).toBe('## corpo');
  });

  it('tolera frontmatter inválido/parcial sem lançar (frontmatter quebrado)', () => {
    const record: PageRecord = {
      slug: 'pagina-quebrada',
      // Simula o shape cru que `getPage` devolve quando `valid: false`.
      frontmatter: { title: 123 } as never,
      body: 'corpo',
      sha: 'sha-1',
      valid: false,
      validationErrors: ['title: Expected string, received number'],
    };

    expect(() => recordToPageFormState(record)).not.toThrow();
    const form = recordToPageFormState(record);
    expect(form.title).toBe(''); // title não é string -> cai pro default seguro
    expect(form.description).toBe('');
  });
});

describe('pageFormStateToFrontmatter', () => {
  it('converte o form de volta pro frontmatter (shape simples, sem campos extras)', () => {
    const fm = pageFormStateToFrontmatter({ title: 'Contato', description: 'Fale com a gente', body: 'x' });
    expect(fm).toEqual({ title: 'Contato', description: 'Fale com a gente' });
  });
});

describe('round-trip com as 4 páginas reais (garante que editar sem mudar nada preserva o arquivo)', () => {
  const slugs = ['sobre-nos', 'contato', 'politica-de-privacidade', 'termos-de-uso'];

  it.each(slugs)('%s.md sem tocar em nada preserva title/description/corpo', (slug) => {
    const path = resolve(__dirname, `../../../src/content/pages/${slug}.md`);
    const raw = readFileSync(path, 'utf-8');
    const parsed = parsePageFile(raw);

    const record: PageRecord = {
      slug,
      frontmatter: parsed.frontmatter as never,
      body: parsed.body,
      sha: 'fake-sha',
      valid: true,
    };

    const form = recordToPageFormState(record);
    const frontmatterOut = pageFormStateToFrontmatter(form);
    const savedFile = serializePageFile(frontmatterOut as never, form.body);
    const reparsed = parsePageFile(savedFile);

    expect(reparsed.frontmatter.title).toEqual(parsed.frontmatter.title);
    expect(reparsed.frontmatter.description).toEqual(parsed.frontmatter.description);
    expect(reparsed.body).toEqual(parsed.body);
  });
});
