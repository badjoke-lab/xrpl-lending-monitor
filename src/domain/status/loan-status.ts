export type LoanOnLedgerStatus = 'active' | 'impaired' | 'defaulted' | 'deleted' | 'unknown'
export type LoanScheduleStatus = 'current' | 'payment_due' | 'default_eligible' | 'complete' | 'not_applicable' | 'unknown'

const LOAN_DEFAULT_FLAG = 0x00010000
const LOAN_IMPAIRED_FLAG = 0x00020000

export interface LoanScheduleInput {
  onLedgerStatus: LoanOnLedgerStatus
  paymentRemaining: number | null
  nextPaymentDueDate: number | null
  gracePeriod: number | null
  evaluatedAt: number
}

export interface LoanStatusResult {
  onLedgerStatus: LoanOnLedgerStatus
  scheduleStatus: LoanScheduleStatus
  source: {
    flags: number | null
    nextPaymentDue: number | null
    gracePeriod: number | null
    defaultEligibleAt: number | null
    evaluatedAt: number
  }
}

function safeInteger(value: number | null, field: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`)
  return value
}

export function onLedgerStatusFromFlags(options: {
  flags: number | null
  deleted?: boolean
}): LoanOnLedgerStatus {
  if (options.deleted) return 'deleted'
  const flags = safeInteger(options.flags, 'flags')
  if (flags === null) return 'unknown'
  if ((flags & LOAN_DEFAULT_FLAG) !== 0) return 'defaulted'
  if ((flags & LOAN_IMPAIRED_FLAG) !== 0) return 'impaired'
  return 'active'
}

export function scheduleStatus(input: LoanScheduleInput): LoanScheduleStatus {
  if (input.onLedgerStatus === 'deleted') return 'not_applicable'
  const paymentRemaining = safeInteger(input.paymentRemaining, 'paymentRemaining')
  const nextPaymentDueDate = safeInteger(input.nextPaymentDueDate, 'nextPaymentDueDate')
  const gracePeriod = safeInteger(input.gracePeriod, 'gracePeriod')
  safeInteger(input.evaluatedAt, 'evaluatedAt')

  if (paymentRemaining === 0) return 'complete'
  if (paymentRemaining === null || nextPaymentDueDate === null || gracePeriod === null) {
    return 'unknown'
  }

  if (input.evaluatedAt < nextPaymentDueDate) return 'current'
  if (input.evaluatedAt < nextPaymentDueDate + gracePeriod) return 'payment_due'
  return 'default_eligible'
}

export function evaluateLoanStatus(options: {
  flags: number | null
  deleted?: boolean
  paymentRemaining: number | null
  nextPaymentDueDate: number | null
  gracePeriod: number | null
  evaluatedAt: number
}): LoanStatusResult {
  const onLedgerStatus = onLedgerStatusFromFlags({
    flags: options.flags,
    deleted: options.deleted,
  })
  const defaultEligibleAt =
    options.nextPaymentDueDate === null || options.gracePeriod === null
      ? null
      : options.nextPaymentDueDate + options.gracePeriod
  return {
    onLedgerStatus,
    scheduleStatus: scheduleStatus({
      onLedgerStatus,
      paymentRemaining: options.paymentRemaining,
      nextPaymentDueDate: options.nextPaymentDueDate,
      gracePeriod: options.gracePeriod,
      evaluatedAt: options.evaluatedAt,
    }),
    source: {
      flags: options.flags,
      nextPaymentDue: options.nextPaymentDueDate,
      gracePeriod: options.gracePeriod,
      defaultEligibleAt,
      evaluatedAt: options.evaluatedAt,
    },
  }
}
