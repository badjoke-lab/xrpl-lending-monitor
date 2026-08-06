import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/verify-r4f-revision4-provider-capture.ts',
    outDir: '.r4f-revision4-provider-capture-verifier-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'verify-r4f-revision4-provider-capture.mjs',
      },
    },
  },
})
