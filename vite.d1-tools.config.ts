import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/run-d1-current-state.ts',
    outDir: '.d1-tools-build',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'run-d1-current-state.mjs',
      },
    },
  },
})
