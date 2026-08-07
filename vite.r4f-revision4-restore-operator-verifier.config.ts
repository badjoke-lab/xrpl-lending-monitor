import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'scripts/verify-r4f-revision4-restore-operator.ts'),
      formats: ['es'],
      fileName: () => 'r4f-revision4-restore-operator-verifier.mjs',
    },
    outDir: resolve(__dirname, '.tmp'),
    rollupOptions: {
      external: ['node:fs', 'node:path'],
    },
  },
})
