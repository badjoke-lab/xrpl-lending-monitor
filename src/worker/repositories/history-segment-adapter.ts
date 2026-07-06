import type { SegmentProtocolEventRecord } from '../../collector/history-segments/build-segment-records'
import type { NormalizedObjectChange } from '../../collector/incremental/affected-nodes'
import type { ArchivedObjectRecord as SegmentArchivedObjectRecord } from '../../collector/incremental/deleted-object-archive'
import type { BalanceHistoryRecord as SegmentBalanceHistoryRecord } from '../../collector/incremental/cover-debt-loss'
import type { LoanLifecycleEvent as SegmentLoanLifecycleEvent } from '../../collector/incremental/loan-lifecycle'
import type {
  ArchivedObjectRecord,
  BalanceHistoryApiRecord,
  LoanLifecycleRecord,
  ObjectChangeRecord,
  ProtocolEventRecord,
} from './history-api-repository'

const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800

export function rippleCloseTimeIso(closeTime: number): string {
  if (!Number.isSafeInteger(closeTime) || closeTime < 0) {
    throw new Error('XRPL close time must be a non-negative safe integer')
  }
  return new Date((closeTime + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

function parseStoredJson(value: string | null): unknown | null {
  return value === null ? null : JSON.parse(value)
}

export function segmentProtocolEventToApi(
  event: SegmentProtocolEventRecord,
  epochId: string,
): ProtocolEventRecord {
  if (epochId.length === 0) throw new Error('Segment protocol event epoch ID must be non-empty')
  return {
    eventHash: event.eventHash,
    epochId,
    ledgerIndex: event.ledgerIndex,
    eventIndex: event.eventIndex,
    closeTime: event.closeTime,
    eventType: event.eventType,
    resultCode: event.resultCode,
    payloadRetained: false,
    sourceJson: null,
    metadataJson: null,
    createdAt: rippleCloseTimeIso(event.closeTime),
  }
}

export function segmentObjectChangeToApi(change: NormalizedObjectChange): ObjectChangeRecord {
  return {
    transactionHash: change.transactionHash,
    epochId: change.epochId,
    ledgerIndex: change.ledgerIndex,
    transactionIndex: change.transactionIndex,
    transactionType: change.transactionType,
    resultCode: change.result,
    closeTime: change.closeTime,
    nodeIndex: change.nodeIndex,
    objectType: change.objectType,
    objectId: change.objectId,
    action: change.action,
    fieldName: change.fieldName,
    beforeJson: parseStoredJson(change.beforeJson),
    afterJson: parseStoredJson(change.afterJson),
    valueType: change.valueType,
    unsupportedField: change.unsupportedField,
    vaultId: change.relationships.vaultId,
    loanBrokerId: change.relationships.loanBrokerId,
    loanId: change.relationships.loanId,
    account: change.relationships.account,
    owner: change.relationships.owner,
    borrower: change.relationships.borrower,
    assetKey: change.relationships.assetKey,
    mptIssuanceId: change.relationships.mptIssuanceId,
    createdAt: rippleCloseTimeIso(change.closeTime),
  }
}

export function segmentLoanLifecycleToApi(event: SegmentLoanLifecycleEvent): LoanLifecycleRecord {
  return {
    loanId: event.loanId,
    epochId: event.epochId,
    transactionHash: event.transactionHash,
    ledgerIndex: event.ledgerIndex,
    transactionIndex: event.transactionIndex,
    closeTime: event.closeTime,
    eventType: event.eventType,
    transactionType: event.transactionType,
    resultCode: event.result,
    statusBefore: event.statusBefore,
    statusAfter: event.statusAfter,
    principalBefore: event.principalBefore,
    principalAfter: event.principalAfter,
    totalValueBefore: event.totalValueBefore,
    totalValueAfter: event.totalValueAfter,
    paymentRemainingBefore: event.paymentRemainingBefore,
    paymentRemainingAfter: event.paymentRemainingAfter,
    detailsJson: JSON.parse(event.detailsJson),
    createdAt: rippleCloseTimeIso(event.closeTime),
  }
}

export function segmentArchivedObjectToApi(
  archive: SegmentArchivedObjectRecord,
): ArchivedObjectRecord {
  return {
    epochId: archive.epochId,
    objectType: archive.objectType,
    objectId: archive.objectId,
    deletionTransactionHash: archive.deletionTransactionHash,
    deletionLedgerIndex: archive.deletionLedgerIndex,
    deletionTransactionIndex: archive.deletionTransactionIndex,
    deletionCloseTime: archive.deletionCloseTime,
    deletionReason: archive.deletionReason,
    finalStateJson: JSON.parse(archive.finalStateJson),
    vaultId: archive.vaultId,
    loanBrokerId: archive.loanBrokerId,
    loanId: archive.loanId,
    owner: archive.owner,
    account: archive.account,
    borrower: archive.borrower,
    assetKey: archive.assetKey,
    archivedAt: rippleCloseTimeIso(archive.deletionCloseTime),
  }
}

export function segmentBalanceHistoryToApi(
  record: SegmentBalanceHistoryRecord,
): BalanceHistoryApiRecord {
  return {
    epochId: record.epochId,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    transactionHash: record.transactionHash,
    ledgerIndex: record.ledgerIndex,
    transactionIndex: record.transactionIndex,
    closeTime: record.closeTime,
    metricType: record.metricType,
    assetKey: record.assetKey,
    beforeValue: record.beforeValue,
    afterValue: record.afterValue,
    formula: record.formula,
    sourceFieldsJson: JSON.parse(record.sourceFieldsJson),
    createdAt: rippleCloseTimeIso(record.closeTime),
  }
}
