import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/xrplto/testnet-ledger-data-benchmark.ts',
    outDir: '.xrplto-ledger-data-benchmark-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'testnet-ledger-data-benchmark.mjs',
      },
    },
  },
})
