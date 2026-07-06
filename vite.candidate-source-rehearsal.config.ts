import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/rehearse-candidate-sources.ts',
    outDir: '.candidate-source-rehearsal-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'rehearse-candidate-sources.mjs' },
    },
  },
})
