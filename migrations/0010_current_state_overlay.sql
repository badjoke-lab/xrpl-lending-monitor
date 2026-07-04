PRAGMA foreign_keys = ON;

CREATE TABLE current_state_overlay_state (
  network TEXT NOT NULL CHECK (network = 'devnet'),
  epoch_id TEXT NOT NULL REFERENCES network_epochs(id),
  base_snapshot_id TEXT NOT NULL,
  base_ledger_index INTEGER NOT NULL CHECK (base_ledger_index >= 0),
  base_ledger_hash TEXT NOT NULL,
  overlay_ledger_index INTEGER NOT NULL CHECK (overlay_ledger_index >= base_ledger_index),
  overlay_ledger_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, base_snapshot_id)
);

CREATE INDEX current_state_overlay_state_watermark
  ON current_state_overlay_state (
    network,
    epoch_id,
    overlay_ledger_index DESC
  );

CREATE TABLE current_state_overlay_objects (
  network TEXT NOT NULL CHECK (network = 'devnet'),
  epoch_id TEXT NOT NULL,
  base_snapshot_id TEXT NOT NULL,
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
  on_ledger_status TEXT CHECK (
    on_ledger_status IS NULL OR
    on_ledger_status IN ('active', 'impaired', 'defaulted')
  ),
  source_ledger_index INTEGER NOT NULL CHECK (source_ledger_index >= 0),
  source_ledger_hash TEXT NOT NULL,
  source_transaction_hash TEXT NOT NULL,
  source_transaction_index INTEGER NOT NULL CHECK (source_transaction_index >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    network,
    epoch_id,
    base_snapshot_id,
    object_type,
    object_id
  ),
  FOREIGN KEY (network, epoch_id, base_snapshot_id)
    REFERENCES current_state_overlay_state(network, epoch_id, base_snapshot_id)
    ON DELETE CASCADE,
  CHECK (
    (operation = 'upsert' AND projection_json IS NOT NULL) OR
    (operation = 'deleted' AND projection_json IS NULL)
  )
);

CREATE INDEX current_state_overlay_objects_list
  ON current_state_overlay_objects (
    network,
    epoch_id,
    base_snapshot_id,
    object_type,
    operation,
    object_id
  );

CREATE INDEX current_state_overlay_objects_owner
  ON current_state_overlay_objects (
    network,
    epoch_id,
    base_snapshot_id,
    owner,
    object_type,
    operation,
    object_id
  );

CREATE INDEX current_state_overlay_objects_account
  ON current_state_overlay_objects (
    network,
    epoch_id,
    base_snapshot_id,
    account,
    object_type,
    operation,
    object_id
  );

CREATE INDEX current_state_overlay_objects_borrower
  ON current_state_overlay_objects (
    network,
    epoch_id,
    base_snapshot_id,
    borrower,
    operation,
    object_id
  );

CREATE INDEX current_state_overlay_objects_vault
  ON current_state_overlay_objects (
    network,
    epoch_id,
    base_snapshot_id,
    vault_id,
    object_type,
    operation,
    object_id
  );

CREATE INDEX current_state_overlay_objects_broker
  ON current_state_overlay_objects (
    network,
    epoch_id,
    base_snapshot_id,
    loan_broker_id,
    object_type,
    operation,
    object_id
  );

CREATE INDEX current_state_overlay_objects_asset
  ON current_state_overlay_objects (
    network,
    epoch_id,
    base_snapshot_id,
    asset_key,
    object_type,
    operation,
    object_id
  );

CREATE INDEX current_state_overlay_objects_status
  ON current_state_overlay_objects (
    network,
    epoch_id,
    base_snapshot_id,
    on_ledger_status,
    operation,
    object_id
  );

CREATE INDEX current_state_overlay_objects_ledger
  ON current_state_overlay_objects (
    network,
    epoch_id,
    base_snapshot_id,
    source_ledger_index,
    source_transaction_index,
    object_type,
    object_id
  );
