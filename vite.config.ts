import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

function rewriteExactApiDocumentationPath(request: { url?: string }) {
  if (!request.url) return
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/api' || url.pathname === '/api/') {
    request.url = `/${url.search}`
  }
}

const apiDocumentationFallback: Plugin = {
  name: 'api-documentation-fallback',
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      rewriteExactApiDocumentationPath(request)
      next()
    })
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, _response, next) => {
      rewriteExactApiDocumentationPath(request)
      next()
    })
  },
}

export default defineConfig({
  plugins: [apiDocumentationFallback, react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
})
