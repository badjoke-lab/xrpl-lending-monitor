import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/xrplto/partner-benchmark.ts',
    outDir: '.xrplto-partner-benchmark-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'partner-benchmark.mjs',
      },
    },
  },
})
