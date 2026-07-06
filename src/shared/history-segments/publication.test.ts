import { describe, expect, it } from 'vitest'
import {
  assertHistorySegmentChainPublication,
  assertHistorySegmentPublicationDigest,
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from './publication'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const D = 'D'.repeat(64)
const E = 'E'.repeat(64)
const H = 'a'.repeat(64)

const counts = (ledgers: number) => ({
  ledgers,
  protocol_events: 2,
  object_changes: 3,
  loan_lifecycle: 0,
  archived_objects: 0,
  balance_history: 0,
  current_projection_mutations: 1,
})

async function valid(): Promise<HistorySegmentChainPublication> {
  const value: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    chainId: 'chain-101-110',
    complete: true,
    startLedgerIndex: 101,
    startLedgerHash: B,
    startParentHash: A,
    endLedgerIndex: 110,
    endLedgerHash: E,
    segmentCount: 2,
    ledgerCount: 10,
    sourceRevision: 'deadbeef',
    publishedAt: '2026-07-06T00:00:00.000Z',
    segments: [
      {
        segmentId: 's-101-105', manifestPath: 'history/s-101-105/manifest.json', manifestSha256: H,
        startLedgerIndex: 101, startLedgerHash: B, startParentHash: A,
        endLedgerIndex: 105, endLedgerHash: C, ledgerCount: 5,
        previousSegmentId: null, previousSegmentEndHash: null, recordCounts: counts(5),
      },
      {
        segmentId: 's-106-110', manifestPath: 'history/s-106-110/manifest.json', manifestSha256: H,
        startLedgerIndex: 106, startLedgerHash: D, startParentHash: C,
        endLedgerIndex: 110, endLedgerHash: E, ledgerCount: 5,
        previousSegmentId: 's-101-105', previousSegmentEndHash: C, recordCounts: counts(5),
      },
    ],
    publicationSha256: H,
  }
  value.publicationSha256 = await historySegmentPublicationDigest(value)
  return value
}

describe('history segment publication', () => {
  it('accepts a contiguous publication and valid digest', async () => {
    const value = await valid()
    expect(() => assertHistorySegmentChainPublication(value)).not.toThrow()
    await expect(assertHistorySegmentPublicationDigest(value)).resolves.toBeUndefined()
  })

  it('rejects duplicate IDs', async () => {
    const value = await valid()
    value.segments[1] = { ...value.segments[1]!, segmentId: value.segments[0]!.segmentId }
    expect(() => assertHistorySegmentChainPublication(value)).toThrow('Duplicate')
  })

  it('rejects a ledger gap', async () => {
    const value = await valid()
    value.segments[1] = { ...value.segments[1]!, startLedgerIndex: 107, ledgerCount: 4, recordCounts: counts(4) }
    expect(() => assertHistorySegmentChainPublication(value)).toThrow('not contiguous')
  })

  it('rejects predecessor hash disagreement', async () => {
    const value = await valid()
    value.segments[1] = { ...value.segments[1]!, previousSegmentEndHash: A }
    expect(() => assertHistorySegmentChainPublication(value)).toThrow('predecessor hash mismatch')
  })

  it('rejects boundary disagreement', async () => {
    const value = await valid()
    value.endLedgerHash = D
    expect(() => assertHistorySegmentChainPublication(value)).toThrow('end boundary mismatch')
  })

  it('rejects semantic digest mismatch', async () => {
    const value = await valid()
    value.sourceRevision = 'changed'
    await expect(assertHistorySegmentPublicationDigest(value)).rejects.toThrow('digest mismatch')
  })
})
