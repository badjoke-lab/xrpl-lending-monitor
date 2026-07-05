import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/run-release-current-state.ts',
    outDir: '.release-current-state-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'run-release-current-state.mjs',
      },
    },
  },
})
