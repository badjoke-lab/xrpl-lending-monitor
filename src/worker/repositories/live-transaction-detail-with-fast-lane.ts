import type { ObjectChangeRecord, ProtocolEventRecord } from './history-api-repository'
import { readFastLaneHistoryBundlesAfterBoundary } from './fast-lane-history-window'
import { getLiveTransactionDetailAfterBoundary as getD1TransactionDetail } from './live-transaction-detail-d1-after-boundary'

function sameTerm(left: string, right: string): boolean {
  return left === right || left.toUpperCase() === right.toUpperCase()
}

function changeKey(item: ObjectChangeRecord): string {
  return [item.transactionHash, item.nodeIndex, item.objectId, item.fieldName, item.action].join(':')
}

export async function getLiveTransactionDetailAfterBoundary(options: {
  db: D1Database
  boundaryLedgerIndex: number
  transactionHash: string
}): Promise<{ event: ProtocolEventRecord | null; changes: ObjectChangeRecord[] }> {
  const [stored, bundles] = await Promise.all([
    getD1TransactionDetail(options),
    readFastLaneHistoryBundlesAfterBoundary({
      db: options.db,
      boundaryLedgerIndex: options.boundaryLedgerIndex,
    }),
  ])

  const compactEvents = bundles
    .flatMap((bundle) => bundle.protocolEvents)
    .filter((item) => item.ledgerIndex > options.boundaryLedgerIndex)
    .filter((item) => sameTerm(item.eventHash, options.transactionHash))
  const event = [stored.event, ...compactEvents]
    .filter((item): item is ProtocolEventRecord => item !== null)
    .sort((left, right) => right.ledgerIndex - left.ledgerIndex || right.eventIndex - left.eventIndex)[0] ?? null

  const seen = new Set<string>()
  const compactChanges = bundles
    .flatMap((bundle) => bundle.objectChanges)
    .filter((item) => item.ledgerIndex > options.boundaryLedgerIndex)
    .filter((item) => sameTerm(item.transactionHash, options.transactionHash))
  const changes = [...stored.changes, ...compactChanges]
    .sort((left, right) => right.ledgerIndex - left.ledgerIndex
      || right.transactionIndex - left.transactionIndex
      || left.nodeIndex - right.nodeIndex
      || left.fieldName.localeCompare(right.fieldName))
    .filter((item) => {
      const key = changeKey(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 100)

  return { event, changes }
}
