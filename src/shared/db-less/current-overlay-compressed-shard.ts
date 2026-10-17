/**
 * D4 gzip candidate: strict decompressed byte cap. Uses Web Streams supported
 * by Node 24 and browsers; no Worker deployment or writable storage required.
 */
export async function compressDbLessD4Shard(json: string): Promise<Uint8Array> {
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function decompressDbLessD4Shard(
  bytes: Uint8Array,
  maxDecodedBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 1 || maxDecodedBytes > 2_000_000) {
    throw new Error('D4 decompressed shard byte guard is invalid')
  }
  const reader = new Blob([new Uint8Array(bytes)]).stream()
    .pipeThrough(new DecompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxDecodedBytes) {
        throw new Error('D4 decompressed shard exceeds declared byte guard')
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
