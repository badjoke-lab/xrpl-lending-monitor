PRAGMA foreign_keys = ON;

CREATE TABLE archived_objects (
  network TEXT NOT NULL CHECK (network IN ('devnet', 'mainnet')),
  epoch_id TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('Vault', 'LoanBroker', 'Loan')),
  object_id TEXT NOT NULL,
  deletion_transaction_hash TEXT NOT NULL,
  deletion_ledger_index INTEGER NOT NULL CHECK (deletion_ledger_index >= 0),
  deletion_transaction_index INTEGER NOT NULL CHECK (deletion_transaction_index >= 0),
  deletion_close_time INTEGER NOT NULL CHECK (deletion_close_time >= 0),
  deletion_reason TEXT NOT NULL CHECK (
    deletion_reason IN ('vault_delete', 'loan_broker_delete', 'loan_delete', 'unknown')
  ),
  final_state_json TEXT NOT NULL,
  vault_id TEXT,
  loan_broker_id TEXT,
  loan_id TEXT,
  owner TEXT,
  account TEXT,
  borrower TEXT,
  asset_key TEXT,
  archived_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, object_type, object_id)
);

CREATE INDEX archived_objects_deletion_order
  ON archived_objects (network, epoch_id, deletion_ledger_index, deletion_transaction_index);

CREATE INDEX archived_objects_relationships
  ON archived_objects (network, epoch_id, vault_id, loan_broker_id, loan_id);

CREATE INDEX archived_objects_accounts
  ON archived_objects (network, epoch_id, owner, account, borrower);
