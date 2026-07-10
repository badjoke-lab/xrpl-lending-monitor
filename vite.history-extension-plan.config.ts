import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/plan-history-extension.ts',
    outDir: '.history-extension-plan-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'plan-history-extension.mjs' },
    },
  },
})
