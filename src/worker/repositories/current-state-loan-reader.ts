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
import {
  getGithubLoanById,
  listGithubLoans,
} from './github-current-loans'
import {
  isReleaseCurrentStateSource,
  type CurrentStateStorage,
} from './release-current-state'

export type {
  CurrentLoanRecord,
  ListCurrentLoansOptions,
  ListCurrentLoansResult,
  LoanScheduleEvaluation,
  LoanScheduleStatus,
  LoanSort,
}

function database(storage: CurrentStateStorage): D1Database {
  return storage as unknown as D1Database
}

export function listCurrentLoans(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  options: ListCurrentLoansOptions,
): Promise<ListCurrentLoansResult> {
  return isReleaseCurrentStateSource(storage)
    ? listGithubLoans(storage, snapshot, options)
    : listStoredCurrentLoans(database(storage), snapshot, options)
}

export function getCurrentLoanById(
  storage: CurrentStateStorage,
  snapshot: ActiveSnapshotRecord,
  loanId: string,
  evaluatedAtRippleTime: number,
): Promise<CurrentLoanRecord | null> {
  return isReleaseCurrentStateSource(storage)
    ? getGithubLoanById(storage, snapshot, loanId, evaluatedAtRippleTime)
    : getStoredCurrentLoanById(database(storage), snapshot, loanId, evaluatedAtRippleTime)
}
