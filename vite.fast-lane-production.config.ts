import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/run-fast-lane-production.ts',
    outDir: '.fast-lane-production-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'run-fast-lane-production.mjs',
      },
    },
  },
})
