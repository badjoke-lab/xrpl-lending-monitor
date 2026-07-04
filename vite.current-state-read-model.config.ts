import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-current-state-read-model.ts',
    outDir: '.current-state-read-model-build',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'build-current-state-read-model.mjs',
      },
    },
  },
})
