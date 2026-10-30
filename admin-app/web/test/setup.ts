import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// `globals: false` no vitest.config.ts -> o auto-cleanup do Testing Library
// (que depende de um `afterEach` global) não se registra sozinho. Registra
// explícito aqui pra cada teste de componente começar com o DOM limpo.
afterEach(cleanup);
