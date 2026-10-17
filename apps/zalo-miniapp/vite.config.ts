import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Bundle the contracts from their ESM source instead of the CommonJS dist: the CJS build drags
    // the whole zod runtime (all locales) into the Mini App chunk because it cannot be tree-shaken.
    alias: {
      '@noxh/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
});
