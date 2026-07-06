import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/rehearse-history-exact-lookups.ts',
    outDir: '.history-exact-rehearsal-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'rehearse-history-exact-lookups.mjs' },
    },
  },
})
