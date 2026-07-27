import { describe, expect, it } from 'vitest'

import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import type { HistoryExactIndexRecord } from '../history-segments/exact-index'
import { planExactSpill, splitExactSuperBuckets } from './exact-spill'
import { assertFixtureContinuity, findFixtureWitness, HISTORY_RECONSTRUCTION_FIXTURE } from './fixture'
import { assertProductionHistoryPath, planFinalTree } from './final-tree'
import {
  HISTORY_RECONSTRUCTION_ACTIVE_END_HASH,
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
  reconstructionSegmentPlan,
  reconstructionSegmentRange,
} from './identity'
import { classifyCheckpointPlan, discoverResume } from './resume'
import {
  assertAttempt,
  assertRawCheckpoint,
  assertReconciliationEvidence,
  assertSpillShardEvidence,
  assertSuperBucketEvidence,
  type RawCheckpoint,
} from './schema'

const H = (character: string) => character.repeat(64)
const SHA = 'a'.repeat(40)

function checkpoint(segmentId: number, options: {
  predecessorDigest?: string | null
  firstParentHash?: string
  terminalHash?: string
  manifestSha256?: string
} = {}): RawCheckpoint {
  const range = reconstructionSegmentRange(segmentId)
  return {
    schemaVersion: 1,
    kind: 'immutable-history-raw-checkpoint',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    network: 'devnet',
    epochId: HISTORY_RECONSTRUCTION_EPOCH_ID,
    segmentId,
    startLedgerIndex: range.startLedgerIndex,
    endLedgerIndex: range.endLedgerIndex,
    ledgerCount: range.ledgerCount,
    firstParentHash: options.firstParentHash ?? HISTORY_RECONSTRUCTION_ACTIVE_END_HASH,
    terminalHash: options.terminalHash ?? H(String((segmentId % 8) + 1)),
    predecessorDigest: options.predecessorDigest ?? null,
    manifestSha256: options.manifestSha256 ?? H('a'),
    semanticCounts: {
      protocolEvents: segmentId === 0 ? 1 : 0,
      objectChanges: 1,
      loanLifecycle: 1,
      archivedObjects: 1,
      balanceHistory: 1,
    },
    decodePassed: true,
    conflictCount: 0,
    sourceImplementationSha: SHA,
    productionMutation: false,
  }
}

async function digest(value: RawCheckpoint): Promise<string> {
  return sha256Hex(canonicalJson(value))
}

describe('history reconstruction identity and schemas', () => {
  it('builds the fixed 263-range plan with the bounded final segment', () => {
    const plan = reconstructionSegmentPlan()
    expect(plan).toHaveLength(HISTORY_RECONSTRUCTION_SEGMENT_COUNT)
    expect(plan[0]).toEqual({ id: 0, startLedgerIndex: 3_800_886, endLedgerIndex: 3_801_385, ledgerCount: 500 })
    expect(plan[224]).toEqual({ id: 224, startLedgerIndex: 3_912_886, endLedgerIndex: 3_913_385, ledgerCount: 500 })
    expect(plan[262]).toEqual({ id: 262, startLedgerIndex: 3_931_886, endLedgerIndex: 3_932_301, ledgerCount: 416 })
  })

  it('requires explicit zero semantic counts and rejects production mutation', () => {
    const value = checkpoint(0)
    value.semanticCounts.protocolEvents = 0
    expect(() => assertRawCheckpoint(value)).not.toThrow()
    const missing = structuredClone(value) as unknown as Record<string, unknown>
    delete (missing.semanticCounts as Record<string, unknown>).protocolEvents
    expect(() => assertRawCheckpoint(missing)).toThrow('unexpected or missing')
    expect(() => assertRawCheckpoint({ ...value, productionMutation: true })).toThrow('fail-closed')
  })

  it('strictly validates attempt identity and complete ledger identity', () => {
    expect(() => assertAttempt({
      schemaVersion: 1,
      kind: 'immutable-history-attempt',
      reconstructionId: HISTORY_RECONSTRUCTION_ID,
      segmentId: 0,
      attempt: 1,
      state: 'started',
      lastSuccessfulLedgerIndex: null,
      lastSuccessfulLedgerHash: null,
      lastPersistedCheckpointDigest: null,
      productionMutation: false,
    })).not.toThrow()
  })

  it('strictly validates spill, super-bucket, and reconciliation evidence', () => {
    expect(() => assertSpillShardEvidence({ schemaVersion: 1, kind: 'history-exact-spill-shard', reconstructionId: HISTORY_RECONSTRUCTION_ID, shardId: 0, rawInputDigest: H('a'), firstSegmentId: 0, lastSegmentId: 3, superBucketCount: 16, recordCount: 5, digest: H('b'), productionMutation: false })).not.toThrow()
    expect(() => assertSuperBucketEvidence({ schemaVersion: 1, kind: 'history-exact-super-bucket', reconstructionId: HISTORY_RECONSTRUCTION_ID, superBucket: 2, rawInputDigest: H('a'), firstBucket: 32, lastBucket: 47, recordCount: 5, digest: H('b'), productionMutation: false })).not.toThrow()
    expect(() => assertReconciliationEvidence({ schemaVersion: 1, kind: 'history-reconstruction-reconciliation', reconstructionId: HISTORY_RECONSTRUCTION_ID, phase: 'raw', expectedRecords: 5, actualRecords: 5, conflicts: 0, passed: true, productionMutation: false })).not.toThrow()
  })
})

describe('bounded four-segment fixture', () => {
  it('contains every semantic class and keeps empty classes explicit', () => {
    expect(HISTORY_RECONSTRUCTION_FIXTURE.segments).toHaveLength(4)
    expect(HISTORY_RECONSTRUCTION_FIXTURE.segments[1]?.semantics.protocolEvents).toEqual([])
    const totals = HISTORY_RECONSTRUCTION_FIXTURE.segments.reduce((result, segment) => ({
      protocolEvents: result.protocolEvents + segment.semantics.protocolEvents.length,
      objectChanges: result.objectChanges + segment.semantics.objectChanges.length,
      loanLifecycle: result.loanLifecycle + segment.semantics.loanLifecycle.length,
      archivedObjects: result.archivedObjects + segment.semantics.archivedObjects.length,
      balanceHistory: result.balanceHistory + segment.semantics.balanceHistory.length,
    }), { protocolEvents: 0, objectChanges: 0, loanLifecycle: 0, archivedObjects: 0, balanceHistory: 0 })
    expect(Object.values(totals).every((count) => count > 0)).toBe(true)
  })

  it('verifies continuity and the fixed fixture transaction/object witness', () => {
    expect(() => assertFixtureContinuity()).not.toThrow()
    expect(findFixtureWitness()).toEqual({ transactionFound: true, objectChangeFound: true })
  })

  it('rejects a deliberate fixture discontinuity', () => {
    const fixture = {
      segments: HISTORY_RECONSTRUCTION_FIXTURE.segments.map((segment, index) => ({
        ...segment,
        startParentHash: index === 2 ? 'F'.repeat(64) : segment.startParentHash,
      })),
    }
    expect(() => assertFixtureContinuity(fixture)).toThrow('parent-hash discontinuity')
  })
})

describe('largest contiguous prefix discovery', () => {
  it('accepts an identical retry and resumes after the prefix', async () => {
    const first = checkpoint(0)
    const firstDigest = await digest(first)
    const second = checkpoint(1, { predecessorDigest: firstDigest, firstParentHash: first.terminalHash })
    const result = await discoverResume([first, structuredClone(first), second])
    expect(result.prefix.map((item) => item.checkpoint.segmentId)).toEqual([0, 1])
    expect(result.rejected.map((item) => item.classification)).toContain('duplicate_identical')
    expect(result.nextSegmentId).toBe(2)
  })

  it('rejects future/orphan checkpoints and resumes at the first gap', async () => {
    const orphan = checkpoint(2, { predecessorDigest: H('b') })
    const result = await discoverResume([orphan])
    expect(result.prefix).toEqual([])
    expect(result.rejected[0]?.classification).toBe('orphan')
    expect(result.nextSegmentId).toBe(0)
  })

  it('fails on conflicting same-range digests', async () => {
    await expect(discoverResume([checkpoint(0), checkpoint(0, { manifestSha256: H('b') })]))
      .rejects.toThrow('Conflicting checkpoint digests')
  })

  it('fails on a parent-hash discontinuity', async () => {
    await expect(discoverResume([checkpoint(0, { firstParentHash: H('F') })]))
      .rejects.toThrow('Parent-hash discontinuity')
  })

  it('classifies a checkpoint from another reconstruction as stale-plan', () => {
    expect(classifyCheckpointPlan({ ...checkpoint(0), reconstructionId: 'old-plan' })).toBe('stale_plan')
  })
})

describe('fixture exact spill planning', () => {
  const record = (term: string, ledgerIndex: number, kind: HistoryExactIndexRecord['reference']['kind'] = 'object_change'): Omit<HistoryExactIndexRecord, 'bucket'> => {
    const fileKinds = {
      transaction_event: 'protocol_events', object_change: 'object_changes', archived_object: 'archived_objects',
      loan_lifecycle: 'loan_lifecycle', balance_history: 'balance_history',
    } as const
    const searchKinds = {
      transaction_event: 'transaction', object_change: 'object_change', archived_object: 'archived_object',
      loan_lifecycle: 'loan_lifecycle',
    } as const
    return {
      schemaVersion: 2,
      term,
      reference: {
        kind,
        segmentId: 'fixture-segment',
        fileKind: fileKinds[kind],
        ledgerIndex,
        searchResult: kind === 'balance_history' ? null : {
          kind: searchKinds[kind],
          epochId: 'fixture-epoch',
          ledgerIndex,
          transactionHash: `TX-${ledgerIndex}`,
          objectType: 'Vault',
          objectId: 'FIXTURE-VAULT',
          loanId: kind === 'loan_lifecycle' ? 'FIXTURE-LOAN' : null,
        },
      },
    }
  }

  it('uses the existing bucket hash and produces deterministic super-buckets', async () => {
    const inputs = [
      record('FIXTURE-TRANSACTION', 1001, 'transaction_event'),
      record('FIXTURE-OBJECT', 1002, 'object_change'),
      record('FIXTURE-ARCHIVE', 1003, 'archived_object'),
      record('FIXTURE-LOAN', 1004, 'loan_lifecycle'),
      record('FIXTURE-BALANCE', 1005, 'balance_history'),
    ]
    const first = await planExactSpill(inputs)
    const second = await planExactSpill([...inputs].reverse())
    expect(second).toEqual(first)
    expect([...splitExactSuperBuckets(first).keys()]).toEqual(Array.from({ length: 16 }, (_, index) => index))
    expect(first.every((item) => item.superBucket === Math.floor(item.record.bucket / 16))).toBe(true)
  })
})

describe('production-compatible final tree planning', () => {
  const digestValue = H('a')
  const entries = [
    { path: 'history-channel.json', sha256: digestValue },
    { path: 'history/publication.json', sha256: digestValue },
    ...['manifest.json', 'ledgers.ndjson.gz', 'protocol-events.ndjson.gz', 'object-changes.ndjson.gz', 'loan-lifecycle.ndjson.gz', 'archived-objects.ndjson.gz', 'balance-history.ndjson.gz', 'current-projection-mutations.ndjson.gz'].map((file) => ({ path: `history/fixture-epoch/fixture-segment/${file}`, sha256: digestValue })),
    { path: 'history/index/exact/manifest.json', sha256: digestValue },
    ...Array.from({ length: 256 }, (_, bucket) => ({
      path: `history/index/exact/${String(bucket).padStart(4, '0')}.ndjson.gz`,
      sha256: digestValue,
    })),
  ]

  it('builds a deterministic canonical path plan with 256 buckets', () => {
    const first = planFinalTree(entries)
    expect(planFinalTree([...entries].reverse())).toEqual(first)
    expect(first[0]?.path).toBe('history-channel.json')
  })

  it.each(['../history-channel.json', '/history/publication.json', 'repair/v1/state.json', 'history/x/y/unknown.gz'])(
    'rejects unsafe or noncanonical path %s',
    (path: string) => expect(() => assertProductionHistoryPath(path)).toThrow(),
  )
})
