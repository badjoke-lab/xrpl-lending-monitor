PRAGMA foreign_keys = ON;

CREATE TABLE current_state_overlay_commit_guards (
  commit_token TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network = 'devnet'),
  epoch_id TEXT NOT NULL,
  base_snapshot_id TEXT NOT NULL,
  expected_base_ledger_index INTEGER NOT NULL CHECK (expected_base_ledger_index >= 0),
  expected_base_ledger_hash TEXT NOT NULL,
  observed_base_ledger_index INTEGER NOT NULL CHECK (observed_base_ledger_index >= 0),
  observed_base_ledger_hash TEXT NOT NULL,
  expected_overlay_ledger_index INTEGER NOT NULL CHECK (expected_overlay_ledger_index >= 0),
  expected_overlay_ledger_hash TEXT NOT NULL,
  observed_overlay_ledger_index INTEGER NOT NULL CHECK (observed_overlay_ledger_index >= 0),
  observed_overlay_ledger_hash TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (network, epoch_id, base_snapshot_id)
    REFERENCES current_state_overlay_state(network, epoch_id, base_snapshot_id)
    ON DELETE CASCADE,
  CHECK (observed_base_ledger_index = expected_base_ledger_index),
  CHECK (observed_base_ledger_hash = expected_base_ledger_hash),
  CHECK (observed_overlay_ledger_index = expected_overlay_ledger_index),
  CHECK (observed_overlay_ledger_hash = expected_overlay_ledger_hash)
);

CREATE INDEX current_state_overlay_commit_guards_scope
  ON current_state_overlay_commit_guards (
    network,
    epoch_id,
    base_snapshot_id,
    checked_at
  );
