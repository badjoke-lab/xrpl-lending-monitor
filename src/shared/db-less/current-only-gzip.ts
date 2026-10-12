// D5 candidate only: bounded gzip codec shared by the Node 24 producer and browser reader.
// Never trust an immutable compressed file's declared uncompressed size.
export const MAX_CURRENT_ONLY_UNCOMPRESSED_BYTES = 2_000_000

export async function gzipDbLessCurrentOnlyJson(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function gunzipDbLessCurrentOnlyJson(
  bytes: Uint8Array,
  maxUncompressedBytes = MAX_CURRENT_ONLY_UNCOMPRESSED_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(maxUncompressedBytes) || maxUncompressedBytes < 1) {
    throw new Error('Current-only decompression bound is invalid')
  }
  const stream = new Blob([new Uint8Array(bytes)]).stream()
    .pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxUncompressedBytes) {
        throw new Error('Current-only decompressed bytes exceed the browser bound')
      }
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(output)
}
