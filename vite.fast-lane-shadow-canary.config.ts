import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-fast-lane-shadow-canary.ts',
    outDir: '.fast-lane-shadow-canary-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: {
        entryFileNames: 'build-fast-lane-shadow-canary.mjs',
      },
    },
  },
})
