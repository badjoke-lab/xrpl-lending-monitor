import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-base-current-state-read-model.ts',
    outDir: '.base-current-state-read-model-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'build-base-current-state-read-model.mjs',
      },
    },
  },
})
