import type {
  NetworkEpochRecord,
  StoredSyncState,
  SuccessfulStatusPlan,
  SyncHealth,
} from '../../domain/network/status'
import type { ResetReason } from '../../domain/epoch/reset-detection'

interface SyncStateRow {
  network: string
  epoch_id: string | null
  last_processed_ledger: number | null
  last_processed_hash: string | null
  latest_observed_ledger: number | null
  latest_observed_hash: string | null
  latest_ledger_age_seconds: number | null
  last_attempt_at: string | null
  last_success_at: string | null
  status: string
  consecutive_failures: number
  endpoint: string | null
  server_version: string | null
  server_state: string | null
  complete_ledgers: string | null
  lending_protocol_enabled: number | null
  lending_protocol_supported: number | null
  single_asset_vault_enabled: number | null
  single_asset_vault_supported: number | null
  reset_reason: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

interface EpochRow {
  id: string
  network: string
  status: string
  first_ledger_index: number
  first_ledger_hash: string
  last_ledger_index: number | null
  last_ledger_hash: string | null
  started_at: string
  ended_at: string | null
  reset_reason: string | null
  created_at: string
  updated_at: string
}

function booleanFromInteger(value: number | null): boolean | null {
  if (value === null) return null
  return value === 1
}

function integerFromBoolean(value: boolean | null): number | null {
  if (value === null) return null
  return value ? 1 : 0
}

function mapSyncState(row: SyncStateRow): StoredSyncState {
  return {
    network: 'devnet',
    epochId: row.epoch_id,
    lastProcessedLedger: row.last_processed_ledger,
    lastProcessedHash: row.last_processed_hash,
    latestObservedLedger: row.latest_observed_ledger,
    latestObservedHash: row.latest_observed_hash,
    latestLedgerAgeSeconds: row.latest_ledger_age_seconds,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    status: row.status as SyncHealth,
    consecutiveFailures: row.consecutive_failures,
    endpoint: row.endpoint,
    serverVersion: row.server_version,
    serverState: row.server_state,
    completeLedgers: row.complete_ledgers,
    lendingProtocolEnabled: booleanFromInteger(row.lending_protocol_enabled),
    lendingProtocolSupported: booleanFromInteger(row.lending_protocol_supported),
    singleAssetVaultEnabled: booleanFromInteger(row.single_asset_vault_enabled),
    singleAssetVaultSupported: booleanFromInteger(row.single_asset_vault_supported),
    resetReason: row.reset_reason as ResetReason | null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEpoch(row: EpochRow): NetworkEpochRecord {
  return {
    id: row.id,
    network: 'devnet',
    status: row.status as 'current' | 'archived',
    firstLedgerIndex: row.first_ledger_index,
    firstLedgerHash: row.first_ledger_hash,
    lastLedgerIndex: row.last_ledger_index,
    lastLedgerHash: row.last_ledger_hash,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    resetReason: row.reset_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getSyncState(db: D1Database): Promise<StoredSyncState | null> {
  const row = await db
    .prepare('SELECT * FROM sync_state WHERE network = ?1')
    .bind('devnet')
    .first<SyncStateRow>()

  return row ? mapSyncState(row) : null
}

export async function getCurrentEpoch(db: D1Database): Promise<NetworkEpochRecord | null> {
  const row = await db
    .prepare(
      "SELECT * FROM network_epochs WHERE network = ?1 AND status = 'current' LIMIT 1",
    )
    .bind('devnet')
    .first<EpochRow>()

  return row ? mapEpoch(row) : null
}

function insertEpochStatement(db: D1Database, epoch: NetworkEpochRecord): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO network_epochs (
        id, network, status, first_ledger_index, first_ledger_hash,
        last_ledger_index, last_ledger_hash, started_at, ended_at,
        reset_reason, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      epoch.id,
      epoch.network,
      epoch.status,
      epoch.firstLedgerIndex,
      epoch.firstLedgerHash,
      epoch.lastLedgerIndex,
      epoch.lastLedgerHash,
      epoch.startedAt,
      epoch.endedAt,
      epoch.resetReason,
      epoch.createdAt,
      epoch.updatedAt,
    )
}

function upsertSyncStateStatement(
  db: D1Database,
  state: StoredSyncState,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sync_state (
        network, epoch_id, last_processed_ledger, last_processed_hash,
        latest_observed_ledger, latest_observed_hash, latest_ledger_age_seconds,
        last_attempt_at, last_success_at, status, consecutive_failures,
        endpoint, server_version, server_state, complete_ledgers,
        lending_protocol_enabled, lending_protocol_supported,
        single_asset_vault_enabled, single_asset_vault_supported,
        reset_reason, error_code, error_message, created_at, updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
        ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24
      )
      ON CONFLICT(network) DO UPDATE SET
        epoch_id = excluded.epoch_id,
        last_processed_ledger = excluded.last_processed_ledger,
        last_processed_hash = excluded.last_processed_hash,
        latest_observed_ledger = excluded.latest_observed_ledger,
        latest_observed_hash = excluded.latest_observed_hash,
        latest_ledger_age_seconds = excluded.latest_ledger_age_seconds,
        last_attempt_at = excluded.last_attempt_at,
        last_success_at = excluded.last_success_at,
        status = excluded.status,
        consecutive_failures = excluded.consecutive_failures,
        endpoint = excluded.endpoint,
        server_version = excluded.server_version,
        server_state = excluded.server_state,
        complete_ledgers = excluded.complete_ledgers,
        lending_protocol_enabled = excluded.lending_protocol_enabled,
        lending_protocol_supported = excluded.lending_protocol_supported,
        single_asset_vault_enabled = excluded.single_asset_vault_enabled,
        single_asset_vault_supported = excluded.single_asset_vault_supported,
        reset_reason = excluded.reset_reason,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at`,
    )
    .bind(
      state.network,
      state.epochId,
      state.lastProcessedLedger,
      state.lastProcessedHash,
      state.latestObservedLedger,
      state.latestObservedHash,
      state.latestLedgerAgeSeconds,
      state.lastAttemptAt,
      state.lastSuccessAt,
      state.status,
      state.consecutiveFailures,
      state.endpoint,
      state.serverVersion,
      state.serverState,
      state.completeLedgers,
      integerFromBoolean(state.lendingProtocolEnabled),
      integerFromBoolean(state.lendingProtocolSupported),
      integerFromBoolean(state.singleAssetVaultEnabled),
      integerFromBoolean(state.singleAssetVaultSupported),
      state.resetReason,
      state.errorCode,
      state.errorMessage,
      state.createdAt,
      state.updatedAt,
    )
}

export async function saveSuccessfulStatus(
  db: D1Database,
  plan: SuccessfulStatusPlan,
): Promise<void> {
  const statements: D1PreparedStatement[] = []

  if (plan.newEpoch) {
    statements.push(insertEpochStatement(db, plan.newEpoch))
  }

  statements.push(upsertSyncStateStatement(db, plan.state))

  if (plan.state.epochId && plan.state.status !== 'reset_suspected') {
    statements.push(
      db
        .prepare(
          `UPDATE network_epochs
           SET last_ledger_index = ?1,
               last_ledger_hash = ?2,
               updated_at = ?3
           WHERE id = ?4 AND status = 'current'`,
        )
        .bind(
          plan.state.latestObservedLedger,
          plan.state.latestObservedHash,
          plan.state.updatedAt,
          plan.state.epochId,
        ),
    )
  }

  await db.batch(statements)
}

export async function saveFailedStatus(
  db: D1Database,
  state: StoredSyncState,
): Promise<void> {
  await upsertSyncStateStatement(db, state).run()
}
