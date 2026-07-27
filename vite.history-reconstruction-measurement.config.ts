import { defineConfig } from 'vite'
export default defineConfig({ build: { ssr: 'scripts/measure-history-reconstruction.ts', outDir: '.history-reconstruction-measurement-build', emptyOutDir: true, rolldownOptions: { external: ['cloudflare:sockets'], output: { entryFileNames: 'measure-history-reconstruction.mjs' } } } })
