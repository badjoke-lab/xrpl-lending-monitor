import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/build-history-segment-channel.ts',
    outDir: '.history-segment-channel-build',
    emptyOutDir: true,
    rolldownOptions: {
      external: ['cloudflare:sockets'],
      output: { entryFileNames: 'build-history-segment-channel.mjs' },
    },
  },
})
