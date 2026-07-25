import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-current-state-overlay-gap-replay.ts',
    outDir: '.current-state-overlay-gap-replay-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'build-current-state-overlay-gap-replay.mjs',
      },
    },
  },
})
