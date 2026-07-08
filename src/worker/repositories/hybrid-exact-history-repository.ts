import type { SegmentProtocolEventRecord } from '../../collector/history-segments/build-segment-records'
import type { NormalizedObjectChange } from '../../collector/incremental/affected-nodes'
import type { LoanLifecycleEvent as SegmentLoanLifecycleEvent } from '../../collector/incremental/loan-lifecycle'
import { normalizeHistoryExactTerm, type HistoryExactIndexReference } from '../../shared/history-segments/exact-index'
import type { HistoryExactIndexReader } from '../../shared/history-segments/exact-index-reader'
import type { HistorySegmentChainReader } from '../../shared/history-segments/reader'
import type {
  HistoryPageOptions,
  LoanLifecycleRecord,
  ObjectChangeRecord,
  ProtocolEventRecord,
  SearchResultRecord,
} from './history-api-repository'
import {
  segmentLoanLifecycleToApi,
  segmentObjectChangeToApi,
  segmentProtocolEventToApi,
} from './history-segment-adapter'
import {
  listLiveLoanLifecycleAfterBoundary,
  listLiveObjectHistoryAfterBoundary,
} from './live-history-after-boundary'
import { getLiveTransactionDetailAfterBoundary } from './live-transaction-detail-after-boundary'
import { searchLiveHistoryAfterBoundary } from './live-search-after-boundary'
import {
  mergeLoanLifecycleDetail,
  mergeObjectHistory,
} from './merged-history-source'

const EXACT_DETAIL_MAX_ASSET_READS = 16
const EXACT_DETAIL_MAX_RECORDS = 100

export interface HybridTransactionDetail {
  transactionHash: string
  event: ProtocolEventRecord | null
  changes: ObjectChangeRecord[]
}

function references(
  values: readonly HistoryExactIndexReference[],
): { segmentId: string; fileKind: HistoryExactIndexReference['fileKind']; ledgerIndex: number }[] {
  return values.map((reference) => ({
    segmentId: reference.segmentId,
    fileKind: reference.fileKind,
    ledgerIndex: reference.ledgerIndex,
  }))
}

function referencedTransactionHashes(values: readonly HistoryExactIndexReference[]): Set<string> {
  return new Set(values.map((reference) => reference.searchResult?.transactionHash).filter((value): value is string => Boolean(value)))
}

export async function getHybridTransactionDetail(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  exactIndex: HistoryExactIndexReader
  transactionHash: string
}): Promise<HybridTransactionDetail> {
  const transactionHash = normalizeHistoryExactTerm(options.transactionHash)
  const [eventLookup, changeLookup, live] = await Promise.all([
    options.exactIndex.find(transactionHash, { limit: 1, referenceKinds: ['transaction_event'] }),
    options.exactIndex.find(transactionHash, { limit: 100, referenceKinds: ['object_change'] }),
    getLiveTransactionDetailAfterBoundary({
      db: options.db,
      boundaryLedgerIndex: options.reader.publication.endLedgerIndex,
      transactionHash,
    }),
  ])

  const immutableEvent = eventLookup.references.length === 0 ? null : await options.reader.readReferenced<SegmentProtocolEventRecord>({
    references: references(eventLookup.references),
    predicate: (event) => normalizeHistoryExactTerm(event.eventHash) === transactionHash,
    limit: 1,
  })
  const immutableChanges = changeLookup.references.length === 0 ? [] : (await options.reader.readReferenced<NormalizedObjectChange>({
    references: references(changeLookup.references),
    predicate: (change) => normalizeHistoryExactTerm(change.transactionHash) === transactionHash,
    limit: 100,
  })).items.map(segmentObjectChangeToApi)

  const immutableEventValue = immutableEvent?.items[0]
    ? segmentProtocolEventToApi(immutableEvent.items[0], options.reader.publication.epochId)
    : null
  const event = [immutableEventValue, live.event]
    .filter((value): value is ProtocolEventRecord => value !== null)
    .sort((left, right) => right.ledgerIndex - left.ledgerIndex || right.eventIndex - left.eventIndex)[0] ?? null
  const changes = mergeObjectHistory({
    immutable: immutableChanges,
    live: live.changes,
    boundaryLedgerIndex: options.reader.publication.endLedgerIndex,
    limit: 100,
  }).items

  return { transactionHash, event, changes }
}

export async function listHybridExactObjectHistory(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  exactIndex: HistoryExactIndexReader
  objectType: string
  objectId: string
  page: HistoryPageOptions
}): Promise<ObjectChangeRecord[]> {
  const lookup = await options.exactIndex.find(options.objectId, {
    limit: options.page.limit,
    referenceKinds: ['object_change'],
    referencePredicate: (reference) =>
      reference.searchResult?.objectType === options.objectType
      && reference.searchResult.objectId === options.objectId,
    direction: 'desc',
  })
  const transactionHashes = referencedTransactionHashes(lookup.references)
  const immutable = lookup.references.length === 0 ? [] : (await options.reader.readReferenced<NormalizedObjectChange>({
    references: references(lookup.references),
    predicate: (change) =>
      change.objectType === options.objectType
      && change.objectId === options.objectId
      && transactionHashes.has(change.transactionHash),
    limit: EXACT_DETAIL_MAX_RECORDS,
    maxAssetReads: EXACT_DETAIL_MAX_ASSET_READS,
  })).items.map(segmentObjectChangeToApi)
  const live = await listLiveObjectHistoryAfterBoundary(
    options.db,
    options.objectType,
    options.objectId,
    options.reader.publication.endLedgerIndex,
    options.page,
  )
  return mergeObjectHistory({
    immutable,
    live,
    boundaryLedgerIndex: options.reader.publication.endLedgerIndex,
    limit: options.page.limit,
  }).items
}

export async function listHybridExactLoanLifecycle(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  exactIndex: HistoryExactIndexReader
  loanId: string
  page: HistoryPageOptions
}): Promise<LoanLifecycleRecord[]> {
  const lookup = await options.exactIndex.find(options.loanId, {
    limit: options.page.limit,
    referenceKinds: ['loan_lifecycle'],
    referencePredicate: (reference) => reference.searchResult?.loanId === options.loanId,
    direction: 'asc',
  })
  const transactionHashes = referencedTransactionHashes(lookup.references)
  const immutable = lookup.references.length === 0 ? [] : (await options.reader.readReferenced<SegmentLoanLifecycleEvent>({
    references: references(lookup.references),
    predicate: (event) => event.loanId === options.loanId && transactionHashes.has(event.transactionHash),
    limit: EXACT_DETAIL_MAX_RECORDS,
    maxAssetReads: EXACT_DETAIL_MAX_ASSET_READS,
  })).items.map(segmentLoanLifecycleToApi)
  const live = await listLiveLoanLifecycleAfterBoundary(
    options.db,
    options.loanId,
    options.reader.publication.endLedgerIndex,
    options.page,
  )
  return mergeLoanLifecycleDetail({
    immutable,
    live,
    boundaryLedgerIndex: options.reader.publication.endLedgerIndex,
    limit: options.page.limit,
  }).items
}

function compareSearch(left: SearchResultRecord, right: SearchResultRecord): number {
  return (right.ledgerIndex ?? -1) - (left.ledgerIndex ?? -1)
    || left.kind.localeCompare(right.kind)
    || (left.transactionHash ?? '').localeCompare(right.transactionHash ?? '')
    || (left.objectId ?? '').localeCompare(right.objectId ?? '')
    || (left.loanId ?? '').localeCompare(right.loanId ?? '')
}

export async function searchHybridHistory(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  exactIndex: HistoryExactIndexReader
  query: string
  limit: number
}): Promise<SearchResultRecord[]> {
  const query = normalizeHistoryExactTerm(options.query)
  const [immutableLookup, live] = await Promise.all([
    options.exactIndex.find(query, {
      limit: options.limit,
      referenceKinds: ['transaction_event', 'object_change', 'archived_object', 'loan_lifecycle'],
    }),
    searchLiveHistoryAfterBoundary({
      db: options.db,
      boundaryLedgerIndex: options.reader.publication.endLedgerIndex,
      query,
      limit: options.limit,
    }),
  ])
  const immutable: SearchResultRecord[] = immutableLookup.references.map((reference) => {
    const result = reference.searchResult
    if (result === null) throw new Error('Searchable exact reference is missing result metadata')
    return {
      kind: result.kind,
      epochId: result.epochId,
      ledgerIndex: result.ledgerIndex,
      transactionHash: result.transactionHash,
      objectType: result.objectType,
      objectId: result.objectId,
      loanId: result.loanId,
    }
  })
  return [...live, ...immutable].sort(compareSearch).slice(0, options.limit)
}
