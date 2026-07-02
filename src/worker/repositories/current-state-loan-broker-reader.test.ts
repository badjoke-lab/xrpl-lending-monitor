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
  getCurrentLoanBrokerById,
  listCurrentLoanBrokers,
} from './current-state-loan-broker-reader'
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

function broker(id: string, vaultId: string, sequence: number): ScannedLedgerObject {
  return {
    LedgerEntryType: 'LoanBroker',
    index: id,
    BinaryHex: 'BCDE',
    PreviousTxnID: 'E'.repeat(64),
    PreviousTxnLgrSeq: 121,
    VaultID: vaultId,
    Owner: `rBrokerOwner${sequence}`,
    Account: `rBrokerAccount${sequence}`,
    Sequence: sequence,
    LoanSequence: 2,
    ManagementFeeRate: 250,
    OwnerCount: 1,
    DebtTotal: '5000000',
    DebtMaximum: '10000000',
    CoverAvailable: '600000',
    CoverRateMinimum: 10000,
    CoverRateLiquidation: 15000,
    Flags: 0,
  }
}

async function fixture() {
  const vaultId = `${'0'.repeat(63)}1`
  const firstBrokerId = `${'8'.repeat(63)}1`
  const secondBrokerId = `${'9'.repeat(63)}2`
  const pages: CurrentStatePage[] = [
    {
      pageNumber: 1,
      markerBefore: null,
      markerAfter: 'next',
      firstLedgerIndex: vaultId,
      lastLedgerIndex: vaultId,
      decodedObjects: 1,
      vaults: [vault(vaultId)],
      loanBrokers: [],
      loans: [],
    },
    {
      pageNumber: 2,
      markerBefore: 'next',
      markerAfter: null,
      firstLedgerIndex: firstBrokerId,
      lastLedgerIndex: secondBrokerId,
      decodedObjects: 2,
      vaults: [],
      loanBrokers: [
        broker(firstBrokerId, vaultId, 1),
        broker(secondBrokerId, vaultId, 2),
      ],
      loans: [],
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
    loanBrokerCount: 2,
    loanCount: 0,
    objectCount: 3,
    shardCount: 2,
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
      loanCount: 0,
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
      pages: 2,
      requests: 2,
      decodedObjects: 3,
      objects: 3,
      elapsedMs: 10,
      requestedObjectsPerPage: 2048,
      responseMode: 'binary',
      byType: {
        vault: { objects: 1 },
        loan_broker: { objects: 2 },
        loan: { objects: 0 },
      },
    },
    counts: { vaults: 1, loanBrokers: 2, loans: 0 },
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

  return { bucket, snapshot, vaultId, firstBrokerId, secondBrokerId }
}

describe('current-state Loan Broker reader', () => {
  it('paginates Brokers and resolves the canonical asset through the related Vault', async () => {
    const { bucket, snapshot, firstBrokerId, secondBrokerId } = await fixture()
    const first = await listCurrentLoanBrokers(bucket, snapshot, { limit: 1 })
    expect(first.data[0]?.broker.id).toBe(firstBrokerId)
    expect(first.data[0]?.vault.asset.key).toBe('XRP')
    expect(first.brokerShardsRead).toBe(2)
    expect(first.relationShardsRead).toBe(0)
    expect(first.nextCursor).not.toBeNull()

    const second = await listCurrentLoanBrokers(bucket, snapshot, {
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.data[0]?.broker.id).toBe(secondBrokerId)
  })

  it('supports direct detail lookup with one bounded Vault relationship read', async () => {
    const { bucket, snapshot, firstBrokerId, vaultId } = await fixture()
    const result = await getCurrentLoanBrokerById(bucket, snapshot, firstBrokerId)
    expect(result?.broker.vaultId).toBe(vaultId)
    expect(result?.vault.asset.key).toBe('XRP')
  })

  it('fails closed when the additional relationship shard limit is exceeded', async () => {
    const { bucket, snapshot } = await fixture()
    await expect(
      listCurrentLoanBrokers(bucket, snapshot, {
        limit: 1,
        sort: 'id_desc',
        maxRelationShardsPerRead: 0,
      }),
    ).rejects.toMatchObject({
      code: 'relationship_read_limit',
    } satisfies Partial<CurrentStateObjectReadError>)
  })
})
