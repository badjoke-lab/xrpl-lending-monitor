import { describe, expect, it } from 'vitest'

import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import type { HistoryExactIndexRecord } from '../history-segments/exact-index'
import { HISTORY_SEGMENT_FILE_KINDS } from '../history-segments/manifest'
import { planExactSpill, splitExactSuperBuckets } from './exact-spill'
import { assertFixtureContinuity, findFixtureWitness, HISTORY_RECONSTRUCTION_FIXTURE } from './fixture'
import { assertProductionHistoryPath, planFinalTree } from './final-tree'
import {
  HISTORY_RECONSTRUCTION_ACTIVE_END_HASH,
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
  HISTORY_RECONSTRUCTION_TARGET_HASH,
  reconstructionSegmentPlan,
  reconstructionSegmentRange,
} from './identity'
import { classifyCheckpointPlan, discoverResume } from './resume'
import { assertReadOnlyMeasurementSummary, RECONSTRUCTION_MEASUREMENT_READ_WINDOW_SIZE, RECONSTRUCTION_MEASUREMENT_SEGMENTS, RECONSTRUCTION_PROTECTION_PATHS } from './measurement'
import {
  assertAttempt,
  assertFinalReadiness,
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

async function completeCheckpointChain(): Promise<RawCheckpoint[]> {
  const result: RawCheckpoint[] = []
  let predecessorDigest: string | null = null
  let parentHash = HISTORY_RECONSTRUCTION_ACTIVE_END_HASH
  for (let segmentId = 0; segmentId < HISTORY_RECONSTRUCTION_SEGMENT_COUNT; segmentId += 1) {
    const current = checkpoint(segmentId, {
      predecessorDigest,
      firstParentHash: parentHash,
      terminalHash: segmentId === 262 ? HISTORY_RECONSTRUCTION_TARGET_HASH : H(String((segmentId % 8) + 1)),
    })
    result.push(current)
    predecessorDigest = await digest(current)
    parentHash = current.terminalHash
  }
  return result
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
    expect(() => assertSpillShardEvidence({ schemaVersion: 1, kind: 'history-exact-spill-shard', reconstructionId: HISTORY_RECONSTRUCTION_ID, shardId: 0, rawInputDigest: H('a'), firstSegmentId: 0, lastSegmentId: 7, superBucketCount: 16, recordCount: 5, digest: H('b'), productionMutation: false })).not.toThrow()
    expect(() => assertSuperBucketEvidence({ schemaVersion: 1, kind: 'history-exact-super-bucket', reconstructionId: HISTORY_RECONSTRUCTION_ID, superBucket: 2, rawInputDigest: H('a'), firstBucket: 32, lastBucket: 47, recordCount: 5, digest: H('b'), productionMutation: false })).not.toThrow()
    expect(() => assertReconciliationEvidence({ schemaVersion: 1, kind: 'history-reconstruction-reconciliation', reconstructionId: HISTORY_RECONSTRUCTION_ID, phase: 'raw', expectedRecords: 5, actualRecords: 5, conflicts: 0, passed: true, productionMutation: false })).not.toThrow()
  })

  it('rejects incomplete final readiness and invalid deterministic spill shard ranges', () => {
    expect(() => assertFinalReadiness({ schemaVersion: 1, kind: 'history-reconstruction-final-readiness', reconstructionId: HISTORY_RECONSTRUCTION_ID, rawComplete: true, exactIndexComplete: true, witnessPassed: true, finalTreePassed: true, remoteRehearsalPassed: false, productionMutation: false })).toThrow('remoteRehearsalPassed must pass')
    expect(() => assertSpillShardEvidence({ schemaVersion: 1, kind: 'history-exact-spill-shard', reconstructionId: HISTORY_RECONSTRUCTION_ID, shardId: 33, rawInputDigest: H('a'), firstSegmentId: 0, lastSegmentId: 7, superBucketCount: 16, recordCount: 5, digest: H('b'), productionMutation: false })).toThrow('out of range')
    expect(() => assertSpillShardEvidence({ schemaVersion: 1, kind: 'history-exact-spill-shard', reconstructionId: HISTORY_RECONSTRUCTION_ID, shardId: 1, rawInputDigest: H('a'), firstSegmentId: 7, lastSegmentId: 14, superBucketCount: 16, recordCount: 5, digest: H('b'), productionMutation: false })).toThrow('deterministic segment range')
    expect(() => assertSpillShardEvidence({ schemaVersion: 1, kind: 'history-exact-spill-shard', reconstructionId: HISTORY_RECONSTRUCTION_ID, shardId: 32, rawInputDigest: H('a'), firstSegmentId: 256, lastSegmentId: 262, superBucketCount: 16, recordCount: 5, digest: H('b'), productionMutation: false })).not.toThrow()
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

describe('read-only measurement evidence', () => {
  it('uses the bounded supported read window', () => expect(RECONSTRUCTION_MEASUREMENT_READ_WINDOW_SIZE).toBe(16))

  it('requires the fixed 12 ranges, seven files, witness, and no production mutation', () => {
    const segments = RECONSTRUCTION_MEASUREMENT_SEGMENTS.map((id) => ({ segmentId: id, range: reconstructionSegmentRange(id), firstParentHash: H('A'), terminalHash: H('B'), wallMilliseconds: 1, cpuUserSeconds: 1, cpuSystemSeconds: 1, peakRssKiB: 1, endpoint: 'fixture', rpc: { requests: 1, retries: 0, timeouts: 0, errors: 0, responseClasses: {} }, files: HISTORY_SEGMENT_FILE_KINDS.map((kind) => ({ kind, compressedBytes: 1, decompressedBytes: 1, recordCount: 0 })), compressedBytes: 7, decompressedBytes: 7, semanticCounts: { protocolEvents: 0, objectChanges: 0, loanLifecycle: 0, archivedObjects: 0, balanceHistory: 0 }, exactRecords: 0, witness: id === 224 ? { transactionFound: true, objectChangeFound: true } : null, productionMutation: false }))
    const exactIndexMeasurement = { extractedRecords: 0, semanticRecords: 0, amplification: null, serializedBytes: 0, peakRssKiB: 1, bucketDistribution: Array.from({ length: 256 }, () => 0), superBucketDistribution: Array.from({ length: 16 }, () => 0), productionMutation: false }
    const localGitMeasurement = { beforePack: 'count: 1', afterPack: 'packs: 1', packBytes: 1, largestBlob: 1, productionMutation: false }
    const githubProtection = RECONSTRUCTION_PROTECTION_PATHS.map((path) => ({ path, status: 404, body: { unavailable: true } }))
    const summary = { schemaVersion: 1, kind: 'read-only-history-reconstruction-measurement', status: 'passed', failures: [], segments, exactIndexMeasurement, localGitMeasurement, githubProtection, productionMutation: false }
    expect(() => assertReadOnlyMeasurementSummary(summary)).not.toThrow()
    expect(() => assertReadOnlyMeasurementSummary({ ...summary, productionMutation: true })).toThrow()
    expect(() => assertReadOnlyMeasurementSummary({ ...summary, segments: segments.map((segment) => segment.segmentId === 224 ? { ...segment, witness: { transactionFound: true, objectChangeFound: false } } : segment) })).toThrow('witness')
    expect(() => assertReadOnlyMeasurementSummary({ ...summary, localGitMeasurement: undefined })).toThrow('localGitMeasurement')
    expect(() => assertReadOnlyMeasurementSummary({ ...summary, segments: segments.map((segment, index) => index === 0 ? { ...segment, peakRssKiB: -1 } : segment) })).toThrow('peakRssKiB')
    expect(() => assertReadOnlyMeasurementSummary({ ...summary, githubProtection: githubProtection.slice(1) })).toThrow('incomplete')
    expect(() => assertReadOnlyMeasurementSummary({ ...summary, githubProtection: githubProtection.map((entry, index) => index === 1 ? githubProtection[0]! : entry) })).toThrow('duplicated')
    expect(() => assertReadOnlyMeasurementSummary({ ...summary, exactIndexMeasurement: { ...exactIndexMeasurement, productionMutation: true } })).toThrow('mutation')
    expect(() => assertReadOnlyMeasurementSummary({ schemaVersion: 1, kind: summary.kind, status: 'failed', failures: ['RPC timeout'], failedSegmentId: 32, failedPhase: 'segment-generation', segments: segments.slice(0, 2), productionMutation: false })).not.toThrow()
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

  it('requires the fixed terminal ledger and hash for a complete prefix', async () => {
    const valid = await completeCheckpointChain()
    await expect(discoverResume(valid)).resolves.toMatchObject({ nextSegmentId: null })

    const wrongHash = structuredClone(valid)
    wrongHash[262]!.terminalHash = H('F')
    await expect(discoverResume(wrongHash)).rejects.toThrow('fixed terminal ledger and hash')

    const wrongLedger = structuredClone(valid)
    wrongLedger[262]!.endLedgerIndex -= 1
    await expect(discoverResume(wrongLedger)).rejects.toThrow('deterministic plan')
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
  const segmentFiles = ['manifest.json', 'ledgers.ndjson.gz', 'protocol-events.ndjson.gz', 'object-changes.ndjson.gz', 'loan-lifecycle.ndjson.gz', 'archived-objects.ndjson.gz', 'balance-history.ndjson.gz', 'current-projection-mutations.ndjson.gz']
  const entries = [
    { path: 'history-channel.json', sha256: digestValue },
    { path: 'history/publication.json', sha256: digestValue },
    ...reconstructionSegmentPlan().flatMap((range) => {
      const segmentId = `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${range.startLedgerIndex}-${range.endLedgerIndex}`
      return segmentFiles.map((file) => ({ path: `history/${HISTORY_RECONSTRUCTION_EPOCH_ID}/${segmentId}/${file}`, sha256: digestValue }))
    }),
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

  it('rejects wrong bucket ranges, missing buckets, missing segments, and incomplete segments', () => {
    const wrongBucket = entries.map((entry) => entry.path.endsWith('/0255.ndjson.gz') ? { ...entry, path: 'history/index/exact/0256.ndjson.gz' } : entry)
    expect(() => planFinalTree(wrongBucket)).toThrow('0000 through 0255')
    expect(() => planFinalTree(entries.filter((entry) => !entry.path.endsWith('/0255.ndjson.gz')))).toThrow('256 exact-index buckets')

    const missingSegmentPrefix = `history/${HISTORY_RECONSTRUCTION_EPOCH_ID}/${HISTORY_RECONSTRUCTION_EPOCH_ID}-3800886-3801385/`
    expect(() => planFinalTree(entries.filter((entry) => !entry.path.startsWith(missingSegmentPrefix)))).toThrow('missing reconstruction segment')
    expect(() => planFinalTree(entries.filter((entry) => entry.path !== `${missingSegmentPrefix}balance-history.ndjson.gz`))).toThrow('segment is incomplete')
  })

  it.each(['../history-channel.json', '/history/publication.json', 'repair/v1/state.json', 'history/x/y/unknown.gz'])(
    'rejects unsafe or noncanonical path %s',
    (path: string) => expect(() => assertProductionHistoryPath(path)).toThrow(),
  )
})
