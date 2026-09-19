import { describe, expect, it } from 'vitest'

import { sha256Hex } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'
import {
  publishImmutableArtifacts,
  type DbLessArtifactMetadata,
  type DbLessImmutableArtifactWriter,
} from './publication'

class MemoryWriter implements DbLessImmutableArtifactWriter {
  readonly values = new Map<string, DbLessArtifactMetadata>()

  inspect(key: string): Promise<DbLessArtifactMetadata | null> {
    return Promise.resolve(this.values.get(key) ?? null)
  }

  async writeImmutable(artifact: DbLessArtifact): Promise<void> {
    if (this.values.has(artifact.key)) throw new Error('overwrite attempted')
    this.values.set(artifact.key, {
      key: artifact.key,
      bytes: artifact.bytes.byteLength,
      sha256: artifact.sha256,
    })
  }
}

async function artifact(key: string): Promise<DbLessArtifact> {
  const bytes = new TextEncoder().encode('{}')
  return {
    key,
    mediaType: 'application/json',
    bytes,
    sha256: await sha256Hex(bytes),
    immutable: true,
  }
}

describe('DB-less immutable artifact publication', () => {
  it('writes new artifacts and reuses exact immutable matches', async () => {
    const writer = new MemoryWriter()
    const item = await artifact('live/a.json')

    await expect(publishImmutableArtifacts({ writer, artifacts: [item] })).resolves.toEqual({
      written: 1,
      reused: 0,
    })
    await expect(publishImmutableArtifacts({ writer, artifacts: [item] })).resolves.toEqual({
      written: 0,
      reused: 1,
    })
  })

  it('fails closed on an immutable key conflict', async () => {
    const writer = new MemoryWriter()
    const item = await artifact('live/a.json')
    writer.values.set(item.key, {
      key: item.key,
      bytes: item.bytes.byteLength,
      sha256: 'b'.repeat(64),
    })

    await expect(
      publishImmutableArtifacts({ writer, artifacts: [item] }),
    ).rejects.toThrow('Immutable artifact conflict')
  })

  it('rejects an artifact whose declared digest does not match its bytes', async () => {
    const writer = new MemoryWriter()
    const item = await artifact('live/a.json')

    await expect(
      publishImmutableArtifacts({
        writer,
        artifacts: [{ ...item, sha256: 'c'.repeat(64) }],
      }),
    ).rejects.toThrow('digest does not match bytes')
  })
})
