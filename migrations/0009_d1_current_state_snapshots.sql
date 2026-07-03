PRAGMA foreign_keys = ON;

CREATE TABLE current_state_d1_snapshots (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network = 'devnet'),
  epoch_id TEXT NOT NULL REFERENCES network_epochs(id),
  status TEXT NOT NULL CHECK (status IN ('building', 'verified', 'failed', 'superseded')),
  ledger_index INTEGER NOT NULL CHECK (ledger_index >= 0),
  ledger_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  decoded_object_count INTEGER NOT NULL DEFAULT 0 CHECK (decoded_object_count >= 0),
  object_count INTEGER NOT NULL DEFAULT 0 CHECK (object_count >= 0),
  vault_count INTEGER NOT NULL DEFAULT 0 CHECK (vault_count >= 0),
  loan_broker_count INTEGER NOT NULL DEFAULT 0 CHECK (loan_broker_count >= 0),
  loan_count INTEGER NOT NULL DEFAULT 0 CHECK (loan_count >= 0),
  batch_count INTEGER NOT NULL DEFAULT 0 CHECK (batch_count >= 0),
  normalized_bytes INTEGER NOT NULL DEFAULT 0 CHECK (normalized_bytes >= 0),
  manifest_hash TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX current_state_d1_snapshots_epoch_ledger
  ON current_state_d1_snapshots (network, epoch_id, ledger_index DESC);

CREATE INDEX current_state_d1_snapshots_status
  ON current_state_d1_snapshots (network, epoch_id, status, updated_at DESC);

CREATE TABLE current_state_d1_snapshot_manifests (
  snapshot_id TEXT PRIMARY KEY
    REFERENCES current_state_d1_snapshots(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  batch_count INTEGER NOT NULL CHECK (batch_count >= 0),
  object_count INTEGER NOT NULL CHECK (object_count >= 0),
  vault_count INTEGER NOT NULL CHECK (vault_count >= 0),
  loan_broker_count INTEGER NOT NULL CHECK (loan_broker_count >= 0),
  loan_count INTEGER NOT NULL CHECK (loan_count >= 0),
  normalized_bytes INTEGER NOT NULL CHECK (normalized_bytes >= 0),
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE current_state_d1_batches (
  snapshot_id TEXT NOT NULL
    REFERENCES current_state_d1_snapshots(id) ON DELETE CASCADE,
  batch_sequence INTEGER NOT NULL CHECK (batch_sequence > 0),
  marker_before_json TEXT,
  marker_after_json TEXT,
  first_object_id TEXT,
  last_object_id TEXT,
  decoded_object_count INTEGER NOT NULL CHECK (decoded_object_count >= 0),
  object_count INTEGER NOT NULL CHECK (object_count >= 0),
  vault_count INTEGER NOT NULL CHECK (vault_count >= 0),
  loan_broker_count INTEGER NOT NULL CHECK (loan_broker_count >= 0),
  loan_count INTEGER NOT NULL CHECK (loan_count >= 0),
  normalized_bytes INTEGER NOT NULL CHECK (normalized_bytes >= 0),
  batch_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, batch_sequence)
);

CREATE INDEX current_state_d1_batches_object_range
  ON current_state_d1_batches (snapshot_id, first_object_id, last_object_id);

CREATE TABLE current_state_d1_vaults (
  snapshot_id TEXT NOT NULL
    REFERENCES current_state_d1_snapshots(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  batch_sequence INTEGER NOT NULL CHECK (batch_sequence > 0),
  object_hash TEXT NOT NULL,
  owner TEXT NOT NULL,
  account TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  has_unrealized_loss INTEGER NOT NULL CHECK (has_unrealized_loss IN (0, 1)),
  projection_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  normalized_bytes INTEGER NOT NULL CHECK (normalized_bytes >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, object_id),
  FOREIGN KEY (snapshot_id, batch_sequence)
    REFERENCES current_state_d1_batches(snapshot_id, batch_sequence)
    ON DELETE CASCADE
);

CREATE INDEX current_state_d1_vaults_owner
  ON current_state_d1_vaults (snapshot_id, owner, object_id);

CREATE INDEX current_state_d1_vaults_account
  ON current_state_d1_vaults (snapshot_id, account, object_id);

CREATE INDEX current_state_d1_vaults_asset
  ON current_state_d1_vaults (snapshot_id, asset_key, object_id);

CREATE INDEX current_state_d1_vaults_loss
  ON current_state_d1_vaults (snapshot_id, has_unrealized_loss, object_id);

CREATE TABLE current_state_d1_loan_brokers (
  snapshot_id TEXT NOT NULL
    REFERENCES current_state_d1_snapshots(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  batch_sequence INTEGER NOT NULL CHECK (batch_sequence > 0),
  object_hash TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  account TEXT NOT NULL,
  projection_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  normalized_bytes INTEGER NOT NULL CHECK (normalized_bytes >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, object_id),
  FOREIGN KEY (snapshot_id, batch_sequence)
    REFERENCES current_state_d1_batches(snapshot_id, batch_sequence)
    ON DELETE CASCADE
);

CREATE INDEX current_state_d1_loan_brokers_vault
  ON current_state_d1_loan_brokers (snapshot_id, vault_id, object_id);

CREATE INDEX current_state_d1_loan_brokers_owner
  ON current_state_d1_loan_brokers (snapshot_id, owner, object_id);

CREATE INDEX current_state_d1_loan_brokers_account
  ON current_state_d1_loan_brokers (snapshot_id, account, object_id);

CREATE TABLE current_state_d1_loans (
  snapshot_id TEXT NOT NULL
    REFERENCES current_state_d1_snapshots(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  batch_sequence INTEGER NOT NULL CHECK (batch_sequence > 0),
  object_hash TEXT NOT NULL,
  loan_broker_id TEXT NOT NULL,
  borrower TEXT NOT NULL,
  on_ledger_status TEXT NOT NULL CHECK (on_ledger_status IN ('active', 'impaired', 'defaulted')),
  projection_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  normalized_bytes INTEGER NOT NULL CHECK (normalized_bytes >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, object_id),
  FOREIGN KEY (snapshot_id, batch_sequence)
    REFERENCES current_state_d1_batches(snapshot_id, batch_sequence)
    ON DELETE CASCADE
);

CREATE INDEX current_state_d1_loans_broker
  ON current_state_d1_loans (snapshot_id, loan_broker_id, object_id);

CREATE INDEX current_state_d1_loans_borrower
  ON current_state_d1_loans (snapshot_id, borrower, object_id);

CREATE INDEX current_state_d1_loans_status
  ON current_state_d1_loans (snapshot_id, on_ledger_status, object_id);

CREATE TABLE current_state_d1_active_snapshots (
  network TEXT PRIMARY KEY CHECK (network = 'devnet'),
  epoch_id TEXT NOT NULL REFERENCES network_epochs(id),
  snapshot_id TEXT NOT NULL
    REFERENCES current_state_d1_snapshots(id),
  rollback_snapshot_id TEXT
    REFERENCES current_state_d1_snapshots(id),
  activated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (rollback_snapshot_id IS NULL OR rollback_snapshot_id <> snapshot_id)
);

CREATE UNIQUE INDEX current_state_d1_active_epoch
  ON current_state_d1_active_snapshots (network, epoch_id);

CREATE TABLE current_state_d1_bootstrap_checkpoints (
  snapshot_id TEXT PRIMARY KEY
    REFERENCES current_state_d1_snapshots(id) ON DELETE CASCADE,
  marker_json TEXT,
  next_batch_sequence INTEGER NOT NULL CHECK (next_batch_sequence > 0),
  scan_complete INTEGER NOT NULL CHECK (scan_complete IN (0, 1)),
  metrics_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX current_state_d1_checkpoint_updated
  ON current_state_d1_bootstrap_checkpoints (updated_at);

CREATE TABLE current_state_d1_cleanup_eligibility (
  snapshot_id TEXT PRIMARY KEY
    REFERENCES current_state_d1_snapshots(id) ON DELETE CASCADE,
  eligible_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX current_state_d1_cleanup_eligible_at
  ON current_state_d1_cleanup_eligibility (eligible_at);
