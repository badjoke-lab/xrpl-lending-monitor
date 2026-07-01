PRAGMA foreign_keys = ON;

CREATE TABLE network_epochs (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network IN ('devnet', 'mainnet')),
  status TEXT NOT NULL CHECK (status IN ('current', 'archived')),
  first_ledger_index INTEGER NOT NULL CHECK (first_ledger_index >= 0),
  first_ledger_hash TEXT NOT NULL,
  last_ledger_index INTEGER CHECK (last_ledger_index IS NULL OR last_ledger_index >= first_ledger_index),
  last_ledger_hash TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  reset_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX network_epochs_one_current_per_network
  ON network_epochs (network)
  WHERE status = 'current';

CREATE INDEX network_epochs_network_started_at
  ON network_epochs (network, started_at DESC);

CREATE TABLE sync_state (
  network TEXT PRIMARY KEY CHECK (network IN ('devnet', 'mainnet')),
  epoch_id TEXT REFERENCES network_epochs(id),
  last_processed_ledger INTEGER CHECK (last_processed_ledger IS NULL OR last_processed_ledger >= 0),
  last_processed_hash TEXT,
  latest_observed_ledger INTEGER CHECK (latest_observed_ledger IS NULL OR latest_observed_ledger >= 0),
  latest_observed_hash TEXT,
  latest_ledger_age_seconds INTEGER CHECK (
    latest_ledger_age_seconds IS NULL OR latest_ledger_age_seconds >= 0
  ),
  last_attempt_at TEXT,
  last_success_at TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('uninitialized', 'healthy', 'stale', 'error', 'reset_suspected')
  ),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  endpoint TEXT,
  server_version TEXT,
  server_state TEXT,
  complete_ledgers TEXT,
  lending_protocol_enabled INTEGER CHECK (
    lending_protocol_enabled IS NULL OR lending_protocol_enabled IN (0, 1)
  ),
  lending_protocol_supported INTEGER CHECK (
    lending_protocol_supported IS NULL OR lending_protocol_supported IN (0, 1)
  ),
  single_asset_vault_enabled INTEGER CHECK (
    single_asset_vault_enabled IS NULL OR single_asset_vault_enabled IN (0, 1)
  ),
  single_asset_vault_supported INTEGER CHECK (
    single_asset_vault_supported IS NULL OR single_asset_vault_supported IN (0, 1)
  ),
  reset_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX sync_state_epoch_id ON sync_state (epoch_id);
