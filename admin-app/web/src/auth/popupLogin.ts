import { OAUTH_SCOPE, OAUTH_WORKER_BASE_URL } from '../lib/env';

const EXPECTED_PROVIDER = 'github';

export type AuthorizationMessage =
  | { kind: 'handshake' }
  | { kind: 'success'; token: string }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' };

/**
 * Parser puro do protocolo de `postMessage` do `oauth-worker` (ver
 * `oauth-worker/src/index.ts`, função `renderPopupPage`). Extraído em função
 * pura (sem `window`/`MessageEvent`) pra ser testável em unit test sem
 * precisar simular um popup real.
 *
 * Protocolo:
 *  - Handshake inicial, sem segredo: `"authorizing:github"`.
 *  - Final: `"authorization:<provider>:<status>:<json>"`, onde `<status>` é
 *    `success` (`json` = `{"token":"...","provider":"github"}`) ou `error`
 *    (`json` = `{"message":"..."}`).
 *
 * Só confia em `provider === "github"` -- qualquer outro valor (ou mensagem
 * que não bate com nenhum formato esperado) devolve `{ kind: 'ignore' }`,
 * nunca lança.
 */
export function parseAuthorizationMessage(data: unknown): AuthorizationMessage {
  if (data === 'authorizing:github') {
    return { kind: 'handshake' };
  }
  if (typeof data !== 'string') {
    return { kind: 'ignore' };
  }

  const match = /^authorization:([^:]+):([^:]+):([\s\S]*)$/.exec(data);
  if (!match) {
    return { kind: 'ignore' };
  }
  const [, provider, status, jsonStr] = match;
  if (provider !== EXPECTED_PROVIDER) {
    return { kind: 'ignore' };
  }

  if (status === 'success') {
    try {
      const payload = JSON.parse(jsonStr) as { token?: unknown };
      if (typeof payload.token !== 'string' || payload.token.length === 0) {
        return { kind: 'error', message: 'Resposta de autenticação do GitHub sem token.' };
      }
      return { kind: 'success', token: payload.token };
    } catch {
      return { kind: 'error', message: 'Resposta de autenticação do GitHub em formato inesperado.' };
    }
  }

  if (status === 'error') {
    try {
      const payload = JSON.parse(jsonStr) as { message?: unknown };
      return {
        kind: 'error',
        message: typeof payload.message === 'string' ? payload.message : 'Falha na autenticação com o GitHub.',
      };
    } catch {
      return { kind: 'error', message: 'Falha na autenticação com o GitHub.' };
    }
  }

  return { kind: 'ignore' };
}

export class LoginCancelledError extends Error {
  constructor() {
    super('Login cancelado -- a janela foi fechada antes de concluir.');
  }
}

export class PopupBlockedError extends Error {
  constructor() {
    super('O navegador bloqueou o popup de login. Permita popups para este site e tente novamente.');
  }
}

/**
 * Abre o popup de login no `oauth-worker` e resolve com o `access_token`
 * quando o handshake completo (ver protocolo acima) terminar com sucesso.
 *
 * Segurança (defesa em profundidade -- o Worker já valida a origem do lado
 * dele antes de mandar o token final, ver `oauth-worker/README.md`): esta
 * função só processa mensagens cuja `event.origin` bate exatamente com a
 * origem do `OAUTH_WORKER_BASE_URL` configurado. Qualquer outra origem é
 * ignorada silenciosamente, mesmo que o conteúdo da mensagem "pareça"
 * válido.
 */
export function loginWithGitHub(): Promise<string> {
  return new Promise((resolve, reject) => {
    let workerOrigin: string;
    try {
      workerOrigin = new URL(OAUTH_WORKER_BASE_URL).origin;
    } catch {
      reject(new Error('VITE_OAUTH_WORKER_BASE_URL inválida.'));
      return;
    }

    const authUrl = `${OAUTH_WORKER_BASE_URL}/auth?scope=${encodeURIComponent(OAUTH_SCOPE)}`;
    const openedPopup = window.open(authUrl, 'guia-urubici-cms-oauth', 'width=640,height=720');
    if (!openedPopup) {
      reject(new PopupBlockedError());
      return;
    }
    // Referência não-nula estável -- `openedPopup` já foi validado acima,
    // mas o TypeScript não propaga essa narrowing pros closures declarados
    // abaixo (handleMessage/finish/closedCheck), então fixamos o tipo aqui.
    const popup: Window = openedPopup;

    let settled = false;

    function finish(fn: () => void): void {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', handleMessage);
      window.clearInterval(closedCheck);
      fn();
    }

    function handleMessage(event: MessageEvent): void {
      if (event.origin !== workerOrigin) return; // defesa em profundidade -- só confia na origem esperada do worker

      const parsed = parseAuthorizationMessage(event.data);
      switch (parsed.kind) {
        case 'handshake':
          // Eco do handshake de volta pro popup -- é a origem da SPA (não a
          // do worker) que o worker valida contra ALLOWED_ORIGINS antes de
          // liberar o token final. Ver `renderPopupPage` no worker.
          try {
            popup.postMessage('authorizing:github', workerOrigin);
          } catch {
            // Popup pode já ter navegado/fechado entre o evento e este
            // ponto -- ignora, o próximo passo (closedCheck) cobre esse caso.
          }
          return;
        case 'success':
          finish(() => {
            try {
              popup.close();
            } catch {
              /* melhor esforço */
            }
            resolve(parsed.token);
          });
          return;
        case 'error':
          finish(() => {
            try {
              popup.close();
            } catch {
              /* melhor esforço */
            }
            reject(new Error(parsed.message));
          });
          return;
        case 'ignore':
          return;
      }
    }

    const closedCheck = window.setInterval(() => {
      if (popup.closed) {
        finish(() => reject(new LoginCancelledError()));
      }
    }, 500);

    window.addEventListener('message', handleMessage);
  });
}
