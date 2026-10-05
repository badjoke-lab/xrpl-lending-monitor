import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/xrplto/testnet-benchmark.ts',
    outDir: '.xrplto-testnet-benchmark-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'testnet-benchmark.mjs',
      },
    },
  },
})
