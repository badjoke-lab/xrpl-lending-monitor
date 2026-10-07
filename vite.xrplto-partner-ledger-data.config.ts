import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/xrplto/partner-ledger-data-benchmark.ts',
    outDir: '.xrplto-partner-ledger-data-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'partner-ledger-data-benchmark.mjs',
      },
    },
  },
})
