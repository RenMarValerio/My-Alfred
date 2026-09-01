import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup-env.ts'],
    // Os testes de integração compartilham um único banco Postgres (karen_test) via
    // TRUNCATE em beforeEach — arquivos rodando em paralelo colidiriam entre si.
    fileParallelism: false,
  },
});
