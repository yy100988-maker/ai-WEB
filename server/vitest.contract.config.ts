import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

/**
 * 契约测试配置：nock 拦截 HTTP，**绝不真连上游**。
 * 与单元测试分开跑，便于 CI 单独标注"零上游费用"这一保证。
 */
export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/contract/**/*.contract.test.ts'],
    testTimeout: 20_000,
  },
});
