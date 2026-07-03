const encoder = new TextEncoder()

function canonicalValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON does not support non-finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => {
        if (entry === undefined) throw new Error(`Canonical JSON does not support undefined at ${key}`)
        return `${JSON.stringify(key)}:${canonicalValue(entry)}`
      })
    return `{${entries.join(',')}}`
  }
  throw new Error(`Canonical JSON does not support ${typeof value}`)
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value)
}

export function utf8(value: string): Uint8Array {
  return encoder.encode(value)
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? utf8(value) : value
  return hex(await crypto.subtle.digest('SHA-256', arrayBuffer(bytes)))
}

export async function gzipDeterministic(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([arrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
