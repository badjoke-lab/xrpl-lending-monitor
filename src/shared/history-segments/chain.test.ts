import { describe, expect, it } from 'vitest'

import {
  HISTORY_SEGMENT_FILE_KINDS,
  type HistorySegmentManifest,
} from './manifest'
import { assertHistorySegmentChain } from './chain'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const D = 'D'.repeat(64)
const E = 'E'.repeat(64)
const F = 'F'.repeat(64)
const DIGEST = 'a'.repeat(64)

function segment(options: {
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

function validChain(): HistorySegmentManifest[] {
  const first = segment({
    segmentId: 's-101-105',
    start: 101,
    end: 105,
    startHash: B,
    startParentHash: A,
    endHash: C,
    previousSegmentId: null,
    previousSegmentEndHash: null,
  })
  const second = segment({
    segmentId: 's-106-110',
    start: 106,
    end: 110,
    startHash: D,
    startParentHash: C,
    endHash: E,
    previousSegmentId: first.segmentId,
    previousSegmentEndHash: first.endLedgerHash,
  })
  const third = segment({
    segmentId: 's-111-115',
    start: 111,
    end: 115,
    startHash: F,
    startParentHash: E,
    endHash: B,
    previousSegmentId: second.segmentId,
    previousSegmentEndHash: second.endLedgerHash,
  })
  return [first, second, third]
}

const expectation = {
  network: 'devnet' as const,
  epochId: 'devnet-test',
  startLedgerIndex: 101,
  startParentHash: A,
  previousSegmentId: null,
  previousSegmentEndHash: null,
  endLedgerIndex: 115,
  endLedgerHash: B,
}

describe('history segment chain verifier', () => {
  it('accepts an exactly anchored contiguous chain and returns its coverage summary', () => {
    expect(assertHistorySegmentChain(validChain(), expectation)).toEqual({
      segmentCount: 3,
      ledgerCount: 15,
      startLedgerIndex: 101,
      startLedgerHash: B,
      startParentHash: A,
      endLedgerIndex: 115,
      endLedgerHash: B,
    })
  })

  it('rejects duplicate segment identities', () => {
    const chain = validChain()
    chain[2] = { ...chain[2]!, segmentId: chain[1]!.segmentId }
    expect(() => assertHistorySegmentChain(chain, expectation)).toThrow('Duplicate history segment ID')
  })

  it('rejects a start anchor mismatch', () => {
    expect(() => assertHistorySegmentChain(validChain(), {
      ...expectation,
      startLedgerIndex: 100,
    })).toThrow('start ledger')
  })

  it('rejects an internal ledger gap', () => {
    const chain = validChain()
    const second = chain[1]!
    chain[1] = {
      ...second,
      startLedgerIndex: 107,
      ledgerCount: second.endLedgerIndex - 107 + 1,
      files: second.files.map((file) => file.kind === 'ledgers'
        ? { ...file, records: second.endLedgerIndex - 107 + 1 }
        : file),
    }
    expect(() => assertHistorySegmentChain(chain, expectation)).toThrow('indexes are not contiguous')
  })

  it('rejects an internal parent-hash discontinuity', () => {
    const chain = validChain()
    chain[1] = { ...chain[1]!, startParentHash: A }
    expect(() => assertHistorySegmentChain(chain, expectation)).toThrow('parent hash')
  })

  it('rejects a terminal boundary mismatch', () => {
    expect(() => assertHistorySegmentChain(validChain(), {
      ...expectation,
      endLedgerHash: C,
    })).toThrow('end hash')
  })
})
