import type { NetworkEpochRecord } from '../../domain/network/status'
import type { ActiveSnapshotRecord } from '../repositories/core-api-repository'
import type {
  CurrentLoanRecord,
  ListCurrentLoansResult,
  LoanScheduleStatus,
  LoanSort,
} from '../repositories/current-state-loan-reader'

const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800

function epochSummary(epoch: NetworkEpochRecord | null) {
  return epoch ? { id: epoch.id, status: epoch.status } : null
}

function snapshotSummary(snapshot: ActiveSnapshotRecord) {
  return {
    id: snapshot.id,
    epoch_id: snapshot.epochId,
    ledger_index: snapshot.ledgerIndex,
    ledger_hash: snapshot.ledgerHash,
    completed_at: snapshot.completedAt,
  }
}

function rippleTimeIso(value: number | null): string | null {
  if (value === null) return null
  return new Date((value + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

function serializeLoan(record: CurrentLoanRecord, includeRaw = false) {
  const { loan, broker, vault, schedule } = record
  return {
    id: loan.id,
    loan_broker_id: loan.loanBrokerId,
    borrower: loan.borrower,
    loan_sequence: loan.loanSequence,
    asset: vault.asset,
    loan_origination_fee: loan.loanOriginationFee,
    loan_service_fee: loan.loanServiceFee,
    late_payment_fee: loan.latePaymentFee,
    close_payment_fee: loan.closePaymentFee,
    overpayment_fee_rate: loan.overpaymentFeeRate,
    interest_rate: loan.interestRate,
    late_interest_rate: loan.lateInterestRate,
    close_interest_rate: loan.closeInterestRate,
    overpayment_interest_rate: loan.overpaymentInterestRate,
    start_date_ripple_time: loan.startDate,
    start_date: rippleTimeIso(loan.startDate),
    payment_interval_seconds: loan.paymentInterval,
    grace_period_seconds: loan.gracePeriod,
    previous_payment_due_ripple_time: loan.previousPaymentDueDate,
    previous_payment_due: rippleTimeIso(loan.previousPaymentDueDate || null),
    next_payment_due_ripple_time: loan.nextPaymentDueDate,
    next_payment_due: rippleTimeIso(loan.nextPaymentDueDate),
    default_eligible_ripple_time: schedule.defaultEligibleRippleTime,
    default_eligible_at: rippleTimeIso(schedule.defaultEligibleRippleTime),
    payment_remaining: loan.paymentRemaining,
    principal_outstanding: loan.principalOutstanding,
    total_value_outstanding: loan.totalValueOutstanding,
    management_fee_outstanding: loan.managementFeeOutstanding,
    periodic_payment: loan.periodicPayment,
    loan_scale: loan.loanScale,
    on_ledger_status: loan.onLedgerStatus,
    schedule_status: schedule.status,
    status_source: {
      flags: loan.flags,
      next_payment_due_ripple_time: schedule.nextPaymentDueRippleTime,
      next_payment_due: rippleTimeIso(schedule.nextPaymentDueRippleTime),
      grace_period_seconds: loan.gracePeriod,
      default_eligible_ripple_time: schedule.defaultEligibleRippleTime,
      default_eligible_at: rippleTimeIso(schedule.defaultEligibleRippleTime),
      evaluated_at_ripple_time: schedule.evaluatedAtRippleTime,
      evaluated_at: rippleTimeIso(schedule.evaluatedAtRippleTime),
    },
    supports_overpayment: loan.supportsOverpayment,
    flags: loan.flags,
    previous_transaction_hash: loan.previousTxHash,
    previous_ledger_index: loan.previousLedgerIndex,
    related_loan_broker: {
      id: broker.id,
      vault_id: broker.vaultId,
      owner: broker.owner,
      account: broker.account,
    },
    related_vault: {
      id: vault.id,
      owner: vault.owner,
      account: vault.account,
      asset: vault.asset,
    },
    provenance: {
      object: 'direct',
      asset: 'direct',
      relationships: 'direct',
      on_ledger_status: 'direct',
      schedule_status: 'derived',
    },
    ...(includeRaw ? { raw: loan.raw } : {}),
  }
}

export function serializeAvailableLoanCollection(options: {
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord
  result: ListCurrentLoansResult
  page: { limit: number }
  sort: LoanSort
  query?: string
  onLedgerStatus?: 'active' | 'impaired' | 'defaulted'
  scheduleStatus?: LoanScheduleStatus
}) {
  return {
    network: 'devnet',
    kind: 'loans',
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    data: options.result.data.map((record) => serializeLoan(record)),
    page: {
      limit: options.page.limit,
      next_cursor: options.result.nextCursor,
      sort: options.sort,
      loan_shards_read: options.result.loanShardsRead,
      relation_shards_read: options.result.relationShardsRead,
      objects_examined: options.result.objectsExamined,
    },
    filters: {
      query: options.query ?? null,
      on_ledger_status: options.onLedgerStatus ?? null,
      schedule_status: options.scheduleStatus ?? null,
    },
    availability: { state: 'available', reason: null },
    provenance: {
      collection: 'direct',
      asset_relationship: 'direct',
      schedule_status: 'derived',
    },
  }
}

export function serializeLoanDetail(options: {
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord
  record: CurrentLoanRecord
}) {
  return {
    network: 'devnet',
    kind: 'loan',
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    data: serializeLoan(options.record, true),
    availability: { state: 'available', reason: null },
    provenance: {
      object: 'direct',
      asset_relationship: 'direct',
      schedule_status: 'derived',
    },
  }
}
