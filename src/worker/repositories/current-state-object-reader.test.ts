import { describe, expect, it } from 'vitest'

import { encodeCurrentStatePageGzip } from '../../collector/current-state/bootstrap-shard-encoder'
import { serializeCurrentStateManifest, type CurrentStateManifest } from '../../collector/current-state/current-state-manifest'
import type { CurrentStatePage } from '../../collector/current-state/scan-current-state'
import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  CurrentStateObjectReadError,
  getCurrentVaultById,
  listCurrentVaults,
} from './current-state-object-reader'

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', source.buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function vault(id: string, loss = '0'): ScannedLedgerObject {
  return {
    LedgerEntryType: 'Vault',
    index: id,
    BinaryHex: 'ABCD',
    PreviousTxnID: 'F'.repeat(64),
    PreviousTxnLgrSeq: 120,
    Owner: 'rOwner',
    Account: 'rVaultAccount',
    Asset: { currency: 'XRP' },
    AssetsTotal: '10000000',
    AssetsAvailable: '7500000',
    AssetsMaximum: '20000000',
    LossUnrealized: loss,
    ShareMPTID: 'A'.repeat(48),
    DomainID: null,
    WithdrawalPolicy: 0,
    Scale: 6,
    Flags: 0,
  }
}

async function fixture() {
  const firstId = `${'0'.repeat(63)}1`
  const secondId = `${'8'.repeat(63)}2`
  const snapshot: ActiveSnapshotRecord = {
    id: 'snapshot-1',
    epochId: 'epoch-1',
    ledgerIndex: 123,
    ledgerHash: 'SNAPSHOT',
    objectPrefix: 'current/snapshot-1',
    manifestKey: 'current/snapshot-1/manifest.json',
    manifestSha256: null,
    vaultCount: 2,
    loanBrokerCount: 0,
    loanCount: 0,
    objectCount: 2,
    shardCount: 2,
    compressedBytes: 0,
    completedAt: '2026-07-02T00:00:00.000Z',
  }

  const pages: CurrentStatePage[] = [
    {
      pageNumber: 1,
      markerBefore: null,
      markerAfter: 'next',
      firstLedgerIndex: firstId,
      lastLedgerIndex: firstId,
      decodedObjects: 1,
      vaults: [vault(firstId)],
      loanBrokers: [],
      loans: [],
    },
    {
      pageNumber: 2,
      markerBefore: 'next',
      markerAfter: null,
      firstLedgerIndex: secondId,
      lastLedgerIndex: secondId,
      decodedObjects: 1,
      vaults: [vault(secondId, '5')],
      loanBrokers: [],
      loans: [],
    },
  ]

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
      loanBrokerCount: 0,
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
      decodedObjects: 2,
      objects: 2,
      elapsedMs: 10,
      requestedObjectsPerPage: 2048,
      responseMode: 'binary',
      byType: {
        vault: { objects: 2 },
        loan_broker: { objects: 0 },
        loan: { objects: 0 },
      },
    },
    counts: { vaults: 2, loanBrokers: 0, loans: 0 },
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

  return { bucket, snapshot, firstId, secondId, objects }
}

describe('current-state Vault reader', () => {
  it('paginates verified Vaults with snapshot-bound cursors', async () => {
    const { bucket, snapshot, firstId, secondId } = await fixture()
    const first = await listCurrentVaults(bucket, snapshot, { limit: 1 })
    expect(first.data.map((item) => item.id)).toEqual([firstId])
    expect(first.nextCursor).not.toBeNull()
    expect(first.shardsRead).toBe(1)

    const second = await listCurrentVaults(bucket, snapshot, {
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.data.map((item) => item.id)).toEqual([secondId])
    expect(second.nextCursor).toBeNull()
  })

  it('supports descending order and loss filtering without cross-asset aggregation', async () => {
    const { bucket, snapshot, secondId } = await fixture()
    const result = await listCurrentVaults(bucket, snapshot, {
      limit: 5,
      sort: 'id_desc',
      hasLoss: true,
    })
    expect(result.data.map((item) => item.id)).toEqual([secondId])
    expect(result.data[0]?.asset.key).toBe('XRP')
  })

  it('uses manifest object-index ranges for single-shard detail lookup', async () => {
    const { bucket, snapshot, secondId } = await fixture()
    const result = await getCurrentVaultById(bucket, snapshot, secondId.toLowerCase())
    expect(result?.id).toBe(secondId)
    expect(result?.assetsTotal).toBe('10000000')
  })

  it('fails closed when a shard digest does not match', async () => {
    const { bucket, snapshot, firstId, objects } = await fixture()
    const key = `${snapshot.objectPrefix}/shards/000001.json.gz`
    const stored = objects.get(key)
    if (!stored) throw new Error('fixture shard missing')
    objects.set(key, { ...stored, sha256: '0'.repeat(64) })

    await expect(getCurrentVaultById(bucket, snapshot, firstId)).rejects.toMatchObject({
      code: 'shard_integrity_error',
    } satisfies Partial<CurrentStateObjectReadError>)
  })
})
