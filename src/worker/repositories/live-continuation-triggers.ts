interface ActiveBoundaryRow {
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
}

interface LoanEventTriggerRow {
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

export interface LiveContinuationTriggers {
  boundary: {
    epochId: string
    snapshotId: string
    ledgerIndex: number
  } | null
  loanEvents: {
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
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export async function readLiveContinuationTriggers(
  db: D1Database,
): Promise<LiveContinuationTriggers> {
  const boundary = await db.prepare(
    `SELECT epoch_id, base_snapshot_id, base_ledger_index
     FROM current_state_overlay_state
     WHERE network = 'devnet'
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).first<ActiveBoundaryRow>()

  if (!boundary) {
    return {
      boundary: null,
      loanEvents: {
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
      },
    }
  }

  const events = await db.prepare(
    `SELECT
       COUNT(*) AS total,
       MAX(ledger_index) AS latest_ledger,
       COALESCE(SUM(CASE WHEN event_type = 'LoanSet' THEN 1 ELSE 0 END), 0) AS loan_set,
       MAX(CASE WHEN event_type = 'LoanSet' THEN ledger_index END) AS loan_set_latest_ledger,
       COALESCE(SUM(CASE WHEN event_type = 'LoanPay' THEN 1 ELSE 0 END), 0) AS loan_pay,
       MAX(CASE WHEN event_type = 'LoanPay' THEN ledger_index END) AS loan_pay_latest_ledger,
       COALESCE(SUM(CASE WHEN event_type = 'LoanManage' THEN 1 ELSE 0 END), 0) AS loan_manage,
       MAX(CASE WHEN event_type = 'LoanManage' THEN ledger_index END) AS loan_manage_latest_ledger,
       COALESCE(SUM(CASE WHEN event_type = 'LoanDelete' THEN 1 ELSE 0 END), 0) AS loan_delete,
       MAX(CASE WHEN event_type = 'LoanDelete' THEN ledger_index END) AS loan_delete_latest_ledger
     FROM protocol_events
     WHERE network = 'devnet'
       AND epoch_id = ?1
       AND ledger_index > ?2
       AND event_type IN ('LoanSet', 'LoanPay', 'LoanManage', 'LoanDelete')`,
  ).bind(boundary.epoch_id, boundary.base_ledger_index).first<LoanEventTriggerRow>()

  return {
    boundary: {
      epochId: boundary.epoch_id,
      snapshotId: boundary.base_snapshot_id,
      ledgerIndex: boundary.base_ledger_index,
    },
    loanEvents: {
      total: numberValue(events?.total),
      latestLedger: events?.latest_ledger ?? null,
      loanSet: numberValue(events?.loan_set),
      loanSetLatestLedger: events?.loan_set_latest_ledger ?? null,
      loanPay: numberValue(events?.loan_pay),
      loanPayLatestLedger: events?.loan_pay_latest_ledger ?? null,
      loanManage: numberValue(events?.loan_manage),
      loanManageLatestLedger: events?.loan_manage_latest_ledger ?? null,
      loanDelete: numberValue(events?.loan_delete),
      loanDeleteLatestLedger: events?.loan_delete_latest_ledger ?? null,
    },
  }
}
