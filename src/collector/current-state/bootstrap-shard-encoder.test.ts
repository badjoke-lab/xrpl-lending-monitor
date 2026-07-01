import { describe, expect, it } from 'vitest'

import type { ScannedLedgerObject } from './scan-ledger-objects'
import type { CurrentStatePage } from './scan-current-state'
import { encodeCurrentStatePageGzip } from './bootstrap-shard-encoder'

function object(type: 'Vault' | 'LoanBroker' | 'Loan', index: string): ScannedLedgerObject {
  return { LedgerEntryType: type, index, BinaryHex: '00' }
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

describe('current-state bootstrap shard encoder', () => {
  it('writes a self-describing gzip shard with the global page number', async () => {
    const page: CurrentStatePage = {
      pageNumber: 1,
      markerBefore: 'before',
      markerAfter: 'after',
      firstLedgerIndex: '0001',
      lastLedgerIndex: '0003',
      decodedObjects: 3,
      vaults: [object('Vault', 'V-1')],
      loanBrokers: [object('LoanBroker', 'B-1')],
      loans: [object('Loan', 'L-1')],
    }

    const encoded = await encodeCurrentStatePageGzip(page, {
      snapshotId: 'snapshot-1',
      pageNumber: 42,
    })
    const payload = JSON.parse(await gunzip(encoded.bytes)) as Record<string, unknown>

    expect(encoded.encoding).toBe('gzip')
    expect(payload).toMatchObject({
      schemaVersion: 1,
      snapshotId: 'snapshot-1',
      pageNumber: 42,
      markerBefore: 'before',
      markerAfter: 'after',
      decodedObjects: 3,
    })
    expect(payload.vaults).toHaveLength(1)
    expect(payload.loanBrokers).toHaveLength(1)
    expect(payload.loans).toHaveLength(1)
  })
})
