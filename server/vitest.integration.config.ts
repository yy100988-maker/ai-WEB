import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/integration/**/*.int.test.ts', 'tests/e2e/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 90000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
