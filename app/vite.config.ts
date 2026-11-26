import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte()],
  resolve: {
    alias: {
      $shared: fileURLToPath(new URL('../shared', import.meta.url)),
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      $c: fileURLToPath(new URL('./src/components', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/app', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
});
