import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/run-history-segment.ts',
    outDir: '.history-segment-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'run-history-segment.mjs' },
    },
  },
})
