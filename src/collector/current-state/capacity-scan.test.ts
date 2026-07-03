import { describe, expect, it } from 'vitest'

import { measureCurrentStateCapacity } from './capacity-scan'

describe('read-only current-state capacity scan', () => {
  it('measures one complete marker page without writing storage', async () => {
    const result = await measureCurrentStateCapacity({
      endpoint: 'https://devnet.example/',
      timeoutMs: 1000,
      ledgerIndex: 123,
      ledgerHash: 'A'.repeat(64),
      existingDatabaseBytes: 10_000,
      historyReserveBytes: 20_000,
      scanBatch: async (options) => {
        await options.onPage({
          pageNumber: 1,
          markerBefore: undefined,
          markerAfter: null,
          firstLedgerIndex: null,
          lastLedgerIndex: null,
          decodedObjects: 2_048,
          vaults: [],
          loanBrokers: [],
          loans: [],
        })
        return {
          endpoint: options.endpoint,
          ledgerHash: options.ledgerHash,
          ledgerIndex: options.ledgerIndex,
          complete: true,
          nextMarker: null,
          metrics: {
            pages: 1,
            requests: 1,
            decodedObjects: 2_048,
            objects: 0,
            elapsedMs: 5,
            requestedObjectsPerPage: 2_048,
            responseMode: 'binary',
            byType: {
              vault: { objects: 0 },
              loan_broker: { objects: 0 },
              loan: { objects: 0 },
            },
          },
        }
      },
    })

    expect(result).toMatchObject({
      ledgerIndex: 123,
      pages: 1,
      requests: 1,
      decodedObjects: 2_048,
      relevantObjects: 0,
      rawBinaryBytes: 0,
      normalizedSnapshotBytes: 0,
      batchRows: 1,
    })
    expect(result.manifestBytes).toBeGreaterThan(0)
    expect(result.report.accepted).toBe(true)
  })
})
