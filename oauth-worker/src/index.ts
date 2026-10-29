/**
 * OAuth provider pro Decap CMS (backend "github") — Guia Urubici.
 *
 * Fluxo padrao que o Decap CMS espera de um backend `github` com `base_url`
 * customizado (mesmo protocolo do "netlify-cms-oauth-provider" de referencia
 * da comunidade, implementado aqui sem dependencias, direto nas APIs nativas
 * do runtime de Workers):
 *
 *  1. CMS abre popup em `${base_url}/auth` -> este Worker redireciona pro
 *     GitHub OAuth authorize, com um `state` aleatorio guardado num cookie
 *     HttpOnly (protecao CSRF — sem KV, sem sessao, so o cookie).
 *  2. Usuario autoriza no GitHub -> GitHub chama `${base_url}/callback` com
 *     `code` + `state`.
 *  3. Este Worker confere `state` (cookie == query string), troca o `code`
 *     pelo `access_token` direto com o GitHub (client_secret so e usado
 *     aqui, server-side, nunca retorna pro browser).
 *  4. Retorna uma pagina HTML minima (a mesma aba do popup) que faz o
 *     handshake de `postMessage` com a janela que abriu o popup (o admin do
 *     Decap) e so entrega o token depois de validar a ORIGEM de quem
 *     respondeu o handshake contra uma allowlist — ver `isAllowedOrigin`.
 *
 * Seguranca (ver nota de handoff pro Severino antes de ir pro ar):
 *  - `client_secret` nunca sai deste Worker (so no POST server-to-server pro
 *    GitHub) e nunca e logado.
 *  - O token final SO e enviado via postMessage pra uma origem que bateu
 *    com `ALLOWED_ORIGINS` (allowlist, env var) — nao usa `*` no postMessage
 *    final (so no primeiro handshake, que nao carrega segredo nenhum).
 *  - `state` em cookie HttpOnly + Secure + SameSite=Lax, de uso unico
 *    (limpo no callback), TTL curto (10 min).
 */

export interface Env {
  /** GitHub OAuth App — client id (nao e segredo, mas mesmo assim via env var). */
  GITHUB_CLIENT_ID: string;
  /** GitHub OAuth App — client secret. Setar via `wrangler secret put GITHUB_CLIENT_SECRET`. NUNCA hardcode. */
  GITHUB_CLIENT_SECRET: string;
  /**
   * Lista separada por virgula de origens permitidas a receber o token via
   * postMessage. Suporta wildcard de subdominio com prefixo "*." (ex:
   * "*.novo-guia-urubici.pages.dev" cobre os deploys de preview do
   * Cloudflare Pages). Exemplo completo:
   * "https://novo-guia-urubici.pages.dev,*.novo-guia-urubici.pages.dev,https://www.guiaurubici.com.br"
   */
  ALLOWED_ORIGINS: string;
}

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEFAULT_SCOPE = 'repo,user';
const STATE_COOKIE = 'decap_oauth_state';
const PROVIDER = 'github';

function randomState(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function htmlResponse(body: string, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...extraHeaders },
  });
}

/**
 * Parseia a allowlist de ALLOWED_ORIGINS e devolve em formato que o script
 * client-side consegue avaliar sem `eval`: lista de origens exatas + lista
 * de sufixos de dominio (pra wildcard "*.dominio").
 */
function parseAllowlist(raw: string): { exact: string[]; suffixes: string[] } {
  const exact: string[] = [];
  const suffixes: string[] = [];
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (entry.startsWith('*.')) {
      suffixes.push(entry.slice(1)); // guarda ".dominio.com"
    } else {
      exact.push(entry);
    }
  }
  return { exact, suffixes };
}

/**
 * Pagina que roda dentro do popup. Implementa o handshake padrao do Decap:
 * o popup avisa a janela-mae que esta pronto (`authorizing:github`, sem
 * segredo, pode ir pra qualquer origem); a janela-mae responde ecoando a
 * mesma mensagem; o popup usa a ORIGEM dessa resposta pra decidir se confia
 * em quem esta do outro lado antes de mandar o payload final (token, no
 * caso de sucesso; mensagem de erro, no caso de falha).
 */
function renderPopupPage(
  status: 'success' | 'error',
  payload: Record<string, unknown>,
  allowlist: { exact: string[]; suffixes: string[] }
): string {
  const finalMessage = `authorization:${PROVIDER}:${status}:${JSON.stringify(payload)}`;

  return `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8" /><title>Guia Urubici — autenticando</title></head>
  <body>
    <p style="font-family: system-ui, sans-serif; padding: 24px;">
      ${status === 'success' ? 'Autenticado. Pode fechar esta janela.' : 'Falha na autenticação. Pode fechar esta janela e tentar novamente.'}
    </p>
    <script>
      (function () {
        var ALLOWED_EXACT = ${JSON.stringify(allowlist.exact)};
        var ALLOWED_SUFFIXES = ${JSON.stringify(allowlist.suffixes)};
        var FINAL_MESSAGE = ${JSON.stringify(finalMessage)};

        function isAllowedOrigin(origin) {
          if (ALLOWED_EXACT.indexOf(origin) !== -1) return true;
          for (var i = 0; i < ALLOWED_SUFFIXES.length; i++) {
            try {
              var host = new URL(origin).hostname;
              if (host.endsWith(ALLOWED_SUFFIXES[i])) return true;
            } catch (e) {
              /* origem malformada, ignora */
            }
          }
          return false;
        }

        function receiveMessage(e) {
          if (!isAllowedOrigin(e.origin)) return; // origem nao confiavel, ignora silenciosamente
          if (!window.opener) return;
          window.opener.postMessage(FINAL_MESSAGE, e.origin);
          window.removeEventListener('message', receiveMessage, false);
        }

        window.addEventListener('message', receiveMessage, false);
        if (window.opener) {
          // Handshake inicial: nenhum segredo nesta mensagem, so avisa que
          // o popup esta pronto. '*' aqui e seguro pq o payload e vazio de
          // dado sensivel — o token so sai depois da validacao de origem
          // em receiveMessage acima.
          window.opener.postMessage('authorizing:${PROVIDER}', '*');
        }
      })();
    </script>
  </body>
</html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return new Response(
        'Worker mal configurado: faltam os secrets GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET. Ver README.md deste worker.',
        { status: 500 }
      );
    }
    if (!env.ALLOWED_ORIGINS) {
      return new Response(
        'Worker mal configurado: falta a variavel ALLOWED_ORIGINS (allowlist de origens pro postMessage). Ver README.md deste worker.',
        { status: 500 }
      );
    }

    const allowlist = parseAllowlist(env.ALLOWED_ORIGINS);

    // --- /auth: inicia o fluxo, redireciona pro GitHub ----------------------
    if (url.pathname === '/auth') {
      const state = randomState();
      const redirectUri = `${url.origin}/callback`;
      const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
      authorizeUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('scope', url.searchParams.get('scope') || DEFAULT_SCOPE);
      authorizeUrl.searchParams.set('state', state);

      return new Response(null, {
        status: 302,
        headers: {
          Location: authorizeUrl.toString(),
          'Set-Cookie': `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=600`,
        },
      });
    }

    // --- /callback: troca code por token, devolve via postMessage ----------
    if (url.pathname === '/callback') {
      const clearCookie = `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/callback; Max-Age=0`;
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const cookieState = readCookie(request, STATE_COOKIE);

      if (!code || !returnedState || !cookieState || returnedState !== cookieState) {
        return htmlResponse(
          renderPopupPage(
            'error',
            { message: 'Validacao de state falhou (possivel CSRF ou sessao expirada). Tente autenticar de novo.' },
            allowlist
          ),
          400,
          { 'Set-Cookie': clearCookie }
        );
      }

      try {
        const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: `${url.origin}/callback`,
          }),
        });

        const tokenData = (await tokenResponse.json()) as {
          access_token?: string;
          error?: string;
          error_description?: string;
        };

        if (!tokenResponse.ok || !tokenData.access_token) {
          // Nunca logar `tokenData` (pode conter detalhe sensivel do GitHub).
          return htmlResponse(
            renderPopupPage(
              'error',
              { message: tokenData.error_description || 'Nao foi possivel obter o token de acesso do GitHub.' },
              allowlist
            ),
            502,
            { 'Set-Cookie': clearCookie }
          );
        }

        return htmlResponse(
          renderPopupPage('success', { token: tokenData.access_token, provider: PROVIDER }, allowlist),
          200,
          { 'Set-Cookie': clearCookie }
        );
      } catch {
        // Erro de rede/parse — nao expor detalhe interno pro client.
        return htmlResponse(
          renderPopupPage('error', { message: 'Erro inesperado ao autenticar com o GitHub.' }, allowlist),
          500,
          { 'Set-Cookie': clearCookie }
        );
      }
    }

    if (url.pathname === '/') {
      return new Response('Decap CMS OAuth provider — Guia Urubici. Rotas: GET /auth, GET /callback', {
        status: 200,
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
