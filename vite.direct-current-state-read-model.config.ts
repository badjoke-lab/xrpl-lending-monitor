import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-direct-current-state-read-model.ts',
    outDir: '.direct-current-state-read-model-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'build-direct-current-state-read-model.mjs',
      },
    },
  },
})
