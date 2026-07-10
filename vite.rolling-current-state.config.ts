import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-rolling-current-state-read-model.ts',
    outDir: '.rolling-current-state-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'build-rolling-current-state-read-model.mjs' },
    },
  },
})
