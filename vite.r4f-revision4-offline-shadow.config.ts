import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-r4f-revision4-offline-shadow.mjs',
    outDir: '.r4f-revision4-offline-shadow-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: { entryFileNames: 'build-r4f-revision4-offline-shadow.mjs' },
    },
  },
})
