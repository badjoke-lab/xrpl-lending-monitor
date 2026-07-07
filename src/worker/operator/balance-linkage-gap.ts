import type { BalanceHistorySourceDiagnostics } from '../repositories/balance-history-source-diagnostics'

export function hasBalanceLinkageGap(
  diagnostics: BalanceHistorySourceDiagnostics | undefined,
): boolean {
  return diagnostics !== undefined && (
    diagnostics.sourceChangesMissingHistory > 0
    || diagnostics.historyRowsMissingSource > 0
  )
}
