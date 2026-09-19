import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-db-less-current-base-read-model.ts',
    outDir: '.db-less-current-base-read-model-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'build-db-less-current-base-read-model.mjs',
      },
    },
  },
})
