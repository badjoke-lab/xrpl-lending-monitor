import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/rebucket-history-exact-index-1024.ts',
    outDir: '.rebucket-history-exact-index-1024-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'rebucket-history-exact-index-1024.mjs' },
    },
  },
})
