import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/verify-db-less-live-release-chain.ts',
    outDir: '.db-less-live-chain-verifier-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'verify-db-less-live-release-chain.mjs',
      },
    },
  },
})
