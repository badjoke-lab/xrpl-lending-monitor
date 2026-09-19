import { sha256Hex } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'
import type { DbLessChannelV1 } from './channel'

export interface DbLessArtifactMetadata {
  key: string
  bytes: number
  sha256: string
}

export interface DbLessImmutableArtifactWriter {
  inspect(key: string): Promise<DbLessArtifactMetadata | null>
  writeImmutable(artifact: DbLessArtifact): Promise<void>
}

export interface DbLessChannelRead {
  channel: DbLessChannelV1
  revision: string | null
}

export interface DbLessChannelPublisher {
  readChannel(): Promise<DbLessChannelRead | null>
  publishChannel(options: {
    channel: DbLessChannelV1
    expectedPreviousChannelSha256: string | null
    expectedRevision: string | null
  }): Promise<{ revision: string | null }>
}

export async function publishImmutableArtifacts(options: {
  writer: DbLessImmutableArtifactWriter
  artifacts: readonly DbLessArtifact[]
}): Promise<{ written: number; reused: number }> {
  let written = 0
  let reused = 0

  for (const artifact of options.artifacts) {
    if (await sha256Hex(artifact.bytes) !== artifact.sha256) {
      throw new Error(`Artifact digest does not match bytes at ${artifact.key}`)
    }

    const existing = await options.writer.inspect(artifact.key)
    if (existing) {
      if (existing.sha256 !== artifact.sha256 || existing.bytes !== artifact.bytes.byteLength) {
        throw new Error(`Immutable artifact conflict at ${artifact.key}`)
      }
      reused += 1
      continue
    }

    await options.writer.writeImmutable(artifact)
    const persisted = await options.writer.inspect(artifact.key)
    if (
      !persisted
      || persisted.sha256 !== artifact.sha256
      || persisted.bytes !== artifact.bytes.byteLength
    ) {
      throw new Error(`Immutable artifact verification failed at ${artifact.key}`)
    }
    written += 1
  }

  return { written, reused }
}
