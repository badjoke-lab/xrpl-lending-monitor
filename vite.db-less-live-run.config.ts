import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/prepare-db-less-live-run.ts',
    outDir: '.db-less-live-run-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'prepare-db-less-live-run.mjs',
      },
    },
  },
})
