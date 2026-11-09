/**
 * Implementação mínima de `KVNamespace` em memória, só com o que os
 * handlers usam (`get`/`put`/`delete`/`list` com `prefix`). Suficiente pra
 * testar a lógica de negócio sem precisar do runtime real do Workers --
 * mesmo espírito de `admin-app/test/github-client.test.ts` mockar `fetch`
 * em vez de bater na API real do GitHub.
 */
export class FakeKv {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async put(key: string, value: string, _opts?: { expirationTtl?: number }): Promise<void> {
    // TTL ignorado de propósito -- os testes não dependem de expiração real, só de presença/ausência da chave.
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }> {
    const prefix = opts?.prefix ?? '';
    const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
    return { keys };
  }

  // Helpers só de teste, não existem no KVNamespace real.
  has(key: string): boolean {
    return this.store.has(key);
  }
  size(): number {
    return this.store.size;
  }
}
