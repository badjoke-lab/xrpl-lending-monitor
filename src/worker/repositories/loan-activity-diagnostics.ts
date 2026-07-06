import { readContinuationScopeBoundary } from './continuation-scope'

interface LoanActivityRow {
  total: number
  latest_ledger: number | null
  loan_set: number
  loan_set_latest_ledger: number | null
  loan_pay: number
  loan_pay_latest_ledger: number | null
  loan_manage: number
  loan_manage_latest_ledger: number | null
  loan_delete: number
  loan_delete_latest_ledger: number | null
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export interface LoanActivityDiagnostics {
  epochId: string | null
  total: number
  latestLedger: number | null
  loanSet: number
  loanSetLatestLedger: number | null
  loanPay: number
  loanPayLatestLedger: number | null
  loanManage: number
  loanManageLatestLedger: number | null
  loanDelete: number
  loanDeleteLatestLedger: number | null
}

function empty(): LoanActivityDiagnostics {
  return {
    epochId: null,
    total: 0,
    latestLedger: null,
    loanSet: 0,
    loanSetLatestLedger: null,
    loanPay: 0,
    loanPayLatestLedger: null,
    loanManage: 0,
    loanManageLatestLedger: null,
    loanDelete: 0,
    loanDeleteLatestLedger: null,
  }
}

export async function readLoanActivityDiagnostics(
  db: D1Database,
): Promise<LoanActivityDiagnostics> {
  const scope = await readContinuationScopeBoundary(db)
  if (!scope) return empty()

  const row = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type IN ('LoanSet', 'LoanPay', 'LoanManage', 'LoanDelete') THEN 1 ELSE 0 END), 0) AS total,
       MAX(CASE WHEN event_type IN ('LoanSet', 'LoanPay', 'LoanManage', 'LoanDelete') THEN ledger_index END) AS latest_ledger,
       COALESCE(SUM(CASE WHEN event_type = 'LoanSet' THEN 1 ELSE 0 END), 0) AS loan_set,
       MAX(CASE WHEN event_type = 'LoanSet' THEN ledger_index END) AS loan_set_latest_ledger,
       COALESCE(SUM(CASE WHEN event_type = 'LoanPay' THEN 1 ELSE 0 END), 0) AS loan_pay,
       MAX(CASE WHEN event_type = 'LoanPay' THEN ledger_index END) AS loan_pay_latest_ledger,
       COALESCE(SUM(CASE WHEN event_type = 'LoanManage' THEN 1 ELSE 0 END), 0) AS loan_manage,
       MAX(CASE WHEN event_type = 'LoanManage' THEN ledger_index END) AS loan_manage_latest_ledger,
       COALESCE(SUM(CASE WHEN event_type = 'LoanDelete' THEN 1 ELSE 0 END), 0) AS loan_delete,
       MAX(CASE WHEN event_type = 'LoanDelete' THEN ledger_index END) AS loan_delete_latest_ledger
     FROM protocol_events
     WHERE network = 'devnet' AND epoch_id = ?1 AND ledger_index > ?2`,
  ).bind(scope.epochId, scope.baseLedgerIndex).first<LoanActivityRow>()

  return {
    epochId: scope.epochId,
    total: numberValue(row?.total),
    latestLedger: row?.latest_ledger ?? null,
    loanSet: numberValue(row?.loan_set),
    loanSetLatestLedger: row?.loan_set_latest_ledger ?? null,
    loanPay: numberValue(row?.loan_pay),
    loanPayLatestLedger: row?.loan_pay_latest_ledger ?? null,
    loanManage: numberValue(row?.loan_manage),
    loanManageLatestLedger: row?.loan_manage_latest_ledger ?? null,
    loanDelete: numberValue(row?.loan_delete),
    loanDeleteLatestLedger: row?.loan_delete_latest_ledger ?? null,
  }
}
