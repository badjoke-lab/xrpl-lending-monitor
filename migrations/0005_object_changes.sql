PRAGMA foreign_keys = ON;

CREATE TABLE object_changes (
  network TEXT NOT NULL CHECK (network IN ('devnet', 'mainnet')),
  epoch_id TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  ledger_index INTEGER NOT NULL CHECK (ledger_index >= 0),
  transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
  transaction_type TEXT NOT NULL,
  result_code TEXT NOT NULL,
  close_time INTEGER NOT NULL CHECK (close_time >= 0),
  node_index INTEGER NOT NULL CHECK (node_index >= 0),
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'modified', 'deleted')),
  field_name TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  value_type TEXT NOT NULL CHECK (
    value_type IN ('null', 'string', 'number', 'boolean', 'array', 'object')
  ),
  unsupported_field INTEGER NOT NULL DEFAULT 0 CHECK (unsupported_field IN (0, 1)),
  vault_id TEXT,
  loan_broker_id TEXT,
  loan_id TEXT,
  account TEXT,
  owner TEXT,
  borrower TEXT,
  asset_key TEXT,
  mpt_issuance_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    network, epoch_id, transaction_hash, node_index, object_id, field_name, action
  )
);

CREATE INDEX object_changes_object_history
  ON object_changes (network, epoch_id, object_type, object_id, ledger_index, transaction_index);

CREATE INDEX object_changes_transaction
  ON object_changes (network, epoch_id, transaction_hash, node_index);

CREATE INDEX object_changes_relationships
  ON object_changes (network, epoch_id, vault_id, loan_broker_id, loan_id);
