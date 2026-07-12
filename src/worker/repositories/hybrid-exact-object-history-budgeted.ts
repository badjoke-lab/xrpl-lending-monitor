import type { NormalizedObjectChange } from '../../collector/incremental/affected-nodes'
import type { HistoryExactIndexReference } from '../../shared/history-segments/exact-index'
import type { HistoryExactIndexReader } from '../../shared/history-segments/exact-index-reader'
import type { HistorySegmentChainReader } from '../../shared/history-segments/reader'
import type { HistoryPageOptions, ObjectChangeRecord } from './history-api-repository'
import { segmentObjectChangeToApi } from './history-segment-adapter'
import { listLiveObjectHistoryAfterBoundary } from './live-history-after-boundary'
import { mergeObjectHistory } from './merged-history-source'

const MAX_ASSET_READS = 16
const MAX_RECORDS_EXAMINED = 9_500

function boundedReferences(
  reader: HistorySegmentChainReader,
  values: readonly HistoryExactIndexReference[],
): HistoryExactIndexReference[] {
  const segments = new Map(reader.publication.segments.map((segment) => [segment.segmentId, segment]))
  const acceptedAssets = new Set<string>()
  const rejectedAssets = new Set<string>()
  const selected: HistoryExactIndexReference[] = []
  let estimatedRecords = 0

  for (const reference of values) {
    const assetKey = `${reference.segmentId}:${reference.fileKind}`
    if (acceptedAssets.has(assetKey)) {
      selected.push(reference)
      continue
    }
    if (rejectedAssets.has(assetKey)) continue
    if (acceptedAssets.size >= MAX_ASSET_READS) {
      rejectedAssets.add(assetKey)
      continue
    }

    const segment = segments.get(reference.segmentId)
    if (!segment) throw new Error(`History reference segment is not published: ${reference.segmentId}`)
    const recordCount = segment.recordCounts[reference.fileKind]
    if (recordCount > MAX_RECORDS_EXAMINED || estimatedRecords + recordCount > MAX_RECORDS_EXAMINED) {
      rejectedAssets.add(assetKey)
      continue
    }

    acceptedAssets.add(assetKey)
    estimatedRecords += recordCount
    selected.push(reference)
  }

  return selected
}

export async function listBudgetedHybridExactObjectHistory(options: {
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
  const bounded = boundedReferences(options.reader, lookup.references)
  const transactionHashes = new Set(
    bounded
      .map((reference) => reference.searchResult?.transactionHash)
      .filter((value): value is string => Boolean(value)),
  )
  const immutable = bounded.length === 0 ? [] : (await options.reader.readReferenced<NormalizedObjectChange>({
    references: bounded.map((reference) => ({
      segmentId: reference.segmentId,
      fileKind: reference.fileKind,
      ledgerIndex: reference.ledgerIndex,
    })),
    predicate: (change) =>
      change.objectType === options.objectType
      && change.objectId === options.objectId
      && transactionHashes.has(change.transactionHash),
    limit: 100,
    direction: 'desc',
    maxAssetReads: MAX_ASSET_READS,
    maxRecordsExamined: MAX_RECORDS_EXAMINED,
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
