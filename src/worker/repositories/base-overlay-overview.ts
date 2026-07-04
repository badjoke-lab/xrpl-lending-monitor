import type { ActiveSnapshotRecord } from './core-api-repository'

interface CountDeltaRow {
  object_type: 'vault' | 'loan_broker' | 'loan'
  live_created: number
  deleted_from_base: number
}

function isMissingOverlaySchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no such table: current_state_overlay_')
    || message.includes('no such table: main.current_state_overlay_')
}

function historyType(type: CountDeltaRow['object_type']): 'Vault' | 'LoanBroker' | 'Loan' {
  if (type === 'vault') return 'Vault'
  if (type === 'loan_broker') return 'LoanBroker'
  return 'Loan'
}

async function deltaForType(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
  objectType: CountDeltaRow['object_type']
}): Promise<CountDeltaRow> {
  const row = await options.db.prepare(
    `SELECT
       ?3 AS object_type,
       COALESCE(SUM(CASE
         WHEN overlay.operation = 'upsert'
          AND EXISTS (
            SELECT 1
            FROM object_changes changes
            WHERE changes.network = 'devnet'
              AND changes.epoch_id = ?1
              AND changes.object_type = ?4
              AND changes.object_id = overlay.object_id
              AND changes.action = 'created'
              AND changes.ledger_index > ?5
            LIMIT 1
          )
         THEN 1 ELSE 0 END), 0) AS live_created,
       COALESCE(SUM(CASE
         WHEN overlay.operation = 'deleted'
          AND NOT EXISTS (
            SELECT 1
            FROM object_changes changes
            WHERE changes.network = 'devnet'
              AND changes.epoch_id = ?1
              AND changes.object_type = ?4
              AND changes.object_id = overlay.object_id
              AND changes.action = 'created'
              AND changes.ledger_index > ?5
            LIMIT 1
          )
         THEN 1 ELSE 0 END), 0) AS deleted_from_base
     FROM current_state_overlay_objects overlay
     WHERE overlay.network = 'devnet'
       AND overlay.epoch_id = ?1
       AND overlay.base_snapshot_id = ?2
       AND overlay.object_type = ?3`,
  ).bind(
    options.snapshot.epochId,
    options.snapshot.id,
    options.objectType,
    historyType(options.objectType),
    options.snapshot.ledgerIndex,
  ).first<CountDeltaRow>()

  return row ?? {
    object_type: options.objectType,
    live_created: 0,
    deleted_from_base: 0,
  }
}

export async function resolveBaseOverlaySnapshotCounts(
  db: D1Database,
  snapshot: ActiveSnapshotRecord,
): Promise<ActiveSnapshotRecord> {
  try {
    const [vault, broker, loan] = await Promise.all([
      deltaForType({ db, snapshot, objectType: 'vault' }),
      deltaForType({ db, snapshot, objectType: 'loan_broker' }),
      deltaForType({ db, snapshot, objectType: 'loan' }),
    ])
    const vaultCount = snapshot.vaultCount + vault.live_created - vault.deleted_from_base
    const loanBrokerCount = snapshot.loanBrokerCount + broker.live_created - broker.deleted_from_base
    const loanCount = snapshot.loanCount + loan.live_created - loan.deleted_from_base
    return {
      ...snapshot,
      vaultCount,
      loanBrokerCount,
      loanCount,
      objectCount: vaultCount + loanBrokerCount + loanCount,
    }
  } catch (error) {
    if (isMissingOverlaySchema(error)) return snapshot
    throw error
  }
}
