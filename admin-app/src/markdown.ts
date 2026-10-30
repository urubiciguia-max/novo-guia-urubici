import yaml from 'js-yaml';

/**
 * Parser/serializador de arquivo `.md` com frontmatter (formato "frontmatter"
 * do Decap, mesmo que já existe em `src/content/posts/*.md`). Implementação
 * própria em vez de `gray-matter`: controla explicitamente o tratamento de
 * datas (ver abaixo) e mantém a dependência externa só em `js-yaml`.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export class MalformedPostFileError extends Error {
  constructor() {
    super('Arquivo não tem o formato esperado (frontmatter YAML entre "---").');
  }
}

/**
 * `js-yaml` (schema padrão, YAML core) resolve `pubDate: 2026-01-15` sem
 * aspas como um `!!timestamp` -> `Date` nativo automaticamente. Isso é
 * exatamente o que NÃO queremos aqui (ver nota em types.ts) -- então
 * qualquer `Date` que sair do parser é convertido de volta pra string
 * "YYYY-MM-DD" (ou ISO completo se tinha horário, embora o projeto só use
 * `time_format: false`).
 */
function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeDates);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeDates(v);
    }
    return out;
  }
  return value;
}

export interface ParsedPostFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parsePostFile(raw: string): ParsedPostFile {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new MalformedPostFileError();
  }
  const [, frontmatterBlock, rest] = match;
  const loaded = yaml.load(frontmatterBlock);
  const frontmatter = normalizeDates(loaded ?? {}) as Record<string, unknown>;
  return { frontmatter, body: rest.replace(/^\n/, '') };
}

/**
 * Ordem fixa dos campos no YAML de saída -- mesma ordem de
 * `public/admin/config.yml`, pra o arquivo ficar legível e os diffs dos
 * commits não ficarem embaralhados independente de qual admin (Decap ou o
 * novo) escreveu por último.
 */
const FIELD_ORDER = [
  'title',
  'description',
  'pubDate',
  'updatedDate',
  'tags',
  'cover',
  'coverAlt',
  'draft',
  'author',
  'category',
  'faq',
  'affiliates',
  'relatedSlugs',
  'legacySlug',
] as const;

/** Remove campos `undefined` e arrays/strings vazios opcionais, pra não gravar lixo tipo `updatedDate: ` ou `faq: []` no frontmatter. */
function pruneEmpty(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const required = new Set(['title', 'description', 'pubDate', 'tags', 'draft', 'author', 'category', 'legacySlug']);
  const out: Record<string, unknown> = {};
  for (const key of FIELD_ORDER) {
    if (!(key in frontmatter)) continue;
    const value = frontmatter[key];
    if (!required.has(key)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (value === '') continue;
    }
    out[key] = value;
  }
  // Campos fora da lista conhecida (não deveria acontecer pós-validação Zod,
  // mas não descarta silenciosamente dado que o usuário não mandou gravar).
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!(key in out) && !FIELD_ORDER.includes(key as (typeof FIELD_ORDER)[number])) {
      out[key] = value;
    }
  }
  return out;
}

export function serializePostFile(frontmatter: Record<string, unknown>, body: string): string {
  const pruned = pruneEmpty(frontmatter);
  const yamlBlock = yaml.dump(pruned, { lineWidth: -1 });
  const trimmedBody = body.replace(/\s+$/, '');
  return `---\n${yamlBlock}---\n\n${trimmedBody}\n`;
}
