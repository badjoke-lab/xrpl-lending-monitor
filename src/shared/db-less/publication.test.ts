import { describe, expect, it } from 'vitest'

import { buildDbLessChannel, type DbLessChannelV1 } from './channel'
import { sha256Hex } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'
import {
  publishArtifactsThenChannel,
  publishImmutableArtifacts,
  type DbLessArtifactMetadata,
  type DbLessChannelPublisher,
  type DbLessChannelRead,
  type DbLessImmutableArtifactWriter,
} from './publication'

const LOCATION = {
  provider: 'github-release' as const,
  repository: 'badjoke-lab/xrpl-lending-monitor',
  releaseTag: 'test-release',
}

const BASE_HASH = 'A'.repeat(64)
const LIVE_HASH = 'B'.repeat(64)
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)

class MemoryWriter implements DbLessImmutableArtifactWriter {
  readonly values = new Map<string, DbLessArtifactMetadata>()
  readonly events: string[]

  constructor(events: string[] = []) {
    this.events = events
  }

  inspect(key: string): Promise<DbLessArtifactMetadata | null> {
    this.events.push(`inspect:${key}`)
    return Promise.resolve(this.values.get(key) ?? null)
  }

  async writeImmutable(artifact: DbLessArtifact): Promise<void> {
    this.events.push(`write:${artifact.key}`)
    if (this.values.has(artifact.key)) throw new Error('overwrite attempted')
    this.values.set(artifact.key, {
      key: artifact.key,
      bytes: artifact.bytes.byteLength,
      sha256: artifact.sha256,
    })
  }
}

class MemoryChannelPublisher implements DbLessChannelPublisher {
  readonly events: string[]
  current: DbLessChannelRead | null
  raceBeforePublish = false

  constructor(current: DbLessChannelRead | null, events: string[] = []) {
    this.current = current
    this.events = events
  }

  readChannel(): Promise<DbLessChannelRead | null> {
    this.events.push('channel:read')
    return Promise.resolve(this.current)
  }

  publishChannel(options: {
    channel: DbLessChannelV1
    expectedPreviousChannelSha256: string | null
    expectedRevision: string | null
  }): Promise<{ revision: string | null }> {
    this.events.push('channel:publish')
    if (this.raceBeforePublish && this.current) {
      this.current = {
        channel: this.current.channel,
        revision: `${this.current.revision ?? 'r'}-changed`,
      }
    }

    const activeSha = this.current?.channel.channelSha256 ?? null
    const activeRevision = this.current?.revision ?? null
    if (activeSha !== options.expectedPreviousChannelSha256) {
      throw new Error('channel sha compare-and-swap failed')
    }
    if (activeRevision !== options.expectedRevision) {
      throw new Error('channel revision compare-and-swap failed')
    }

    const revision = activeRevision === null ? 'r1' : `${activeRevision}-next`
    this.current = { channel: options.channel, revision }
    return Promise.resolve({ revision })
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

async function initialChannel(): Promise<DbLessChannelV1> {
  return buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    base: {
      location: LOCATION,
      generationId: 'base-test',
      snapshotId: 'snapshot-test',
      manifestKey: 'base-test-manifest.json',
      manifestSha256: SHA_A,
      ledgerIndex: 100,
      ledgerHash: BASE_HASH,
    },
    live: null,
    lastCommittedLedgerIndex: 100,
    lastCommittedLedgerHash: BASE_HASH,
    historyCoverage: [],
    updatedAt: '2026-09-20T00:00:00.000Z',
  })
}

async function nextChannel(): Promise<DbLessChannelV1> {
  return buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    base: {
      location: LOCATION,
      generationId: 'base-test',
      snapshotId: 'snapshot-test',
      manifestKey: 'base-test-manifest.json',
      manifestSha256: SHA_A,
      ledgerIndex: 100,
      ledgerHash: BASE_HASH,
    },
    live: {
      location: LOCATION,
      generationId: 'live-chain-test',
      manifestKey: 'live-chain-test-manifest.json',
      manifestSha256: SHA_B,
      payloadDigest: `sha256:${SHA_C}`,
      startLedgerIndex: 101,
      startLedgerHash: LIVE_HASH,
      startParentHash: BASE_HASH,
      endLedgerIndex: 101,
      endLedgerHash: LIVE_HASH,
    },
    lastCommittedLedgerIndex: 101,
    lastCommittedLedgerHash: LIVE_HASH,
    historyCoverage: [],
    updatedAt: '2026-09-20T00:05:00.000Z',
  })
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

describe('DB-less channel-last publication', () => {
  it('verifies immutable artifacts before publishing and reading back the channel', async () => {
    const events: string[] = []
    const writer = new MemoryWriter(events)
    const before = await initialChannel()
    const after = await nextChannel()
    const publisher = new MemoryChannelPublisher(
      { channel: before, revision: 'r1' },
      events,
    )
    const item = await artifact('live/delta.json')

    await expect(publishArtifactsThenChannel({
      writer,
      publisher,
      artifacts: [item],
      nextChannel: after,
      expectedPreviousChannelSha256: before.channelSha256,
    })).resolves.toEqual({
      artifacts: { written: 1, reused: 0 },
      revision: 'r1-next',
    })

    const writeIndex = events.indexOf('write:live/delta.json')
    const publishIndex = events.indexOf('channel:publish')
    expect(writeIndex).toBeGreaterThanOrEqual(0)
    expect(publishIndex).toBeGreaterThan(writeIndex)
    expect(publisher.current?.channel.channelSha256).toBe(after.channelSha256)
  })

  it('fails before artifact writes when the active channel already changed', async () => {
    const events: string[] = []
    const writer = new MemoryWriter(events)
    const active = await initialChannel()
    const after = await nextChannel()
    const publisher = new MemoryChannelPublisher(
      { channel: active, revision: 'r1' },
      events,
    )
    const item = await artifact('live/delta.json')

    await expect(publishArtifactsThenChannel({
      writer,
      publisher,
      artifacts: [item],
      nextChannel: after,
      expectedPreviousChannelSha256: SHA_B,
    })).rejects.toThrow('Active channel changed')

    expect(events.some((event) => event.startsWith('write:'))).toBe(false)
    expect(events).not.toContain('channel:publish')
  })

  it('leaves verified orphan artifacts safe when the channel CAS loses a race', async () => {
    const events: string[] = []
    const writer = new MemoryWriter(events)
    const before = await initialChannel()
    const after = await nextChannel()
    const publisher = new MemoryChannelPublisher(
      { channel: before, revision: 'r1' },
      events,
    )
    publisher.raceBeforePublish = true
    const item = await artifact('live/delta.json')

    await expect(publishArtifactsThenChannel({
      writer,
      publisher,
      artifacts: [item],
      nextChannel: after,
      expectedPreviousChannelSha256: before.channelSha256,
    })).rejects.toThrow('revision compare-and-swap failed')

    expect(writer.values.has(item.key)).toBe(true)
    expect(publisher.current?.channel.channelSha256).toBe(before.channelSha256)
  })

  it('does not publish the channel when immutable artifact verification fails', async () => {
    const events: string[] = []
    const writer = new MemoryWriter(events)
    const before = await initialChannel()
    const after = await nextChannel()
    const publisher = new MemoryChannelPublisher(
      { channel: before, revision: 'r1' },
      events,
    )
    const item = await artifact('live/delta.json')
    writer.values.set(item.key, {
      key: item.key,
      bytes: item.bytes.byteLength,
      sha256: SHA_B,
    })

    await expect(publishArtifactsThenChannel({
      writer,
      publisher,
      artifacts: [item],
      nextChannel: after,
      expectedPreviousChannelSha256: before.channelSha256,
    })).rejects.toThrow('Immutable artifact conflict')

    expect(events).not.toContain('channel:publish')
    expect(publisher.current?.channel.channelSha256).toBe(before.channelSha256)
  })
})