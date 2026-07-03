import { canonicalJson, sha256Hex, utf8 } from './canonical-json'

export interface ArtifactReaderCursor {
  schemaVersion: 1
  mode: string
  term: string
  descriptorIndex: number
  lineIndex: number
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function fromHex(value: string): Uint8Array {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(value)) {
    throw new Error('Reader cursor encoding is invalid')
  }
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function encodeArtifactReaderCursor(cursor: ArtifactReaderCursor): string {
  return hex(utf8(canonicalJson(cursor)))
}

export function decodeArtifactReaderCursor(options: {
  cursor: string | undefined
  mode: string
  term: string
}): ArtifactReaderCursor {
  if (!options.cursor) {
    return {
      schemaVersion: 1,
      mode: options.mode,
      term: options.term,
      descriptorIndex: 0,
      lineIndex: 0,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromHex(options.cursor)))
  } catch {
    throw new Error('Reader cursor is invalid')
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) throw new Error('Reader cursor schema is invalid')
  if (parsed.mode !== options.mode || parsed.term !== options.term) {
    throw new Error('Reader cursor does not match the requested query')
  }
  if (
    !Number.isSafeInteger(parsed.descriptorIndex)
    || Number(parsed.descriptorIndex) < 0
    || !Number.isSafeInteger(parsed.lineIndex)
    || Number(parsed.lineIndex) < 0
  ) {
    throw new Error('Reader cursor position is invalid')
  }
  return parsed as unknown as ArtifactReaderCursor
}

export async function decodeGzipNdjson(options: {
  bytes: Uint8Array
  sha256: string
}): Promise<unknown[]> {
  if (await sha256Hex(options.bytes) !== options.sha256) {
    throw new Error('Artifact digest mismatch')
  }
  const stream = new Blob([arrayBuffer(options.bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  const text = new TextDecoder().decode(await new Response(stream).arrayBuffer())
  if (text.length === 0) return []
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  return lines.filter((line) => line.length > 0).map((line) => JSON.parse(line) as unknown)
}
