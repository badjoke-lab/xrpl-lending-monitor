import type { CurrentStateManifest, CurrentStateShardSummary } from '../../collector/current-state/current-state-manifest'
import type { CurrentStateShardPayload } from '../../collector/current-state/bootstrap-shard-encoder'
import {
  normalizeLoan,
  normalizeLoanBroker,
  normalizeVault,
} from '../../collector/current-state/normalize-current-objects'
import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  LoanOnLedgerStatus,
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
const DEFAULT_MAX_LOAN_SHARDS = 8
const DEFAULT_MAX_RELATION_SHARDS = 8

export type LoanSort = 'id_asc' | 'id_desc'
export type LoanScheduleStatus =
  | 'current'
  | 'payment_due'
  | 'default_eligible'
  | 'complete'
  | 'unknown'

interface LoanCursor {
  version: 1
  snapshotId: string
  shardIndex: number
  objectOffset: number
  sort: LoanSort
}

export interface LoanScheduleEvaluation {
  status: LoanScheduleStatus
  evaluatedAtRippleTime: number
  nextPaymentDueRippleTime: number | null
  defaultEligibleRippleTime: number | null
}

export interface CurrentLoanRecord {
  loan: LoanCurrentProjection
  broker: LoanBrokerCurrentProjection
  vault: VaultCurrentProjection
  schedule: LoanScheduleEvaluation
}

export interface ListCurrentLoansOptions {
  limit: number
  evaluatedAtRippleTime: number
  cursor?: string
  sort?: LoanSort
  query?: string
  onLedgerStatus?: LoanOnLedgerStatus
  scheduleStatus?: LoanScheduleStatus
  maxLoanShardsPerRead?: number
  maxRelationShardsPerRead?: number
}

export interface ListCurrentLoansResult {
  data: CurrentLoanRecord[]
  nextCursor: string | null
  loanShardsRead: number
  relationShardsRead: number
  objectsExamined: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeCursor(cursor: LoanCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeCursor(value: string): LoanCursor {
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
    return parsed as unknown as LoanCursor
  } catch (error) {
    throw new CurrentStateObjectReadError(
      'invalid_cursor',
      error instanceof Error ? error.message : 'cursor is invalid',
    )
  }
}

function nextShardIndex(index: number, sort: LoanSort): number {
  return sort === 'id_asc' ? index + 1 : index - 1
}

function isShardIndexInRange(index: number, length: number): boolean {
  return index >= 0 && index < length
}

function scheduleEvaluation(
  loan: LoanCurrentProjection,
  evaluatedAtRippleTime: number,
): LoanScheduleEvaluation {
  if (!Number.isSafeInteger(evaluatedAtRippleTime) || evaluatedAtRippleTime < 0) {
    throw new Error('evaluatedAtRippleTime must be a non-negative safe integer')
  }
  if (loan.paymentRemaining === 0) {
    return {
      status: 'complete',
      evaluatedAtRippleTime,
      nextPaymentDueRippleTime: loan.nextPaymentDueDate,
      defaultEligibleRippleTime: null,
    }
  }
  if (loan.nextPaymentDueDate === null) {
    return {
      status: 'unknown',
      evaluatedAtRippleTime,
      nextPaymentDueRippleTime: null,
      defaultEligibleRippleTime: null,
    }
  }
  const defaultEligibleRippleTime = loan.nextPaymentDueDate + loan.gracePeriod
  return {
    status: evaluatedAtRippleTime < loan.nextPaymentDueDate
      ? 'current'
      : evaluatedAtRippleTime < defaultEligibleRippleTime
        ? 'payment_due'
        : 'default_eligible',
    evaluatedAtRippleTime,
    nextPaymentDueRippleTime: loan.nextPaymentDueDate,
    defaultEligibleRippleTime,
  }
}

function matchesLoan(
  loan: LoanCurrentProjection,
  evaluation: LoanScheduleEvaluation,
  options: Pick<ListCurrentLoansOptions, 'query' | 'onLedgerStatus' | 'scheduleStatus'>,
): boolean {
  if (options.onLedgerStatus && loan.onLedgerStatus !== options.onLedgerStatus) return false
  if (options.scheduleStatus && evaluation.status !== options.scheduleStatus) return false
  if (!options.query) return true
  const query = options.query.toLowerCase()
  return [loan.id, loan.loanBrokerId, loan.borrower]
    .some((value) => value.toLowerCase().includes(query))
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

async function ensureRelationshipShards(options: {
  bucket: R2Bucket
  snapshot: ActiveSnapshotRecord
  descriptors: CurrentStateShardSummary[]
  cache: Map<string, CurrentStateShardPayload>
  readsUsed: number
  maxReads: number
}): Promise<number> {
  const unread = [...new Map(options.descriptors.map((value) => [value.key, value])).values()]
    .filter((descriptor) => !options.cache.has(descriptor.key))
  if (options.readsUsed + unread.length > options.maxReads) {
    throw new CurrentStateObjectReadError(
      'relationship_read_limit',
      `Loan relationships require more than ${options.maxReads} additional shards`,
    )
  }
  let reads = options.readsUsed
  for (const descriptor of unread) {
    const result = await cachedShard({
      bucket: options.bucket,
      snapshot: options.snapshot,
      descriptor,
      cache: options.cache,
    })
    if (result.read) reads += 1
  }
  return reads
}

async function resolveRelationships(options: {
  bucket: R2Bucket
  snapshot: ActiveSnapshotRecord
  manifest: CurrentStateManifest
  loans: LoanCurrentProjection[]
  cache: Map<string, CurrentStateShardPayload>
  maxRelationShards: number
}): Promise<{
  brokers: Map<string, LoanBrokerCurrentProjection>
  vaults: Map<string, VaultCurrentProjection>
  relationShardsRead: number
}> {
  const brokerDescriptors = options.loans.map((loan) => {
    const descriptor = findCurrentStateShard(options.manifest, loan.loanBrokerId)
    if (!descriptor) {
      throw new CurrentStateObjectReadError(
        'shard_integrity_error',
        `Loan ${loan.id} references Loan Broker ${loan.loanBrokerId} outside the active manifest`,
      )
    }
    return descriptor
  })

  let relationShardsRead = await ensureRelationshipShards({
    bucket: options.bucket,
    snapshot: options.snapshot,
    descriptors: brokerDescriptors,
    cache: options.cache,
    readsUsed: 0,
    maxReads: options.maxRelationShards,
  })

  const requestedBrokerIds = new Set(options.loans.map((loan) => loan.loanBrokerId.toUpperCase()))
  const brokers = new Map<string, LoanBrokerCurrentProjection>()
  for (const descriptor of brokerDescriptors) {
    const shard = options.cache.get(descriptor.key)
    if (!shard) continue
    for (const raw of shard.loanBrokers) {
      const id = raw.index.toUpperCase()
      if (requestedBrokerIds.has(id)) brokers.set(id, normalizeLoanBroker(raw))
    }
  }

  for (const loan of options.loans) {
    if (!brokers.has(loan.loanBrokerId.toUpperCase())) {
      throw new CurrentStateObjectReadError(
        'shard_integrity_error',
        `Loan ${loan.id} references missing Loan Broker ${loan.loanBrokerId}`,
      )
    }
  }

  const vaultDescriptors = [...brokers.values()].map((broker) => {
    const descriptor = findCurrentStateShard(options.manifest, broker.vaultId)
    if (!descriptor) {
      throw new CurrentStateObjectReadError(
        'shard_integrity_error',
        `Loan Broker ${broker.id} references Vault ${broker.vaultId} outside the active manifest`,
      )
    }
    return descriptor
  })

  relationShardsRead = await ensureRelationshipShards({
    bucket: options.bucket,
    snapshot: options.snapshot,
    descriptors: vaultDescriptors,
    cache: options.cache,
    readsUsed: relationShardsRead,
    maxReads: options.maxRelationShards,
  })

  const requestedVaultIds = new Set([...brokers.values()].map((broker) => broker.vaultId.toUpperCase()))
  const vaults = new Map<string, VaultCurrentProjection>()
  for (const descriptor of vaultDescriptors) {
    const shard = options.cache.get(descriptor.key)
    if (!shard) continue
    for (const raw of shard.vaults) {
      const id = raw.index.toUpperCase()
      if (requestedVaultIds.has(id)) vaults.set(id, normalizeVault(raw))
    }
  }

  for (const broker of brokers.values()) {
    if (!vaults.has(broker.vaultId.toUpperCase())) {
      throw new CurrentStateObjectReadError(
        'shard_integrity_error',
        `Loan Broker ${broker.id} references missing Vault ${broker.vaultId}`,
      )
    }
  }

  return { brokers, vaults, relationShardsRead }
}

export async function listCurrentLoans(
  bucket: R2Bucket,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoansOptions,
): Promise<ListCurrentLoansResult> {
  const sort = options.sort ?? 'id_asc'
  const maxLoanShards = options.maxLoanShardsPerRead ?? DEFAULT_MAX_LOAN_SHARDS
  const maxRelationShards = options.maxRelationShardsPerRead ?? DEFAULT_MAX_RELATION_SHARDS
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error('limit must be positive')
  if (!Number.isSafeInteger(maxLoanShards) || maxLoanShards < 1) {
    throw new Error('maxLoanShardsPerRead must be positive')
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
  let loanShardsRead = 0
  let objectsExamined = 0
  const selected: Array<{ loan: LoanCurrentProjection; schedule: LoanScheduleEvaluation }> = []
  const cache = new Map<string, CurrentStateShardPayload>()

  while (
    isShardIndexInRange(shardIndex, manifest.shards.length) &&
    loanShardsRead < maxLoanShards &&
    selected.length < options.limit
  ) {
    const descriptor = manifest.shards[shardIndex]
    if (!descriptor) break
    const result = await cachedShard({ bucket, snapshot, descriptor, cache })
    if (result.read) loanShardsRead += 1

    const ordered = result.shard.loans
      .map((value) => normalizeLoan(value))
      .sort((left, right) => left.id.localeCompare(right.id))
    if (sort === 'id_desc') ordered.reverse()

    for (let index = objectOffset; index < ordered.length; index += 1) {
      const loan = ordered[index]
      if (!loan) continue
      objectsExamined += 1
      const schedule = scheduleEvaluation(loan, options.evaluatedAtRippleTime)
      if (!matchesLoan(loan, schedule, options)) continue
      selected.push({ loan, schedule })
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

  const relationships = await resolveRelationships({
    bucket,
    snapshot,
    manifest,
    loans: selected.map((value) => value.loan),
    cache,
    maxRelationShards,
  })

  return {
    data: selected.map(({ loan, schedule }) => {
      const broker = relationships.brokers.get(loan.loanBrokerId.toUpperCase())!
      return {
        loan,
        broker,
        vault: relationships.vaults.get(broker.vaultId.toUpperCase())!,
        schedule,
      }
    }),
    nextCursor,
    loanShardsRead,
    relationShardsRead: relationships.relationShardsRead,
    objectsExamined,
  }
}

export async function getCurrentLoanById(
  bucket: R2Bucket,
  snapshot: ActiveSnapshotRecord,
  loanId: string,
  evaluatedAtRippleTime: number,
): Promise<CurrentLoanRecord | null> {
  const normalizedId = loanId.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalizedId)) return null
  const manifest = await readCurrentStateManifest(bucket, snapshot)
  const descriptor = findCurrentStateShard(manifest, normalizedId)
  if (!descriptor) return null

  const cache = new Map<string, CurrentStateShardPayload>()
  const loanShard = await cachedShard({ bucket, snapshot, descriptor, cache })
  const rawLoan = loanShard.shard.loans.find((value) => value.index.toUpperCase() === normalizedId)
  if (!rawLoan) return null
  const loan = normalizeLoan(rawLoan)
  const relationships = await resolveRelationships({
    bucket,
    snapshot,
    manifest,
    loans: [loan],
    cache,
    maxRelationShards: 2,
  })
  const broker = relationships.brokers.get(loan.loanBrokerId.toUpperCase())
  if (!broker) {
    throw new CurrentStateObjectReadError(
      'shard_integrity_error',
      `Loan ${loan.id} references missing Loan Broker ${loan.loanBrokerId}`,
    )
  }
  const vault = relationships.vaults.get(broker.vaultId.toUpperCase())
  if (!vault) {
    throw new CurrentStateObjectReadError(
      'shard_integrity_error',
      `Loan Broker ${broker.id} references missing Vault ${broker.vaultId}`,
    )
  }
  return {
    loan,
    broker,
    vault,
    schedule: scheduleEvaluation(loan, evaluatedAtRippleTime),
  }
}
