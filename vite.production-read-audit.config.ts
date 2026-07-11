import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/verify-production-read-audit.ts',
    outDir: '.production-read-audit-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'verify-production-read-audit.mjs',
      },
    },
  },
})
