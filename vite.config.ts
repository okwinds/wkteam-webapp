import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite 配置（包含 Vitest 配置）
 *
 * - 目标：本地可运行 + 离线回归可执行
 * - 约束：V1 不引入 CI（本仓库不提供 workflows）
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      },
      '/webhooks': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      },
      '/healthz': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['legacy/**', 'node_modules/**']
  }
})
