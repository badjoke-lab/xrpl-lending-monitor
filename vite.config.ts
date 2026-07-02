import react from '@vitejs/plugin-react'
import {
  defineConfig,
  type Plugin,
  type PreviewServer,
  type ViteDevServer,
} from 'vite'

function installApiDocumentationFallback(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((request, _response, next) => {
    if (request.url) {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (url.pathname === '/api' || url.pathname === '/api/') {
        request.url = `/${url.search}`
      }
    }
    next()
  })
}

const apiDocumentationFallback: Plugin = {
  name: 'api-documentation-fallback',
  configureServer(server) {
    installApiDocumentationFallback(server)
  },
  configurePreviewServer(server) {
    installApiDocumentationFallback(server)
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
