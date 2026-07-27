import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/diagnose-remote-history-terms.ts',
    outDir: '.remote-history-term-diagnostic-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'diagnose-remote-history-terms.mjs' },
    },
  },
})
