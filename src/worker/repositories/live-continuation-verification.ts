import type { LiveContinuationEvidence } from '../../collector/incremental/live-continuation-verification'

interface SyncRow {
  epoch_id: string | null
  last_processed_ledger: number | null
  last_processed_hash: string | null
  latest_observed_ledger: number | null
  latest_observed_hash: string | null
}

interface OverlayRow {
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
  overlay_ledger_index: number
  overlay_ledger_hash: string
}

interface CollectorRow {
  status: string
  lag_ledgers: number | null
  last_success_at: string | null
}

interface ProcessedRow {
  count: number
  minimum: number | null
  maximum: number | null
  discontinuities: number
}

interface ActionRow {
  created: number
  modified: number
  deleted: number
}

interface OverlayObjectRow {
  upserts: number
  tombstones: number
  created_matches: number
  modified_matches: number
}

interface ProtocolRow {
  total: number
  loan_pay: number
  loan_manage: number
}

interface LifecycleRow {
  total: number
  payment: number
  paid: number
  impaired: number
  unimpaired: number
  defaulted: number
  deleted: number
}

interface ArchiveRow {
  total: number
  missing_tombstones: number
}

interface TombstoneArchiveRow {
  tombstones_missing_archive: number
}

interface CountRow {
  total: number
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export async function readLiveContinuationEvidence(
  db: D1Database,
): Promise<LiveContinuationEvidence> {
  const [sync, overlay, collector] = await Promise.all([
    db.prepare(
      `SELECT epoch_id, last_processed_ledger, last_processed_hash,
              latest_observed_ledger, latest_observed_hash
       FROM sync_state
       WHERE network = 'devnet'
       LIMIT 1`,
    ).first<SyncRow>(),
    db.prepare(
      `SELECT epoch_id, base_snapshot_id, base_ledger_index, base_ledger_hash,
              overlay_ledger_index, overlay_ledger_hash
       FROM current_state_overlay_state
       WHERE network = 'devnet'
       ORDER BY updated_at DESC
       LIMIT 1`,
    ).first<OverlayRow>(),
    db.prepare(
      `SELECT status, lag_ledgers, last_success_at
       FROM incremental_collector_state
       WHERE network = 'devnet'
       LIMIT 1`,
    ).first<CollectorRow>(),
  ])

  const epochId = sync?.epoch_id ?? ''
  const baseSnapshotId = overlay?.base_snapshot_id ?? ''
  const baseLedgerIndex = overlay?.base_ledger_index ?? -1
  const baseLedgerHash = overlay?.base_ledger_hash ?? ''

  const [processed, actions, overlayObjects, protocol, lifecycle, archives, tombstoneArchives, balances] =
    await Promise.all([
      db.prepare(
        `WITH source AS (
           SELECT ?2 AS ledger_index, ?3 AS ledger_hash, '' AS parent_hash, 1 AS anchor
           UNION ALL
           SELECT ledger_index, ledger_hash, parent_hash, 0 AS anchor
           FROM processed_ledgers
           WHERE network = 'devnet' AND epoch_id = ?1 AND ledger_index > ?2
         ), ordered AS (
           SELECT ledger_index, ledger_hash, parent_hash, anchor,
                  LAG(ledger_index) OVER (ORDER BY ledger_index) AS previous_index,
                  LAG(ledger_hash) OVER (ORDER BY ledger_index) AS previous_hash
           FROM source
         )
         SELECT COALESCE(SUM(CASE WHEN anchor = 0 THEN 1 ELSE 0 END), 0) AS count,
                MIN(CASE WHEN anchor = 0 THEN ledger_index END) AS minimum,
                MAX(CASE WHEN anchor = 0 THEN ledger_index END) AS maximum,
                COALESCE(SUM(
                  CASE
                    WHEN anchor = 0
                     AND previous_index IS NOT NULL
                     AND (ledger_index <> previous_index + 1 OR parent_hash <> previous_hash)
                    THEN 1 ELSE 0
                  END
                ), 0) AS discontinuities
         FROM ordered`,
      ).bind(epochId, baseLedgerIndex, baseLedgerHash).first<ProcessedRow>(),
      db.prepare(
        `WITH distinct_actions AS (
           SELECT DISTINCT transaction_hash, node_index, object_id, action
           FROM object_changes
           WHERE network = 'devnet' AND epoch_id = ?1
             AND ledger_index > ?2
             AND object_type IN ('Vault', 'LoanBroker', 'Loan')
         )
         SELECT
           COALESCE(SUM(CASE WHEN action = 'created' THEN 1 ELSE 0 END), 0) AS created,
           COALESCE(SUM(CASE WHEN action = 'modified' THEN 1 ELSE 0 END), 0) AS modified,
           COALESCE(SUM(CASE WHEN action = 'deleted' THEN 1 ELSE 0 END), 0) AS deleted
         FROM distinct_actions`,
      ).bind(epochId, baseLedgerIndex).first<ActionRow>(),
      db.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN o.operation = 'upsert' THEN 1 ELSE 0 END), 0) AS upserts,
           COALESCE(SUM(CASE WHEN o.operation = 'deleted' THEN 1 ELSE 0 END), 0) AS tombstones,
           COALESCE(SUM(CASE
             WHEN o.operation = 'upsert' AND EXISTS (
               SELECT 1 FROM object_changes c
               WHERE c.network = o.network
                 AND c.epoch_id = o.epoch_id
                 AND c.object_type = CASE o.object_type
                   WHEN 'vault' THEN 'Vault'
                   WHEN 'loan_broker' THEN 'LoanBroker'
                   WHEN 'loan' THEN 'Loan'
                 END
                 AND c.object_id = o.object_id
                 AND c.action = 'created'
                 AND c.ledger_index > ?3
             ) THEN 1 ELSE 0 END), 0) AS created_matches,
           COALESCE(SUM(CASE
             WHEN o.operation = 'upsert' AND EXISTS (
               SELECT 1 FROM object_changes c
               WHERE c.network = o.network
                 AND c.epoch_id = o.epoch_id
                 AND c.object_type = CASE o.object_type
                   WHEN 'vault' THEN 'Vault'
                   WHEN 'loan_broker' THEN 'LoanBroker'
                   WHEN 'loan' THEN 'Loan'
                 END
                 AND c.object_id = o.object_id
                 AND c.action = 'modified'
                 AND c.ledger_index > ?3
             ) THEN 1 ELSE 0 END), 0) AS modified_matches
         FROM current_state_overlay_objects o
         WHERE o.network = 'devnet' AND o.epoch_id = ?1 AND o.base_snapshot_id = ?2`,
      ).bind(epochId, baseSnapshotId, baseLedgerIndex).first<OverlayObjectRow>(),
      db.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN event_type = 'LoanPay' THEN 1 ELSE 0 END), 0) AS loan_pay,
                COALESCE(SUM(CASE WHEN event_type = 'LoanManage' THEN 1 ELSE 0 END), 0) AS loan_manage
         FROM protocol_events
         WHERE network = 'devnet' AND epoch_id = ?1 AND ledger_index > ?2`,
      ).bind(epochId, baseLedgerIndex).first<ProtocolRow>(),
      db.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN event_type = 'payment' THEN 1 ELSE 0 END), 0) AS payment,
                COALESCE(SUM(CASE WHEN event_type = 'paid' THEN 1 ELSE 0 END), 0) AS paid,
                COALESCE(SUM(CASE WHEN event_type = 'impaired' THEN 1 ELSE 0 END), 0) AS impaired,
                COALESCE(SUM(CASE WHEN event_type = 'unimpaired' THEN 1 ELSE 0 END), 0) AS unimpaired,
                COALESCE(SUM(CASE WHEN event_type = 'defaulted' THEN 1 ELSE 0 END), 0) AS defaulted,
                COALESCE(SUM(CASE WHEN event_type = 'deleted' THEN 1 ELSE 0 END), 0) AS deleted
         FROM loan_lifecycle_events
         WHERE network = 'devnet' AND epoch_id = ?1 AND ledger_index > ?2`,
      ).bind(epochId, baseLedgerIndex).first<LifecycleRow>(),
      db.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN NOT EXISTS (
                  SELECT 1 FROM current_state_overlay_objects o
                  WHERE o.network = a.network
                    AND o.epoch_id = a.epoch_id
                    AND o.base_snapshot_id = ?2
                    AND o.object_id = a.object_id
                    AND o.operation = 'deleted'
                ) THEN 1 ELSE 0 END), 0) AS missing_tombstones
         FROM archived_objects a
         WHERE a.network = 'devnet' AND a.epoch_id = ?1 AND a.deletion_ledger_index > ?3`,
      ).bind(epochId, baseSnapshotId, baseLedgerIndex).first<ArchiveRow>(),
      db.prepare(
        `SELECT COUNT(*) AS tombstones_missing_archive
         FROM current_state_overlay_objects o
         WHERE o.network = 'devnet'
           AND o.epoch_id = ?1
           AND o.base_snapshot_id = ?2
           AND o.operation = 'deleted'
           AND NOT EXISTS (
             SELECT 1 FROM archived_objects a
             WHERE a.network = o.network
               AND a.epoch_id = o.epoch_id
               AND a.object_id = o.object_id
               AND a.deletion_ledger_index > ?3
           )`,
      ).bind(epochId, baseSnapshotId, baseLedgerIndex).first<TombstoneArchiveRow>(),
      db.prepare(
        `SELECT COUNT(*) AS total
         FROM balance_history
         WHERE network = 'devnet' AND epoch_id = ?1 AND ledger_index > ?2`,
      ).bind(epochId, baseLedgerIndex).first<CountRow>(),
    ])

  return {
    cursor: {
      epochId: sync?.epoch_id ?? null,
      lastProcessedLedger: sync?.last_processed_ledger ?? null,
      lastProcessedHash: sync?.last_processed_hash ?? null,
      latestObservedLedger: sync?.latest_observed_ledger ?? null,
      latestObservedHash: sync?.latest_observed_hash ?? null,
    },
    overlay: {
      epochId: overlay?.epoch_id ?? null,
      overlayLedgerIndex: overlay?.overlay_ledger_index ?? null,
      overlayLedgerHash: overlay?.overlay_ledger_hash ?? null,
    },
    collector: {
      status: collector?.status ?? null,
      lagLedgers: collector?.lag_ledgers ?? null,
      lastSuccessAt: collector?.last_success_at ?? null,
    },
    processedLedgers: {
      count: numberValue(processed?.count),
      minimum: processed?.minimum ?? null,
      maximum: processed?.maximum ?? null,
      discontinuities: numberValue(processed?.discontinuities),
    },
    objectChanges: {
      created: numberValue(actions?.created),
      modified: numberValue(actions?.modified),
      deleted: numberValue(actions?.deleted),
    },
    overlayObjects: {
      upserts: numberValue(overlayObjects?.upserts),
      tombstones: numberValue(overlayObjects?.tombstones),
      createdMatches: numberValue(overlayObjects?.created_matches),
      modifiedMatches: numberValue(overlayObjects?.modified_matches),
    },
    protocolEvents: {
      total: numberValue(protocol?.total),
      loanPay: numberValue(protocol?.loan_pay),
      loanManage: numberValue(protocol?.loan_manage),
    },
    lifecycle: {
      total: numberValue(lifecycle?.total),
      payment: numberValue(lifecycle?.payment),
      paid: numberValue(lifecycle?.paid),
      impaired: numberValue(lifecycle?.impaired),
      unimpaired: numberValue(lifecycle?.unimpaired),
      defaulted: numberValue(lifecycle?.defaulted),
      deleted: numberValue(lifecycle?.deleted),
    },
    archives: {
      total: numberValue(archives?.total),
      missingTombstones: numberValue(archives?.missing_tombstones),
      tombstonesMissingArchive: numberValue(tombstoneArchives?.tombstones_missing_archive),
    },
    balanceHistory: {
      total: numberValue(balances?.total),
    },
  }
}
