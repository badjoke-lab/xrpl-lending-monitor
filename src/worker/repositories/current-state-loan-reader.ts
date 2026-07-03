import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  getCurrentLoanById as getStoredCurrentLoanById,
  listCurrentLoans as listStoredCurrentLoans,
  type CurrentLoanRecord,
  type ListCurrentLoansOptions,
  type ListCurrentLoansResult,
  type LoanScheduleEvaluation,
  type LoanScheduleStatus,
  type LoanSort,
} from './d1-current-loan-reader'

export type {
  CurrentLoanRecord,
  ListCurrentLoansOptions,
  ListCurrentLoansResult,
  LoanScheduleEvaluation,
  LoanScheduleStatus,
  LoanSort,
}

function database(storage: R2Bucket | D1Database): D1Database {
  return storage as unknown as D1Database
}

export function listCurrentLoans(
  storage: R2Bucket | D1Database,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoansOptions,
): Promise<ListCurrentLoansResult> {
  return listStoredCurrentLoans(database(storage), snapshot, options)
}

export function getCurrentLoanById(
  storage: R2Bucket | D1Database,
  snapshot: ActiveSnapshotRecord,
  loanId: string,
  evaluatedAtRippleTime: number,
): Promise<CurrentLoanRecord | null> {
  return getStoredCurrentLoanById(database(storage), snapshot, loanId, evaluatedAtRippleTime)
}
