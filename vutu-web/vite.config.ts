/// <reference types='vitest' />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vutu 生图工作台 —— 构建配置。
 *
 * 生产：部署在 https://ai.vutu.cc/studio/ 子路径下，
 *   因此 base=/studio/（否则资源 404），API 走同域 /api（无跨域）。
 *   这两个值由 VITE_BASE / VITE_API_BASE 注入，见 .env.production。
 *
 * 开发：`/v1` 代理到本地 vutu-server，避免 CORS。
 *
 * 测试：jsdom 环境跑组件测试（React 18 + Testing Library）。
 *   统一放本文件而非独立 vitest.config.ts —— 共用同一套 alias 与插件，
 *   避免两处配置漂移导致「测试能过、构建失败」这类假绿。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    base: env['VITE_BASE'] || '/',
    server: {
      // 显式绑定 IPv4：默认只监听 ::1，会导致浏览器访问 127.0.0.1 被拒
      host: '127.0.0.1',
      port: 5178,
      strictPort: true,
      proxy: {
        '/v1': {
          target: env['VUTU_API_TARGET'] ?? 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      // 业务不 import CSS，但 setup/组件可能间接引入；关掉可加速
      css: false,
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/test/**',
          'src/main.tsx',
          'src/vite-env.d.ts',
        ],
      },
    },
  };
});