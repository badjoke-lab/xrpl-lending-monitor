import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'scripts/verify-three-layer-read-canary.ts',
    outDir: '.three-layer-read-canary-build',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'verify-three-layer-read-canary.mjs',
      },
    },
  },
})

// Keep the verifier build isolated from the Worker bundle.
