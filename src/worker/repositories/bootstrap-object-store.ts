import type { BootstrapObjectStore } from '../../collector/current-state/bootstrap-runner'

function assertDigest(sha256: string): void {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Bootstrap object SHA-256 digest is invalid')
  }
}

async function putIdempotent(options: {
  bucket: R2Bucket
  key: string
  bytes: Uint8Array
  sha256: string
  contentType: string
}): Promise<number> {
  assertDigest(options.sha256)
  const existing = await options.bucket.head(options.key)
  if (existing) {
    if (
      existing.customMetadata?.sha256 !== options.sha256 ||
      existing.size !== options.bytes.byteLength
    ) {
      throw new Error(`Bootstrap object key ${options.key} already contains different content`)
    }
    return existing.size
  }

  const written = await options.bucket.put(options.key, options.bytes, {
    httpMetadata: { contentType: options.contentType },
    customMetadata: { sha256: options.sha256 },
  })
  if (!written) throw new Error(`Bootstrap object ${options.key} was not stored`)
  if (written.size !== options.bytes.byteLength) {
    throw new Error(`Bootstrap object ${options.key} stored byte count does not match payload`)
  }
  return written.size
}

export function createR2BootstrapObjectStore(bucket: R2Bucket): BootstrapObjectStore {
  return {
    async putShard(options) {
      const storedBytes = await putIdempotent({
        bucket,
        key: options.key,
        bytes: options.bytes,
        sha256: options.sha256,
        contentType: 'application/gzip',
      })
      return { storedBytes }
    },

    async putManifest(options) {
      await putIdempotent({
        bucket,
        key: options.key,
        bytes: options.bytes,
        sha256: options.sha256,
        contentType: 'application/json; charset=utf-8',
      })
    },

    async verifyManifest(options) {
      assertDigest(options.sha256)
      const object = await bucket.head(options.key)
      return object?.customMetadata?.sha256 === options.sha256
    },
  }
}
