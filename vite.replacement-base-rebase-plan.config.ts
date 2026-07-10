import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/plan-replacement-base-rebase.ts',
    outDir: '.replacement-base-rebase-plan-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'plan-replacement-base-rebase.mjs' },
    },
  },
})
