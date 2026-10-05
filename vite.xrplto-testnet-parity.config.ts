import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/xrplto/testnet-parity.ts',
    outDir: '.xrplto-testnet-parity-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'testnet-parity.mjs',
      },
    },
  },
})
