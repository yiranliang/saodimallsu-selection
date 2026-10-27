import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite 配置 — 单页应用
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
  // 部署到子路径时修改 base（如 Cloudflare Pages 项目名前缀）
  base: './',
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the two libraries that change on their own schedule out of the
         * app bundle. Without this the single chunk is ~650 kB, which trips the
         * 500 kB warning and means every content edit invalidates the whole
         * download. These two chunks stay cached across deploys.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
