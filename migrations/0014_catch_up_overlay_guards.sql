PRAGMA foreign_keys = ON;

CREATE TABLE catch_up_overlay_guards (
  token TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network = 'devnet'),
  expected_epoch_id TEXT,
  observed_epoch_id TEXT,
  expected_base_snapshot_id TEXT,
  observed_base_snapshot_id TEXT,
  expected_overlay_ledger_index INTEGER,
  observed_overlay_ledger_index INTEGER,
  expected_overlay_ledger_hash TEXT,
  observed_overlay_ledger_hash TEXT,
  checked_at TEXT NOT NULL,
  CHECK (COALESCE(observed_epoch_id, '') = COALESCE(expected_epoch_id, '')),
  CHECK (COALESCE(observed_base_snapshot_id, '') = COALESCE(expected_base_snapshot_id, '')),
  CHECK (COALESCE(observed_overlay_ledger_index, -1) = COALESCE(expected_overlay_ledger_index, -1)),
  CHECK (COALESCE(observed_overlay_ledger_hash, '') = COALESCE(expected_overlay_ledger_hash, ''))
);
