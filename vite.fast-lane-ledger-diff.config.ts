import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/verify-fast-lane-against-ledger.ts',
    outDir: '.fast-lane-ledger-diff-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'verify-fast-lane-against-ledger.mjs',
      },
    },
  },
})
