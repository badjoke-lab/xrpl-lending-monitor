import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/verify-history-extension-artifacts.ts',
    outDir: '.history-extension-artifacts-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'verify-history-extension-artifacts.mjs' },
    },
  },
})
