import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // Electron keeps a strict CSP in development as well as production. Disabling
  // HMR avoids Vite's inline React Refresh preamble without weakening script-src.
  server: {
    hmr: false,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
