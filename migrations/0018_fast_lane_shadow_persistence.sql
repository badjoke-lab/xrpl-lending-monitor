PRAGMA foreign_keys = ON;

CREATE TABLE fast_lane_shadow_state (
  network TEXT PRIMARY KEY CHECK (network = 'devnet'),
  epoch_id TEXT NOT NULL,
  last_processed_ledger INTEGER NOT NULL CHECK (last_processed_ledger >= 0),
  last_processed_hash TEXT NOT NULL,
  latest_observed_ledger INTEGER NOT NULL CHECK (latest_observed_ledger >= 0),
  latest_observed_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'behind', 'error')),
  updated_at TEXT NOT NULL
);

CREATE TABLE fast_lane_shadow_commit_guards (
  commit_token TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network = 'devnet'),
  expected_ledger INTEGER NOT NULL CHECK (expected_ledger >= 0),
  expected_hash TEXT NOT NULL,
  observed_ledger INTEGER NOT NULL CHECK (observed_ledger >= 0),
  observed_hash TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  CHECK (expected_ledger = observed_ledger),
  CHECK (expected_hash = observed_hash)
);

CREATE TABLE fast_lane_shadow_objects (
  network TEXT NOT NULL CHECK (network = 'devnet'),
  epoch_id TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('vault', 'loan_broker', 'loan')),
  object_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'deleted')),
  projection_json TEXT,
  owner TEXT,
  account TEXT,
  borrower TEXT,
  vault_id TEXT,
  loan_broker_id TEXT,
  asset_key TEXT,
  on_ledger_status TEXT,
  source_ledger_index INTEGER NOT NULL CHECK (source_ledger_index >= 0),
  source_ledger_hash TEXT NOT NULL,
  source_transaction_hash TEXT NOT NULL,
  source_transaction_index INTEGER NOT NULL CHECK (source_transaction_index >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, object_type, object_id),
  CHECK (
    (operation = 'upsert' AND projection_json IS NOT NULL)
    OR (operation = 'deleted' AND projection_json IS NULL)
  )
);

CREATE INDEX fast_lane_shadow_objects_source
  ON fast_lane_shadow_objects (network, epoch_id, source_ledger_index, source_transaction_index);

CREATE TABLE fast_lane_shadow_windows (
  network TEXT NOT NULL CHECK (network = 'devnet'),
  epoch_id TEXT NOT NULL,
  window_start_close_time INTEGER NOT NULL CHECK (window_start_close_time >= 0),
  window_end_close_time INTEGER NOT NULL CHECK (window_end_close_time >= window_start_close_time),
  start_ledger_index INTEGER NOT NULL CHECK (start_ledger_index >= 0),
  end_ledger_index INTEGER NOT NULL CHECK (end_ledger_index >= start_ledger_index),
  end_ledger_hash TEXT NOT NULL,
  inspected_transaction_count INTEGER NOT NULL CHECK (inspected_transaction_count >= 0),
  lending_transaction_count INTEGER NOT NULL CHECK (lending_transaction_count >= 0),
  successful_lending_transaction_count INTEGER NOT NULL CHECK (successful_lending_transaction_count >= 0),
  affected_object_count INTEGER NOT NULL CHECK (affected_object_count >= 0),
  activity_bundle_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, window_start_close_time)
);

CREATE INDEX fast_lane_shadow_windows_latest
  ON fast_lane_shadow_windows (network, epoch_id, window_end_close_time DESC);
