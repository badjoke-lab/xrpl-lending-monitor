import { canonicalJson, sha256Hex } from '../current-state/canonical-json'

const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ASSET_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export type DbLessBaseAssetKind = 'vault-page' | 'loan-broker-page' | 'loan-page' | 'lookup'

export interface DbLessBaseCountsV1 {
  vaults: number
  loanBrokers: number
  loans: number
}

export interface DbLessBasePageCountsV1 {
  vaults: number
  loanBrokers: number
  loans: number
}

export interface DbLessBaseAssetDescriptorV1 {
  key: string
  kind: DbLessBaseAssetKind
  ordinal: number
  records: number
  bytes: number
  sha256: string
}

export interface DbLessBaseManifestV1 {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  snapshotId: string
  generationId: string
  sourceRevision: string
  sourceManifestSha256: string
  ledgerIndex: number
  ledgerHash: string
  complete: true
  pageSize: number
  lookupPrefixLength: number
  counts: DbLessBaseCountsV1
  pageCounts: DbLessBasePageCountsV1
  assets: DbLessBaseAssetDescriptorV1[]
  manifestSha256: string
}

export type DbLessBaseManifestBodyV1 = Omit<DbLessBaseManifestV1, 'manifestSha256'>

function nonEmpty(value: string, field: string): void {
  if (!value.length) throw new Error(`${field} must be non-empty`)
}

function integer(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} must be a safe integer of at least ${minimum}`)
  }
}

function digest(value: string, field: string): void {
  if (!SHA256.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`)
}

function ledgerHash(value: string, field: string): void {
  if (!LEDGER_HASH.test(value)) throw new Error(`${field} must be an uppercase 64-character ledger hash`)
}

function assetKey(value: string, field: string): void {
  if (!SAFE_ASSET_KEY.test(value)) throw new Error(`${field} must be a flat release-safe filename`)
}

function expectedLookupAssets(prefixLength: number): number {
  if (prefixLength < 1 || prefixLength > 4) {
    throw new Error('lookupPrefixLength must be between 1 and 4 for release assets')
  }
  return 16 ** prefixLength
}

export function assertDbLessBaseManifest(manifest: DbLessBaseManifestV1): void {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported DB-less base manifest schema version')
  if (manifest.network !== 'devnet') throw new Error('DB-less base manifest network must be devnet')
  if (manifest.complete !== true) throw new Error('DB-less base manifest must be complete')
  nonEmpty(manifest.epochId, 'epochId')
  nonEmpty(manifest.snapshotId, 'snapshotId')
  nonEmpty(manifest.generationId, 'generationId')
  nonEmpty(manifest.sourceRevision, 'sourceRevision')
  digest(manifest.sourceManifestSha256, 'sourceManifestSha256')
  digest(manifest.manifestSha256, 'manifestSha256')
  integer(manifest.ledgerIndex, 'ledgerIndex', 1)
  ledgerHash(manifest.ledgerHash, 'ledgerHash')
  integer(manifest.pageSize, 'pageSize', 1)
  integer(manifest.lookupPrefixLength, 'lookupPrefixLength', 1)

  const countTotal = manifest.counts.vaults + manifest.counts.loanBrokers + manifest.counts.loans
  for (const [field, value] of Object.entries(manifest.counts)) integer(value, `counts.${field}`)
  for (const [field, value] of Object.entries(manifest.pageCounts)) integer(value, `pageCounts.${field}`)

  const seen = new Set<string>()
  const ordinals = new Map<DbLessBaseAssetKind, number[]>()
  let recordTotal = 0
  for (const [index, asset] of manifest.assets.entries()) {
    assetKey(asset.key, `assets[${index}].key`)
    if (seen.has(asset.key)) throw new Error('DB-less base asset keys must be unique')
    seen.add(asset.key)
    integer(asset.ordinal, `assets[${index}].ordinal`)
    integer(asset.records, `assets[${index}].records`)
    integer(asset.bytes, `assets[${index}].bytes`, 1)
    digest(asset.sha256, `assets[${index}].sha256`)
    const values = ordinals.get(asset.kind) ?? []
    values.push(asset.ordinal)
    ordinals.set(asset.kind, values)
    if (asset.kind !== 'lookup') recordTotal += asset.records
  }

  const expectedByKind: Record<DbLessBaseAssetKind, number> = {
    'vault-page': manifest.pageCounts.vaults,
    'loan-broker-page': manifest.pageCounts.loanBrokers,
    'loan-page': manifest.pageCounts.loans,
    lookup: expectedLookupAssets(manifest.lookupPrefixLength),
  }
  for (const [kind, expected] of Object.entries(expectedByKind) as [DbLessBaseAssetKind, number][]) {
    const values = (ordinals.get(kind) ?? []).sort((left, right) => left - right)
    if (values.length !== expected) throw new Error(`Unexpected ${kind} asset count`)
    values.forEach((value, index) => {
      if (value !== index) throw new Error(`${kind} ordinals must be contiguous from zero`)
    })
  }

  if (recordTotal !== countTotal) throw new Error('DB-less base page record total does not match object counts')
  if (manifest.assets.length + 1 > 1_000) {
    throw new Error('DB-less base generation exceeds the GitHub Release 1000-asset limit')
  }
}

export async function dbLessBaseManifestDigest(body: DbLessBaseManifestBodyV1): Promise<string> {
  return sha256Hex(`${canonicalJson(body)}\n`)
}

export async function buildDbLessBaseManifest(body: DbLessBaseManifestBodyV1): Promise<DbLessBaseManifestV1> {
  const manifest: DbLessBaseManifestV1 = {
    ...body,
    manifestSha256: await dbLessBaseManifestDigest(body),
  }
  assertDbLessBaseManifest(manifest)
  return manifest
}

export async function verifyDbLessBaseManifest(manifest: DbLessBaseManifestV1): Promise<void> {
  assertDbLessBaseManifest(manifest)
  const { manifestSha256, ...body } = manifest
  if (await dbLessBaseManifestDigest(body) !== manifestSha256) {
    throw new Error('DB-less base manifest digest mismatch')
  }
}
