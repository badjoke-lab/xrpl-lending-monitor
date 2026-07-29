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
import { decodeFastLaneHistoryPayload } from './fast-lane-history-codec'
import {
  readFastLaneHistoryBundlesAfterBoundary,
  type FastLaneHistoryBundle,
} from './fast-lane-history-window'
import {
  listLiveActivityAfterBoundary as listD1Activity,
  listLiveArchivedObjectsAfterBoundary as listD1ArchivedObjects,
  listLiveBalanceHistoryAfterBoundary as listD1BalanceHistory,
  listLiveLoanLifecycleAfterBoundary as listD1LoanLifecycle,
  listLiveLoanLifecycleEventsAfterBoundary as listD1LoanLifecycleEvents,
  listLiveObjectHistoryAfterBoundary as listD1ObjectHistory,
} from './live-history-d1-after-boundary'

interface FastLaneLookupWindowRow {
  bundle_json: string
}

function dedupe<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const value = key(item)
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

function newestEvent(left: ProtocolEventRecord, right: ProtocolEventRecord): number {
  return right.ledgerIndex - left.ledgerIndex || right.eventIndex - left.eventIndex
}

function newestChange(left: ObjectChangeRecord, right: ObjectChangeRecord): number {
  return right.ledgerIndex - left.ledgerIndex
    || right.transactionIndex - left.transactionIndex
    || left.nodeIndex - right.nodeIndex
    || left.fieldName.localeCompare(right.fieldName)
}

function objectChangeKey(item: ObjectChangeRecord): string {
  return [item.transactionHash, item.nodeIndex, item.objectId, item.fieldName, item.action].join(':')
}

function newestLifecycle(left: LoanLifecycleRecord, right: LoanLifecycleRecord): number {
  return right.ledgerIndex - left.ledgerIndex || right.transactionIndex - left.transactionIndex
}

function oldestLifecycle(left: LoanLifecycleRecord, right: LoanLifecycleRecord): number {
  return left.ledgerIndex - right.ledgerIndex || left.transactionIndex - right.transactionIndex
}

function newestArchive(left: ArchivedObjectRecord, right: ArchivedObjectRecord): number {
  return right.deletionLedgerIndex - left.deletionLedgerIndex
    || right.deletionTransactionIndex - left.deletionTransactionIndex
}

function newestBalance(left: BalanceHistoryApiRecord, right: BalanceHistoryApiRecord): number {
  return right.ledgerIndex - left.ledgerIndex
    || right.transactionIndex - left.transactionIndex
    || left.subjectId.localeCompare(right.subjectId)
    || left.metricType.localeCompare(right.metricType)
}

function archiveMatches(item: ArchivedObjectRecord, options: ArchivedObjectListOptions): boolean {
  if (options.objectType && item.objectType !== options.objectType) return false
  if (!options.query) return true
  return [
    item.objectId,
    item.deletionTransactionHash,
    item.vaultId,
    item.loanBrokerId,
    item.loanId,
    item.owner,
    item.account,
    item.borrower,
    item.assetKey,
  ].some((value) => value === options.query)
}

function balanceMatches(item: BalanceHistoryApiRecord, options: BalanceHistoryListOptions): boolean {
  return (!options.metricType || item.metricType === options.metricType)
    && (!options.subjectType || item.subjectType === options.subjectType)
    && (!options.subjectId || item.subjectId === options.subjectId)
    && (!options.assetKey || item.assetKey === options.assetKey)
}

async function readFastLaneLookupBundles(options: {
  db: D1Database
  boundaryLedgerIndex: number
  needle: string
  maxWindows: number
}): Promise<FastLaneHistoryBundle[]> {
  const result = await options.db.prepare(
    `SELECT history.bundle_json
     FROM fast_lane_shadow_windows AS lookup
     JOIN fast_lane_history_windows AS history
       ON history.network = lookup.network
      AND history.start_ledger_index = lookup.start_ledger_index
      AND history.end_ledger_index = lookup.end_ledger_index
     WHERE lookup.network = 'devnet'
       AND lookup.epoch_id = 'fast-lane-shadow-devnet'
       AND history.epoch_id = (
         SELECT base_epoch_id
         FROM fast_lane_shadow_base_binding
         WHERE network = 'devnet'
       )
       AND history.end_ledger_index > ?1
       AND instr(lookup.object_lookup_json, ?2) > 0
     ORDER BY history.end_ledger_index DESC
     LIMIT ?3`,
  ).bind(
    options.boundaryLedgerIndex,
    options.needle,
    Math.min(options.maxWindows, 256),
  ).all<FastLaneLookupWindowRow>()

  return Promise.all(
    (result.results ?? []).map(async (row) => (
      await decodeFastLaneHistoryPayload(
        row.bundle_json,
      ) as FastLaneHistoryBundle
    )),
  )
}

async function readFastLaneObjectHistory(options: {
  db: D1Database
  objectType: string
  objectId: string
  boundaryLedgerIndex: number
  limit: number
}): Promise<ObjectChangeRecord[]> {
  const needle = JSON.stringify({
    objectType: options.objectType,
    objectId: options.objectId,
  }).slice(1, -1)

  const bundles = await readFastLaneLookupBundles({
    db: options.db,
    boundaryLedgerIndex: options.boundaryLedgerIndex,
    needle,
    maxWindows: options.limit,
  })

  return dedupe(
    bundles.flatMap((bundle) => bundle.objectChanges)
      .filter((item) => (
        item.ledgerIndex > options.boundaryLedgerIndex
        && item.objectType === options.objectType
        && item.objectId === options.objectId
      ))
      .sort(newestChange),
    objectChangeKey,
  ).slice(0, options.limit)
}

export async function listLiveActivityAfterBoundary(
  db: D1Database,
  boundaryLedgerIndex: number,
  options: HistoryPageOptions,
): Promise<ProtocolEventRecord[]> {
  const [stored, bundles] = await Promise.all([
    listD1Activity(db, boundaryLedgerIndex, options),
    readFastLaneHistoryBundlesAfterBoundary({ db, boundaryLedgerIndex }),
  ])
  const compact = bundles.flatMap((bundle) => bundle.protocolEvents)
    .filter((item) => item.ledgerIndex > boundaryLedgerIndex)
  return dedupe([...stored, ...compact].sort(newestEvent), (item) => item.eventHash)
    .slice(0, options.limit)
}

export async function listLiveObjectHistoryAfterBoundary(
  db: D1Database,
  objectType: string,
  objectId: string,
  boundaryLedgerIndex: number,
  options: HistoryPageOptions,
): Promise<ObjectChangeRecord[]> {
  const compact = await readFastLaneObjectHistory({
    db,
    objectType,
    objectId,
    boundaryLedgerIndex,
    limit: options.limit,
  })
  if (compact.length >= options.limit) return compact

  const stored = await listD1ObjectHistory(db, objectType, objectId, boundaryLedgerIndex, options)
  return dedupe(
    [...stored, ...compact].sort(newestChange),
    objectChangeKey,
  ).slice(0, options.limit)
}

export async function listLiveLoanLifecycleAfterBoundary(
  db: D1Database,
  loanId: string,
  boundaryLedgerIndex: number,
  options: HistoryPageOptions,
): Promise<LoanLifecycleRecord[]> {
  const [stored, bundles] = await Promise.all([
    listD1LoanLifecycle(db, loanId, boundaryLedgerIndex, options),
    readFastLaneLookupBundles({
      db,
      boundaryLedgerIndex,
      needle: JSON.stringify(loanId),
      maxWindows: 256,
    }),
  ])
  const compact = bundles.flatMap((bundle) => bundle.loanLifecycle)
    .filter((item) => (
      item.ledgerIndex > boundaryLedgerIndex
      && item.loanId === loanId
    ))
  return dedupe(
    [...stored, ...compact].sort(oldestLifecycle),
    (item) => [
      item.loanId,
      item.transactionHash,
      item.eventType,
    ].join(':'),
  ).slice(0, options.limit)
}

export async function listLiveLoanLifecycleEventsAfterBoundary(
  db: D1Database,
  boundaryLedgerIndex: number,
  options: LoanLifecycleListOptions,
): Promise<LoanLifecycleRecord[]> {
  const bundleRead = options.loanId
    ? readFastLaneLookupBundles({
        db,
        boundaryLedgerIndex,
        needle: JSON.stringify(options.loanId),
        maxWindows: 256,
      })
    : readFastLaneHistoryBundlesAfterBoundary({
        db,
        boundaryLedgerIndex,
      })

  const [stored, bundles] = await Promise.all([
    listD1LoanLifecycleEvents(db, boundaryLedgerIndex, options),
    bundleRead,
  ])
  const compact = bundles.flatMap((bundle) => bundle.loanLifecycle)
    .filter((item) => item.ledgerIndex > boundaryLedgerIndex)
    .filter((item) => (
      !options.eventType
      || item.eventType === options.eventType
    ))
    .filter((item) => (
      !options.loanId
      || item.loanId === options.loanId
    ))
  return dedupe(
    [...stored, ...compact].sort(newestLifecycle),
    (item) => [
      item.loanId,
      item.transactionHash,
      item.eventType,
    ].join(':'),
  ).slice(0, options.limit)
}

export async function listLiveArchivedObjectsAfterBoundary(
  db: D1Database,
  boundaryLedgerIndex: number,
  options: ArchivedObjectListOptions,
): Promise<ArchivedObjectRecord[]> {
  const bundleRead = options.query
    ? readFastLaneLookupBundles({
        db,
        boundaryLedgerIndex,
        needle: JSON.stringify(options.query),
        maxWindows: 256,
      })
    : readFastLaneHistoryBundlesAfterBoundary({
        db,
        boundaryLedgerIndex,
      })

  const [stored, bundles] = await Promise.all([
    listD1ArchivedObjects(db, boundaryLedgerIndex, options),
    bundleRead,
  ])
  const compact = bundles.flatMap((bundle) => bundle.archivedObjects)
    .filter((item) => (
      item.deletionLedgerIndex > boundaryLedgerIndex
      && archiveMatches(item, options)
    ))
  return dedupe(
    [...stored, ...compact].sort(newestArchive),
    (item) => `${item.objectType}:${item.objectId}`,
  ).slice(0, options.limit)
}

export async function listLiveBalanceHistoryAfterBoundary(
  db: D1Database,
  boundaryLedgerIndex: number,
  options: BalanceHistoryListOptions,
): Promise<BalanceHistoryApiRecord[]> {
  const lookupValue = options.subjectId ?? options.assetKey
  const bundleRead = lookupValue
    ? readFastLaneLookupBundles({
        db,
        boundaryLedgerIndex,
        needle: JSON.stringify(lookupValue),
        maxWindows: 256,
      })
    : readFastLaneHistoryBundlesAfterBoundary({
        db,
        boundaryLedgerIndex,
      })

  const [stored, bundles] = await Promise.all([
    listD1BalanceHistory(db, boundaryLedgerIndex, options),
    bundleRead,
  ])
  const compact = bundles.flatMap((bundle) => bundle.balanceHistory)
    .filter((item) => (
      item.ledgerIndex > boundaryLedgerIndex
      && balanceMatches(item, options)
    ))
  return dedupe(
    [...stored, ...compact].sort(newestBalance),
    (item) => [
      item.subjectType,
      item.subjectId,
      item.transactionHash,
      item.metricType,
    ].join(':'),
  ).slice(0, options.limit)
}
