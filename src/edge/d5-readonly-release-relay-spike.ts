// D5 isolated delivery spike. NOT a canonical data source or an authorized production runtime.
const REPO = 'badjoke-lab/xrpl-lending-monitor'
const MAX_ASSET_BYTES = 2_000_000
const ALLOWED_REDIRECT_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com'])
const TAG_RE = /^(?:d2-current-base-\d+|db-less-current-overlay-v1-\d+|db-less-live-data-v1-\d{8}-\d{2}(?:-r\d+)?)$/
const FILE_RE = /^(?:base-manifest\.json|(?:vault|loan|loan-broker)-page-\d{6}\.json\.gz|lookup-[0-9A-F]+\.json\.gz|current-overlay-v1-\d+-(?:manifest|bucket-\d{4})\.json|live-v1-\d+-\d+-[a-f0-9]{16}-[a-f0-9]{12}-(?:manifest|chunk-\d{4})\.json)$/

function respond(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  })
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return respond(405, 'Only GET and HEAD are permitted')
    }
    const path = new URL(request.url).pathname
    if (path === '/_health') return respond(200, 'read-only relay spike')
    const match = /^\/artifacts\/([^/]+)\/([^/]+)$/.exec(path)
    if (!match) return respond(404, 'Not found')
    const tag = match[1]!
    const file = match[2]!
    if (!TAG_RE.test(tag) || !FILE_RE.test(file) || file.includes('..')) {
      return respond(400, 'Artifact is not allowlisted')
    }
    if (file.startsWith('current-overlay-v1-')) {
      const prefix = /^current-overlay-v1-(\d+)-/.exec(file)
      if (!prefix || !tag.endsWith('-' + prefix[1])) {
        return respond(400, 'Artifact and Release identities differ')
      }
      if (!tag.startsWith('db-less-current-overlay-v1-')) {
        return respond(400, 'Overlay artifact has incorrect Release class')
      }
    } else if (file.startsWith('live-v1-')) {
      if (!tag.startsWith('db-less-live-data-v1-')) {
        return respond(400, 'D3 artifact has incorrect Release class')
      }
    } else if (!tag.startsWith('d2-current-base-')) {
      return respond(400, 'Base artifact has incorrect Release class')
    }
    const url = `https://github.com/${REPO}/releases/download/${tag}/${file}`
    let upstream: Response
    try {
      upstream = await fetch(url, {
        method: request.method,
        redirect: 'follow',
        headers: { Accept: 'application/octet-stream' },
      })
    } catch {
      return respond(502, 'Upstream fetch failed')
    }
    const finalUrl = new URL(upstream.url)
    if (finalUrl.protocol !== 'https:' || !ALLOWED_REDIRECT_HOSTS.has(finalUrl.hostname)) {
      return respond(502, 'Unexpected upstream redirect')
    }
    if (!upstream.ok) return respond(502, 'Upstream artifact unavailable')
    const contentLength = upstream.headers.get('content-length')
    if (contentLength !== null) {
      const size = Number(contentLength)
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ASSET_BYTES) {
        return respond(502, 'Upstream asset exceeds byte bound')
      }
    }
    // Stream, rather than buffer, to avoid 2 MiB+ Worker memory/copy overhead.
    // Browser consumer MUST verify the manifest-provided exact SHA-256 and byte count.
    const headers = new Headers({
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'access-control-allow-origin, content-length',
      'x-content-type-options': 'nosniff',
      'content-type': 'application/octet-stream',
      'cache-control': 'public, max-age=3600',
    })
    if (contentLength !== null) headers.set('content-length', contentLength)
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: 200,
      headers,
    })
  },
}
