import { describe, expect, it } from 'vitest';
import { parseAuthorizationMessage } from '../src/auth/popupLogin';

describe('parseAuthorizationMessage', () => {
  it('reconhece o handshake inicial', () => {
    expect(parseAuthorizationMessage('authorizing:github')).toEqual({ kind: 'handshake' });
  });

  it('extrai o token da mensagem de sucesso', () => {
    const msg = 'authorization:github:success:' + JSON.stringify({ token: 'abc123', provider: 'github' });
    expect(parseAuthorizationMessage(msg)).toEqual({ kind: 'success', token: 'abc123' });
  });

  it('extrai a mensagem de erro', () => {
    const msg = 'authorization:github:error:' + JSON.stringify({ message: 'deu ruim' });
    expect(parseAuthorizationMessage(msg)).toEqual({ kind: 'error', message: 'deu ruim' });
  });

  it('ignora provider diferente de github', () => {
    const msg = 'authorization:gitlab:success:' + JSON.stringify({ token: 'x' });
    expect(parseAuthorizationMessage(msg)).toEqual({ kind: 'ignore' });
  });

  it('ignora mensagens que não batem com o protocolo', () => {
    expect(parseAuthorizationMessage('qualquer coisa')).toEqual({ kind: 'ignore' });
    expect(parseAuthorizationMessage(42)).toEqual({ kind: 'ignore' });
    expect(parseAuthorizationMessage(null)).toEqual({ kind: 'ignore' });
  });

  it('trata sucesso sem token como erro (nunca lança)', () => {
    const msg = 'authorization:github:success:' + JSON.stringify({ provider: 'github' });
    expect(parseAuthorizationMessage(msg)).toEqual({
      kind: 'error',
      message: 'Resposta de autenticação do GitHub sem token.',
    });
  });

  it('trata JSON malformado como erro, nunca lança', () => {
    expect(() => parseAuthorizationMessage('authorization:github:success:{nao-e-json')).not.toThrow();
    expect(parseAuthorizationMessage('authorization:github:success:{nao-e-json').kind).toBe('error');
  });

  it('erro sem message vira mensagem genérica', () => {
    const msg = 'authorization:github:error:' + JSON.stringify({});
    expect(parseAuthorizationMessage(msg)).toEqual({
      kind: 'error',
      message: 'Falha na autenticação com o GitHub.',
    });
  });
});
