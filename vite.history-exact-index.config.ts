import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-history-exact-index.ts',
    outDir: '.history-exact-index-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'build-history-exact-index.mjs' },
    },
  },
})
