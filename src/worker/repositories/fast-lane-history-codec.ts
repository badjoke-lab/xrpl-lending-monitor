import type { FastLaneHistoryBundle } from './fast-lane-history-window'

const GZIP_BASE64_PREFIX = 'gzip-base64-v1:'
const BASE64_CHUNK_BYTES = 32_768

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function gzip(value: string): Promise<Uint8Array> {
  const input = new Blob([value]).stream()
  const compressed = input.pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(compressed).arrayBuffer())
}

async function gunzip(value: Uint8Array): Promise<string> {
  const input = new Blob([value]).stream()
  const decompressed = input.pipeThrough(new DecompressionStream('gzip'))
  return new Response(decompressed).text()
}

export function isCompressedFastLaneHistoryPayload(value: string): boolean {
  return value.startsWith(GZIP_BASE64_PREFIX)
}

export async function encodeFastLaneHistoryBundle(
  bundle: FastLaneHistoryBundle,
): Promise<string> {
  const json = JSON.stringify(bundle)
  const compressed = await gzip(json)
  return `${GZIP_BASE64_PREFIX}${bytesToBase64(compressed)}`
}

export async function decodeFastLaneHistoryPayload(value: string): Promise<unknown> {
  if (!isCompressedFastLaneHistoryPayload(value)) return JSON.parse(value)
  const compressed = base64ToBytes(value.slice(GZIP_BASE64_PREFIX.length))
  return JSON.parse(await gunzip(compressed))
}

export function fastLaneHistoryPayloadBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
