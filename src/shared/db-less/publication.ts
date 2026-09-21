import { sha256Hex } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'
import { verifyDbLessChannel, type DbLessChannelV1 } from './channel'

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

export interface DbLessChannelLastPublicationResult {
  artifacts: {
    written: number
    reused: number
  }
  revision: string | null
}

export async function publishArtifactsThenChannel(options: {
  writer: DbLessImmutableArtifactWriter
  publisher: DbLessChannelPublisher
  artifacts: readonly DbLessArtifact[]
  nextChannel: DbLessChannelV1
  expectedPreviousChannelSha256: string | null
}): Promise<DbLessChannelLastPublicationResult> {
  await verifyDbLessChannel(options.nextChannel)

  const before = await options.publisher.readChannel()
  if (before) await verifyDbLessChannel(before.channel)

  const actualPreviousChannelSha256 = before?.channel.channelSha256 ?? null
  if (actualPreviousChannelSha256 !== options.expectedPreviousChannelSha256) {
    throw new Error('Active channel changed before immutable artifact publication')
  }

  const artifacts = await publishImmutableArtifacts({
    writer: options.writer,
    artifacts: options.artifacts,
  })

  const published = await options.publisher.publishChannel({
    channel: options.nextChannel,
    expectedPreviousChannelSha256: options.expectedPreviousChannelSha256,
    expectedRevision: before?.revision ?? null,
  })

  const after = await options.publisher.readChannel()
  if (!after) throw new Error('Published channel could not be read back')
  await verifyDbLessChannel(after.channel)
  if (after.channel.channelSha256 !== options.nextChannel.channelSha256) {
    throw new Error('Published channel readback does not match the intended channel')
  }

  return {
    artifacts,
    revision: published.revision,
  }
}
