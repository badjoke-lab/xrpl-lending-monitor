import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/publish-db-less-current-overlay-checkpoint.ts',
    outDir: '.db-less-current-overlay-publisher-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'publish-db-less-current-overlay-checkpoint.mjs',
      },
    },
  },
})
