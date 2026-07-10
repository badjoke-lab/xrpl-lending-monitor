import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-incremental-history-exact-index.ts',
    outDir: '.incremental-history-exact-index-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'build-incremental-history-exact-index.mjs' },
    },
  },
})
