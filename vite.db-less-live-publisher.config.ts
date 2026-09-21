import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/publish-db-less-live-release.ts',
    outDir: '.db-less-live-publisher-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'publish-db-less-live-release.mjs',
      },
    },
  },
})
