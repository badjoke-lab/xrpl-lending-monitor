PRAGMA foreign_keys = ON;

CREATE TABLE current_state_snapshots (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL CHECK (network IN ('devnet', 'mainnet')),
  epoch_id TEXT NOT NULL REFERENCES network_epochs(id),
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded')),
  ledger_index INTEGER NOT NULL CHECK (ledger_index >= 0),
  ledger_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  object_count INTEGER NOT NULL DEFAULT 0 CHECK (object_count >= 0),
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

CREATE TABLE vaults_current (
  snapshot_id TEXT NOT NULL REFERENCES current_state_snapshots(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  account TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('xrp', 'iou', 'mpt')),
  asset_key TEXT NOT NULL,
  asset_json TEXT NOT NULL,
  assets_total TEXT NOT NULL,
  assets_available TEXT NOT NULL,
  assets_maximum TEXT,
  loss_unrealized TEXT NOT NULL,
  share_mpt_id TEXT NOT NULL,
  domain_id TEXT,
  withdrawal_policy INTEGER NOT NULL,
  scale INTEGER NOT NULL,
  flags INTEGER NOT NULL,
  data_hex TEXT,
  previous_tx_hash TEXT NOT NULL,
  previous_ledger_index INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, vault_id)
);

CREATE INDEX vaults_current_asset
  ON vaults_current (snapshot_id, asset_key, vault_id);
CREATE INDEX vaults_current_owner
  ON vaults_current (snapshot_id, owner, vault_id);

CREATE TABLE loan_brokers_current (
  snapshot_id TEXT NOT NULL REFERENCES current_state_snapshots(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  loan_broker_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  account TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  loan_sequence INTEGER NOT NULL,
  management_fee_rate INTEGER,
  owner_count INTEGER NOT NULL,
  debt_total TEXT NOT NULL,
  debt_maximum TEXT,
  cover_available TEXT NOT NULL,
  cover_rate_minimum INTEGER NOT NULL,
  cover_rate_liquidation INTEGER NOT NULL,
  flags INTEGER NOT NULL,
  data_hex TEXT,
  previous_tx_hash TEXT NOT NULL,
  previous_ledger_index INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, loan_broker_id),
  FOREIGN KEY (snapshot_id, vault_id) REFERENCES vaults_current(snapshot_id, vault_id)
);

CREATE INDEX loan_brokers_current_vault
  ON loan_brokers_current (snapshot_id, vault_id, loan_broker_id);
CREATE INDEX loan_brokers_current_owner
  ON loan_brokers_current (snapshot_id, owner, loan_broker_id);

CREATE TABLE loans_current (
  snapshot_id TEXT NOT NULL REFERENCES current_state_snapshots(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  loan_id TEXT NOT NULL,
  loan_broker_id TEXT NOT NULL,
  borrower TEXT NOT NULL,
  loan_sequence INTEGER NOT NULL,
  loan_origination_fee TEXT NOT NULL,
  loan_service_fee TEXT NOT NULL,
  late_payment_fee TEXT NOT NULL,
  close_payment_fee TEXT NOT NULL,
  overpayment_fee_rate INTEGER NOT NULL,
  interest_rate INTEGER NOT NULL,
  late_interest_rate INTEGER NOT NULL,
  close_interest_rate INTEGER NOT NULL,
  overpayment_interest_rate INTEGER NOT NULL,
  start_date INTEGER NOT NULL,
  payment_interval INTEGER NOT NULL,
  grace_period INTEGER NOT NULL,
  previous_payment_due_date INTEGER NOT NULL,
  next_payment_due_date INTEGER NOT NULL,
  payment_remaining INTEGER NOT NULL,
  principal_outstanding TEXT NOT NULL,
  total_value_outstanding TEXT NOT NULL,
  management_fee_outstanding TEXT NOT NULL,
  periodic_payment TEXT NOT NULL,
  loan_scale INTEGER,
  on_ledger_status TEXT NOT NULL CHECK (on_ledger_status IN ('active', 'impaired', 'defaulted')),
  supports_overpayment INTEGER NOT NULL CHECK (supports_overpayment IN (0, 1)),
  flags INTEGER NOT NULL,
  data_hex TEXT,
  previous_tx_hash TEXT NOT NULL,
  previous_ledger_index INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, loan_id),
  FOREIGN KEY (snapshot_id, loan_broker_id)
    REFERENCES loan_brokers_current(snapshot_id, loan_broker_id)
);

CREATE INDEX loans_current_broker
  ON loans_current (snapshot_id, loan_broker_id, loan_id);
CREATE INDEX loans_current_borrower
  ON loans_current (snapshot_id, borrower, loan_id);
CREATE INDEX loans_current_status
  ON loans_current (snapshot_id, on_ledger_status, loan_id);
