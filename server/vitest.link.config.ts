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
    include: ['tests/link/**/*.link.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 120000,
    hookTimeout: 60000,
    // 联调打的是同一套线上栈（同一 worker 消费队列），文件必须串行，
    // 否则任务互相挤占 worker、等待窗口抖动。
    fileParallelism: false,
    sequence: { shuffle: false },
  },
});
