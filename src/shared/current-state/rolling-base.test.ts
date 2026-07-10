import { describe, expect, it } from 'vitest'

import {
  parseRollingCurrentStateBaseManifest,
  rollingBaseManifestDigest,
  rollingBaseSegmentForId,
  type RollingCurrentStateBaseManifest,
} from './rolling-base'

function manifest(): RollingCurrentStateBaseManifest {
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-1',
    snapshotId: 'devnet-10-aaaaaaaaaaaa',
    ledgerIndex: 10,
    ledgerHash: 'A'.repeat(64),
    complete: true,
    segmentCount: 2,
    counts: { vaults: 1, loanBrokers: 1, loans: 1 },
    assets: [
      {
        path: 'segment-00000.ndjson.gz', ordinal: 0, sha256: 'a'.repeat(64), bytes: 10, records: 1,
        firstObjectId: '0'.repeat(64), lastObjectId: '0'.repeat(64),
        counts: { vaults: 1, loanBrokers: 0, loans: 0 },
      },
      {
        path: 'segment-00001.ndjson.gz', ordinal: 1, sha256: 'b'.repeat(64), bytes: 20, records: 2,
        firstObjectId: '8'.repeat(64), lastObjectId: 'F'.repeat(64),
        counts: { vaults: 0, loanBrokers: 1, loans: 1 },
      },
    ],
    manifestSha256: 'c'.repeat(64),
  }
}

describe('rolling current-state base contract', () => {
  it('maps object IDs deterministically to fixed segments', () => {
    expect(rollingBaseSegmentForId('0'.repeat(64), 4)).toBe(0)
    expect(rollingBaseSegmentForId('4'.repeat(64), 4)).toBe(1)
    expect(rollingBaseSegmentForId('8'.repeat(64), 4)).toBe(2)
    expect(rollingBaseSegmentForId('F'.repeat(64), 4)).toBe(3)
  })

  it('parses a complete ordered manifest', () => {
    expect(parseRollingCurrentStateBaseManifest(manifest()).counts).toEqual({ vaults: 1, loanBrokers: 1, loans: 1 })
  })

  it('rejects aggregate count disagreement', () => {
    const value = manifest()
    value.counts.loans = 2
    expect(() => parseRollingCurrentStateBaseManifest(value)).toThrow('aggregate counts mismatch')
  })

  it('digests without trusting the embedded digest', async () => {
    const left = manifest()
    const right = { ...manifest(), manifestSha256: 'd'.repeat(64) }
    expect(await rollingBaseManifestDigest(left)).toBe(await rollingBaseManifestDigest(right))
  })
})
