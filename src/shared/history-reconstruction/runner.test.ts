import { describe, expect, it } from 'vitest'

import type { HistorySegmentManifest } from '../history-segments/manifest'
import { planFinalTree } from './final-tree'
import {
  HISTORY_RECONSTRUCTION_ACTIVE_END_HASH,
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  reconstructionSegmentRange,
} from './identity'
import { discoverResume } from './resume'
import {
  assertAppendableCheckpoint,
  buildRawCheckpoint,
  checkpointFileName,
  committedCheckpointFiles,
  rawCheckpointDigest,
  spillShardForSegment,
  spillShardRange,
} from './runner'

const SOURCE_SHA = 'a'.repeat(40)
const FILE_SHA = 'b'.repeat(64)

function manifestFor(id: number, options?: {
  parentHash?: string
  previousSegmentId?: string | null
  previousSegmentEndHash?: string | null
  terminalHash?: string
}): HistorySegmentManifest {
  const range = reconstructionSegmentRange(id)
  const segmentId = `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${range.startLedgerIndex}-${range.endLedgerIndex}`
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: HISTORY_RECONSTRUCTION_EPOCH_ID,
    segmentId,
    startLedgerIndex: range.startLedgerIndex,
    startLedgerHash: 'C'.repeat(64),
    startParentHash: options?.parentHash ?? HISTORY_RECONSTRUCTION_ACTIVE_END_HASH,
    endLedgerIndex: range.endLedgerIndex,
    endLedgerHash: options?.terminalHash ?? 'D'.repeat(64),
    ledgerCount: range.ledgerCount,
    sourceRevision: SOURCE_SHA,
    generatedAt: '2026-07-27T00:00:00.000Z',
    previousSegmentId: options?.previousSegmentId ?? null,
    previousSegmentEndHash: options?.previousSegmentEndHash ?? null,
    files: [
      { kind: 'ledgers', path: 'ledgers.ndjson.gz', bytes: 1, records: range.ledgerCount, sha256: FILE_SHA },
      { kind: 'protocol_events', path: 'protocol-events.ndjson.gz', bytes: 1, records: 2, sha256: FILE_SHA },
      { kind: 'object_changes', path: 'object-changes.ndjson.gz', bytes: 1, records: 3, sha256: FILE_SHA },
      { kind: 'loan_lifecycle', path: 'loan-lifecycle.ndjson.gz', bytes: 1, records: 4, sha256: FILE_SHA },
      { kind: 'archived_objects', path: 'archived-objects.ndjson.gz', bytes: 1, records: 5, sha256: FILE_SHA },
      { kind: 'balance_history', path: 'balance-history.ndjson.gz', bytes: 1, records: 6, sha256: FILE_SHA },
      { kind: 'current_projection_mutations', path: 'current-projection-mutations.ndjson.gz', bytes: 1, records: 7, sha256: FILE_SHA },
    ],
  }
}

describe('immutable history reconstruction runner primitives', () => {
  it('ignores abrupt-termination temporary files and orders committed checkpoints', () => {
    expect(committedCheckpointFiles([
      '0002.json',
      '0001.json.tmp-99',
      '0000.json',
      '0001.partial',
      '0001.json',
    ])).toEqual(['0000.json', '0001.json', '0002.json'])
    expect(checkpointFileName(262)).toBe('0262.json')
    expect(() => committedCheckpointFiles(['0000.json', 'operator-notes.txt'])).toThrow('Unexpected checkpoint file')
  })

  it('covers all 263 segments with exactly 33 deterministic spill shards', () => {
    const ranges = Array.from({ length: 33 }, (_, shardId) => spillShardRange(shardId))
    expect(ranges[0]).toEqual({ shardId: 0, firstSegmentId: 0, lastSegmentId: 7 })
    expect(ranges.at(-1)).toEqual({ shardId: 32, firstSegmentId: 256, lastSegmentId: 262 })
    const covered = ranges.flatMap((range) => Array.from(
      { length: range.lastSegmentId - range.firstSegmentId + 1 },
      (_, offset) => range.firstSegmentId + offset,
    ))
    expect(covered).toEqual(Array.from({ length: 263 }, (_, id) => id))
    expect(spillShardForSegment(262)).toBe(32)
  })

  it('builds a resumable parent-hash-linked checkpoint prefix', async () => {
    const firstManifest = manifestFor(0, { terminalHash: '1'.repeat(64) })
    const first = await buildRawCheckpoint({
      segmentId: 0,
      manifest: firstManifest,
      manifestText: `${JSON.stringify(firstManifest)}\n`,
      sourceImplementationSha: SOURCE_SHA,
      predecessor: null,
    })
    const firstDigest = await rawCheckpointDigest(first)
    const firstRange = reconstructionSegmentRange(0)
    const secondManifest = manifestFor(1, {
      parentHash: first.terminalHash,
      previousSegmentId: `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${firstRange.startLedgerIndex}-${firstRange.endLedgerIndex}`,
      previousSegmentEndHash: first.terminalHash,
      terminalHash: '2'.repeat(64),
    })
    const second = await buildRawCheckpoint({
      segmentId: 1,
      manifest: secondManifest,
      manifestText: `${JSON.stringify(secondManifest)}\n`,
      sourceImplementationSha: SOURCE_SHA,
      predecessor: { checkpoint: first, digest: firstDigest },
    })
    await expect(assertAppendableCheckpoint({ checkpoints: [first], candidate: second })).resolves.toBeUndefined()
    expect(second.predecessorDigest).toBe(firstDigest)
    expect(second.semanticCounts).toEqual({
      protocolEvents: 2,
      objectChanges: 3,
      loanLifecycle: 4,
      archivedObjects: 5,
      balanceHistory: 6,
    })
  })

  it('fails closed on conflicting checkpoint digests', async () => {
    const manifest = manifestFor(0, { terminalHash: '1'.repeat(64) })
    const checkpoint = await buildRawCheckpoint({
      segmentId: 0,
      manifest,
      manifestText: `${JSON.stringify(manifest)}\n`,
      sourceImplementationSha: SOURCE_SHA,
      predecessor: null,
    })
    const conflict = { ...checkpoint, terminalHash: '9'.repeat(64) }
    await expect(discoverResume([checkpoint, conflict])).rejects.toThrow('Conflicting checkpoint digests')
  })

  it('fails closed on a parent-hash discontinuity', async () => {
    const firstManifest = manifestFor(0, { terminalHash: '1'.repeat(64) })
    const first = await buildRawCheckpoint({
      segmentId: 0,
      manifest: firstManifest,
      manifestText: `${JSON.stringify(firstManifest)}\n`,
      sourceImplementationSha: SOURCE_SHA,
      predecessor: null,
    })
    const firstDigest = await rawCheckpointDigest(first)
    const firstRange = reconstructionSegmentRange(0)
    const broken = manifestFor(1, {
      parentHash: 'F'.repeat(64),
      previousSegmentId: `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${firstRange.startLedgerIndex}-${firstRange.endLedgerIndex}`,
      previousSegmentEndHash: first.terminalHash,
    })
    await expect(buildRawCheckpoint({
      segmentId: 1,
      manifest: broken,
      manifestText: `${JSON.stringify(broken)}\n`,
      sourceImplementationSha: SOURCE_SHA,
      predecessor: { checkpoint: first, digest: firstDigest },
    })).rejects.toThrow('Parent-hash discontinuity')
  })

  it('fails closed when one of the 256 exact-index buckets is absent', () => {
    const entries = [
      { path: 'history-channel.json', sha256: FILE_SHA },
      { path: 'history/publication.json', sha256: FILE_SHA },
      { path: 'history/index/exact/manifest.json', sha256: FILE_SHA },
      ...Array.from({ length: 255 }, (_, bucket) => ({
        path: `history/index/exact/${String(bucket).padStart(4, '0')}.ndjson.gz`,
        sha256: FILE_SHA,
      })),
    ]
    expect(() => planFinalTree(entries)).toThrow('exactly 256 exact-index buckets')
  })
})
