import { describe, expect, it } from 'vitest'

import {
  HISTORY_SEGMENT_FILE_KINDS,
  type HistorySegmentManifest,
} from './manifest'
import {
  advanceHistorySegmentCheckpoint,
  assertHistorySegmentCheckpoint,
  createHistorySegmentCheckpoint,
  historySegmentCheckpointComplete,
  type HistorySegmentCheckpoint,
} from './checkpoint'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const D = 'D'.repeat(64)
const E = 'E'.repeat(64)
const DIGEST = 'a'.repeat(64)

function manifest(options: {
  segmentId: string
  start: number
  end: number
  startHash: string
  startParentHash: string
  endHash: string
  previousSegmentId: string | null
  previousSegmentEndHash: string | null
}): HistorySegmentManifest {
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    segmentId: options.segmentId,
    startLedgerIndex: options.start,
    startLedgerHash: options.startHash,
    startParentHash: options.startParentHash,
    endLedgerIndex: options.end,
    endLedgerHash: options.endHash,
    ledgerCount: options.end - options.start + 1,
    sourceRevision: 'deadbeef',
    generatedAt: '2026-07-06T00:00:00.000Z',
    previousSegmentId: options.previousSegmentId,
    previousSegmentEndHash: options.previousSegmentEndHash,
    files: HISTORY_SEGMENT_FILE_KINDS.map((kind) => ({
      kind,
      path: `${kind}.ndjson.gz`,
      bytes: 1,
      records: kind === 'ledgers' ? options.end - options.start + 1 : 0,
      sha256: DIGEST,
    })),
  }
}

function emptyCheckpoint(): HistorySegmentCheckpoint {
  return createHistorySegmentCheckpoint({
    network: 'devnet',
    epochId: 'devnet-test',
    rangeStartLedgerIndex: 101,
    rangeEndLedgerIndex: 110,
    previousSegmentId: null,
    previousSegmentEndHash: null,
  })
}

const first = manifest({
  segmentId: 's-101-105',
  start: 101,
  end: 105,
  startHash: B,
  startParentHash: A,
  endHash: C,
  previousSegmentId: null,
  previousSegmentEndHash: null,
})

const second = manifest({
  segmentId: 's-106-110',
  start: 106,
  end: 110,
  startHash: D,
  startParentHash: C,
  endHash: E,
  previousSegmentId: first.segmentId,
  previousSegmentEndHash: first.endLedgerHash,
})

describe('history segment checkpoint', () => {
  it('creates an empty resumable checkpoint at the requested range start', () => {
    const checkpoint = emptyCheckpoint()
    expect(checkpoint.nextLedgerIndex).toBe(101)
    expect(checkpoint.completedSegments).toEqual([])
    expect(historySegmentCheckpointComplete(checkpoint)).toBe(false)
  })

  it('advances only after complete segments and marks the range complete', () => {
    const afterFirst = advanceHistorySegmentCheckpoint({
      checkpoint: emptyCheckpoint(),
      manifest: first,
      manifestSha256: DIGEST,
    })
    expect(afterFirst.nextLedgerIndex).toBe(106)
    expect(afterFirst.previousSegmentId).toBe(first.segmentId)
    expect(historySegmentCheckpointComplete(afterFirst)).toBe(false)

    const afterSecond = advanceHistorySegmentCheckpoint({
      checkpoint: afterFirst,
      manifest: second,
      manifestSha256: DIGEST,
    })
    expect(afterSecond.nextLedgerIndex).toBe(111)
    expect(afterSecond.completedSegments.map((segment) => segment.segmentId)).toEqual([
      first.segmentId,
      second.segmentId,
    ])
    expect(historySegmentCheckpointComplete(afterSecond)).toBe(true)
  })

  it('can resume from a serialized checkpoint without losing predecessor linkage', () => {
    const saved = JSON.stringify(advanceHistorySegmentCheckpoint({
      checkpoint: emptyCheckpoint(),
      manifest: first,
      manifestSha256: DIGEST,
    }))
    const restored = JSON.parse(saved) as HistorySegmentCheckpoint
    assertHistorySegmentCheckpoint(restored)

    const complete = advanceHistorySegmentCheckpoint({
      checkpoint: restored,
      manifest: second,
      manifestSha256: DIGEST,
    })
    expect(historySegmentCheckpointComplete(complete)).toBe(true)
  })

  it('rejects a segment that does not begin at the next ledger', () => {
    const wrong = { ...first, startLedgerIndex: 102, ledgerCount: 4 }
    wrong.files = wrong.files.map((file) => file.kind === 'ledgers'
      ? { ...file, records: 4 }
      : file)
    expect(() => advanceHistorySegmentCheckpoint({
      checkpoint: emptyCheckpoint(),
      manifest: wrong,
      manifestSha256: DIGEST,
    })).toThrow('checkpoint next ledger')
  })

  it('rejects a segment with the wrong predecessor hash', () => {
    const afterFirst = advanceHistorySegmentCheckpoint({
      checkpoint: emptyCheckpoint(),
      manifest: first,
      manifestSha256: DIGEST,
    })
    expect(() => advanceHistorySegmentCheckpoint({
      checkpoint: afterFirst,
      manifest: { ...second, previousSegmentEndHash: A },
      manifestSha256: DIGEST,
    })).toThrow('previous hash')
  })

  it('rejects a segment that exceeds the requested range', () => {
    const oversized = manifest({
      segmentId: 's-101-111',
      start: 101,
      end: 111,
      startHash: B,
      startParentHash: A,
      endHash: C,
      previousSegmentId: null,
      previousSegmentEndHash: null,
    })
    expect(() => advanceHistorySegmentCheckpoint({
      checkpoint: emptyCheckpoint(),
      manifest: oversized,
      manifestSha256: DIGEST,
    })).toThrow('range end')
  })

  it('rejects a corrupted checkpoint whose next ledger skips completed coverage', () => {
    const checkpoint = advanceHistorySegmentCheckpoint({
      checkpoint: emptyCheckpoint(),
      manifest: first,
      manifestSha256: DIGEST,
    })
    expect(() => assertHistorySegmentCheckpoint({
      ...checkpoint,
      nextLedgerIndex: 107,
    })).toThrow('next ledger does not follow completed coverage')
  })

  it('rejects reusing a completed segment ID later in the range', () => {
    const afterFirst = advanceHistorySegmentCheckpoint({
      checkpoint: emptyCheckpoint(),
      manifest: first,
      manifestSha256: DIGEST,
    })
    expect(() => advanceHistorySegmentCheckpoint({
      checkpoint: afterFirst,
      manifest: { ...second, segmentId: first.segmentId },
      manifestSha256: DIGEST,
    })).toThrow('already been checkpointed')
  })
})
