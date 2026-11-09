import { describe, expect, it } from 'vitest';
import { handleSubmitComment } from '../_lib/handlers/submit-comment.js';
import { FakeKv } from './helpers/fakeKv.js';
import type { Env } from '../_lib/env.js';
import { buildRateLimitKey } from '../_lib/kv-keys.js';
import { sha256Hex } from '../_lib/hash.js';

function makeRequest(fields: Record<string, string>, opts: { ip?: string } = {}): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const headers: Record<string, string> = {};
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
  return new Request('https://guiadeurubici.com.br/cachoeiras-secretas-urubici', {
    method: 'POST',
    body: form,
    headers,
  });
}

function makeEnv(): { env: Env; kv: FakeKv } {
  const kv = new FakeKv();
  return { env: { COMMENTS_KV: kv as unknown as KVNamespace }, kv };
}

describe('handleSubmitComment', () => {
  it('fluxo feliz: grava pendente no KV e redireciona com sucesso', async () => {
    const { env, kv } = makeEnv();
    const req = makeRequest(
      {
        slug: 'cachoeiras-secretas-urubici',
        name: 'Maria',
        text: 'Lugar incrível, recomendo demais pra quem gosta de trilha!',
        consent: 'on',
      },
      { ip: '203.0.113.42' }
    );

    const res = await handleSubmitComment(req, env);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://guiadeurubici.com.br/cachoeiras-secretas-urubici?comentario=enviado#comentarios'
    );

    const pendingKeys = (await kv.list({ prefix: 'pending:cachoeiras-secretas-urubici:' })).keys;
    expect(pendingKeys).toHaveLength(1);

    const stored = JSON.parse((await kv.get(pendingKeys[0].name))!);
    expect(stored.name).toBe('Maria');
    expect(stored.text).toBe('Lugar incrível, recomendo demais pra quem gosta de trilha!');
    expect(stored.slug).toBe('cachoeiras-secretas-urubici');
    expect(stored.ip).not.toBe('203.0.113.42'); // nunca o IP cru
    expect(stored.ip).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(typeof stored.createdAt).toBe('string');
  });

  it('honeypot preenchido (campo real "website", ver CommentsSection.astro): descarta silenciosamente, sem gravar nada no KV', async () => {
    const { env, kv } = makeEnv();
    const req = makeRequest(
      {
        slug: 'cachoeiras-secretas-urubici',
        name: 'Bot',
        text: 'Mensagem de bot qualquer, nem precisa ser válida.',
        consent: 'on',
        website: 'http://spam.example.com',
      },
      { ip: '203.0.113.42' }
    );

    const res = await handleSubmitComment(req, env);

    expect(res.status).toBe(302);
    // Responde como se tivesse dado certo -- bot não aprende que foi pego.
    expect(res.headers.get('location')).toBe(
      'https://guiadeurubici.com.br/cachoeiras-secretas-urubici?comentario=enviado#comentarios'
    );
    expect(kv.size()).toBe(0);
  });

  it('honeypot preenchido + slug malicioso: nunca faz open redirect', async () => {
    const { env, kv } = makeEnv();
    const req = makeRequest({
      slug: '//evil.example.com',
      name: 'Bot',
      text: 'tentando redirecionar pra fora do site',
      consent: 'on',
      website: 'http://spam.example.com',
    });

    const res = await handleSubmitComment(req, env);

    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location.startsWith('https://guiadeurubici.com.br/')).toBe(true);
    expect(location).not.toContain('evil.example.com');
    expect(kv.size()).toBe(0);
  });

  it('regressão (achado do Severino, 2026-11-09): bot preenchendo o campo REAL do form ("website") é descartado -- handler lia "honeypot", nome que nunca existe no HTML real', async () => {
    const { env, kv } = makeEnv();
    const req = makeRequest({
      slug: 'cachoeiras-secretas-urubici',
      name: 'Bot Disfarcado',
      text: 'Comentário de bot que preencheu o campo "website" (nome real no HTML), não "honeypot".',
      consent: 'on',
      website: 'http://spam.example.com', // nome real do input em CommentsSection.astro
    });

    const res = await handleSubmitComment(req, env);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('comentario=enviado');
    const pendingKeys = (await kv.list({ prefix: 'pending:' })).keys;
    expect(pendingKeys).toHaveLength(0); // nada gravado -- descartado em silêncio, como o design pretendia.
  });

  it('consent ausente: rejeita com motivo=consentimento, sem gravar nada', async () => {
    const { env, kv } = makeEnv();
    const req = makeRequest({
      slug: 'cachoeiras-secretas-urubici',
      name: 'Maria',
      text: 'Comentário válido só que sem marcar o consentimento.',
    });

    const res = await handleSubmitComment(req, env);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('comentario=erro&motivo=consentimento');
    expect(kv.size()).toBe(0);
  });

  it('texto curto demais: rejeita com motivo=invalido', async () => {
    const { env, kv } = makeEnv();
    const req = makeRequest({
      slug: 'cachoeiras-secretas-urubici',
      name: 'Maria',
      text: 'curto',
      consent: 'on',
    });

    const res = await handleSubmitComment(req, env);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('comentario=erro&motivo=invalido');
    expect(kv.size()).toBe(0);
  });

  it('rate limit: acima de 5 submissões/hora do mesmo IP, rejeita com mensagem genérica e não grava pendente', async () => {
    const { env, kv } = makeEnv();
    const ip = '203.0.113.42';
    const ipHash = await sha256Hex(ip);
    await kv.put(buildRateLimitKey(ipHash), '5');

    const req = makeRequest(
      {
        slug: 'cachoeiras-secretas-urubici',
        name: 'Maria',
        text: 'Mais um comentário válido, mas já estourei a cota da hora.',
        consent: 'on',
      },
      { ip }
    );

    const res = await handleSubmitComment(req, env);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('comentario=erro&motivo=limite');
    const pendingKeys = (await kv.list({ prefix: 'pending:' })).keys;
    expect(pendingKeys).toHaveLength(0);
  });

  it('rate limit: na 5a submissão válida ainda aceita, e incrementa o contador', async () => {
    const { env, kv } = makeEnv();
    const ip = '203.0.113.42';
    const ipHash = await sha256Hex(ip);
    await kv.put(buildRateLimitKey(ipHash), '4');

    const req = makeRequest(
      {
        slug: 'cachoeiras-secretas-urubici',
        name: 'Maria',
        text: 'Comentário dentro da cota ainda, deve passar normal.',
        consent: 'on',
      },
      { ip }
    );

    const res = await handleSubmitComment(req, env);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('comentario=enviado');
    expect(await kv.get(buildRateLimitKey(ipHash))).toBe('5');
  });
});
