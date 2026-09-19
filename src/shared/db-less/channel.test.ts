import { describe, expect, it } from 'vitest'

import {
  buildDbLessChannel,
  verifyDbLessChannel,
  type DbLessChannelBodyV1,
} from './channel'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const D = 'D'.repeat(64)
const SHA = 'a'.repeat(64)
const PAYLOAD = `sha256:${'b'.repeat(64)}`

function body(): DbLessChannelBodyV1 {
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-3371675',
    base: {
      generationId: 'base-v1',
      snapshotId: 'snapshot-v1',
      manifestKey: 'current/base-v1/manifest.json',
      manifestSha256: SHA,
      ledgerIndex: 5_218_039,
      ledgerHash: A,
    },
    live: {
      generationId: 'live-v1',
      manifestKey: 'live/live-v1/manifest.json',
      manifestSha256: SHA,
      payloadDigest: PAYLOAD,
      startLedgerIndex: 5_218_040,
      startParentHash: A,
      endLedgerIndex: 5_218_042,
      endLedgerHash: B,
    },
    lastCommittedLedgerIndex: 5_218_042,
    lastCommittedLedgerHash: B,
    historyCoverage: [
      {
        rangeId: 'archive-v1',
        source: 'archive',
        epochId: 'devnet-3371675',
        startLedgerIndex: 3_371_676,
        startLedgerHash: C,
        endLedgerIndex: 3_932_301,
        endLedgerHash: D,
      },
      {
        rangeId: 'live-v1',
        source: 'live',
        epochId: 'devnet-3371675',
        startLedgerIndex: 5_218_040,
        startLedgerHash: A,
        endLedgerIndex: 5_218_042,
        endLedgerHash: B,
      },
    ],
    updatedAt: '2026-09-20T00:00:00.000Z',
  }
}

describe('DB-less channel', () => {
  it('allows explicit non-overlapping historical gaps', async () => {
    const channel = await buildDbLessChannel(body())
    await expect(verifyDbLessChannel(channel)).resolves.toBeUndefined()
    expect(channel.historyCoverage).toHaveLength(2)
    expect(channel.lastCommittedLedgerIndex).toBe(5_218_042)
  })

  it('fails when Current live continuity does not begin at base + 1', async () => {
    const input = body()
    input.live = { ...input.live!, startLedgerIndex: 5_218_041 }
    await expect(buildDbLessChannel(input)).rejects.toThrow('immediately after the active base')
  })

  it('fails overlapping historical coverage without pretending it is one continuous range', async () => {
    const input = body()
    input.historyCoverage = [
      input.historyCoverage[0]!,
      {
        ...input.historyCoverage[1]!,
        startLedgerIndex: 3_932_301,
      },
    ]
    await expect(buildDbLessChannel(input)).rejects.toThrow('must not overlap')
  })

  it('detects channel tampering', async () => {
    const channel = await buildDbLessChannel(body())
    const tampered = { ...channel, lastCommittedLedgerIndex: channel.lastCommittedLedgerIndex + 1 }
    await expect(verifyDbLessChannel(tampered)).rejects.toThrow()
  })
})
