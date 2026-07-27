import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: [
      'scripts/run-history-reconstruction.ts',
      'scripts/finalize-history-reconstruction-candidate.ts',
    ],
    outDir: '.history-reconstruction-runner-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: '[name].mjs' },
    },
  },
})
