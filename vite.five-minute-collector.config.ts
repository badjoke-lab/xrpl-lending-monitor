import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/run-five-minute-collector.ts',
    outDir: '.five-minute-collector-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'run-five-minute-collector.mjs',
      },
    },
  },
})
