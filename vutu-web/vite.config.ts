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
  };
});
