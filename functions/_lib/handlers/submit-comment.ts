import type { Env } from '../env.js';
import { isValidSlug } from '../slug.js';
import { validateSubmissionFields } from '../validation.js';
import { sha256Hex } from '../hash.js';
import { generatePendingId } from '../id.js';
import { buildPendingKey, buildRateLimitKey } from '../kv-keys.js';
import type { PendingComment } from '../types.js';

const RATE_LIMIT_MAX_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

/**
 * Monta a URL de redirect a partir de um `slug` -- SEMPRE validado com
 * `isValidSlug` antes de entrar aqui (é por isso que recebe `safeSlug`
 * já pronto, nunca o valor cru do form). Sem essa validação, um `slug`
 * malicioso tipo `//evil.com` virando `Location: //evil.com/...` seria um
 * open redirect (`new URL('//x', base)` resolve pra origem `x`, não pra um
 * path relativo) -- achado ao desenhar este handler, documentado no
 * relatório do Jurandir (2026-11-09).
 */
function redirectTo(request: Request, safeSlugOrPath: string, query: string): Response {
  const url = new URL(`${safeSlugOrPath}${query}`, request.url);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

function safeBackPath(rawSlug: string): string {
  return isValidSlug(rawSlug) ? `/${rawSlug}` : '/';
}

/**
 * Handler puro (recebe `Request`/`Env`, sem depender dos tipos
 * `PagesFunction`/`EventContext` do Cloudflare) -- `functions/api/comments.ts`
 * só repassa `context.request`/`context.env`. Mantém isso testável em
 * vitest com um `Request` real (Web standard, disponível nativamente a
 * partir do Node 18+) e um `env.COMMENTS_KV` mockado na mão, sem precisar
 * simular o runtime do Workers.
 *
 * Contrato (ver documentação da API no relatório final): POST
 * `application/x-www-form-urlencoded` (form HTML tradicional, sem JS
 * obrigatório), campos `slug`, `name`, `text`, `consent`, `website`
 * (honeypot -- nome deliberadamente "atraente" pra autofill de bot, ver
 * `CommentsSection.astro`; NÃO é o campo literal "honeypot" -- um nome óbvio
 * assim um bot sofisticado reconhece e evita preencher).
 * Sempre responde com 302 -- nunca 200 com corpo -- pra funcionar com
 * progressive enhancement (formulário sem JS navega normal).
 */
export async function handleSubmitComment(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirectTo(request, '/', '?comentario=erro&motivo=invalido');
  }

  const rawSlug = String(form.get('slug') ?? '');
  const backPath = safeBackPath(rawSlug);
  // Campo real no HTML se chama `website` (não `honeypot`, de propósito --
  // ver `CommentsSection.astro`: nome "atraente" pra autofill de bot). Bug
  // original (achado do Severino, 2026-11-09): este handler lia
  // `form.get('honeypot')`, que nunca existe no form real, então a
  // armadilha nunca disparava -- fix aqui é ler o nome certo.
  const honeypot = String(form.get('website') ?? '').trim();

  // Honeypot: campo escondido que só um bot preenche. DESCARTA
  // SILENCIOSAMENTE -- responde como se tivesse dado certo, SEM gravar
  // nada no KV e SEM gastar cota de rate limit, de propósito: não
  // queremos ensinar o bot (por tentativa e erro) qual campo o denunciou.
  if (honeypot.length > 0) {
    return redirectTo(request, backPath, '?comentario=enviado#comentarios');
  }

  const consent = form.get('consent');
  if (consent !== 'on') {
    return redirectTo(request, backPath, '?comentario=erro&motivo=consentimento#comentarios');
  }

  const validation = validateSubmissionFields({
    slug: rawSlug,
    name: form.get('name'),
    text: form.get('text'),
  });
  if (!validation.ok || !validation.data) {
    return redirectTo(request, backPath, '?comentario=erro&motivo=invalido#comentarios');
  }
  const { slug, name, text } = validation.data;

  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  const ipHash = await sha256Hex(ip);
  const rateLimitKey = buildRateLimitKey(ipHash);

  // Rate limit simples por IP (hash) na última hora. Trade-off assumido
  // (documentado no relatório): não é uma janela deslizante perfeita --
  // cada submissão aceita REINICIA o TTL de 1h -- e KV é eventualmente
  // consistente entre PoPs, então um ataque bem distribuído poderia
  // passar ligeiramente de 5/hora. Suficiente pro volume de spam esperado
  // num blog regional; se um dia precisar de precisão real, migra pra
  // Durable Objects (contador atômico) -- não vale a complexidade hoje.
  const currentCountRaw = await env.COMMENTS_KV.get(rateLimitKey);
  const currentCount = currentCountRaw ? Number.parseInt(currentCountRaw, 10) || 0 : 0;
  if (currentCount >= RATE_LIMIT_MAX_PER_HOUR) {
    // Mensagem genérica de propósito -- não revela que foi especificamente rate limit (ver spec).
    return redirectTo(request, `/${slug}`, '?comentario=erro&motivo=limite#comentarios');
  }

  const pending: PendingComment = {
    id: generatePendingId(),
    slug,
    name,
    text,
    createdAt: new Date().toISOString(),
    ip: ipHash,
  };

  try {
    await env.COMMENTS_KV.put(buildPendingKey(slug, pending.id), JSON.stringify(pending));
    // Incrementa a cota DEPOIS de persistir o comentário -- se o `put`
    // acima falhasse, a submissão inteira falhou; não faz sentido gastar
    // a cota do IP por um comentário que não foi salvo.
    await env.COMMENTS_KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  } catch {
    return redirectTo(request, `/${slug}`, '?comentario=erro&motivo=servidor#comentarios');
  }

  return redirectTo(request, `/${slug}`, '?comentario=enviado#comentarios');
}
