import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/finalize-history-reconstruction-candidate.ts',
    outDir: '.history-reconstruction-finalizer-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'finalize-history-reconstruction-candidate.mjs' },
    },
  },
})
