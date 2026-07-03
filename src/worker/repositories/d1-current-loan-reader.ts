import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  LoanOnLedgerStatus,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  decodeD1Cursor,
  encodeD1Cursor,
  parseLoanBrokerProjection,
  parseLoanProjection,
  parseVaultProjection,
} from './d1-current-reader-common'
import { CurrentStateObjectReadError } from './current-state-object-reader'

export type LoanSort = 'id_asc' | 'id_desc'
export type LoanScheduleStatus = 'current' | 'payment_due' | 'default_eligible' | 'complete' | 'unknown'

export interface LoanScheduleEvaluation {
  status: LoanScheduleStatus
  evaluatedAtRippleTime: number
  nextPaymentDueRippleTime: number | null
  defaultEligibleRippleTime: number | null
}

export interface CurrentLoanRecord {
  loan: LoanCurrentProjection
  broker: LoanBrokerCurrentProjection
  vault: VaultCurrentProjection
  schedule: LoanScheduleEvaluation
}

export interface ListCurrentLoansOptions {
  limit: number
  evaluatedAtRippleTime: number
  cursor?: string
  sort?: LoanSort
  query?: string
  onLedgerStatus?: LoanOnLedgerStatus
  scheduleStatus?: LoanScheduleStatus
}

export interface ListCurrentLoansResult {
  data: CurrentLoanRecord[]
  nextCursor: string | null
  loanShardsRead: number
  relationShardsRead: number
  objectsExamined: number
}

interface LoanRow {
  object_id: string
  loan_projection_json: string
  loan_raw_json: string
  broker_projection_json: string
  broker_raw_json: string
  vault_projection_json: string
  vault_raw_json: string
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function evaluateSchedule(
  loan: LoanCurrentProjection,
  evaluatedAtRippleTime: number,
): LoanScheduleEvaluation {
  if (!Number.isSafeInteger(evaluatedAtRippleTime) || evaluatedAtRippleTime < 0) {
    throw new Error('evaluatedAtRippleTime must be a non-negative safe integer')
  }
  if (loan.paymentRemaining === 0) {
    return {
      status: 'complete',
      evaluatedAtRippleTime,
      nextPaymentDueRippleTime: loan.nextPaymentDueDate,
      defaultEligibleRippleTime: null,
    }
  }
  if (loan.nextPaymentDueDate === null) {
    return {
      status: 'unknown',
      evaluatedAtRippleTime,
      nextPaymentDueRippleTime: null,
      defaultEligibleRippleTime: null,
    }
  }
  const defaultEligibleRippleTime = loan.nextPaymentDueDate + loan.gracePeriod
  return {
    status: evaluatedAtRippleTime < loan.nextPaymentDueDate
      ? 'current'
      : evaluatedAtRippleTime < defaultEligibleRippleTime
        ? 'payment_due'
        : 'default_eligible',
    evaluatedAtRippleTime,
    nextPaymentDueRippleTime: loan.nextPaymentDueDate,
    defaultEligibleRippleTime,
  }
}

function parseRecord(row: LoanRow, evaluatedAtRippleTime: number): CurrentLoanRecord {
  const loan = parseLoanProjection(row.loan_projection_json, row.loan_raw_json)
  return {
    loan,
    broker: parseLoanBrokerProjection(row.broker_projection_json, row.broker_raw_json),
    vault: parseVaultProjection(row.vault_projection_json, row.vault_raw_json),
    schedule: evaluateSchedule(loan, evaluatedAtRippleTime),
  }
}

export async function listCurrentLoans(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoansOptions,
): Promise<ListCurrentLoansResult> {
  const sort = options.sort ?? 'id_asc'
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('limit must be an integer from 1 to 100')
  }
  const cursor = options.cursor ? decodeD1Cursor(options.cursor) : null
  if (cursor && cursor.snapshotId !== snapshot.id) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor belongs to a different snapshot')
  }
  if (cursor && cursor.sort !== sort) {
    throw new CurrentStateObjectReadError('invalid_cursor', 'cursor sort does not match request sort')
  }

  const conditions = ['loan.snapshot_id = ?1']
  const values: unknown[] = [snapshot.id]
  if (cursor) {
    conditions.push(`loan.object_id ${sort === 'id_asc' ? '>' : '<'} ?${values.length + 1}`)
    values.push(cursor.lastObjectId)
  }
  if (options.query) {
    const parameter = `?${values.length + 1}`
    conditions.push(`(
      loan.object_id LIKE ${parameter} ESCAPE '\\' OR
      loan.loan_broker_id LIKE ${parameter} ESCAPE '\\' OR
      loan.borrower LIKE ${parameter} ESCAPE '\\'
    )`)
    values.push(`%${escapeLike(options.query)}%`)
  }
  if (options.onLedgerStatus) {
    conditions.push(`loan.on_ledger_status = ?${values.length + 1}`)
    values.push(options.onLedgerStatus)
  }

  const candidateLimit = Math.min(1_000, Math.max(options.limit + 1, options.limit * 8))
  values.push(candidateLimit)
  const result = await db
    .prepare(
      `SELECT loan.object_id,
              loan.projection_json AS loan_projection_json,
              loan.raw_json AS loan_raw_json,
              broker.projection_json AS broker_projection_json,
              broker.raw_json AS broker_raw_json,
              vault.projection_json AS vault_projection_json,
              vault.raw_json AS vault_raw_json
       FROM current_state_d1_loans loan
       JOIN current_state_d1_loan_brokers broker
         ON broker.snapshot_id = loan.snapshot_id
        AND broker.object_id = loan.loan_broker_id
       JOIN current_state_d1_vaults vault
         ON vault.snapshot_id = broker.snapshot_id
        AND vault.object_id = broker.vault_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY loan.object_id ${sort === 'id_asc' ? 'ASC' : 'DESC'}
       LIMIT ?${values.length}`,
    )
    .bind(...values)
    .all<LoanRow>()

  const rows = result.results ?? []
  const selected: CurrentLoanRecord[] = []
  let examined = 0
  for (const row of rows) {
    examined += 1
    const record = parseRecord(row, options.evaluatedAtRippleTime)
    if (options.scheduleStatus && record.schedule.status !== options.scheduleStatus) continue
    selected.push(record)
    if (selected.length === options.limit) break
  }

  const lastExamined = rows[Math.max(0, examined - 1)]
  const hasMore = rows.length === candidateLimit || examined < rows.length
  const nextCursor = hasMore && lastExamined
    ? encodeD1Cursor({
        version: 1,
        snapshotId: snapshot.id,
        lastObjectId: lastExamined.object_id,
        sort,
      })
    : null

  return {
    data: selected,
    nextCursor,
    loanShardsRead: 0,
    relationShardsRead: 0,
    objectsExamined: examined,
  }
}

export async function getCurrentLoanById(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
  loanId: string,
  evaluatedAtRippleTime: number,
): Promise<CurrentLoanRecord | null> {
  const normalizedId = loanId.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalizedId)) return null
  const row = await db
    .prepare(
      `SELECT loan.object_id,
              loan.projection_json AS loan_projection_json,
              loan.raw_json AS loan_raw_json,
              broker.projection_json AS broker_projection_json,
              broker.raw_json AS broker_raw_json,
              vault.projection_json AS vault_projection_json,
              vault.raw_json AS vault_raw_json
       FROM current_state_d1_loans loan
       JOIN current_state_d1_loan_brokers broker
         ON broker.snapshot_id = loan.snapshot_id
        AND broker.object_id = loan.loan_broker_id
       JOIN current_state_d1_vaults vault
         ON vault.snapshot_id = broker.snapshot_id
        AND vault.object_id = broker.vault_id
       WHERE loan.snapshot_id = ?1 AND loan.object_id = ?2`,
    )
    .bind(snapshot.id, normalizedId)
    .first<LoanRow>()
  return row ? parseRecord(row, evaluatedAtRippleTime) : null
}
