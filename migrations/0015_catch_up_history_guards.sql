PRAGMA foreign_keys = ON;

CREATE TABLE catch_up_history_guards (
  token TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network = 'devnet'),
  expected_processed_ledger_count INTEGER NOT NULL CHECK (expected_processed_ledger_count >= 0),
  observed_processed_ledger_count INTEGER NOT NULL CHECK (observed_processed_ledger_count >= 0),
  checked_at TEXT NOT NULL,
  CHECK (observed_processed_ledger_count = expected_processed_ledger_count)
);
