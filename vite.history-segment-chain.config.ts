import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/verify-history-segment-chain.ts',
    outDir: '.history-segment-chain-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'verify-history-segment-chain.mjs' },
    },
  },
})
