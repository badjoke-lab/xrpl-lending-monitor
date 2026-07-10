import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-rolling-history-exact-index.ts',
    outDir: '.rolling-history-exact-index-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'build-rolling-history-exact-index.mjs' },
    },
  },
})
