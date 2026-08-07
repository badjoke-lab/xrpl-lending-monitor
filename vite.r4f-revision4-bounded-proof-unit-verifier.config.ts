import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'scripts/verify-r4f-revision4-bounded-proof-unit.ts'),
      formats: ['es'],
      fileName: () => 'r4f-revision4-bounded-proof-unit-verifier.mjs',
    },
    outDir: resolve(__dirname, '.tmp'),
    rollupOptions: { external: ['node:fs', 'node:path'] },
  },
})
