/**
 * D5 candidate: opt-in, browser-visible HTTPS transport for public, immutable
 * GitHub Release assets. GitHub's canonical JSON control metadata still comes
 * DIRECTLY from api.github.com; never via an untrusted relay.
 *
 * The relay supplies ONLY asset bytes; the unchanged D2/D3/D4 readers enforce
 * exact source-authorized byte size, SHA-256, schema and ledger identity.
 * No implicit fallback to CORS-blocked direct GitHub downloads.
 */
const REPO = 'badjoke-lab/xrpl-lending-monitor'
const SOURCE_PREFIX = `https://github.com/${REPO}/releases/download/`

const TAG = /^(?:d2-current-base-\d+|db-less-current-overlay-v1-\d+|db-less-live-data-v1-\d{8}-\d{2}(?:-r\d+)?)$/
const FILE = /^(?:base-manifest\.json|(?:vault|loan|loan-broker)-page-\d{6}\.json\.gz|lookup-[0-9A-F]+\.json\.gz|current-overlay-v1-\d+-(?:manifest\.json|bucket-\d{4}\.json(?:\.gz)?)|live-v1-\d+-\d+-[a-f0-9]{16}-[a-f0-9]{12}-(?:(?:manifest|chunk-\d{4})\.json|current-only-v1\.json\.gz))$/
const HEX_LEDGER = /^db-less-current-overlay-v1-(\d+)$/
const SHARD_LEDGER = /^current-overlay-v1-(\d+)-/

export function normalizedDbLessD5RelayOrigin(value: string): string {
  if (typeof value !== 'string' || !value) throw new Error('D5 relay origin is required')
  let u: URL
  try { u = new URL(value) } catch { throw new Error('D5 relay URL is invalid') }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password
    || u.pathname !== '/' || u.search || u.hash) {
    throw new Error('D5 relay requires a bare trusted HTTPS origin')
  }
  // No embedded URLs, path prefixes, or attacker-controlled query parameters.
  return u.origin
}

export function mappedDbLessD5ReleaseAsset(options: {
  source: string
  relayOrigin: string
}): string | null {
  const source = options.source
  if (!source.startsWith(SOURCE_PREFIX)) return null
  const rest = source.slice(SOURCE_PREFIX.length)
  const parts = rest.split('/')
  if (parts.length !== 2 || !TAG.test(parts[0]!) || !FILE.test(parts[1]!)) {
    throw new Error('D5 Release asset URL is not allowlisted')
  }
  const [tag, key] = parts as [string, string]
  if (key.startsWith('current-overlay-v1-')) {
    if (HEX_LEDGER.exec(tag)?.[1] !== SHARD_LEDGER.exec(key)?.[1]) {
      throw new Error('D5 D4 asset Release/ledger context mismatch')
    }
  } else if (key.startsWith('live-v1-')) {
    if (!tag.startsWith('db-less-live-data-v1-')) throw new Error('D5 D3 asset Release class differs')
  } else if (!tag.startsWith('d2-current-base-')) {
    throw new Error('D5 D2 asset Release class differs')
  }
  return `${normalizedDbLessD5RelayOrigin(options.relayOrigin)}/artifacts/${tag}/${key}`
}

export function createDbLessD5PublicRelayFetch(options: {
  relayOrigin: string
  fetcher?: typeof fetch
}): typeof fetch {
  const origin = normalizedDbLessD5RelayOrigin(options.relayOrigin)
  const transport = options.fetcher ?? ((input, init) => fetch(input, init))
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input !== 'string' && !(input instanceof URL)) {
      throw new Error('D5 relay supports only explicit source URLs')
    }
    const source = String(input)
    const mapped = mappedDbLessD5ReleaseAsset({ source, relayOrigin: origin })
    if (mapped === null) {
      // Only exact read-only public control-channel metadata is allowed outside
      // the relay. Neither query endpoints nor arbitrary origins can be proxied.
      const metadata = new URL(source)
      if (metadata.protocol !== 'https:' || metadata.origin !== 'https://api.github.com'
        || !new RegExp(`^/repos/${REPO}/releases/tags/[A-Za-z0-9._-]+$`).test(metadata.pathname)
        || metadata.search || metadata.hash) {
        throw new Error('D5 only reads public GitHub Release control metadata')
      }
      return transport(input, init)
    }
    const response = await transport(mapped, { ...init, redirect: 'follow', method: 'GET' })
    const actual = new URL(response.url)
    const expected = new URL(mapped)
    if (actual.protocol !== 'https:' || actual.origin !== origin
      || actual.pathname !== expected.pathname || actual.search || actual.hash) {
      throw new Error('D5 Release relay responded from an unexpected URL/origin')
    }
    return response
  }) as typeof fetch
}
