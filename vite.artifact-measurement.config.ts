import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/run-artifact-measurement.ts',
    outDir: '.artifact-measurement-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'run-artifact-measurement.mjs',
      },
    },
  },
})
