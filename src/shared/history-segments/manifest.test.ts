import { describe, expect, it } from 'vitest'

import {
  HISTORY_SEGMENT_FILE_KINDS,
  assertAdjacentHistorySegments,
  assertHistorySegmentManifest,
  type HistorySegmentManifest,
} from './manifest'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const D = 'D'.repeat(64)

function manifest(options: {
  segmentId?: string
  start?: number
  end?: number
  startHash?: string
  startParentHash?: string
  endHash?: string
  previousSegmentId?: string | null
  previousSegmentEndHash?: string | null
} = {}): HistorySegmentManifest {
  const start = options.start ?? 101
  const end = options.end ?? 110
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    segmentId: options.segmentId ?? 'segment-101-110',
    startLedgerIndex: start,
    startLedgerHash: options.startHash ?? B,
    startParentHash: options.startParentHash ?? A,
    endLedgerIndex: end,
    endLedgerHash: options.endHash ?? C,
    ledgerCount: end - start + 1,
    sourceRevision: 'deadbeef',
    generatedAt: '2026-07-06T00:00:00.000Z',
    previousSegmentId: options.previousSegmentId ?? null,
    previousSegmentEndHash: options.previousSegmentEndHash ?? null,
    files: HISTORY_SEGMENT_FILE_KINDS.map((kind) => ({
      kind,
      path: `${kind}.ndjson.gz`,
      bytes: 100,
      records: kind === 'ledgers' ? end - start + 1 : 0,
      sha256: D,
    })),
  }
}

describe('history segment manifest', () => {
  it('accepts a complete deterministic segment contract', () => {
    expect(() => assertHistorySegmentManifest(manifest())).not.toThrow()
  })

  it('rejects a ledger count that disagrees with the inclusive range', () => {
    const input = manifest()
    input.ledgerCount = 9
    expect(() => assertHistorySegmentManifest(input)).toThrow('ledger count')
  })

  it('rejects missing required file kinds', () => {
    const input = manifest()
    input.files = input.files.filter((file) => file.kind !== 'balance_history')
    expect(() => assertHistorySegmentManifest(input)).toThrow('missing file kinds')
  })

  it('rejects previous segment identity without its terminal hash', () => {
    const input = manifest({ previousSegmentId: 'segment-91-100' })
    expect(() => assertHistorySegmentManifest(input)).toThrow('both present or both null')
  })
})

describe('adjacent history segments', () => {
  it('accepts exact segment ID, ledger index, and hash linkage', () => {
    const previous = manifest({ segmentId: 'segment-101-110', endHash: C })
    const next = manifest({
      segmentId: 'segment-111-120',
      start: 111,
      end: 120,
      startHash: D,
      startParentHash: C,
      endHash: A,
      previousSegmentId: previous.segmentId,
      previousSegmentEndHash: previous.endLedgerHash,
    })
    expect(() => assertAdjacentHistorySegments(previous, next)).not.toThrow()
  })

  it('rejects a ledger index gap even when previous metadata is present', () => {
    const previous = manifest({ segmentId: 'segment-101-110', endHash: C })
    const next = manifest({
      segmentId: 'segment-112-121',
      start: 112,
      end: 121,
      startParentHash: C,
      previousSegmentId: previous.segmentId,
      previousSegmentEndHash: previous.endLedgerHash,
    })
    expect(() => assertAdjacentHistorySegments(previous, next)).toThrow('indexes are not contiguous')
  })

  it('rejects a parent-hash discontinuity', () => {
    const previous = manifest({ segmentId: 'segment-101-110', endHash: C })
    const next = manifest({
      segmentId: 'segment-111-120',
      start: 111,
      end: 120,
      startParentHash: B,
      previousSegmentId: previous.segmentId,
      previousSegmentEndHash: previous.endLedgerHash,
    })
    expect(() => assertAdjacentHistorySegments(previous, next)).toThrow('parent hash')
  })
})
