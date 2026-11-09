import { defineConfig } from 'vitest/config';

// Testa `functions/` (Cloudflare Pages Functions do backend de
// comentários, Jurandir 2026-11-09) -- environment 'node' porque a lógica
// é toda Web-standard puro (Request/Response/fetch/crypto.subtle/FormData,
// nativos no Node 18+), sem precisar simular o runtime do Workers de
// verdade. Mesmo estilo de teste que `admin-app/test/` já usa
// (`vi.stubGlobal('fetch', ...)`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['functions/test/**/*.test.ts'],
  },
});
