import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-history-segment-publication.ts',
    outDir: '.history-segment-publication-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'build-history-segment-publication.mjs' },
    },
  },
})
