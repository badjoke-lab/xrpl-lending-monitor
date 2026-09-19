import { describe, expect, it } from 'vitest'

import {
  buildDbLessBaseManifest,
  verifyDbLessBaseManifest,
  type DbLessBaseAssetDescriptorV1,
  type DbLessBaseManifestBodyV1,
} from './base-manifest'

const HASH = 'A'.repeat(64)
const SHA = 'b'.repeat(64)

function asset(
  kind: DbLessBaseAssetDescriptorV1['kind'],
  ordinal: number,
  records: number,
): DbLessBaseAssetDescriptorV1 {
  const label = kind.replaceAll('-', '_')
  return {
    key: `${label}-${String(ordinal).padStart(4, '0')}.json.gz`,
    kind,
    ordinal,
    records,
    bytes: 100,
    sha256: SHA,
  }
}

function body(): DbLessBaseManifestBodyV1 {
  const assets: DbLessBaseAssetDescriptorV1[] = [
    asset('vault-page', 0, 2),
    asset('loan-broker-page', 0, 1),
    asset('loan-page', 0, 1),
    ...Array.from({ length: 16 }, (_, index) => asset('lookup', index, 0)),
  ]
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    snapshotId: 'snapshot-test',
    generationId: 'base-v1-test',
    sourceRevision: 'revision-test',
    sourceManifestSha256: SHA,
    ledgerIndex: 123,
    ledgerHash: HASH,
    complete: true,
    pageSize: 4096,
    lookupPrefixLength: 1,
    counts: { vaults: 2, loanBrokers: 1, loans: 1 },
    pageCounts: { vaults: 1, loanBrokers: 1, loans: 1 },
    assets,
  }
}

describe('DB-less base manifest', () => {
  it('accepts a complete release-safe sharded base and verifies its self digest', async () => {
    const manifest = await buildDbLessBaseManifest(body())
    await expect(verifyDbLessBaseManifest(manifest)).resolves.toBeUndefined()
    expect(manifest.pageSize).toBe(4096)
    expect(manifest.assets).toHaveLength(19)
  })

  it('rejects a layout that exceeds the GitHub Release asset ceiling', async () => {
    const input = body()
    input.lookupPrefixLength = 1
    input.pageCounts = { vaults: 984, loanBrokers: 0, loans: 0 }
    input.counts = { vaults: 984, loanBrokers: 0, loans: 0 }
    input.assets = [
      ...Array.from({ length: 984 }, (_, index) => asset('vault-page', index, 1)),
      ...Array.from({ length: 16 }, (_, index) => asset('lookup', index, 0)),
    ]
    await expect(buildDbLessBaseManifest(input)).rejects.toThrow('1000-asset limit')
  })

  it('rejects missing or non-contiguous page ordinals', async () => {
    const input = body()
    input.assets[0] = asset('vault-page', 2, 2)
    await expect(buildDbLessBaseManifest(input)).rejects.toThrow('ordinals must be contiguous')
  })

  it('detects manifest tampering', async () => {
    const manifest = await buildDbLessBaseManifest(body())
    await expect(verifyDbLessBaseManifest({
      ...manifest,
      pageSize: manifest.pageSize + 1,
    })).rejects.toThrow('digest mismatch')
  })
})
