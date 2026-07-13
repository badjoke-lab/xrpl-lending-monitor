import type { SearchResultRecord } from './history-api-repository'
import { readFastLaneHistoryBundlesAfterBoundary } from './fast-lane-history-window'
import { searchLiveHistoryAfterBoundary as searchD1History } from './live-search-d1-after-boundary'

function sameTerm(value: string | null, query: string): boolean {
  return value !== null && (value === query || value.toUpperCase() === query.toUpperCase())
}

function compareSearch(left: SearchResultRecord, right: SearchResultRecord): number {
  return (right.ledgerIndex ?? -1) - (left.ledgerIndex ?? -1)
    || left.kind.localeCompare(right.kind)
    || (left.transactionHash ?? '').localeCompare(right.transactionHash ?? '')
    || (left.objectId ?? '').localeCompare(right.objectId ?? '')
    || (left.loanId ?? '').localeCompare(right.loanId ?? '')
}

function resultKey(item: SearchResultRecord): string {
  return [
    item.kind,
    item.epochId,
    item.ledgerIndex ?? '',
    item.transactionHash ?? '',
    item.objectType ?? '',
    item.objectId ?? '',
    item.loanId ?? '',
  ].join(':')
}

export async function searchLiveHistoryAfterBoundary(options: {
  db: D1Database
  boundaryLedgerIndex: number
  query: string
  limit: number
}): Promise<SearchResultRecord[]> {
  const [stored, bundles] = await Promise.all([
    searchD1History(options),
    readFastLaneHistoryBundlesAfterBoundary({
      db: options.db,
      boundaryLedgerIndex: options.boundaryLedgerIndex,
    }),
  ])
  const compact: SearchResultRecord[] = []

  for (const bundle of bundles) {
    for (const event of bundle.protocolEvents) {
      if (event.ledgerIndex <= options.boundaryLedgerIndex || !sameTerm(event.eventHash, options.query)) continue
      compact.push({
        kind: 'transaction',
        epochId: event.epochId,
        ledgerIndex: event.ledgerIndex,
        transactionHash: event.eventHash,
        objectType: null,
        objectId: null,
        loanId: null,
      })
    }

    for (const change of bundle.objectChanges) {
      if (change.ledgerIndex <= options.boundaryLedgerIndex) continue
      const match = [
        change.transactionHash,
        change.objectId,
        change.vaultId,
        change.loanBrokerId,
        change.loanId,
        change.account,
        change.owner,
        change.borrower,
        change.assetKey,
        change.mptIssuanceId,
      ].some((value) => sameTerm(value, options.query))
      if (!match) continue
      compact.push({
        kind: 'object_change',
        epochId: change.epochId,
        ledgerIndex: change.ledgerIndex,
        transactionHash: change.transactionHash,
        objectType: change.objectType,
        objectId: change.objectId,
        loanId: change.loanId,
      })
    }

    for (const archive of bundle.archivedObjects) {
      if (archive.deletionLedgerIndex <= options.boundaryLedgerIndex) continue
      const match = [
        archive.deletionTransactionHash,
        archive.objectId,
        archive.vaultId,
        archive.loanBrokerId,
        archive.loanId,
        archive.owner,
        archive.account,
        archive.borrower,
        archive.assetKey,
      ].some((value) => sameTerm(value, options.query))
      if (!match) continue
      compact.push({
        kind: 'archived_object',
        epochId: archive.epochId,
        ledgerIndex: archive.deletionLedgerIndex,
        transactionHash: archive.deletionTransactionHash,
        objectType: archive.objectType,
        objectId: archive.objectId,
        loanId: archive.loanId,
      })
    }

    for (const lifecycle of bundle.loanLifecycle) {
      if (
        lifecycle.ledgerIndex <= options.boundaryLedgerIndex
        || (!sameTerm(lifecycle.transactionHash, options.query) && !sameTerm(lifecycle.loanId, options.query))
      ) continue
      compact.push({
        kind: 'loan_lifecycle',
        epochId: lifecycle.epochId,
        ledgerIndex: lifecycle.ledgerIndex,
        transactionHash: lifecycle.transactionHash,
        objectType: 'Loan',
        objectId: lifecycle.loanId,
        loanId: lifecycle.loanId,
      })
    }
  }

  const seen = new Set<string>()
  return [...stored, ...compact]
    .sort(compareSearch)
    .filter((item) => {
      const key = resultKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, options.limit)
}
