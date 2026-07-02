import { describe, expect, it } from 'vitest'

import { encodeCurrentStatePageGzip } from '../../collector/current-state/bootstrap-shard-encoder'
import {
  serializeCurrentStateManifest,
  type CurrentStateManifest,
} from '../../collector/current-state/current-state-manifest'
import type { CurrentStatePage } from '../../collector/current-state/scan-current-state'
import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { getCurrentLoanById, listCurrentLoans } from './current-state-loan-reader'
import type { CurrentStateObjectReadError } from './current-state-object-reader'

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, '0')).join('')
}

function vault(id: string): ScannedLedgerObject {
  return {
    LedgerEntryType: 'Vault', index: id, PreviousTxnID: 'F'.repeat(64), PreviousTxnLgrSeq: 120,
    Owner: 'rVaultOwner', Account: 'rVaultAccount', Asset: { currency: 'XRP' },
    AssetsTotal: '10000000', AssetsAvailable: '7500000', AssetsMaximum: '20000000',
    LossUnrealized: '0', ShareMPTID: 'A'.repeat(48), WithdrawalPolicy: 0, Scale: 6, Flags: 0,
  }
}

function broker(id: string, vaultId: string): ScannedLedgerObject {
  return {
    LedgerEntryType: 'LoanBroker', index: id, PreviousTxnID: 'E'.repeat(64), PreviousTxnLgrSeq: 121,
    VaultID: vaultId, Owner: 'rBrokerOwner', Account: 'rBrokerAccount', Sequence: 1, LoanSequence: 3,
    DebtTotal: '5000000', DebtMaximum: '10000000', CoverAvailable: '600000',
    CoverRateMinimum: 10000, CoverRateLiquidation: 15000, Flags: 0,
  }
}

function loan(id: string, brokerId: string, complete = false): ScannedLedgerObject {
  return {
    LedgerEntryType: 'Loan', index: id, PreviousTxnID: 'D'.repeat(64), PreviousTxnLgrSeq: 122,
    LoanBrokerID: brokerId, Borrower: complete ? 'rBorrowerTwo' : 'rBorrowerOne',
    LoanSequence: complete ? 2 : 1, StartDate: 500, PaymentInterval: 100, GracePeriod: 60,
    PreviousPaymentDueDate: 900, ...(complete ? {} : { NextPaymentDueDate: 1000 }),
    PaymentRemaining: complete ? 0 : 2, PrincipalOutstanding: complete ? '0' : '10000',
    TotalValueOutstanding: complete ? '0' : '10500', ManagementFeeOutstanding: '100',
    PeriodicPayment: '1000', Flags: 0,
  }
}

async function fixture() {
  const vaultId = `${'0'.repeat(63)}1`
  const brokerId = `${'8'.repeat(63)}1`
  const firstLoanId = `${'9'.repeat(63)}1`
  const secondLoanId = `${'A'.repeat(63)}2`
  const pages: CurrentStatePage[] = [
    {
      pageNumber: 1, markerBefore: null, markerAfter: 'broker', firstLedgerIndex: vaultId,
      lastLedgerIndex: vaultId, decodedObjects: 1, vaults: [vault(vaultId)], loanBrokers: [], loans: [],
    },
    {
      pageNumber: 2, markerBefore: 'broker', markerAfter: 'loans', firstLedgerIndex: brokerId,
      lastLedgerIndex: brokerId, decodedObjects: 1, vaults: [], loanBrokers: [broker(brokerId, vaultId)], loans: [],
    },
    {
      pageNumber: 3, markerBefore: 'loans', markerAfter: null, firstLedgerIndex: firstLoanId,
      lastLedgerIndex: secondLoanId, decodedObjects: 2, vaults: [], loanBrokers: [],
      loans: [loan(firstLoanId, brokerId), loan(secondLoanId, brokerId, true)],
    },
  ]
  const snapshot: ActiveSnapshotRecord = {
    id: 'snapshot-1', epochId: 'epoch-1', ledgerIndex: 123, ledgerHash: 'SNAPSHOT',
    objectPrefix: 'current/snapshot-1', manifestKey: 'current/snapshot-1/manifest.json',
    manifestSha256: null, vaultCount: 1, loanBrokerCount: 1, loanCount: 2, objectCount: 4,
    shardCount: 3, compressedBytes: 0, completedAt: '2026-07-02T00:00:00.000Z',
  }
  const objects = new Map<string, { bytes: Uint8Array; sha256: string }>()
  const shards = []
  let compressedBytes = 0
  for (const page of pages) {
    const encoded = await encodeCurrentStatePageGzip(page, { snapshotId: snapshot.id, pageNumber: page.pageNumber })
    const sha256 = await digest(encoded.bytes)
    const key = `${snapshot.objectPrefix}/shards/${String(page.pageNumber).padStart(6, '0')}.json.gz`
    objects.set(key, { bytes: encoded.bytes, sha256 })
    compressedBytes += encoded.bytes.byteLength
    shards.push({
      key, pageNumber: page.pageNumber, firstLedgerIndex: page.firstLedgerIndex,
      lastLedgerIndex: page.lastLedgerIndex, decodedObjects: page.decodedObjects,
      vaultCount: page.vaults.length, loanBrokerCount: page.loanBrokers.length,
      loanCount: page.loans.length, compressedBytes: encoded.bytes.byteLength, sha256,
    })
  }
  const manifest: CurrentStateManifest = {
    schemaVersion: 1, snapshotId: snapshot.id, network: 'devnet', epochId: snapshot.epochId,
    ledgerIndex: snapshot.ledgerIndex, ledgerHash: snapshot.ledgerHash,
    generatedAt: '2026-07-02T00:00:00.000Z', objectPrefix: snapshot.objectPrefix,
    metrics: {
      pages: 3, requests: 3, decodedObjects: 4, objects: 4, elapsedMs: 10,
      requestedObjectsPerPage: 2048, responseMode: 'binary',
      byType: { vault: { objects: 1 }, loan_broker: { objects: 1 }, loan: { objects: 2 } },
    },
    counts: { vaults: 1, loanBrokers: 1, loans: 2 }, compressedBytes, shards,
  }
  const manifestBytes = serializeCurrentStateManifest(manifest)
  const manifestSha256 = await digest(manifestBytes)
  snapshot.manifestSha256 = manifestSha256
  snapshot.compressedBytes = compressedBytes
  objects.set(snapshot.manifestKey!, { bytes: manifestBytes, sha256: manifestSha256 })
  const bucket = {
    async get(key: string) {
      const stored = objects.get(key)
      return stored ? {
        size: stored.bytes.byteLength,
        customMetadata: { sha256: stored.sha256 },
        arrayBuffer: async () => Uint8Array.from(stored.bytes).buffer,
      } : null
    },
  } as unknown as R2Bucket
  return { bucket, snapshot, vaultId, brokerId, firstLoanId, secondLoanId }
}

describe('current-state Loan reader', () => {
  it('paginates and resolves the canonical relationship chain', async () => {
    const { bucket, snapshot, firstLoanId, secondLoanId } = await fixture()
    const first = await listCurrentLoans(bucket, snapshot, { limit: 1, evaluatedAtRippleTime: 900 })
    expect(first.data[0]?.loan.id).toBe(firstLoanId)
    expect(first.data[0]?.schedule.status).toBe('current')
    expect(first.data[0]?.vault.asset.key).toBe('XRP')
    expect(first.loanShardsRead).toBe(3)
    expect(first.relationShardsRead).toBe(0)
    const second = await listCurrentLoans(bucket, snapshot, {
      limit: 1, evaluatedAtRippleTime: 900, cursor: first.nextCursor ?? undefined,
    })
    expect(second.data[0]?.loan.id).toBe(secondLoanId)
    expect(second.data[0]?.schedule.status).toBe('complete')
  })

  it('uses the exact due and grace boundaries', async () => {
    const { bucket, snapshot, firstLoanId } = await fixture()
    const due = await listCurrentLoans(bucket, snapshot, {
      limit: 10, evaluatedAtRippleTime: 1000, scheduleStatus: 'payment_due',
    })
    expect(due.data.map((record) => record.loan.id)).toEqual([firstLoanId])
    const eligible = await listCurrentLoans(bucket, snapshot, {
      limit: 10, evaluatedAtRippleTime: 1060, scheduleStatus: 'default_eligible',
    })
    expect(eligible.data.map((record) => record.loan.id)).toEqual([firstLoanId])
  })

  it('supports direct lookup and fails closed above the relationship limit', async () => {
    const { bucket, snapshot, firstLoanId, brokerId, vaultId } = await fixture()
    const detail = await getCurrentLoanById(bucket, snapshot, firstLoanId, 1060)
    expect(detail?.broker.id).toBe(brokerId)
    expect(detail?.vault.id).toBe(vaultId)
    expect(detail?.schedule.status).toBe('default_eligible')
    await expect(listCurrentLoans(bucket, snapshot, {
      limit: 1, evaluatedAtRippleTime: 900, sort: 'id_desc', maxRelationShardsPerRead: 1,
    })).rejects.toMatchObject({ code: 'relationship_read_limit' } satisfies Partial<CurrentStateObjectReadError>)
  })
})
