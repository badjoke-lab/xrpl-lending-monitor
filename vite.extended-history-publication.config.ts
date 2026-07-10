import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-extended-history-publication.ts',
    outDir: '.extended-history-publication-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'build-extended-history-publication.mjs' },
    },
  },
})
