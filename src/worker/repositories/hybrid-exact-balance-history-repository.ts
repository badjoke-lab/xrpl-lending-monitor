import type { BalanceHistoryRecord as SegmentBalanceHistoryRecord } from '../../collector/incremental/cover-debt-loss'
import type { HistoryExactIndexReference } from '../../shared/history-segments/exact-index'
import type { HistoryExactIndexReader } from '../../shared/history-segments/exact-index-reader'
import type { HistorySegmentChainReader } from '../../shared/history-segments/reader'
import type {
  BalanceHistoryApiRecord,
  BalanceHistoryListOptions,
} from './history-api-repository'
import { segmentBalanceHistoryToApi } from './history-segment-adapter'
import { listLiveBalanceHistoryAfterBoundary } from './live-history-after-boundary'
import { mergeBalanceHistory } from './merged-history-source'

const EXACT_BALANCE_MAX_ASSET_READS = 16
const EXACT_BALANCE_MAX_REFERENCES = 100
const EXACT_BALANCE_MAX_RECORDS = 100

function references(
  values: readonly HistoryExactIndexReference[],
): { segmentId: string; fileKind: HistoryExactIndexReference['fileKind']; ledgerIndex: number }[] {
  return values.map((reference) => ({
    segmentId: reference.segmentId,
    fileKind: reference.fileKind,
    ledgerIndex: reference.ledgerIndex,
  }))
}

function boundedAssetReferences(
  values: readonly HistoryExactIndexReference[],
  maxAssetReads = EXACT_BALANCE_MAX_ASSET_READS,
): HistoryExactIndexReference[] {
  const selectedAssets = new Set<string>()
  const selected: HistoryExactIndexReference[] = []
  for (const reference of values) {
    const assetKey = `${reference.segmentId}:${reference.fileKind}`
    if (!selectedAssets.has(assetKey)) {
      if (selectedAssets.size >= maxAssetReads) continue
      selectedAssets.add(assetKey)
    }
    selected.push(reference)
  }
  return selected
}

function balanceMatches(
  record: SegmentBalanceHistoryRecord,
  options: BalanceHistoryListOptions,
): boolean {
  return record.subjectId === options.subjectId
    && (!options.metricType || record.metricType === options.metricType)
    && (!options.subjectType || record.subjectType === options.subjectType)
    && (!options.assetKey || record.assetKey === options.assetKey)
}

export async function listHybridExactBalanceHistory(options: {
  db: D1Database
  reader: HistorySegmentChainReader
  exactIndex: HistoryExactIndexReader
  list: BalanceHistoryListOptions & { subjectId: string }
}): Promise<BalanceHistoryApiRecord[]> {
  const lookup = await options.exactIndex.find(options.list.subjectId, {
    limit: EXACT_BALANCE_MAX_REFERENCES,
    referenceKinds: ['balance_history'],
    direction: 'desc',
  })
  const bounded = boundedAssetReferences(lookup.references)
  const immutable = bounded.length === 0 ? [] : (
    await options.reader.readReferenced<SegmentBalanceHistoryRecord>({
      references: references(bounded),
      predicate: (record) => balanceMatches(record, options.list),
      limit: Math.min(options.list.limit, EXACT_BALANCE_MAX_RECORDS),
      direction: 'desc',
      maxAssetReads: EXACT_BALANCE_MAX_ASSET_READS,
    })
  ).items.map(segmentBalanceHistoryToApi)
  const live = await listLiveBalanceHistoryAfterBoundary(
    options.db,
    options.reader.publication.endLedgerIndex,
    options.list,
  )
  return mergeBalanceHistory({
    immutable,
    live,
    boundaryLedgerIndex: options.reader.publication.endLedgerIndex,
    limit: options.list.limit,
  }).items
}
