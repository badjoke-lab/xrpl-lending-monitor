PRAGMA foreign_keys = ON;

CREATE TABLE fast_lane_shadow_objects_compact (
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
) WITHOUT ROWID;
