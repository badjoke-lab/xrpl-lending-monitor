import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

function apiDocumentationFallback(): Plugin {
  const rewriteExactApiDocumentationPath = () => ({
    name: 'api-documentation-fallback',
    configureServer(server: Parameters<NonNullable<Plugin['configureServer']>>[0]) {
      server.middlewares.use((request, _response, next) => {
        if (request.url) {
          const url = new URL(request.url, 'http://127.0.0.1')
          if (url.pathname === '/api' || url.pathname === '/api/') {
            request.url = `/${url.search}`
          }
        }
        next()
      })
    },
    configurePreviewServer(server: Parameters<NonNullable<Plugin['configurePreviewServer']>>[0]) {
      server.middlewares.use((request, _response, next) => {
        if (request.url) {
          const url = new URL(request.url, 'http://127.0.0.1')
          if (url.pathname === '/api' || url.pathname === '/api/') {
            request.url = `/${url.search}`
          }
        }
        next()
      })
    },
  }) satisfies Plugin

  return rewriteExactApiDocumentationPath()
}

export default defineConfig({
  plugins: [apiDocumentationFallback(), react()],
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
