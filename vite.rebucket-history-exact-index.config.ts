import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/rebucket-history-exact-index.ts',
    outDir: '.rebucket-history-exact-index-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'rebucket-history-exact-index.mjs' },
    },
  },
})
