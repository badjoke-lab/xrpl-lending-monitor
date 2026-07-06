import { mergeHistorySources, type HistorySourceMergeResult } from '../../shared/history-segments/merge-sources'
import type {
  ArchivedObjectRecord,
  BalanceHistoryApiRecord,
  LoanLifecycleRecord,
  ObjectChangeRecord,
  ProtocolEventRecord,
} from './history-api-repository'

function textCompare(left: string, right: string): number {
  return left.localeCompare(right)
}

export function mergeActivityHistory(options: {
  immutable: readonly ProtocolEventRecord[]
  live: readonly ProtocolEventRecord[]
  boundaryLedgerIndex: number
  limit: number
}): HistorySourceMergeResult<ProtocolEventRecord> {
  return mergeHistorySources({
    ...options,
    ledgerIndex: (event) => event.ledgerIndex,
    identity: (event) => event.eventHash,
    compare: (left, right) =>
      right.ledgerIndex - left.ledgerIndex
      || right.eventIndex - left.eventIndex
      || textCompare(left.eventHash, right.eventHash),
  })
}

export function mergeObjectHistory(options: {
  immutable: readonly ObjectChangeRecord[]
  live: readonly ObjectChangeRecord[]
  boundaryLedgerIndex: number
  limit: number
}): HistorySourceMergeResult<ObjectChangeRecord> {
  return mergeHistorySources({
    ...options,
    ledgerIndex: (change) => change.ledgerIndex,
    identity: (change) => [
      change.transactionHash,
      change.nodeIndex,
      change.objectType,
      change.objectId,
      change.fieldName,
    ].join(':'),
    compare: (left, right) =>
      right.ledgerIndex - left.ledgerIndex
      || right.transactionIndex - left.transactionIndex
      || left.nodeIndex - right.nodeIndex
      || textCompare(left.fieldName, right.fieldName)
      || textCompare(left.objectId, right.objectId),
  })
}

export function mergeLoanLifecycleDetail(options: {
  immutable: readonly LoanLifecycleRecord[]
  live: readonly LoanLifecycleRecord[]
  boundaryLedgerIndex: number
  limit: number
}): HistorySourceMergeResult<LoanLifecycleRecord> {
  return mergeHistorySources({
    ...options,
    ledgerIndex: (event) => event.ledgerIndex,
    identity: lifecycleIdentity,
    compare: (left, right) =>
      left.ledgerIndex - right.ledgerIndex
      || left.transactionIndex - right.transactionIndex
      || textCompare(left.loanId, right.loanId)
      || textCompare(left.eventType, right.eventType)
      || textCompare(left.transactionHash, right.transactionHash),
  })
}

export function mergeLoanLifecycleExplorer(options: {
  immutable: readonly LoanLifecycleRecord[]
  live: readonly LoanLifecycleRecord[]
  boundaryLedgerIndex: number
  limit: number
}): HistorySourceMergeResult<LoanLifecycleRecord> {
  return mergeHistorySources({
    ...options,
    ledgerIndex: (event) => event.ledgerIndex,
    identity: lifecycleIdentity,
    compare: (left, right) =>
      right.ledgerIndex - left.ledgerIndex
      || right.transactionIndex - left.transactionIndex
      || textCompare(left.loanId, right.loanId)
      || textCompare(left.eventType, right.eventType)
      || textCompare(left.transactionHash, right.transactionHash),
  })
}

function lifecycleIdentity(event: LoanLifecycleRecord): string {
  return [
    event.epochId,
    event.loanId,
    event.transactionHash,
    event.transactionIndex,
    event.eventType,
  ].join(':')
}

export function mergeArchivedObjects(options: {
  immutable: readonly ArchivedObjectRecord[]
  live: readonly ArchivedObjectRecord[]
  boundaryLedgerIndex: number
  limit: number
}): HistorySourceMergeResult<ArchivedObjectRecord> {
  return mergeHistorySources({
    ...options,
    ledgerIndex: (archive) => archive.deletionLedgerIndex,
    identity: (archive) => [
      archive.epochId,
      archive.objectType,
      archive.objectId,
      archive.deletionTransactionHash,
    ].join(':'),
    compare: (left, right) =>
      right.deletionLedgerIndex - left.deletionLedgerIndex
      || right.deletionTransactionIndex - left.deletionTransactionIndex
      || textCompare(left.objectType, right.objectType)
      || textCompare(left.objectId, right.objectId),
  })
}

export function mergeBalanceHistory(options: {
  immutable: readonly BalanceHistoryApiRecord[]
  live: readonly BalanceHistoryApiRecord[]
  boundaryLedgerIndex: number
  limit: number
}): HistorySourceMergeResult<BalanceHistoryApiRecord> {
  return mergeHistorySources({
    ...options,
    ledgerIndex: (record) => record.ledgerIndex,
    identity: (record) => [
      record.epochId,
      record.subjectType,
      record.subjectId,
      record.transactionHash,
      record.transactionIndex,
      record.metricType,
      record.assetKey ?? '',
    ].join(':'),
    compare: (left, right) =>
      right.ledgerIndex - left.ledgerIndex
      || right.transactionIndex - left.transactionIndex
      || textCompare(left.subjectId, right.subjectId)
      || textCompare(left.metricType, right.metricType)
      || textCompare(left.assetKey ?? '', right.assetKey ?? ''),
  })
}
