import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-t5-cutover-preflight-bundle.ts',
    outDir: '.t5-cutover-preflight-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'build-t5-cutover-preflight-bundle.mjs' },
    },
  },
})
