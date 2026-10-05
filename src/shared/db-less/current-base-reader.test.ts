import { describe, expect, it } from 'vitest'

import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import { buildDbLessBaseManifest, type DbLessBaseAssetDescriptorV1 } from './base-manifest'
import { DbLessCurrentBaseReader } from './current-base-reader'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../current-state/canonical-json'

const HASH = 'A'.repeat(64)

function vault(id: string): VaultCurrentProjection {
  return {
    kind: 'vault',
    id,
    owner: `r-owner-${id}`,
    account: `r-account-${id}`,
    asset: { type: 'xrp', key: 'XRP', scale: 6 },
    assetsTotal: '10',
    assetsAvailable: '9',
    assetsMaximum: null,
    lossUnrealized: '0',
    shareMptId: id.padEnd(64, '0').slice(0, 64),
    domainId: null,
    withdrawalPolicy: 0,
    scale: 6,
    flags: 0,
    dataHex: null,
    previousTxHash: 'B'.repeat(64),
    previousLedgerIndex: 100,
    raw: {},
  }
}

async function artifact(
  key: string,
  kind: DbLessBaseAssetDescriptorV1['kind'],
  ordinal: number,
  records: number,
  value: unknown,
) {
  const bytes = await gzipDeterministic(utf8(`${canonicalJson(value)}\n`))
  return {
    descriptor: {
      key,
      kind,
      ordinal,
      records,
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    } satisfies DbLessBaseAssetDescriptorV1,
    bytes,
  }
}

async function fixture() {
  const pages = [
    await artifact(
      'vault-page-000000.json.gz',
      'vault-page',
      0,
      2,
      { schemaVersion: 1, kind: 'vault', page: 0, records: [vault('A1'), vault('A2')] },
    ),
    await artifact(
      'vault-page-000001.json.gz',
      'vault-page',
      1,
      1,
      { schemaVersion: 1, kind: 'vault', page: 1, records: [vault('B1')] },
    ),
  ]
  const lookupRecords = new Map<string, unknown[]>([
    ['A', [
      { id: 'A1', kind: 'vault', page: 0, offset: 0 },
      { id: 'A2', kind: 'vault', page: 0, offset: 1 },
    ]],
    ['B', [{ id: 'B1', kind: 'vault', page: 1, offset: 0 }]],
  ])
  const lookups = []
  for (let index = 0; index < 16; index += 1) {
    const prefix = index.toString(16).toUpperCase()
    const records = lookupRecords.get(prefix) ?? []
    lookups.push(await artifact(
      `lookup-${prefix}.json.gz`,
      'lookup',
      index,
      records.length,
      { schemaVersion: 1, prefix, records },
    ))
  }
  const all = [...pages, ...lookups]
  const manifest = await buildDbLessBaseManifest({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'epoch-1',
    snapshotId: 'snapshot-1',
    generationId: 'base-1',
    sourceRevision: 'C'.repeat(40),
    sourceManifestSha256: 'd'.repeat(64),
    ledgerIndex: 100,
    ledgerHash: HASH,
    complete: true,
    pageSize: 2,
    lookupPrefixLength: 1,
    counts: { vaults: 3, loanBrokers: 0, loans: 0 },
    pageCounts: { vaults: 2, loanBrokers: 0, loans: 0 },
    assets: all.map((item) => item.descriptor),
  })
  const bytes = new Map(all.map((item) => [item.descriptor.key, item.bytes]))
  let reads = 0
  const reader = new DbLessCurrentBaseReader({
    manifest,
    readArtifact: async (key) => {
      reads += 1
      return bytes.get(key) ?? null
    },
  })
  return { reader, bytes, reads: () => reads }
}

describe('DB-less D5 browser base reader', () => {
  it('resolves exact objects through one lookup bucket and one page', async () => {
    const built = await fixture()
    const result = await built.reader.get<VaultCurrentProjection>('vault', 'A2')
    expect(result.item?.id).toBe('A2')
    expect(result.assetReads).toBe(2)
    expect(built.reads()).toBe(2)
  })

  it('bounds list reads and resumes with a generation-bound cursor', async () => {
    const built = await fixture()
    const first = await built.reader.list<VaultCurrentProjection>('vault', {
      limit: 2,
      maxPageReads: 1,
      scope: 'vault-list',
    })
    expect(first.items.map((item) => item.id)).toEqual(['A1', 'A2'])
    expect(first.pageReads).toBe(1)
    expect(first.nextCursor).not.toBeNull()

    const second = await built.reader.list<VaultCurrentProjection>('vault', {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
      maxPageReads: 1,
      scope: 'vault-list',
    })
    expect(second.items.map((item) => item.id)).toEqual(['B1'])
    expect(second.pageReads).toBe(1)
    expect(second.nextCursor).toBeNull()
  })

  it('rejects a tampered compressed asset before decoding it', async () => {
    const built = await fixture()
    built.bytes.set('vault-page-000000.json.gz', new Uint8Array([1, 2, 3]))
    await expect(
      built.reader.list<VaultCurrentProjection>('vault', { limit: 1 }),
    ).rejects.toThrow(/Missing or invalid|SHA-256 mismatch/)
  })
})
