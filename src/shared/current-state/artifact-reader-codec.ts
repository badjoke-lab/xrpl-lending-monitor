import { canonicalJson, sha256Hex, utf8 } from './canonical-json'

export interface ArtifactReaderCursor {
  schemaVersion: 1
  mode: string
  term: string
  descriptorIndex: number
  lineIndex: number
}

export interface DecodedGzipNdjson {
  records: unknown[]
  decompressedBytes: number
  decompressedSha256: string
}

const DEFAULT_MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024

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

export async function decodeGzipNdjsonWithMetadata(options: {
  bytes: Uint8Array
  sha256: string
  uncompressedSha256?: string
  expectedDecompressedBytes?: number
  maxDecompressedBytes?: number
}): Promise<DecodedGzipNdjson> {
  const maxDecompressedBytes = options.maxDecompressedBytes ?? DEFAULT_MAX_DECOMPRESSED_BYTES
  if (!Number.isSafeInteger(maxDecompressedBytes) || maxDecompressedBytes < 1) {
    throw new Error('maxDecompressedBytes must be a positive safe integer')
  }
  if (
    options.expectedDecompressedBytes !== undefined
    && (!Number.isSafeInteger(options.expectedDecompressedBytes) || options.expectedDecompressedBytes < 0)
  ) {
    throw new Error('expectedDecompressedBytes must be a non-negative safe integer')
  }
  if (
    options.expectedDecompressedBytes !== undefined
    && options.expectedDecompressedBytes > maxDecompressedBytes
  ) {
    throw new Error('Artifact declared decompressed size exceeds limit')
  }
  if (await sha256Hex(options.bytes) !== options.sha256) throw new Error('Artifact digest mismatch')
  const stream = new Blob([arrayBuffer(options.bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxDecompressedBytes) {
      await reader.cancel()
      throw new Error('Artifact decompressed size exceeds limit')
    }
    if (options.expectedDecompressedBytes !== undefined && total > options.expectedDecompressedBytes) {
      await reader.cancel()
      throw new Error('Artifact decompressed size mismatch')
    }
    chunks.push(value)
  }
  if (options.expectedDecompressedBytes !== undefined && total !== options.expectedDecompressedBytes) {
    throw new Error('Artifact decompressed size mismatch')
  }
  const decompressed = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    decompressed.set(chunk, offset)
    offset += chunk.byteLength
  }
  const decompressedSha256 = await sha256Hex(decompressed)
  if (options.uncompressedSha256 && decompressedSha256 !== options.uncompressedSha256) {
    throw new Error('Artifact decompressed digest mismatch')
  }
  const text = new TextDecoder().decode(decompressed)
  if (text.length === 0) return { records: [], decompressedBytes: total, decompressedSha256 }
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  return {
    records: lines.filter((line) => line.length > 0).map((line) => JSON.parse(line) as unknown),
    decompressedBytes: total,
    decompressedSha256,
  }
}

export async function decodeGzipNdjson(options: {
  bytes: Uint8Array
  sha256: string
  uncompressedSha256?: string
  expectedDecompressedBytes?: number
  maxDecompressedBytes?: number
}): Promise<unknown[]> {
  return (await decodeGzipNdjsonWithMetadata(options)).records
}
