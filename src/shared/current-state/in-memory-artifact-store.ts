import type { ArtifactMetadata, ArtifactStore } from './artifact-metadata'
import { verifyArtifact } from './artifact-metadata'

export class InMemoryArtifactStore implements ArtifactStore {
  readonly #objects = new Map<string, { bytes: Uint8Array; sha256: string }>()

  async write(key: string, bytes: Uint8Array, sha256: string): Promise<void> {
    await verifyArtifact(bytes, sha256)
    const existing = this.#objects.get(key)
    if (existing) {
      if (existing.sha256 !== sha256) throw new Error(`Immutable artifact mismatch for ${key}`)
      return
    }
    this.#objects.set(key, { bytes: bytes.slice(), sha256 })
  }

  async read(key: string): Promise<Uint8Array | null> {
    return this.#objects.get(key)?.bytes.slice() ?? null
  }

  async inspect(key: string): Promise<ArtifactMetadata | null> {
    const stored = this.#objects.get(key)
    return stored ? { key, size: stored.bytes.byteLength, sha256: stored.sha256 } : null
  }

  async enumerate(prefix: string): Promise<ArtifactMetadata[]> {
    return Array.from(this.#objects.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, stored]) => ({ key, size: stored.bytes.byteLength, sha256: stored.sha256 }))
      .sort((left, right) => left.key.localeCompare(right.key))
  }
}
