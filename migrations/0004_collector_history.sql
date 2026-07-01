PRAGMA foreign_keys = ON;

CREATE TABLE processed_ledgers (
  network TEXT NOT NULL CHECK (network IN ('devnet', 'mainnet')),
  epoch_id TEXT NOT NULL REFERENCES network_epochs(id),
  ledger_index INTEGER NOT NULL CHECK (ledger_index >= 0),
  ledger_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  close_time INTEGER NOT NULL CHECK (close_time >= 0),
  inspected_count INTEGER NOT NULL CHECK (inspected_count >= 0),
  matched_count INTEGER NOT NULL CHECK (matched_count >= 0),
  endpoint TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, ledger_index),
  UNIQUE (network, epoch_id, ledger_hash)
);
