import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-db-less-initial-channel.ts',
    outDir: '.db-less-initial-channel-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'build-db-less-initial-channel.mjs',
      },
    },
  },
})
