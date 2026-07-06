import { readContinuationScopeBoundary } from './continuation-scope'

interface ObjectChangeDrilldownRow {
  created: number
  created_latest_ledger: number | null
  modified: number
  modified_latest_ledger: number | null
  deleted: number
  deleted_latest_ledger: number | null
}
interface ProtocolDrilldownRow {
  total: number
  latest_ledger: number | null
  loan_pay: number
  loan_pay_latest_ledger: number | null
  loan_manage: number
  loan_manage_latest_ledger: number | null
}
interface LifecycleDrilldownRow {
  total: number
  latest_ledger: number | null
  payment: number
  payment_latest_ledger: number | null
  paid: number
  paid_latest_ledger: number | null
  impaired: number
  impaired_latest_ledger: number | null
  unimpaired: number
  unimpaired_latest_ledger: number | null
  defaulted: number
  defaulted_latest_ledger: number | null
  deleted: number
  deleted_latest_ledger: number | null
}
interface BalanceDrilldownRow { total: number; latest_ledger: number | null }
interface LinkageGapRow {
  loan_pay_without_lifecycle: number
  lifecycle_without_protocol: number
  lifecycle_without_balance: number
  balance_without_lifecycle: number
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export interface LiveContinuationDrilldown {
  epochId: string | null
  objectChanges: { created: number; createdLatestLedger: number | null; modified: number; modifiedLatestLedger: number | null; deleted: number; deletedLatestLedger: number | null }
  protocolEvents: { total: number; latestLedger: number | null; loanPay: number; loanPayLatestLedger: number | null; loanManage: number; loanManageLatestLedger: number | null }
  lifecycle: { total: number; latestLedger: number | null; payment: number; paymentLatestLedger: number | null; paid: number; paidLatestLedger: number | null; impaired: number; impairedLatestLedger: number | null; unimpaired: number; unimpairedLatestLedger: number | null; defaulted: number; defaultedLatestLedger: number | null; deleted: number; deletedLatestLedger: number | null }
  balanceHistory: { total: number; latestLedger: number | null }
  linkageGaps: { loanPayWithoutLifecycle: number; lifecycleWithoutProtocol: number; lifecycleWithoutBalance: number; balanceWithoutLifecycle: number }
}

function empty(): LiveContinuationDrilldown {
  return {
    epochId: null,
    objectChanges: { created: 0, createdLatestLedger: null, modified: 0, modifiedLatestLedger: null, deleted: 0, deletedLatestLedger: null },
    protocolEvents: { total: 0, latestLedger: null, loanPay: 0, loanPayLatestLedger: null, loanManage: 0, loanManageLatestLedger: null },
    lifecycle: { total: 0, latestLedger: null, payment: 0, paymentLatestLedger: null, paid: 0, paidLatestLedger: null, impaired: 0, impairedLatestLedger: null, unimpaired: 0, unimpairedLatestLedger: null, defaulted: 0, defaultedLatestLedger: null, deleted: 0, deletedLatestLedger: null },
    balanceHistory: { total: 0, latestLedger: null },
    linkageGaps: { loanPayWithoutLifecycle: 0, lifecycleWithoutProtocol: 0, lifecycleWithoutBalance: 0, balanceWithoutLifecycle: 0 },
  }
}

export async function readLiveContinuationDrilldown(
  db: D1Database,
): Promise<LiveContinuationDrilldown> {
  const scope = await readContinuationScopeBoundary(db)
  if (!scope) return empty()
  const { epochId, baseLedgerIndex } = scope

  const [objectChanges, protocol, lifecycle, balance, gaps] = await Promise.all([
    db.prepare(
      `WITH distinct_actions AS (
         SELECT DISTINCT transaction_hash, node_index, object_id, action, ledger_index
         FROM object_changes
         WHERE network = 'devnet' AND epoch_id = ?1 AND ledger_index > ?2
           AND object_type IN ('Vault', 'LoanBroker', 'Loan')
       )
       SELECT
         COALESCE(SUM(CASE WHEN action = 'created' THEN 1 ELSE 0 END), 0) AS created,
         MAX(CASE WHEN action = 'created' THEN ledger_index END) AS created_latest_ledger,
         COALESCE(SUM(CASE WHEN action = 'modified' THEN 1 ELSE 0 END), 0) AS modified,
         MAX(CASE WHEN action = 'modified' THEN ledger_index END) AS modified_latest_ledger,
         COALESCE(SUM(CASE WHEN action = 'deleted' THEN 1 ELSE 0 END), 0) AS deleted,
         MAX(CASE WHEN action = 'deleted' THEN ledger_index END) AS deleted_latest_ledger
       FROM distinct_actions`,
    ).bind(epochId, baseLedgerIndex).first<ObjectChangeDrilldownRow>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              MAX(ledger_index) AS latest_ledger,
              COALESCE(SUM(CASE WHEN event_type = 'LoanPay' THEN 1 ELSE 0 END), 0) AS loan_pay,
              MAX(CASE WHEN event_type = 'LoanPay' THEN ledger_index END) AS loan_pay_latest_ledger,
              COALESCE(SUM(CASE WHEN event_type = 'LoanManage' THEN 1 ELSE 0 END), 0) AS loan_manage,
              MAX(CASE WHEN event_type = 'LoanManage' THEN ledger_index END) AS loan_manage_latest_ledger
       FROM protocol_events
       WHERE network = 'devnet' AND epoch_id = ?1 AND ledger_index > ?2`,
    ).bind(epochId, baseLedgerIndex).first<ProtocolDrilldownRow>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              MAX(ledger_index) AS latest_ledger,
              COALESCE(SUM(CASE WHEN event_type = 'payment' THEN 1 ELSE 0 END), 0) AS payment,
              MAX(CASE WHEN event_type = 'payment' THEN ledger_index END) AS payment_latest_ledger,
              COALESCE(SUM(CASE WHEN event_type = 'paid' THEN 1 ELSE 0 END), 0) AS paid,
              MAX(CASE WHEN event_type = 'paid' THEN ledger_index END) AS paid_latest_ledger,
              COALESCE(SUM(CASE WHEN event_type = 'impaired' THEN 1 ELSE 0 END), 0) AS impaired,
              MAX(CASE WHEN event_type = 'impaired' THEN ledger_index END) AS impaired_latest_ledger,
              COALESCE(SUM(CASE WHEN event_type = 'unimpaired' THEN 1 ELSE 0 END), 0) AS unimpaired,
              MAX(CASE WHEN event_type = 'unimpaired' THEN ledger_index END) AS unimpaired_latest_ledger,
              COALESCE(SUM(CASE WHEN event_type = 'defaulted' THEN 1 ELSE 0 END), 0) AS defaulted,
              MAX(CASE WHEN event_type = 'defaulted' THEN ledger_index END) AS defaulted_latest_ledger,
              COALESCE(SUM(CASE WHEN event_type = 'deleted' THEN 1 ELSE 0 END), 0) AS deleted,
              MAX(CASE WHEN event_type = 'deleted' THEN ledger_index END) AS deleted_latest_ledger
       FROM loan_lifecycle_events
       WHERE network = 'devnet' AND epoch_id = ?1 AND ledger_index > ?2`,
    ).bind(epochId, baseLedgerIndex).first<LifecycleDrilldownRow>(),
    db.prepare(
      `SELECT COUNT(*) AS total, MAX(ledger_index) AS latest_ledger
       FROM balance_history
       WHERE network = 'devnet' AND epoch_id = ?1 AND ledger_index > ?2`,
    ).bind(epochId, baseLedgerIndex).first<BalanceDrilldownRow>(),
    db.prepare(
      `SELECT
         (
           SELECT COUNT(*) FROM protocol_events p
           WHERE p.network = 'devnet' AND p.epoch_id = ?1
             AND p.ledger_index > ?2 AND p.event_type = 'LoanPay'
             AND NOT EXISTS (
               SELECT 1 FROM loan_lifecycle_events l
               WHERE l.network = p.network AND l.epoch_id = p.epoch_id
                 AND l.transaction_hash = p.event_hash
                 AND l.ledger_index > ?2
                 AND l.event_type IN ('payment', 'paid')
             )
         ) AS loan_pay_without_lifecycle,
         (
           SELECT COUNT(*) FROM loan_lifecycle_events l
           WHERE l.network = 'devnet' AND l.epoch_id = ?1 AND l.ledger_index > ?2
             AND NOT EXISTS (
               SELECT 1 FROM protocol_events p
               WHERE p.network = l.network AND p.epoch_id = l.epoch_id
                 AND p.event_hash = l.transaction_hash AND p.ledger_index > ?2
             )
         ) AS lifecycle_without_protocol,
         (
           SELECT COUNT(*) FROM loan_lifecycle_events l
           WHERE l.network = 'devnet' AND l.epoch_id = ?1 AND l.ledger_index > ?2
             AND NOT EXISTS (
               SELECT 1 FROM balance_history b
               WHERE b.network = l.network AND b.epoch_id = l.epoch_id
                 AND b.transaction_hash = l.transaction_hash AND b.ledger_index > ?2
             )
         ) AS lifecycle_without_balance,
         (
           SELECT COUNT(*) FROM balance_history b
           WHERE b.network = 'devnet' AND b.epoch_id = ?1 AND b.ledger_index > ?2
             AND NOT EXISTS (
               SELECT 1 FROM loan_lifecycle_events l
               WHERE l.network = b.network AND l.epoch_id = b.epoch_id
                 AND l.transaction_hash = b.transaction_hash AND l.ledger_index > ?2
             )
         ) AS balance_without_lifecycle`,
    ).bind(epochId, baseLedgerIndex).first<LinkageGapRow>(),
  ])

  return {
    epochId,
    objectChanges: {
      created: numberValue(objectChanges?.created), createdLatestLedger: objectChanges?.created_latest_ledger ?? null,
      modified: numberValue(objectChanges?.modified), modifiedLatestLedger: objectChanges?.modified_latest_ledger ?? null,
      deleted: numberValue(objectChanges?.deleted), deletedLatestLedger: objectChanges?.deleted_latest_ledger ?? null,
    },
    protocolEvents: {
      total: numberValue(protocol?.total), latestLedger: protocol?.latest_ledger ?? null,
      loanPay: numberValue(protocol?.loan_pay), loanPayLatestLedger: protocol?.loan_pay_latest_ledger ?? null,
      loanManage: numberValue(protocol?.loan_manage), loanManageLatestLedger: protocol?.loan_manage_latest_ledger ?? null,
    },
    lifecycle: {
      total: numberValue(lifecycle?.total), latestLedger: lifecycle?.latest_ledger ?? null,
      payment: numberValue(lifecycle?.payment), paymentLatestLedger: lifecycle?.payment_latest_ledger ?? null,
      paid: numberValue(lifecycle?.paid), paidLatestLedger: lifecycle?.paid_latest_ledger ?? null,
      impaired: numberValue(lifecycle?.impaired), impairedLatestLedger: lifecycle?.impaired_latest_ledger ?? null,
      unimpaired: numberValue(lifecycle?.unimpaired), unimpairedLatestLedger: lifecycle?.unimpaired_latest_ledger ?? null,
      defaulted: numberValue(lifecycle?.defaulted), defaultedLatestLedger: lifecycle?.defaulted_latest_ledger ?? null,
      deleted: numberValue(lifecycle?.deleted), deletedLatestLedger: lifecycle?.deleted_latest_ledger ?? null,
    },
    balanceHistory: { total: numberValue(balance?.total), latestLedger: balance?.latest_ledger ?? null },
    linkageGaps: {
      loanPayWithoutLifecycle: numberValue(gaps?.loan_pay_without_lifecycle),
      lifecycleWithoutProtocol: numberValue(gaps?.lifecycle_without_protocol),
      lifecycleWithoutBalance: numberValue(gaps?.lifecycle_without_balance),
      balanceWithoutLifecycle: numberValue(gaps?.balance_without_lifecycle),
    },
  }
}
