import { describe, expect, it } from 'vitest';
import { MalformedPostFileError, parsePostFile, serializePostFile } from '../src/markdown.js';

const SAMPLE = `---
title: "Quando ir pra Urubici"
description: "Post de exemplo"
pubDate: 2026-01-15
author: "Equipe Guia de Urubici"
category: "Guia Prático"
tags: ["planejamento", "clima"]
draft: false
legacySlug: "quando-ir-urubici"
relatedSlugs: ["cachoeiras-secretas-urubici"]
---

## Título

Corpo do post.
`;

describe('parsePostFile', () => {
  it('separa frontmatter e corpo', () => {
    const { frontmatter, body } = parsePostFile(SAMPLE);
    expect(frontmatter.title).toBe('Quando ir pra Urubici');
    expect(frontmatter.legacySlug).toBe('quando-ir-urubici');
    expect(body).toContain('## Título');
    expect(body).toContain('Corpo do post.');
  });

  it('normaliza datas YAML (!!timestamp) de volta pra string YYYY-MM-DD', () => {
    const { frontmatter } = parsePostFile(SAMPLE);
    // js-yaml resolveria isso como Date nativo sem a normalização -- garante que não.
    expect(typeof frontmatter.pubDate).toBe('string');
    expect(frontmatter.pubDate).toBe('2026-01-15');
  });

  it('lança MalformedPostFileError se não tiver os delimitadores ---', () => {
    expect(() => parsePostFile('sem frontmatter nenhum')).toThrow(MalformedPostFileError);
  });
});

describe('serializePostFile', () => {
  it('serializa e reparseia preservando os valores', () => {
    const frontmatter = {
      title: 'Teste',
      description: 'Descrição',
      pubDate: '2026-03-01',
      tags: ['a', 'b'],
      draft: false,
      author: 'Equipe',
      category: 'Geral',
      legacySlug: 'teste',
    };
    const out = serializePostFile(frontmatter, 'Corpo aqui.');
    expect(out.startsWith('---\n')).toBe(true);

    const { frontmatter: reparsed, body } = parsePostFile(out);
    expect(reparsed).toMatchObject(frontmatter);
    expect(body.trim()).toBe('Corpo aqui.');
  });

  it('não grava campos opcionais vazios/undefined', () => {
    const frontmatter = {
      title: 'Teste',
      description: 'Descrição',
      pubDate: '2026-03-01',
      updatedDate: undefined,
      tags: [],
      cover: undefined,
      faq: [],
      draft: false,
      author: 'Equipe',
      category: 'Geral',
      legacySlug: 'teste',
    };
    const out = serializePostFile(frontmatter, 'Corpo.');
    expect(out).not.toContain('updatedDate');
    expect(out).not.toContain('cover');
    expect(out).not.toContain('faq');
    // Campo obrigatório com array vazio (tags) continua presente.
    expect(out).toContain('tags: []');
  });

  it('mantém a data como string "YYYY-MM-DD" (sem reformatar pra ISO datetime)', () => {
    const out = serializePostFile(
      {
        title: 'Teste',
        description: 'Descrição',
        pubDate: '2026-03-01',
        tags: [],
        draft: false,
        author: 'Equipe',
        category: 'Geral',
        legacySlug: 'teste',
      },
      'Corpo.'
    );
    // js-yaml grava a string entre aspas (ex: pubDate: '2026-03-01') -- é o
    // dumper evitando que, num próximo parse (nosso ou de outra ferramenta),
    // o valor seja resolvido como `!!timestamp`/Date em vez de string. Mais
    // seguro que o estilo sem aspas que o Decap grava hoje; só cosmético,
    // `parsePostFile` entende os dois formatos igual (ver teste acima).
    expect(out).toMatch(/pubDate:\s*'?2026-03-01'?/);
    expect(out).not.toContain('2026-03-01T00:00:00');
  });
});
