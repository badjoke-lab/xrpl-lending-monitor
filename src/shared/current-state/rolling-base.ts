import { canonicalJson, sha256Hex } from './canonical-json'

export type RollingBaseKind = 'vault' | 'loan-broker' | 'loan'

export interface RollingBaseAsset {
  path: string
  ordinal: number
  sha256: string
  bytes: number
  records: number
  firstObjectId: string | null
  lastObjectId: string | null
  counts: { vaults: number; loanBrokers: number; loans: number }
}

export interface RollingCurrentStateBaseManifest {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  snapshotId: string
  ledgerIndex: number
  ledgerHash: string
  complete: true
  segmentCount: number
  counts: { vaults: number; loanBrokers: number; loans: number }
  assets: RollingBaseAsset[]
  manifestSha256: string
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${field} must be a safe integer >= ${minimum}`)
  return Number(value)
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a SHA-256 digest`)
  return value
}

function ledgerHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-F0-9]{64}$/.test(value)) throw new Error(`${field} must be an uppercase ledger hash`)
  return value
}

function objectId(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^[A-F0-9]{64}$/.test(value)) throw new Error(`${field} must be an uppercase object ID or null`)
  return value
}

function counts(value: unknown, field: string): { vaults: number; loanBrokers: number; loans: number } {
  const source = record(value, field)
  return {
    vaults: integer(source.vaults, `${field}.vaults`),
    loanBrokers: integer(source.loanBrokers, `${field}.loanBrokers`),
    loans: integer(source.loans, `${field}.loans`),
  }
}

export function rollingBaseSegmentForId(objectIdValue: string, segmentCount: number): number {
  if (!/^[A-F0-9]{64}$/.test(objectIdValue)) throw new Error('objectId must be an uppercase 64-character hex string')
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 1 || segmentCount > 4096) throw new Error('segmentCount is invalid')
  const prefix = Number.parseInt(objectIdValue.slice(0, 8), 16)
  const uint32Space = 0x1_0000_0000
  return Math.min(segmentCount - 1, Math.floor(prefix * segmentCount / uint32Space))
}

export async function rollingBaseManifestDigest(
  manifest: Omit<RollingCurrentStateBaseManifest, 'manifestSha256'> | RollingCurrentStateBaseManifest,
): Promise<string> {
  return sha256Hex(`${canonicalJson({ ...manifest, manifestSha256: null })}\n`)
}

export function parseRollingCurrentStateBaseManifest(value: unknown): RollingCurrentStateBaseManifest {
  const source = record(value, 'manifest')
  if (source.schemaVersion !== 1 || source.network !== 'devnet' || source.complete !== true) {
    throw new Error('Rolling base manifest schema is invalid')
  }
  const segmentCount = integer(source.segmentCount, 'segmentCount', 1)
  const manifestCounts = counts(source.counts, 'counts')
  const rawAssets = Array.isArray(source.assets) ? source.assets : []
  const assets = rawAssets.map((raw, index): RollingBaseAsset => {
    const asset = record(raw, `assets[${index}]`)
    const parsedCounts = counts(asset.counts, `assets[${index}].counts`)
    const parsed: RollingBaseAsset = {
      path: text(asset.path, `assets[${index}].path`),
      ordinal: integer(asset.ordinal, `assets[${index}].ordinal`),
      sha256: digest(asset.sha256, `assets[${index}].sha256`),
      bytes: integer(asset.bytes, `assets[${index}].bytes`, 1),
      records: integer(asset.records, `assets[${index}].records`),
      firstObjectId: objectId(asset.firstObjectId, `assets[${index}].firstObjectId`),
      lastObjectId: objectId(asset.lastObjectId, `assets[${index}].lastObjectId`),
      counts: parsedCounts,
    }
    if (parsed.ordinal !== index) throw new Error('Rolling base asset ordinals are not complete and ordered')
    if (parsedCounts.vaults + parsedCounts.loanBrokers + parsedCounts.loans !== parsed.records) {
      throw new Error(`Rolling base asset ${index} count mismatch`)
    }
    return parsed
  })
  if (assets.length !== segmentCount) throw new Error('Rolling base segment count mismatch')
  const aggregate = assets.reduce(
    (total, asset) => ({
      vaults: total.vaults + asset.counts.vaults,
      loanBrokers: total.loanBrokers + asset.counts.loanBrokers,
      loans: total.loans + asset.counts.loans,
    }),
    { vaults: 0, loanBrokers: 0, loans: 0 },
  )
  if (canonicalJson(aggregate) !== canonicalJson(manifestCounts)) throw new Error('Rolling base aggregate counts mismatch')

  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: text(source.epochId, 'epochId'),
    snapshotId: text(source.snapshotId, 'snapshotId'),
    ledgerIndex: integer(source.ledgerIndex, 'ledgerIndex', 1),
    ledgerHash: ledgerHash(source.ledgerHash, 'ledgerHash'),
    complete: true,
    segmentCount,
    counts: manifestCounts,
    assets,
    manifestSha256: digest(source.manifestSha256, 'manifestSha256'),
  }
}
