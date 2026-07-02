import { describe, expect, it } from 'vitest'

import { encodeCurrentStatePageGzip } from '../../collector/current-state/bootstrap-shard-encoder'
import {
  serializeCurrentStateManifest,
  type CurrentStateManifest,
} from '../../collector/current-state/current-state-manifest'
import type { CurrentStatePage } from '../../collector/current-state/scan-current-state'
import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  getCurrentLoanById,
  listCurrentLoans,
} from './current-state-loan-reader'
import type { CurrentStateObjectReadError } from './current-state-object-reader'

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', source.buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function vault(id: string): ScannedLedgerObject {
  return {
    LedgerEntryType: 'Vault',
    index: id,
    BinaryHex: 'ABCD',
    PreviousTxnID: 'F'.repeat(64),
    PreviousTxnLgrSeq: 120,
    Owner: 'rVaultOwner',
    Account: 'rVaultAccount',
    Asset: { currency: 'XRP' },
    AssetsTotal: '10000000',
    AssetsAvailable: '7500000',
    AssetsMaximum: '20000000',
    LossUnrealized: '0',
    ShareMPTID: 'A'.repeat(48),
    WithdrawalPolicy: 0,
    Scale: 6,
    Flags: 0,
  }
}

function broker(id: string, vaultId: string): ScannedLedgerObject {
  return {
    LedgerEntryType: 'LoanBroker',
    index: id,
    BinaryHex: 'BCDE',
    PreviousTxnID: 'E'.repeat(64),
    PreviousTxnLgrSeq: 121,
    VaultID: vaultId,
    Owner: 'rBrokerOwner',
    Account: 'rBrokerAccount',
    Sequence: 1,
    LoanSequence: 3,
    ManagementFeeRate: 250,
    OwnerCount: 2,
    DebtTotal: '5000000',
    DebtMaximum: '10000000',
    CoverAvailable: '600000',
    CoverRateMinimum: 10000,
    CoverRateLiquidation: 15000,
    Flags: 0,
  }
}

function loan(options: {
  id: string
  brokerId: string
  borrower: string
  sequence: number
  paymentRemaining: number
  nextPaymentDueDate?: number
}): ScannedLedgerObject {
  return {
    LedgerEntryType: 'Loan',
    index: options.id,
    BinaryHex: 'CDEF',
    PreviousTxnID: 'D'.repeat(64),
    PreviousTxnLgrSeq: 122,
    LoanBrokerID: options.brokerId,
    Borrower: options.borrower,
    LoanSequence: options.sequence,
    StartDate: 500,
    PaymentInterval: 100,
    GracePeriod: 60,
    PreviousPaymentDueDate: 900,
    ...(options.nextPaymentDueDate === undefined
      ? {}
      : { NextPaymentDueDate: options.nextPaymentDueDate }),
    PaymentRemaining: options.paymentRemaining,
    PrincipalOutstanding: options.paymentRemaining === 0 ? '0' : '10000',
    TotalValueOutstanding: options.paymentRemaining === 0 ? '0' : '10500',
    ManagementFeeOutstanding: '100',
    PeriodicPayment: '1000',
    Flags: 0,
  }
}

async function fixture() {
  const vaultId = `${'0'.repeat(63)}1`
  const brokerId = `${'8'.repeat(63)}1`
  const firstLoanId = `${'9'.repeat(63)}1`
  const secondLoanId = `${'A'.repeat(63)}2`
  const pages: CurrentStatePage[] = [
    {
      pageNumber: 1,
      markerBefore: null,
      markerAfter: 'broker',
      firstLedgerIndex: vaultId,
      lastLedgerIndex: vaultId,
      decodedObjects: 1,
      vaults: [vault(vaultId)],
      loanBrokers: [],
      loans: [],
    },
    {
      pageNumber: 2,
      markerBefore: 'broker',
      markerAfter: 'loans',
      firstLedgerIndex: brokerId,
      lastLedgerIndex: brokerId,
      decodedObjects: 1,
      vaults: [],
      loanBrokers: [broker(brokerId, vaultId)],
      loans: [],
    },
    {
      pageNumber: 3,
      markerBefore: 'loans',
      markerAfter: null,
      firstLedgerIndex: firstLoanId,
      lastLedgerIndex: secondLoanId,
      decodedObjects: 2,
      vaults: [],
      loanBrokers: [],
      loans: [
        loan({
          id: firstLoanId,
          brokerId,
          borrower: 'rBorrowerOne',
          sequence: 1,
          paymentRemaining: 2,
          nextPaymentDueDate: 1000,
        }),
        loan({
          id: secondLoanId,
          brokerId,
          borrower: 'rBorrowerTwo',
          sequence: 2,
          paymentRemaining: 0,
        }),
      ],
    },
  ]
  const snapshot: ActiveSnapshotRecord = {
    id: 'snapshot-1',
    epochId: 'epoch-1',
    ledgerIndex: 123,
    ledgerHash: 'SNAPSHOT',
    objectPrefix: 'current/snapshot-1',
    manifestKey: 'current/snapshot-1/manifest.json',
    manifestSha256: null,
    vaultCount: 1,
    loanBrokerCount: 1,
    loanCount: 2,
    objectCount: 4,
    shardCount: 3,
    compressedBytes: 0,
    completedAt: '2026-07-02T00:00:00.000Z',
  }

  const objects = new Map<string, { bytes: Uint8Array; sha256: string }>()
  const descriptors = []
  let compressedBytes = 0
  for (const page of pages) {
    const encoded = await encodeCurrentStatePageGzip(page, {
      snapshotId: snapshot.id,
      pageNumber: page.pageNumber,
    })
    const digest = await sha256(encoded.bytes)
    const key = `${snapshot.objectPrefix}/shards/${String(page.pageNumber).padStart(6, '0')}.json.gz`
    objects.set(key, { bytes: encoded.bytes, sha256: digest })
    compressedBytes += encoded.bytes.byteLength
    descriptors.push({
      key,
      pageNumber: page.pageNumber,
      firstLedgerIndex: page.firstLedgerIndex,
      lastLedgerIndex: page.lastLedgerIndex,
      decodedObjects: page.decodedObjects,
      vaultCount: page.vaults.length,
      loanBrokerCount: page.loanBrokers.length,
      loanCount: page.loans.length,
      compressedBytes: encoded.bytes.byteLength,
      sha256: digest,
    })
  }

  const manifest: CurrentStateManifest = {
    schemaVersion: 1,
    snapshotId: snapshot.id,
    network: 'devnet',
    epochId: snapshot.epochId,
    ledgerIndex: snapshot.ledgerIndex,
    ledgerHash: snapshot.ledgerHash,
    generatedAt: '2026-07-02T00:00:00.000Z',
    objectPrefix: snapshot.objectPrefix,
    metrics: {
      pages: 3,
      requests: 3,
      decodedObjects: 4,
      objects: 4,
      elapsedMs: 10,
      requestedObjectsPerPage: 2048,
      responseMode: 'binary',
      byType: {
        vault: { objects: 1 },
        loan_broker: { objects: 1 },
        loan: { objects: 2 },
      },
    },
    counts: { vaults: 1, loanBrokers: 1, loans: 2 },
    compressedBytes,
    shards: descriptors,
  }
  const manifestBytes = serializeCurrentStateManifest(manifest)
  const manifestDigest = await sha256(manifestBytes)
  snapshot.manifestSha256 = manifestDigest
  snapshot.compressedBytes = compressedBytes
  objects.set(snapshot.manifestKey!, { bytes: manifestBytes, sha256: manifestDigest })

  const bucket = {
    async get(key: string) {
      const stored = objects.get(key)
      if (!stored) return null
      return {
        size: stored.bytes.byteLength,
        customMetadata: { sha256: stored.sha256 },
        arrayBuffer: async () => Uint8Array.from(stored.bytes).buffer,
      }
    },
  } as unknown as R2Bucket

  return { bucket, snapshot, vaultId, brokerId, firstLoanId, secondLoanId }
}

describe('current-state Loan reader', () => {
  it('paginates Loans and resolves Broker, Vault, asset, and schedule state', async () => {
    const { bucket, snapshot, firstLoanId, secondLoanId } = await fixture()
    const first = await listCurrentLoans(bucket, snapshot, {
      limit: 1,
      evaluatedAtRippleTime: 900,
    })
    expect(first.data[0]?.loan.id).toBe(firstLoanId)
    expect(first.data[0]?.schedule.status).toBe('current')
    expect(first.data[0]?.vault.asset.key).toBe('XRP')
    expect(first.loanShardsRead).toBe(3)
    expect(first.relationShardsRead).toBe(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await listCurrentLoans(bucket, snapshot, {
      limit: 1,
      evaluatedAtRippleTime: 900,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.data[0]?.loan.id).toBe(secondLoanId)
    expect(second.data[0]?.schedule.status).toBe('complete')
  })

  it('applies the canonical due and grace boundary', async () => {
    const { bucket, snapshot, firstLoanId } = await fixture()
    const due = await listCurrentLoans(bucket, snapshot, {
      limit: 10,
      evaluatedAtRippleTime: 1000,
      scheduleStatus: 'payment_due',
    })
    expect(due.data.map((record) => record.loan.id)).toEqual([firstLoanId])

    const eligible = await listCurrentLoans(bucket, snapshot, {
      limit: 10,
      evaluatedAtRippleTime: 1060,
      scheduleStatus: 'default_eligible',
    })
    expect(eligible.data.map((record) => record.loan.id)).toEqual([firstLoanId])
  })

  it('supports direct detail lookup with verified same-snapshot relationships', async () => {
    const { bucket, snapshot, firstLoanId, brokerId, vaultId } = await fixture()
    const result = await getCurrentLoanById(bucket, snapshot, firstLoanId, 1060)
    expect(result?.broker.id).toBe(brokerId)
    expect(result?.vault.id).toBe(vaultId)
    expect(result?.schedule.status).toBe('default_eligible')
  })

  it('fails closed when relationship reads exceed the configured limit', async () => {
    const { bucket, snapshot } = await fixture()
    await expect(
      listCurrentLoans(bucket, snapshot, {
        limit: 1,
        evaluatedAtRippleTime: 900,
        maxRelationShardsPerRead: 1,
      }),
    ).rejects.toMatchObject({
      code: 'relationship_read_limit',
    } satisfies Partial<CurrentStateObjectReadError>)
  })
})
