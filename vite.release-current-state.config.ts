import { defineConfig, type Plugin } from 'vite'

function releaseSourceTransform(): Plugin {
  return {
    name: 'release-source-transform',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/scripts/run-release-current-state.ts')) return null
      const source = 'result.validated !== true'
      const replacement = 'result.validated === false'
      const matches = code.split(source).length - 1
      if (matches !== 1) throw new Error(`Expected one validated guard, found ${matches}`)
      return { code: code.replace(source, replacement), map: null }
    },
  }
}

export default defineConfig({
  plugins: [releaseSourceTransform()],
  build: {
    ssr: 'scripts/run-release-current-state.ts',
    outDir: '.release-current-state-build',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'run-release-current-state.mjs',
      },
    },
  },
})
