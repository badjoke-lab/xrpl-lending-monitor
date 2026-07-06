import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-replacement-current-state-read-model.ts',
    outDir: '.replacement-current-state-read-model-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'build-replacement-current-state-read-model.mjs' },
    },
  },
})
