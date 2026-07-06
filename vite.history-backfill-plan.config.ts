import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/plan-history-backfill.ts',
    outDir: '.history-backfill-plan-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'plan-history-backfill.mjs' },
    },
  },
})
