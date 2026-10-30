import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PostRecord } from '@admin-data/index.js';
import { parsePostFile, serializePostFile } from '@admin-data/index.js';
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
    // V3: sem UI de categoria, post legado sem categoria válida cai pro
    // default "Geral" em vez de '' -- não existe mais widget pra corrigir isso na tela.
    expect(form.category).toBe('Geral');
    expect(form.legacySlug).toBe('post-legado'); // sempre o slug da rota, nunca o do frontmatter quebrado
  });
});

describe('V3 -- categoria sem UI de edição (preservação/default fixo)', () => {
  it('post novo (emptyFormState) nasce com category "Geral" já fixado, sem intervenção do usuário', () => {
    const form = emptyFormState();
    expect(form.category).toBe('Geral');
    expect(formStateToFrontmatter(form).category).toBe('Geral');
  });

  it('post existente com categoria diferente de "Geral" é preservado (recordToFormState -> formStateToFrontmatter), não é sobrescrito pelo default', () => {
    const record: PostRecord = {
      slug: 'onde-ficar-fondue',
      frontmatter: {
        title: 'Onde comer fondue',
        description: 'desc',
        pubDate: '2026-01-01',
        tags: [],
        draft: false,
        author: 'Equipe',
        category: 'Onde Comer',
        legacySlug: 'onde-ficar-fondue',
      },
      body: 'corpo',
      sha: 'sha-1',
      valid: true,
    };

    const form = recordToFormState(record, 'onde-ficar-fondue');
    expect(form.category).toBe('Onde Comer');
    expect(formStateToFrontmatter(form).category).toBe('Onde Comer');
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

  it('cover/coverAlt/coverCredit vazios viram undefined, não string vazia', () => {
    const form = emptyFormState();
    const fm = formStateToFrontmatter(form);
    expect(fm.cover).toBeUndefined();
    expect(fm.coverAlt).toBeUndefined();
    expect(fm.coverCredit).toBeUndefined();
  });

  it('faq/affiliates vazios viram undefined (array vazio não é gravado)', () => {
    const form = emptyFormState();
    const fm = formStateToFrontmatter(form);
    expect(fm.faq).toBeUndefined();
    expect(fm.affiliates).toBeUndefined();
    expect(fm.relatedSlugs).toBeUndefined();
  });

  it('preserva faq e affiliates preenchidos (bug original: formStateToFrontmatter não conhecia esses campos)', () => {
    const form = emptyFormState();
    form.faq = [{ question: 'Pergunta?', answer: 'Resposta.' }];
    form.affiliates = [{ label: 'Reserve', url: 'https://booking.com', provider: 'booking' }];
    form.relatedSlugsText = 'post-a, post-b';
    const fm = formStateToFrontmatter(form);
    expect(fm.faq).toEqual([{ question: 'Pergunta?', answer: 'Resposta.' }]);
    expect(fm.affiliates).toEqual([{ label: 'Reserve', url: 'https://booking.com', provider: 'booking' }]);
    expect(fm.relatedSlugs).toEqual(['post-a', 'post-b']);
  });
});

describe('round-trip com post real (regressão do bug de perda de dados)', () => {
  it('editar onde-comer-fondue-urubici.md sem tocar em affiliates preserva affiliates no arquivo salvo', () => {
    const path = resolve(__dirname, '../../../src/content/posts/onde-comer-fondue-urubici.md');
    const raw = readFileSync(path, 'utf-8');
    const parsed = parsePostFile(raw);

    const record: PostRecord = {
      slug: 'onde-comer-fondue-urubici',
      frontmatter: parsed.frontmatter as never,
      body: parsed.body,
      sha: 'fake-sha',
      valid: true,
    };

    // Simula abrir o post no admin e salvar sem mexer em nada.
    const form = recordToFormState(record, 'onde-comer-fondue-urubici');
    const frontmatterOut = formStateToFrontmatter(form);
    const savedFile = serializePostFile(frontmatterOut as never, form.body);
    const reparsed = parsePostFile(savedFile);

    expect(reparsed.frontmatter.affiliates).toEqual(parsed.frontmatter.affiliates);
    expect(reparsed.frontmatter.title).toEqual(parsed.frontmatter.title);
    // V3: affiliates/author/tags perderam a UI de edição nesta tela, mas
    // continuam sendo preservados intactos no save (preservação silenciosa) --
    // é exatamente o teste que a spec da Track A pede pra não repetir o bug.
    expect(reparsed.frontmatter.author).toEqual(parsed.frontmatter.author);
    expect(reparsed.frontmatter.tags).toEqual(parsed.frontmatter.tags);
  });

  it('editar cachoeiras-secretas-urubici.md (tem faq + affiliates + relatedSlugs) sem tocar nesses campos preserva todos', () => {
    const path = resolve(__dirname, '../../../src/content/posts/cachoeiras-secretas-urubici.md');
    const raw = readFileSync(path, 'utf-8');
    const parsed = parsePostFile(raw);

    const record: PostRecord = {
      slug: 'cachoeiras-secretas-urubici',
      frontmatter: parsed.frontmatter as never,
      body: parsed.body,
      sha: 'fake-sha',
      valid: true,
    };

    const form = recordToFormState(record, 'cachoeiras-secretas-urubici');
    const frontmatterOut = formStateToFrontmatter(form);
    const savedFile = serializePostFile(frontmatterOut as never, form.body);
    const reparsed = parsePostFile(savedFile);

    expect(reparsed.frontmatter.faq).toEqual(parsed.frontmatter.faq);
    expect(reparsed.frontmatter.affiliates).toEqual(parsed.frontmatter.affiliates);
    expect(reparsed.frontmatter.relatedSlugs).toEqual(parsed.frontmatter.relatedSlugs);
  });
});
