import type { CurrentStateManifest, CurrentStateShardSummary } from '../../collector/current-state/current-state-manifest'
import type { CurrentStateShardPayload } from '../../collector/current-state/bootstrap-shard-encoder'
import { normalizeVault } from '../../collector/current-state/normalize-current-objects'
import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { ActiveSnapshotRecord } from './core-api-repository'

const CURSOR_VERSION = 1
const DEFAULT_MAX_SHARDS_PER_READ = 8

export type VaultSort = 'id_asc' | 'id_desc'

export class CurrentStateObjectReadError extends Error {
  readonly code:
    | 'invalid_cursor'
    | 'snapshot_manifest_unavailable'
    | 'manifest_integrity_error'
    | 'shard_integrity_error'

  constructor(
    code: CurrentStateObjectReadError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'CurrentStateObjectReadError'
    this.code = code
  }
}

interface VaultCursor {
  version: 1
  snapshotId: string
  shardIndex: number
  objectOffset: number
  sort: VaultSort
}

export interface ListCurrentVaultsOptions {
  limit: number
  cursor?: string
  sort?: VaultSort
  query?: string
  hasLoss?: boolean
  maxShardsPerRead?: number
}

export interface ListCurrentVaultsResult {
  data: VaultCurrentProjection[]
  nextCursor: string | null
  shardsRead: number
  objectsExamined: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return Number(value)
}

function requiredDigest(value: unknown, field: string): string {
  const digest = requiredString(value, field).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${field} must be a SHA-256 digest`)
  }
  return digest
}

function optionalObjectIndex(value: unknown, field: string): string | null {
  if (value === null) return null
  const id = requiredString(value, field).toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(id)) throw new Error(`${field} must be a 64-character hex ID`)
  return id
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', source.buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function readVerifiedObject(options: {
  bucket: R2Bucket
  key: string
  expectedSha256: string
  expectedBytes?: number
  code: 'manifest_integrity_error' | 'shard_integrity_error'
}): Promise<Uint8Array> {
  const object = await options.bucket.get(options.key)
  if (!object) {
    throw new CurrentStateObjectReadError(options.code, `Current-state object ${options.key} is missing`)
  }

  if (object.customMetadata?.sha256 !== options.expectedSha256) {
    throw new CurrentStateObjectReadError(options.code, `Current-state object ${options.key} metadata digest does not match`)
  }
  if (options.expectedBytes !== undefined && object.size !== options.expectedBytes) {
    throw new CurrentStateObjectReadError(options.code, `Current-state object ${options.key} byte size does not match`)
  }

  const bytes = new Uint8Array(await object.arrayBuffer())
  if ((await sha256(bytes)) !== options.expectedSha256) {
    throw new CurrentStateObjectReadError(options.code, `Current-state object ${options.key} content digest does not match`)
  }
  return bytes
}

function validateShardSummary(value: unknown, index: number): CurrentStateShardSummary {
  if (!isRecord(value)) throw new Error(`manifest.shards[${index}] must be an object`)
  const pageNumber = requiredNonNegativeInteger(value.pageNumber, `manifest.shards[${index}].pageNumber`)
  if (pageNumber !== index + 1) throw new Error(`manifest shard sequence is incomplete at page ${index + 1}`)

  return {
    key: requiredString(value.key, `manifest.shards[${index}].key`),
    pageNumber,
    firstLedgerIndex: optionalObjectIndex(value.firstLedgerIndex, `manifest.shards[${index}].firstLedgerIndex`),
    lastLedgerIndex: optionalObjectIndex(value.lastLedgerIndex, `manifest.shards[${index}].lastLedgerIndex`),
    decodedObjects: requiredNonNegativeInteger(value.decodedObjects, `manifest.shards[${index}].decodedObjects`),
    vaultCount: requiredNonNegativeInteger(value.vaultCount, `manifest.shards[${index}].vaultCount`),
    loanBrokerCount: requiredNonNegativeInteger(value.loanBrokerCount, `manifest.shards[${index}].loanBrokerCount`),
    loanCount: requiredNonNegativeInteger(value.loanCount, `manifest.shards[${index}].loanCount`),
    compressedBytes: requiredNonNegativeInteger(value.compressedBytes, `manifest.shards[${index}].compressedBytes`),
    sha256: requiredDigest(value.sha256, `manifest.shards[${index}].sha256`),
  }
}

function validateManifest(value: unknown, snapshot: ActiveSnapshotRecord): CurrentStateManifest {
  if (!isRecord(value)) throw new Error('manifest must be an object')
  if (value.schemaVersion !== 1) throw new Error('manifest schemaVersion must be 1')
  if (value.network !== 'devnet') throw new Error('manifest network must be devnet')
  if (value.snapshotId !== snapshot.id) throw new Error('manifest snapshotId does not match active snapshot')
  if (value.epochId !== snapshot.epochId) throw new Error('manifest epochId does not match active snapshot')
  if (value.ledgerIndex !== snapshot.ledgerIndex) throw new Error('manifest ledgerIndex does not match active snapshot')
  if (value.ledgerHash !== snapshot.ledgerHash) throw new Error('manifest ledgerHash does not match active snapshot')
  if (value.objectPrefix !== snapshot.objectPrefix) throw new Error('manifest objectPrefix does not match active snapshot')
  if (!isRecord(value.counts)) throw new Error('manifest counts must be an object')
  if (!Array.isArray(value.shards)) throw new Error('manifest shards must be an array')

  const shards = value.shards.map(validateShardSummary)
  if (shards.length !== snapshot.shardCount) throw new Error('manifest shard count does not match active snapshot')
  if (value.counts.vaults !== snapshot.vaultCount) throw new Error('manifest Vault count does not match active snapshot')
  if (value.counts.loanBrokers !== snapshot.loanBrokerCount) throw new Error('manifest LoanBroker count does not match active snapshot')
  if (value.counts.loans !== snapshot.loanCount) throw new Error('manifest Loan count does not match active snapshot')
  if (value.compressedBytes !== snapshot.compressedBytes) throw new Error('manifest compressed bytes do not match active snapshot')

  return value as unknown as CurrentStateManifest
}

async function readManifest(bucket: R2Bucket, snapshot: ActiveSnapshotRecord): Promise<CurrentStateManifest> {
  if (!snapshot.manifestKey || !snapshot.manifestSha256) {
    throw new CurrentStateObjectReadError(
      'snapshot_manifest_unavailable',
      'Active snapshot manifest metadata is incomplete',
    )
  }

  const bytes = await readVerifiedObject({
    bucket,
    key: snapshot.manifestKey,
    expectedSha256: snapshot.manifestSha256,
    code: 'manifest_integrity_error',
  })

  try {
    return validateManifest(JSON.parse(new TextDecoder().decode(bytes)), snapshot)
  } catch (error) {
    throw new CurrentStateObjectReadError(
      'manifest_integrity_error',
      error instanceof Error ? error.message : 'Current-state manifest is invalid',
    )
  }
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const source = Uint8Array.from(bytes)
  const stream = new Blob([source.buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function validateShardPayload(
  value: unknown,
  snapshot: ActiveSnapshotRecord,
  descriptor: CurrentStateShardSummary,
): CurrentStateShardPayload {
  if (!isRecord(value)) throw new Error('shard payload must be an object')
  if (value.schemaVersion !== 1) throw new Error('shard schemaVersion must be 1')
  if (value.snapshotId !== snapshot.id) throw new Error('shard snapshotId does not match active snapshot')
  if (value.pageNumber !== descriptor.pageNumber) throw new Error('shard pageNumber does not match manifest')
  if (!Array.isArray(value.vaults)) throw new Error('shard vaults must be an array')
  if (!Array.isArray(value.loanBrokers)) throw new Error('shard loanBrokers must be an array')
  if (!Array.isArray(value.loans)) throw new Error('shard loans must be an array')
  if (value.vaults.length !== descriptor.vaultCount) throw new Error('shard Vault count does not match manifest')
  if (value.loanBrokers.length !== descriptor.loanBrokerCount) throw new Error('shard LoanBroker count does not match manifest')
  if (value.loans.length !== descriptor.loanCount) throw new Error('shard Loan count does not match manifest')
  return value as unknown as CurrentStateShardPayload
}

async function readShard(
  bucket: R2Bucket,
  snapshot: ActiveSnapshotRecord,
  descriptor: CurrentStateShardSummary,
): Promise<CurrentStateShardPayload> {
  if (!descriptor.key.startsWith(`${snapshot.objectPrefix}/`)) {
    throw new CurrentStateObjectReadError('shard_integrity_error', 'Shard key is outside the active snapshot prefix')
  }

  const compressed = await readVerifiedObject({
    bucket,
    key: descriptor.key,
    expectedSha256: descriptor.sha256,
    expectedBytes: descriptor.compressedBytes,
    code: 'shard_integrity_error',
  })

  try {
    const decoded = await gunzip(compressed)
    return validateShardPayload(JSON.parse(new TextDecoder().decode(decoded)), snapshot, descriptor)
  } catch (error) {
    if (error instanceof CurrentStateObjectReadError) throw error
    throw new CurrentStateObjectReadError(
      'shard_integrity_error',
      error instanceof Error ? error.message : 'Current-state shard is invalid',
    )
  }
}

function encodeCursor(cursor: VaultCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeCursor(value: string): VaultCursor {
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    const parsed: unknown = JSON.parse(atob(padded))
    if (!isRecord(parsed)) throw new Error('cursor must be an object')
    if (parsed.version !== CURSOR_VERSION) throw new Error('cursor version is unsupported')
    if (typeof parsed.snapshotId !== 'string' || parsed.snapshotId.length === 0) throw new Error('cursor snapshotId is invalid')
    if (!Number.isSafeInteger(parsed.shardIndex) || Number(parsed.shardIndex) < 0) throw new Error('cursor shardIndex is invalid')
    if (!Number.isSafeInteger(parsed.objectOffset) || Number(parsed.objectOffset) < 0) throw new Error('cursor objectOffset is invalid')
    if (parsed.sort !== 'id_asc' && parsed.sort !== 'id_desc') throw new Error('cursor sort is invalid')
    return parsed as unknown as VaultCursor
  } catch (error) {
    throw new CurrentStateObjectReadError(
      'invalid_cursor',
      error instanceof Error ? error.message : 'cursor is invalid',
    )
  }
}

function hasNonZeroLoss(vault: VaultCurrentProjection): boolean {
  return !/^[-+]?0(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(vault.lossUnrealized.trim())
}

function matchesVault(vault: VaultCurrentProjection, options: { query?: string; hasLoss?: boolean }): boolean {
  if (options.hasLoss !== undefined && hasNonZeroLoss(vault) !== options.hasLoss) return false
  if (!options.query) return true
  const query = options.query.toLowerCase()
  return [vault.id, vault.owner, vault.account, vault.domainId ?? '', vault.shareMptId, vault.asset.key]
    .some((value) => value.toLowerCase().includes(query))
}

function nextShardIndex(index: number, sort: VaultSort): number {
  return sort === 'id_asc' ? index + 1 : index - 1
}

function isShardIndexInRange(index: number, length: number): boolean {
  return index >= 0 && index < length
}

export async function listCurrentVaults(
  bucket: R2Bucket,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentVaultsOptions,
): Promise<ListCurrentVaultsResult> {
  const sort = options.sort ?? 'id_asc'
  const maxShardsPerRead = options.maxShardsPerRead ?? DEFAULT_MAX_SHARDS_PER_READ
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error('limit must be positive')
  if (!Number.isSafeInteger(maxShardsPerRead) || maxShardsPerRead < 1) throw new Error('maxShardsPerRead must be positive')

  const manifest = await readManifest(bucket, snapshot)
  const decodedCursor = options.cursor ? decodeCursor(options.cursor) : null
  if (decodedCursor && decodedCursor.snapshotId !== snapshot.id) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor belongs to a different snapshot')
  }
  if (decodedCursor && decodedCursor.sort !== sort) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor sort does not match request sort')
  }

  let shardIndex = decodedCursor?.shardIndex ?? (sort === 'id_asc' ? 0 : manifest.shards.length - 1)
  let objectOffset = decodedCursor?.objectOffset ?? 0
  const data: VaultCurrentProjection[] = []
  let shardsRead = 0
  let objectsExamined = 0

  while (
    isShardIndexInRange(shardIndex, manifest.shards.length) &&
    shardsRead < maxShardsPerRead &&
    data.length < options.limit
  ) {
    const descriptor = manifest.shards[shardIndex]
    if (!descriptor) break
    const shard = await readShard(bucket, snapshot, descriptor)
    shardsRead += 1

    const ordered = shard.vaults
      .map((value) => normalizeVault(value))
      .sort((left, right) => left.id.localeCompare(right.id))
    if (sort === 'id_desc') ordered.reverse()

    for (let index = objectOffset; index < ordered.length; index += 1) {
      const vault = ordered[index]
      if (!vault) continue
      objectsExamined += 1
      if (!matchesVault(vault, options)) continue
      data.push(vault)
      if (data.length === options.limit) {
        const nextOffset = index + 1
        const nextCursor = nextOffset < ordered.length
          ? encodeCursor({ version: 1, snapshotId: snapshot.id, shardIndex, objectOffset: nextOffset, sort })
          : isShardIndexInRange(nextShardIndex(shardIndex, sort), manifest.shards.length)
            ? encodeCursor({ version: 1, snapshotId: snapshot.id, shardIndex: nextShardIndex(shardIndex, sort), objectOffset: 0, sort })
            : null
        return { data, nextCursor, shardsRead, objectsExamined }
      }
    }

    shardIndex = nextShardIndex(shardIndex, sort)
    objectOffset = 0
  }

  return {
    data,
    nextCursor: isShardIndexInRange(shardIndex, manifest.shards.length)
      ? encodeCursor({ version: 1, snapshotId: snapshot.id, shardIndex, objectOffset: 0, sort })
      : null,
    shardsRead,
    objectsExamined,
  }
}

export async function getCurrentVaultById(
  bucket: R2Bucket,
  snapshot: ActiveSnapshotRecord,
  vaultId: string,
): Promise<VaultCurrentProjection | null> {
  const normalizedId = vaultId.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalizedId)) return null
  const manifest = await readManifest(bucket, snapshot)
  const descriptor = manifest.shards.find((shard) => {
    if (!shard.firstLedgerIndex || !shard.lastLedgerIndex) return false
    return shard.firstLedgerIndex <= normalizedId && normalizedId <= shard.lastLedgerIndex
  })
  if (!descriptor) return null

  const shard = await readShard(bucket, snapshot, descriptor)
  const object = shard.vaults.find((value) => value.index.toUpperCase() === normalizedId)
  return object ? normalizeVault(object) : null
}
