PRAGMA foreign_keys = ON;

CREATE TABLE catch_up_epoch_guards (
  token TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network = 'devnet'),
  expected_current_epoch_id TEXT,
  observed_current_epoch_id TEXT,
  expected_base_epoch_count INTEGER NOT NULL CHECK (expected_base_epoch_count >= 0),
  observed_base_epoch_count INTEGER NOT NULL CHECK (observed_base_epoch_count >= 0),
  checked_at TEXT NOT NULL,
  CHECK (COALESCE(observed_current_epoch_id, '') = COALESCE(expected_current_epoch_id, '')),
  CHECK (observed_base_epoch_count = expected_base_epoch_count)
);
