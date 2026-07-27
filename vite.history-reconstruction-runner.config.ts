import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/run-history-reconstruction.ts',
    outDir: '.history-reconstruction-runner-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'run-history-reconstruction.mjs' },
    },
  },
})
