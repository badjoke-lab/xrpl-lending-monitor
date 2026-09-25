import { describe, expect, it } from 'vitest'

import {
  buildDbLessCurrentOverlayChannel,
  encodeDbLessCurrentOverlayChannel,
  verifyDbLessCurrentOverlayChannel,
} from './current-overlay-channel'

const LEDGER = 5_537_748
const HASH = 'A'.repeat(64)
const SHA = 'a'.repeat(64)
const CHANNEL_SHA = 'b'.repeat(64)
const STATE_SHA = 'c'.repeat(64)

function body() {
  return {
    schemaVersion: 1 as const,
    network: 'devnet' as const,
    epochId: 'devnet-5479808',
    active: {
      location: {
        provider: 'github-release' as const,
        repository: 'badjoke-lab/xrpl-lending-monitor',
        releaseTag: `db-less-current-overlay-v1-${LEDGER}`,
      },
      manifestKey: `current-overlay-v1-${LEDGER}-manifest.json`,
      manifestSha256: SHA,
      sourceChannelSha256: CHANNEL_SHA,
      stateSha256: STATE_SHA,
      baseIdentity: 'base-v1-test',
      throughLedgerIndex: LEDGER,
      throughLedgerHash: HASH,
      generationCount: 31,
      entryCount: 17_415,
      tombstoneCount: 352,
      bucketCount: 64,
    },
    updatedAt: '2026-09-24T00:00:00.000Z',
  }
}

describe('D4 Current overlay channel contract', () => {
  it('builds and verifies a canonical checkpoint pointer', async () => {
    const channel = await buildDbLessCurrentOverlayChannel(body())
    await expect(verifyDbLessCurrentOverlayChannel(channel)).resolves.toBeUndefined()

    const encoded = new TextDecoder().decode(encodeDbLessCurrentOverlayChannel(channel))
    expect(encoded.endsWith('\n')).toBe(true)
    expect(JSON.parse(encoded)).toEqual(channel)
  })

  it('rejects a Release tag that does not match the through ledger', async () => {
    const value = body()
    value.active.location.releaseTag = 'db-less-current-overlay-v1-1'

    await expect(buildDbLessCurrentOverlayChannel(value)).rejects.toThrow(
      'Release tag does not match',
    )
  })

  it('rejects a manifest key that does not match the through ledger', async () => {
    const value = body()
    value.active.manifestKey = 'current-overlay-v1-1-manifest.json'

    await expect(buildDbLessCurrentOverlayChannel(value)).rejects.toThrow(
      'manifest key does not match',
    )
  })

  it('rejects invalid checkpoint counts', async () => {
    const value = body()
    value.active.tombstoneCount = value.active.entryCount + 1

    await expect(buildDbLessCurrentOverlayChannel(value)).rejects.toThrow(
      'tombstoneCount exceeds',
    )
  })

  it('rejects a tampered channel digest', async () => {
    const channel = await buildDbLessCurrentOverlayChannel(body())
    channel.active.entryCount += 1

    await expect(verifyDbLessCurrentOverlayChannel(channel)).rejects.toThrow(
      'digest mismatch',
    )
  })

  it('rejects invalid source-state digests', async () => {
    const value = body()
    value.active.stateSha256 = 'not-a-digest'

    await expect(buildDbLessCurrentOverlayChannel(value)).rejects.toThrow(
      'stateSha256',
    )
  })
})
