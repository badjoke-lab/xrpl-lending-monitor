import { describe, expect, it } from 'vitest'
import type { DbLessChannelV1, DbLessCurrentProjectionTailGenerationV1 } from './channel'
import type { DbLessCurrentOverlayCheckpointManifest } from './current-overlay-checkpoint'
import { assertDbLessD4ActivationTailSafety } from './current-overlay-activation-tail-guard'

const H = 'A'.repeat(64)
const B = 'B'.repeat(64)
const EPOCH = 'epoch-1'
const BASE = 'base-1'
function checkpoint(throughLedgerIndex = 100, throughLedgerHash = H) {
  return { schemaVersion: 2, network: 'devnet', epochId: EPOCH, baseIdentity: BASE,
    throughLedgerIndex, throughLedgerHash,
  } as DbLessCurrentOverlayCheckpointManifest
}
function pointer(startLedgerIndex: number, endLedgerIndex: number): DbLessCurrentProjectionTailGenerationV1 {
  return {
    location: { provider: 'github-release', repository: 'owner/repo', releaseTag: 'release1' },
    generationId: `g-${endLedgerIndex}`, manifestKey: 'immutable.json', manifestSha256: 'a'.repeat(64),
    payloadDigest: `sha256:${'b'.repeat(64)}`,
    previousLedgerIndex: startLedgerIndex - 1,
    expectedParentHash: H,
    startLedgerIndex, endLedgerIndex, startLedgerHash: B, endLedgerHash: B,
    ledgerCount: endLedgerIndex - startLedgerIndex + 1, currentProjectionMutations: 1,
  }
}
function channel(options: {
  head?: number
  start?: number
  generations?: DbLessCurrentProjectionTailGenerationV1[]
  epochId?: string
  baseId?: string
  hash?: string
  coverageHash?: string
  tail?: boolean
} = {}): DbLessChannelV1 {
  const generations = options.generations ?? [pointer(101, 110), pointer(111, 120)]
  return {
    network:'devnet', epochId:options.epochId ?? EPOCH,
    base:{generationId: options.baseId ?? BASE},
    lastCommittedLedgerIndex:options.head ?? 120,
    lastCommittedLedgerHash:options.hash ?? B,
    currentProjectionTail:options.tail === false ? undefined : {
      schemaVersion:1, coverageStartLedgerIndex:options.start ?? 100,
      coverageStartLedgerHash:options.coverageHash ?? H, generations,
    },
  } as DbLessChannelV1
}

describe('D4 activation final live Current tail safety', () => {
  it('accepts a frozen checkpoint whose tail still covers later D3 commits', () => {
    const result = assertDbLessD4ActivationTailSafety({
      checkpoint:checkpoint(), currentD3:channel(),
    })
    expect(result.pass).toBe(true)
    expect(result.generationsAfterCheckpoint).toBe(2)
    expect(result.remainingTailSlots).toBe(126)
  })
  it('rejects an evicted checkpoint when the current D3 tail no longer covers it', () => {
    expect(() => assertDbLessD4ActivationTailSafety({
      checkpoint:checkpoint(),
      currentD3:channel({start:101}),
    })).toThrow(/Current tail gap/)
  })
  it('rejects source epoch, base, head rollback and missing Current tail', () => {
    for (const currentD3 of [
      channel({epochId:'other'}),
      channel({baseId:'other'}),
      channel({head:99}),
      channel({tail:false}),
    ]) {
      expect(() => assertDbLessD4ActivationTailSafety({checkpoint:checkpoint(),currentD3}))
        .toThrow()
    }
  })
  it('rejects a fork at the exact retained parent and boundary', () => {
    expect(() => assertDbLessD4ActivationTailSafety({
      checkpoint:checkpoint(100,B),currentD3:channel(),
    })).toThrow(/coverage boundary/)
    const altered = pointer(101,110)
    altered.expectedParentHash=B
    expect(() => assertDbLessD4ActivationTailSafety({
      checkpoint:checkpoint(),currentD3:channel({generations:[altered,pointer(111,120)]}),
    })).toThrow(/successor ledger parent hash/)
  })
  it('rejects a checkpoint inside an indexed mutation generation', () => {
    expect(() => assertDbLessD4ActivationTailSafety({
      checkpoint:checkpoint(105,H),
      currentD3:channel({start:100}),
    })).toThrow(/bisects indexed/)
  })
  it('allows mutation-free ledger gaps but refuses a low remaining capacity', () => {
    const gaps = channel({head:130,generations:[pointer(106,110),pointer(121,125)]})
    const valid = assertDbLessD4ActivationTailSafety({checkpoint:checkpoint(),currentD3:gaps})
    expect(valid.generationsAfterCheckpoint).toBe(2)
    const crowded = Array.from({length:124},(_,i)=>pointer(101+i,101+i))
    expect(() => assertDbLessD4ActivationTailSafety({
      checkpoint:checkpoint(),currentD3:channel({head:224,generations:crowded}),
    })).toThrow(/close to eviction/)
    expect(() => assertDbLessD4ActivationTailSafety({
      checkpoint:checkpoint(),currentD3:channel(),minRemainingTailSlots:129,
    })).toThrow(/margin/)
  })
  it('rejects an indexed checkpoint boundary whose ledger hash differs', () => {
    expect(() => assertDbLessD4ActivationTailSafety({
      checkpoint:checkpoint(110,H),
      currentD3:channel({start:100}),
    })).toThrow(/retained indexed generation/)
  })
})
