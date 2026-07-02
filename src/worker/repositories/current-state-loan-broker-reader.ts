import type { CurrentStateManifest, CurrentStateShardSummary } from '../../collector/current-state/current-state-manifest'
import type { CurrentStateShardPayload } from '../../collector/current-state/bootstrap-shard-encoder'
import { normalizeLoanBroker, normalizeVault } from '../../collector/current-state/normalize-current-objects'
import type {
  LoanBrokerCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  CurrentStateObjectReadError,
  findCurrentStateShard,
  readCurrentStateManifest,
  readCurrentStateShard,
} from './current-state-object-reader'

const CURSOR_VERSION = 1
const DEFAULT_MAX_BROKER_SHARDS = 8
const DEFAULT_MAX_RELATION_SHARDS = 8

export type LoanBrokerSort = 'id_asc' | 'id_desc'

interface LoanBrokerCursor {
  version: 1
  snapshotId: string
  shardIndex: number
  objectOffset: number
  sort: LoanBrokerSort
}

export interface CurrentLoanBrokerRecord {
  broker: LoanBrokerCurrentProjection
  vault: VaultCurrentProjection
}

export interface ListCurrentLoanBrokersOptions {
  limit: number
  cursor?: string
  sort?: LoanBrokerSort
  query?: string
  maxBrokerShardsPerRead?: number
  maxRelationShardsPerRead?: number
}

export interface ListCurrentLoanBrokersResult {
  data: CurrentLoanBrokerRecord[]
  nextCursor: string | null
  brokerShardsRead: number
  relationShardsRead: number
  objectsExamined: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeCursor(cursor: LoanBrokerCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeCursor(value: string): LoanBrokerCursor {
  try {
    const padded = value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=')
    const parsed: unknown = JSON.parse(atob(padded))
    if (!isRecord(parsed)) throw new Error('cursor must be an object')
    if (parsed.version !== CURSOR_VERSION) throw new Error('cursor version is unsupported')
    if (typeof parsed.snapshotId !== 'string' || parsed.snapshotId.length === 0) {
      throw new Error('cursor snapshotId is invalid')
    }
    if (!Number.isSafeInteger(parsed.shardIndex) || Number(parsed.shardIndex) < 0) {
      throw new Error('cursor shardIndex is invalid')
    }
    if (!Number.isSafeInteger(parsed.objectOffset) || Number(parsed.objectOffset) < 0) {
      throw new Error('cursor objectOffset is invalid')
    }
    if (parsed.sort !== 'id_asc' && parsed.sort !== 'id_desc') {
      throw new Error('cursor sort is invalid')
    }
    return parsed as unknown as LoanBrokerCursor
  } catch (error) {
    throw new CurrentStateObjectReadError(
      'invalid_cursor',
      error instanceof Error ? error.message : 'cursor is invalid',
    )
  }
}

function nextShardIndex(index: number, sort: LoanBrokerSort): number {
  return sort === 'id_asc' ? index + 1 : index - 1
}

function isShardIndexInRange(index: number, length: number): boolean {
  return index >= 0 && index < length
}

function matchesBroker(broker: LoanBrokerCurrentProjection, query?: string): boolean {
  if (!query) return true
  const normalized = query.toLowerCase()
  return [broker.id, broker.vaultId, broker.owner, broker.account]
    .some((value) => value.toLowerCase().includes(normalized))
}

async function cachedShard(options: {
  bucket: R2Bucket
  snapshot: ActiveSnapshotRecord
  descriptor: CurrentStateShardSummary
  cache: Map<string, CurrentStateShardPayload>
}): Promise<{ shard: CurrentStateShardPayload; read: boolean }> {
  const cached = options.cache.get(options.descriptor.key)
  if (cached) return { shard: cached, read: false }
  const shard = await readCurrentStateShard(options.bucket, options.snapshot, options.descriptor)
  options.cache.set(options.descriptor.key, shard)
  return { shard, read: true }
}

async function resolveVaults(options: {
  bucket: R2Bucket
  snapshot: ActiveSnapshotRecord
  manifest: CurrentStateManifest
  brokers: LoanBrokerCurrentProjection[]
  cache: Map<string, CurrentStateShardPayload>
  maxRelationShards: number
}): Promise<{ vaults: Map<string, VaultCurrentProjection>; relationShardsRead: number }> {
  const descriptors = new Map<string, CurrentStateShardSummary>()
  for (const broker of options.brokers) {
    const descriptor = findCurrentStateShard(options.manifest, broker.vaultId)
    if (!descriptor) {
      throw new CurrentStateObjectReadError(
        'shard_integrity_error',
        `Loan Broker ${broker.id} references Vault ${broker.vaultId} outside the active manifest`,
      )
    }
    descriptors.set(descriptor.key, descriptor)
  }

  const unread = [...descriptors.values()].filter((descriptor) => !options.cache.has(descriptor.key))
  if (unread.length > options.maxRelationShards) {
    throw new CurrentStateObjectReadError(
      'relationship_read_limit',
      `Loan Broker relationships require ${unread.length} additional shards, above the limit ${options.maxRelationShards}`,
    )
  }

  let relationShardsRead = 0
  for (const descriptor of unread) {
    const result = await cachedShard({
      bucket: options.bucket,
      snapshot: options.snapshot,
      descriptor,
      cache: options.cache,
    })
    if (result.read) relationShardsRead += 1
  }

  const requested = new Set(options.brokers.map((broker) => broker.vaultId.toUpperCase()))
  const vaults = new Map<string, VaultCurrentProjection>()
  for (const descriptor of descriptors.values()) {
    const shard = options.cache.get(descriptor.key)
    if (!shard) continue
    for (const raw of shard.vaults) {
      const id = raw.index.toUpperCase()
      if (requested.has(id)) vaults.set(id, normalizeVault(raw))
    }
  }

  for (const broker of options.brokers) {
    if (!vaults.has(broker.vaultId.toUpperCase())) {
      throw new CurrentStateObjectReadError(
        'shard_integrity_error',
        `Loan Broker ${broker.id} references missing Vault ${broker.vaultId}`,
      )
    }
  }

  return { vaults, relationShardsRead }
}

export async function listCurrentLoanBrokers(
  bucket: R2Bucket,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoanBrokersOptions,
): Promise<ListCurrentLoanBrokersResult> {
  const sort = options.sort ?? 'id_asc'
  const maxBrokerShards = options.maxBrokerShardsPerRead ?? DEFAULT_MAX_BROKER_SHARDS
  const maxRelationShards = options.maxRelationShardsPerRead ?? DEFAULT_MAX_RELATION_SHARDS
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error('limit must be positive')
  if (!Number.isSafeInteger(maxBrokerShards) || maxBrokerShards < 1) {
    throw new Error('maxBrokerShardsPerRead must be positive')
  }
  if (!Number.isSafeInteger(maxRelationShards) || maxRelationShards < 0) {
    throw new Error('maxRelationShardsPerRead must be non-negative')
  }

  const manifest = await readCurrentStateManifest(bucket, snapshot)
  const decodedCursor = options.cursor ? decodeCursor(options.cursor) : null
  if (decodedCursor && decodedCursor.snapshotId !== snapshot.id) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor belongs to a different snapshot')
  }
  if (decodedCursor && decodedCursor.sort !== sort) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor sort does not match request sort')
  }

  let shardIndex = decodedCursor?.shardIndex ?? (sort === 'id_asc' ? 0 : manifest.shards.length - 1)
  let objectOffset = decodedCursor?.objectOffset ?? 0
  let nextCursor: string | null = null
  let brokerShardsRead = 0
  let objectsExamined = 0
  const selected: LoanBrokerCurrentProjection[] = []
  const cache = new Map<string, CurrentStateShardPayload>()

  while (
    isShardIndexInRange(shardIndex, manifest.shards.length) &&
    brokerShardsRead < maxBrokerShards &&
    selected.length < options.limit
  ) {
    const descriptor = manifest.shards[shardIndex]
    if (!descriptor) break
    const result = await cachedShard({ bucket, snapshot, descriptor, cache })
    if (result.read) brokerShardsRead += 1

    const ordered = result.shard.loanBrokers
      .map((value) => normalizeLoanBroker(value))
      .sort((left, right) => left.id.localeCompare(right.id))
    if (sort === 'id_desc') ordered.reverse()

    for (let index = objectOffset; index < ordered.length; index += 1) {
      const broker = ordered[index]
      if (!broker) continue
      objectsExamined += 1
      if (!matchesBroker(broker, options.query)) continue
      selected.push(broker)
      if (selected.length === options.limit) {
        const nextOffset = index + 1
        nextCursor = nextOffset < ordered.length
          ? encodeCursor({ version: 1, snapshotId: snapshot.id, shardIndex, objectOffset: nextOffset, sort })
          : isShardIndexInRange(nextShardIndex(shardIndex, sort), manifest.shards.length)
            ? encodeCursor({
                version: 1,
                snapshotId: snapshot.id,
                shardIndex: nextShardIndex(shardIndex, sort),
                objectOffset: 0,
                sort,
              })
            : null
        break
      }
    }

    if (selected.length === options.limit) break
    shardIndex = nextShardIndex(shardIndex, sort)
    objectOffset = 0
  }

  if (selected.length < options.limit) {
    nextCursor = isShardIndexInRange(shardIndex, manifest.shards.length)
      ? encodeCursor({ version: 1, snapshotId: snapshot.id, shardIndex, objectOffset: 0, sort })
      : null
  }

  const resolved = await resolveVaults({
    bucket,
    snapshot,
    manifest,
    brokers: selected,
    cache,
    maxRelationShards,
  })

  return {
    data: selected.map((broker) => ({
      broker,
      vault: resolved.vaults.get(broker.vaultId.toUpperCase())!,
    })),
    nextCursor,
    brokerShardsRead,
    relationShardsRead: resolved.relationShardsRead,
    objectsExamined,
  }
}

export async function getCurrentLoanBrokerById(
  bucket: R2Bucket,
  snapshot: ActiveSnapshotRecord,
  brokerId: string,
): Promise<CurrentLoanBrokerRecord | null> {
  const normalizedId = brokerId.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalizedId)) return null
  const manifest = await readCurrentStateManifest(bucket, snapshot)
  const descriptor = findCurrentStateShard(manifest, normalizedId)
  if (!descriptor) return null

  const cache = new Map<string, CurrentStateShardPayload>()
  const brokerShard = await cachedShard({ bucket, snapshot, descriptor, cache })
  const rawBroker = brokerShard.shard.loanBrokers.find(
    (value) => value.index.toUpperCase() === normalizedId,
  )
  if (!rawBroker) return null
  const broker = normalizeLoanBroker(rawBroker)
  const resolved = await resolveVaults({
    bucket,
    snapshot,
    manifest,
    brokers: [broker],
    cache,
    maxRelationShards: 1,
  })
  const vault = resolved.vaults.get(broker.vaultId.toUpperCase())
  if (!vault) {
    throw new CurrentStateObjectReadError(
      'shard_integrity_error',
      `Loan Broker ${broker.id} references missing Vault ${broker.vaultId}`,
    )
  }
  return { broker, vault }
}
