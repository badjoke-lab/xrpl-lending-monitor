PRAGMA foreign_keys = ON;

CREATE TABLE current_state_snapshots (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network IN ('devnet', 'mainnet')),
  epoch_id TEXT NOT NULL REFERENCES network_epochs(id),
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded')),
  ledger_index INTEGER NOT NULL CHECK (ledger_index >= 0),
  ledger_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  storage_backend TEXT NOT NULL CHECK (storage_backend = 'r2_shards'),
  object_prefix TEXT NOT NULL,
  manifest_key TEXT,
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  decoded_object_count INTEGER NOT NULL DEFAULT 0 CHECK (decoded_object_count >= 0),
  object_count INTEGER NOT NULL DEFAULT 0 CHECK (object_count >= 0),
  vault_count INTEGER NOT NULL DEFAULT 0 CHECK (vault_count >= 0),
  loan_broker_count INTEGER NOT NULL DEFAULT 0 CHECK (loan_broker_count >= 0),
  loan_count INTEGER NOT NULL DEFAULT 0 CHECK (loan_count >= 0),
  shard_count INTEGER NOT NULL DEFAULT 0 CHECK (shard_count >= 0),
  compressed_bytes INTEGER NOT NULL DEFAULT 0 CHECK (compressed_bytes >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX current_state_one_active_snapshot
  ON current_state_snapshots (network, epoch_id)
  WHERE status = 'active';

CREATE INDEX current_state_snapshots_ledger
  ON current_state_snapshots (network, epoch_id, ledger_index DESC);
