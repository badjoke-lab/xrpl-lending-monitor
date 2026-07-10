import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/plan-history-extension-shards.ts',
    outDir: '.history-extension-shards-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'plan-history-extension-shards.mjs' },
    },
  },
})
