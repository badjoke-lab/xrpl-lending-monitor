import type { SegmentProtocolEventRecord } from '../../collector/history-segments/build-segment-records'
import type { NormalizedObjectChange } from '../../collector/incremental/affected-nodes'
import type { ArchivedObjectRecord as SegmentArchivedObjectRecord } from '../../collector/incremental/deleted-object-archive'
import type { BalanceHistoryRecord as SegmentBalanceHistoryRecord } from '../../collector/incremental/cover-debt-loss'
import type { LoanLifecycleEvent as SegmentLoanLifecycleEvent } from '../../collector/incremental/loan-lifecycle'
import type { HistorySourceMergeDiagnostics } from '../../shared/history-segments/merge-sources'
import {
  HistorySegmentChainReader,
  type HistorySegmentReadResult,
} from '../../shared/history-segments/reader'
import type {
  ArchivedObjectListOptions,
  ArchivedObjectRecord,
  BalanceHistoryApiRecord,
  BalanceHistoryListOptions,
  HistoryPageOptions,
  LoanLifecycleListOptions,
  LoanLifecycleRecord,
  ObjectChangeRecord,
  ProtocolEventRecord,
} from './history-api-repository'
import {
  segmentArchivedObjectToApi,
  segmentBalanceHistoryToApi,
  segmentLoanLifecycleToApi,
  segmentObjectChangeToApi,
  segmentProtocolEventToApi,
} from './history-segment-adapter'
import {
  listLiveActivityAfterBoundary,
  listLiveArchivedObjectsAfterBoundary,
  listLiveBalanceHistoryAfterBoundary,
  listLiveLoanLifecycleAfterBoundary,
  listLiveLoanLifecycleEventsAfterBoundary,
  listLiveObjectHistoryAfterBoundary,
} from './live-history-after-boundary'
import {
  mergeActivityHistory,
  mergeArchivedObjects,
  mergeBalanceHistory,
  mergeLoanLifecycleDetail,
  mergeLoanLifecycleExplorer,
  mergeObjectHistory,
} from './merged-history-source'

export interface ImmutableHistoryReadMeta {
  complete: boolean
  nextCursor: string | null
  segmentReads: number
  compressedBytes: number
  decompressedBytes: number
  recordsExamined: number
}

export interface HybridHistoryResult<T> {
  items: T[]
  immutable: ImmutableHistoryReadMeta
  merge: HistorySourceMergeDiagnostics
}

function immutableMeta<T>(result: HistorySegmentReadResult<T>): ImmutableHistoryReadMeta {
  return {
    complete: result.complete,
    nextCursor: result.nextCursor,
    segmentReads: result.segmentReads,
    compressedBytes: result.compressedBytes,
    decompressedBytes: result.decompressedBytes,
    recordsExamined: result.recordsExamined,
  }
}

function boundary(reader: HistorySegmentChainReader): number {
  return reader.publication.endLedgerIndex
}

export async function listHybridActivity(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  page: HistoryPageOptions
  immutableCursor?: string
}): Promise<HybridHistoryResult<ProtocolEventRecord>> {
  const immutable = await options.reader.list<SegmentProtocolEventRecord>({
    kind: 'protocol_events',
    direction: 'desc',
    limit: options.page.limit,
    cursor: options.immutableCursor,
  })
  const live = await listLiveActivityAfterBoundary(options.db, boundary(options.reader), options.page)
  const merged = mergeActivityHistory({
    immutable: immutable.items.map((event) => segmentProtocolEventToApi(event, options.reader.publication.epochId)),
    live,
    boundaryLedgerIndex: boundary(options.reader),
    limit: options.page.limit,
  })
  return { items: merged.items, immutable: immutableMeta(immutable), merge: merged.diagnostics }
}

export async function listHybridObjectHistory(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  objectType: string
  objectId: string
  page: HistoryPageOptions
  immutableCursor?: string
}): Promise<HybridHistoryResult<ObjectChangeRecord>> {
  const scope = `object:${options.objectType}:${options.objectId}`
  const immutable = await options.reader.list<NormalizedObjectChange>({
    kind: 'object_changes',
    direction: 'desc',
    scope,
    predicate: (change) => change.objectType === options.objectType && change.objectId === options.objectId,
    limit: options.page.limit,
    cursor: options.immutableCursor,
  })
  const live = await listLiveObjectHistoryAfterBoundary(
    options.db,
    options.objectType,
    options.objectId,
    boundary(options.reader),
    options.page,
  )
  const merged = mergeObjectHistory({
    immutable: immutable.items.map(segmentObjectChangeToApi),
    live,
    boundaryLedgerIndex: boundary(options.reader),
    limit: options.page.limit,
  })
  return { items: merged.items, immutable: immutableMeta(immutable), merge: merged.diagnostics }
}

export async function listHybridLoanLifecycle(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  loanId: string
  page: HistoryPageOptions
  immutableCursor?: string
}): Promise<HybridHistoryResult<LoanLifecycleRecord>> {
  const immutable = await options.reader.list<SegmentLoanLifecycleEvent>({
    kind: 'loan_lifecycle',
    direction: 'asc',
    scope: `loan:${options.loanId}`,
    predicate: (event) => event.loanId === options.loanId,
    limit: options.page.limit,
    cursor: options.immutableCursor,
  })
  const live = await listLiveLoanLifecycleAfterBoundary(
    options.db,
    options.loanId,
    boundary(options.reader),
    options.page,
  )
  const merged = mergeLoanLifecycleDetail({
    immutable: immutable.items.map(segmentLoanLifecycleToApi),
    live,
    boundaryLedgerIndex: boundary(options.reader),
    limit: options.page.limit,
  })
  return { items: merged.items, immutable: immutableMeta(immutable), merge: merged.diagnostics }
}

export async function listHybridLoanLifecycleEvents(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  list: LoanLifecycleListOptions
  immutableCursor?: string
}): Promise<HybridHistoryResult<LoanLifecycleRecord>> {
  const eventType = options.list.eventType ?? null
  const loanId = options.list.loanId ?? null
  const immutable = await options.reader.list<SegmentLoanLifecycleEvent>({
    kind: 'loan_lifecycle',
    direction: 'desc',
    scope: `lifecycle:${eventType ?? '*'}:${loanId ?? '*'}`,
    predicate: (event) =>
      (eventType === null || event.eventType === eventType)
      && (loanId === null || event.loanId === loanId),
    limit: options.list.limit,
    cursor: options.immutableCursor,
  })
  const live = await listLiveLoanLifecycleEventsAfterBoundary(
    options.db,
    boundary(options.reader),
    options.list,
  )
  const merged = mergeLoanLifecycleExplorer({
    immutable: immutable.items.map(segmentLoanLifecycleToApi),
    live,
    boundaryLedgerIndex: boundary(options.reader),
    limit: options.list.limit,
  })
  return { items: merged.items, immutable: immutableMeta(immutable), merge: merged.diagnostics }
}

function archiveMatches(
  archive: SegmentArchivedObjectRecord,
  options: ArchivedObjectListOptions,
): boolean {
  if (options.objectType && archive.objectType !== options.objectType) return false
  const query = options.query
  if (!query) return true
  return [
    archive.objectId,
    archive.deletionTransactionHash,
    archive.vaultId,
    archive.loanBrokerId,
    archive.loanId,
    archive.owner,
    archive.account,
    archive.borrower,
    archive.assetKey,
  ].some((value) => value === query)
}

export async function listHybridArchivedObjects(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  list: ArchivedObjectListOptions
  immutableCursor?: string
}): Promise<HybridHistoryResult<ArchivedObjectRecord>> {
  const immutable = await options.reader.list<SegmentArchivedObjectRecord>({
    kind: 'archived_objects',
    direction: 'desc',
    scope: `archive:${options.list.objectType ?? '*'}:${options.list.query ?? '*'}`,
    predicate: (archive) => archiveMatches(archive, options.list),
    limit: options.list.limit,
    cursor: options.immutableCursor,
  })
  const live = await listLiveArchivedObjectsAfterBoundary(
    options.db,
    boundary(options.reader),
    options.list,
  )
  const merged = mergeArchivedObjects({
    immutable: immutable.items.map(segmentArchivedObjectToApi),
    live,
    boundaryLedgerIndex: boundary(options.reader),
    limit: options.list.limit,
  })
  return { items: merged.items, immutable: immutableMeta(immutable), merge: merged.diagnostics }
}

function balanceMatches(
  record: SegmentBalanceHistoryRecord,
  options: BalanceHistoryListOptions,
): boolean {
  return (!options.metricType || record.metricType === options.metricType)
    && (!options.subjectType || record.subjectType === options.subjectType)
    && (!options.subjectId || record.subjectId === options.subjectId)
    && (!options.assetKey || record.assetKey === options.assetKey)
}

export async function listHybridBalanceHistory(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  list: BalanceHistoryListOptions
  immutableCursor?: string
}): Promise<HybridHistoryResult<BalanceHistoryApiRecord>> {
  const immutable = await options.reader.list<SegmentBalanceHistoryRecord>({
    kind: 'balance_history',
    direction: 'desc',
    scope: [
      'balance',
      options.list.metricType ?? '*',
      options.list.subjectType ?? '*',
      options.list.subjectId ?? '*',
      options.list.assetKey ?? '*',
    ].join(':'),
    predicate: (record) => balanceMatches(record, options.list),
    limit: options.list.limit,
    cursor: options.immutableCursor,
  })
  const live = await listLiveBalanceHistoryAfterBoundary(
    options.db,
    boundary(options.reader),
    options.list,
  )
  const merged = mergeBalanceHistory({
    immutable: immutable.items.map(segmentBalanceHistoryToApi),
    live,
    boundaryLedgerIndex: boundary(options.reader),
    limit: options.list.limit,
  })
  return { items: merged.items, immutable: immutableMeta(immutable), merge: merged.diagnostics }
}
