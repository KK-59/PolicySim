import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: { '/api': 'http://127.0.0.1:4174' },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      input: {
        // The product, and Albert's workbench. Two entries because policy-workbench.css styles
        // global elements for a dark console and cannot share a document with the light shell.
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        workbench: fileURLToPath(new URL('./workbench.html', import.meta.url)),
      },
    },
  },
})
