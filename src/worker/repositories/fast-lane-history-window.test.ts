import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import {
  decodeFastLaneHistoryPayload,
  fastLaneHistoryPayloadBytes,
  isCompressedFastLaneHistoryPayload,
} from './fast-lane-history-codec'
import {
  buildBoundedFastLaneHistoryWindow,
  buildFastLaneHistoryBundle,
  MAX_FAST_LANE_HISTORY_BUNDLE_BYTES,
} from './fast-lane-history-window'

const TRANSACTION = 'A'.repeat(64)
const LEDGER = 'C'.repeat(64)
const PARENT = 'P'.repeat(64)
const LOAN = 'L'.repeat(64)
const BROKER = 'B'.repeat(64)

function loanFields() {
  return {
    Borrower: 'rBorrower',
    Flags: 0,
    LoanBrokerID: BROKER,
    LoanSequence: 7,
    StartDate: 1000,
    PaymentInterval: 300,
    GracePeriod: 20,
    PreviousPaymentDueDate: 1000,
    NextPaymentDueDate: 1300,
    PaymentRemaining: 3,
    PrincipalOutstanding: '900',
    TotalValueOutstanding: '990',
    PeriodicPayment: '330',
  }
}

function scan(): IncrementalScanResult {
  const event = {
    hash: TRANSACTION,
    transactionType: 'LoanSet',
    account: 'rAccount',
    sequence: 1,
    fee: '10',
    result: 'tesSUCCESS',
    transactionIndex: 2,
    transaction: { TransactionType: 'LoanSet', Account: 'rAccount' },
    metadata: {
      TransactionResult: 'tesSUCCESS',
      TransactionIndex: 2,
      AffectedNodes: [{
        CreatedNode: {
          LedgerEntryType: 'Loan',
          LedgerIndex: LOAN,
          NewFields: loanFields(),
        },
      }],
    },
  }
  return {
    endpoint: 'wss://example.invalid/',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    latestValidatedLedger: 101,
    completeToLatest: true,
    ledgers: [{
      endpoint: 'wss://example.invalid/',
      ledgerIndex: 101,
      ledgerHash: LEDGER,
      parentHash: PARENT,
      closeTime: 1234,
      transactions: [event],
      lendingTransactions: [event],
    }],
    metrics: {
      ledgers: 1,
      inspectedTransactions: 1,
      lendingTransactions: 1,
      elapsedMs: 10,
    },
  }
}

function uniqueHash(index: number): string {
  return createHash('sha256').update(`fast-lane-history-${index}`).digest('hex').toUpperCase()
}

function manyEvents(
  template: IncrementalScanResult['ledgers'][number]['lendingTransactions'][number],
  count: number,
) {
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    hash: uniqueHash(index),
    transactionIndex: index,
    metadata: { TransactionResult: 'tesSUCCESS', TransactionIndex: index, AffectedNodes: [] },
  }))
}

describe('fast-lane compact history bundle', () => {
  it('records activity and semantic history from the exact fast-lane scan window', () => {
    const bundle = buildFastLaneHistoryBundle({
      scan: scan(),
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-13T09:00:00.000Z',
    })

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      epochId: 'devnet-epoch-1',
      startLedgerIndex: 101,
      endLedgerIndex: 101,
      endLedgerHash: LEDGER,
      createdAt: '2026-07-13T09:00:00.000Z',
    })
    expect(bundle.protocolEvents).toEqual([{
      eventHash: TRANSACTION,
      epochId: 'devnet-epoch-1',
      ledgerIndex: 101,
      eventIndex: 2,
      closeTime: 1234,
      eventType: 'LoanSet',
      resultCode: 'tesSUCCESS',
      payloadRetained: false,
      sourceJson: null,
      metadataJson: null,
      createdAt: '2026-07-13T09:00:00.000Z',
    }])
    expect(bundle.objectChanges.length).toBeGreaterThan(0)
    expect(bundle.objectChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transactionHash: TRANSACTION,
        objectType: 'Loan',
        objectId: LOAN,
        action: 'created',
      }),
    ]))
    expect(bundle.loanLifecycle).toEqual([
      expect.objectContaining({
        loanId: LOAN,
        transactionHash: TRANSACTION,
        eventType: 'created',
      }),
    ])
    expect(bundle.archivedObjects).toEqual([])
    expect(bundle.balanceHistory).toEqual([])
  })

  it('compresses, bounds, and round-trips the full semantic bundle', async () => {
    const bounded = await buildBoundedFastLaneHistoryWindow({
      scan: scan(),
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-13T09:00:00.000Z',
    })

    expect(bounded.reduced).toBe(false)
    expect(isCompressedFastLaneHistoryPayload(bounded.encodedBundle)).toBe(true)
    expect(bounded.encodedBytes).toBe(fastLaneHistoryPayloadBytes(bounded.encodedBundle))
    expect(bounded.encodedBytes).toBeLessThanOrEqual(MAX_FAST_LANE_HISTORY_BUNDLE_BYTES)
    await expect(decodeFastLaneHistoryPayload(bounded.encodedBundle)).resolves.toEqual(bounded.bundle)
  })

  it('reduces a range only when its compressed representation exceeds the limit', async () => {
    const input = scan()
    const first = input.ledgers[0]
    const template = first?.lendingTransactions[0]
    if (!first || !template) throw new Error('test fixture is incomplete')
    const denseEvents = manyEvents(template, 8_000)
    input.ledgers = [
      first,
      {
        ...first,
        ledgerIndex: 102,
        ledgerHash: 'D'.repeat(64),
        parentHash: first.ledgerHash,
        closeTime: 1235,
        transactions: denseEvents,
        lendingTransactions: denseEvents,
      },
    ]
    input.endLedgerIndex = 102
    input.latestValidatedLedger = 102
    input.metrics.ledgers = 2
    input.metrics.inspectedTransactions = 1 + denseEvents.length
    input.metrics.lendingTransactions = 1 + denseEvents.length

    const bounded = await buildBoundedFastLaneHistoryWindow({
      scan: input,
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-13T09:00:00.000Z',
    })

    expect(bounded.reduced).toBe(true)
    expect(bounded.scan.ledgers).toHaveLength(1)
    expect(bounded.scan.endLedgerIndex).toBe(101)
    expect(bounded.bundle.endLedgerIndex).toBe(101)
    expect(bounded.encodedBytes).toBeLessThanOrEqual(MAX_FAST_LANE_HISTORY_BUNDLE_BYTES)
  }, 30_000)

  it('fails before persistence when one ledger exceeds the compressed byte limit', async () => {
    const oversized = scan()
    const template = oversized.ledgers[0]?.lendingTransactions[0]
    if (!template || !oversized.ledgers[0]) throw new Error('test fixture is incomplete')
    const events = manyEvents(template, 8_000)
    oversized.ledgers[0].transactions = events
    oversized.ledgers[0].lendingTransactions = events
    oversized.metrics.inspectedTransactions = events.length
    oversized.metrics.lendingTransactions = events.length

    await expect(buildBoundedFastLaneHistoryWindow({
      scan: oversized,
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-13T09:00:00.000Z',
    })).rejects.toThrow('exceeds the persistence limit')
  }, 30_000)

  it('keeps legacy plain JSON readable during the rolling format transition', async () => {
    const bundle = buildFastLaneHistoryBundle({
      scan: scan(),
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-13T09:00:00.000Z',
    })
    await expect(decodeFastLaneHistoryPayload(JSON.stringify(bundle))).resolves.toEqual(bundle)
  })

  it('rejects an empty scan', () => {
    const empty = scan()
    empty.ledgers = []
    empty.endLedgerIndex = null

    expect(() => buildFastLaneHistoryBundle({
      scan: empty,
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-13T09:00:00.000Z',
    })).toThrow('non-empty scan')
  })
})
