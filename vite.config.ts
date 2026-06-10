import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': root } },
  // Second-instance escape hatch (replaces the old NEXT_DIST_DIR trick):
  // run a parallel dev server with VITE_CACHE_DIR=node_modules/.vite-test.
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
});
