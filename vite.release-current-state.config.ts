import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/run-release-current-state.ts',
    outDir: '.release-current-state-build',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'run-release-current-state.mjs',
      },
    },
  },
})
