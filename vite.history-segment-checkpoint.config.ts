import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/update-history-segment-checkpoint.ts',
    outDir: '.history-segment-checkpoint-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'update-history-segment-checkpoint.mjs' },
    },
  },
})
