// vite.config.js
import { defineConfig } from "file:///D:/Users/zby/WorkBuddy%20AI/2026-10-20-14-51-24/node_modules/vite/dist/node/index.js";
import react from "file:///D:/Users/zby/WorkBuddy%20AI/2026-10-20-14-51-24/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true
  },
  // 部署到子路径时修改 base（如 Cloudflare Pages 项目名前缀）
  base: "./",
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
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"]
        }
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxVc2Vyc1xcXFx6YnlcXFxcV29ya0J1ZGR5IEFJXFxcXDIwMjYtMTAtMjAtMTQtNTEtMjRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXFVzZXJzXFxcXHpieVxcXFxXb3JrQnVkZHkgQUlcXFxcMjAyNi0xMC0yMC0xNC01MS0yNFxcXFx2aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDovVXNlcnMvemJ5L1dvcmtCdWRkeSUyMEFJLzIwMjYtMTAtMjAtMTQtNTEtMjQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuXG4vLyBWaXRlIFx1OTE0RFx1N0Y2RSBcdTIwMTQgXHU1MzU1XHU5ODc1XHU1RTk0XHU3NTI4XG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgb3BlbjogdHJ1ZSxcbiAgfSxcbiAgLy8gXHU5MEU4XHU3RjcyXHU1MjMwXHU1QjUwXHU4REVGXHU1Rjg0XHU2NUY2XHU0RkVFXHU2NTM5IGJhc2VcdUZGMDhcdTU5ODIgQ2xvdWRmbGFyZSBQYWdlcyBcdTk4NzlcdTc2RUVcdTU0MERcdTUyNERcdTdGMDBcdUZGMDlcbiAgYmFzZTogJy4vJyxcbiAgYnVpbGQ6IHtcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNwbGl0IHRoZSB0d28gbGlicmFyaWVzIHRoYXQgY2hhbmdlIG9uIHRoZWlyIG93biBzY2hlZHVsZSBvdXQgb2YgdGhlXG4gICAgICAgICAqIGFwcCBidW5kbGUuIFdpdGhvdXQgdGhpcyB0aGUgc2luZ2xlIGNodW5rIGlzIH42NTAga0IsIHdoaWNoIHRyaXBzIHRoZVxuICAgICAgICAgKiA1MDAga0Igd2FybmluZyBhbmQgbWVhbnMgZXZlcnkgY29udGVudCBlZGl0IGludmFsaWRhdGVzIHRoZSB3aG9sZVxuICAgICAgICAgKiBkb3dubG9hZC4gVGhlc2UgdHdvIGNodW5rcyBzdGF5IGNhY2hlZCBhY3Jvc3MgZGVwbG95cy5cbiAgICAgICAgICovXG4gICAgICAgIG1hbnVhbENodW5rczoge1xuICAgICAgICAgIHJlYWN0OiBbJ3JlYWN0JywgJ3JlYWN0LWRvbScsICdyZWFjdC1yb3V0ZXItZG9tJ10sXG4gICAgICAgICAgc3VwYWJhc2U6IFsnQHN1cGFiYXNlL3N1cGFiYXNlLWpzJ10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG59KVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFxVSxTQUFTLG9CQUFvQjtBQUNsVyxPQUFPLFdBQVc7QUFHbEIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxFQUNSO0FBQUE7QUFBQSxFQUVBLE1BQU07QUFBQSxFQUNOLE9BQU87QUFBQSxJQUNMLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxRQU9OLGNBQWM7QUFBQSxVQUNaLE9BQU8sQ0FBQyxTQUFTLGFBQWEsa0JBQWtCO0FBQUEsVUFDaEQsVUFBVSxDQUFDLHVCQUF1QjtBQUFBLFFBQ3BDO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
