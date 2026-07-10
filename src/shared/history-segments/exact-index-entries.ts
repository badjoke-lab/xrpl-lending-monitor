import {
  normalizeHistoryExactTerm,
  type HistoryExactIndexReference,
  type HistoryExactReferenceKind,
  type HistoryExactSearchResultMetadata,
} from './exact-index'
import type { HistorySegmentFileKind } from './manifest'

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function ledgerIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('Indexed history record ledger index is invalid')
  return Number(value)
}

function optionalTerm(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? normalizeHistoryExactTerm(value) : null
}

function terms(values: readonly unknown[]): string[] {
  return [...new Set(values.map(optionalTerm).filter((term): term is string => term !== null))]
}

function reference(options: {
  kind: HistoryExactReferenceKind
  segmentId: string
  fileKind: HistorySegmentFileKind
  ledgerIndex: number
  searchResult: HistoryExactSearchResultMetadata | null
}): HistoryExactIndexReference {
  return options
}

export function extractHistoryExactEntries(options: {
  epochId: string
  segmentId: string
  fileKind: HistorySegmentFileKind
  value: unknown
}): { terms: string[]; reference: HistoryExactIndexReference } | null {
  const source = record(options.value, `${options.fileKind} record`)
  if (options.fileKind === 'protocol_events') {
    const transactionHash = stringValue(source.eventHash, 'protocol event hash')
    const index = ledgerIndex(source.ledgerIndex)
    return {
      terms: terms([transactionHash]),
      reference: reference({
        kind: 'transaction_event', segmentId: options.segmentId, fileKind: options.fileKind, ledgerIndex: index,
        searchResult: { kind: 'transaction', epochId: options.epochId, ledgerIndex: index, transactionHash, objectType: null, objectId: null, loanId: null },
      }),
    }
  }
  if (options.fileKind === 'object_changes') {
    const relationships = record(source.relationships, 'object change relationships')
    const transactionHash = stringValue(source.transactionHash, 'object change transaction hash')
    const objectType = stringValue(source.objectType, 'object change object type')
    const objectId = stringValue(source.objectId, 'object change object id')
    const loanId = optionalString(relationships.loanId)
    const index = ledgerIndex(source.ledgerIndex)
    return {
      terms: terms([transactionHash, objectId, relationships.vaultId, relationships.loanBrokerId, relationships.loanId, relationships.account, relationships.owner, relationships.borrower, relationships.assetKey, relationships.mptIssuanceId]),
      reference: reference({
        kind: 'object_change', segmentId: options.segmentId, fileKind: options.fileKind, ledgerIndex: index,
        searchResult: { kind: 'object_change', epochId: options.epochId, ledgerIndex: index, transactionHash, objectType, objectId, loanId },
      }),
    }
  }
  if (options.fileKind === 'archived_objects') {
    const transactionHash = stringValue(source.deletionTransactionHash, 'archive transaction hash')
    const objectType = stringValue(source.objectType, 'archive object type')
    const objectId = stringValue(source.objectId, 'archive object id')
    const loanId = optionalString(source.loanId)
    const index = ledgerIndex(source.deletionLedgerIndex)
    return {
      terms: terms([transactionHash, objectId, source.vaultId, source.loanBrokerId, source.loanId, source.owner, source.account, source.borrower, source.assetKey]),
      reference: reference({
        kind: 'archived_object', segmentId: options.segmentId, fileKind: options.fileKind, ledgerIndex: index,
        searchResult: { kind: 'archived_object', epochId: options.epochId, ledgerIndex: index, transactionHash, objectType, objectId, loanId },
      }),
    }
  }
  if (options.fileKind === 'loan_lifecycle') {
    const transactionHash = stringValue(source.transactionHash, 'lifecycle transaction hash')
    const loanId = stringValue(source.loanId, 'lifecycle loan id')
    const index = ledgerIndex(source.ledgerIndex)
    return {
      terms: terms([transactionHash, loanId]),
      reference: reference({
        kind: 'loan_lifecycle', segmentId: options.segmentId, fileKind: options.fileKind, ledgerIndex: index,
        searchResult: { kind: 'loan_lifecycle', epochId: options.epochId, ledgerIndex: index, transactionHash, objectType: 'Loan', objectId: loanId, loanId },
      }),
    }
  }
  if (options.fileKind === 'balance_history') {
    return {
      terms: terms([source.transactionHash, source.subjectId, source.assetKey]),
      reference: reference({
        kind: 'balance_history', segmentId: options.segmentId, fileKind: options.fileKind,
        ledgerIndex: ledgerIndex(source.ledgerIndex), searchResult: null,
      }),
    }
  }
  return null
}
