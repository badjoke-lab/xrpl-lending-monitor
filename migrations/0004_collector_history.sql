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

CREATE INDEX processed_ledgers_close_time
  ON processed_ledgers (network, epoch_id, close_time DESC);

CREATE TABLE protocol_events (
  network TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  ledger_index INTEGER NOT NULL,
  event_index INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  result_code TEXT NOT NULL,
  source_json TEXT,
  metadata_json TEXT,
  payload_retained INTEGER NOT NULL DEFAULT 1 CHECK (payload_retained IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, event_hash)
);

CREATE UNIQUE INDEX protocol_events_ledger_order
  ON protocol_events (network, epoch_id, ledger_index, event_index);
