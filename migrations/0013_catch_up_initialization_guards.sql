PRAGMA foreign_keys = ON;

CREATE TABLE catch_up_initialization_guards (
  token TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network = 'devnet'),
  expected_sync_epoch_id TEXT,
  observed_sync_epoch_id TEXT,
  expected_last_processed_ledger INTEGER,
  observed_last_processed_ledger INTEGER,
  expected_last_processed_hash TEXT,
  observed_last_processed_hash TEXT,
  expected_latest_observed_ledger INTEGER NOT NULL CHECK (expected_latest_observed_ledger >= 0),
  observed_latest_observed_ledger INTEGER NOT NULL CHECK (observed_latest_observed_ledger >= 0),
  expected_latest_observed_hash TEXT NOT NULL,
  observed_latest_observed_hash TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  CHECK (COALESCE(observed_sync_epoch_id, '') = COALESCE(expected_sync_epoch_id, '')),
  CHECK (COALESCE(observed_last_processed_ledger, -1) = COALESCE(expected_last_processed_ledger, -1)),
  CHECK (COALESCE(observed_last_processed_hash, '') = COALESCE(expected_last_processed_hash, '')),
  CHECK (observed_latest_observed_ledger = expected_latest_observed_ledger),
  CHECK (observed_latest_observed_hash = expected_latest_observed_hash)
);
