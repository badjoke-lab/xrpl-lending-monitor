import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-db-less-current-overlay-checkpoint.ts',
    outDir: '.db-less-current-overlay-checkpoint-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'build-db-less-current-overlay-checkpoint.mjs',
      },
    },
  },
})
