import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/run-typed-current-state-release.ts',
    outDir: '.typed-current-state-release-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'run-typed-current-state-release.mjs',
      },
    },
  },
})
