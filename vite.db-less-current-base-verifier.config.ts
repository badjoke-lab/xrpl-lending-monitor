import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/verify-db-less-current-base.ts',
    outDir: '.db-less-current-base-verifier-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'verify-db-less-current-base.mjs',
      },
    },
  },
})
