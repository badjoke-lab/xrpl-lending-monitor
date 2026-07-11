import type { LoanOnLedgerStatus } from '../../domain/lending/current-projections'
import type {
  LoanScheduleStatus,
  LoanSort,
} from './d1-current-loan-reader'
import { readThreeLayerCursorScope } from './three-layer-cursor-metadata'

export interface LoanPaginationTimeOptions {
  cursor?: string
  sort?: LoanSort
  query?: string
  onLedgerStatus?: LoanOnLedgerStatus
  scheduleStatus?: LoanScheduleStatus
  evaluatedAtRippleTime: number
}

export function loanPaginationScopePrefix(options: LoanPaginationTimeOptions): string {
  return [
    'loan',
    options.sort ?? 'id_asc',
    options.query ?? '',
    options.onLedgerStatus ?? '',
    options.scheduleStatus ?? '',
  ].join(':') + ':'
}

export function resolveLoanPaginationEvaluationTime(options: LoanPaginationTimeOptions): number {
  const scope = readThreeLayerCursorScope(options.cursor)
  const prefix = loanPaginationScopePrefix(options)
  if (!scope || !scope.startsWith(prefix)) return options.evaluatedAtRippleTime
  const value = Number(scope.slice(prefix.length))
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : options.evaluatedAtRippleTime
}

export function loanPaginationScope(
  options: LoanPaginationTimeOptions,
  evaluatedAtRippleTime: number,
): string {
  return `${loanPaginationScopePrefix(options)}${evaluatedAtRippleTime}`
}
