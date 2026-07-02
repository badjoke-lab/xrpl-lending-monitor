PRAGMA foreign_keys = ON;

CREATE TABLE balance_history (
  network TEXT NOT NULL CHECK (network IN ('devnet', 'mainnet')),
  epoch_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('Vault', 'LoanBroker')),
  subject_id TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  ledger_index INTEGER NOT NULL CHECK (ledger_index >= 0),
  transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
  close_time INTEGER NOT NULL CHECK (close_time >= 0),
  metric_type TEXT NOT NULL CHECK (
    metric_type IN (
      'debt_total',
      'debt_maximum',
      'cover_available',
      'loss_unrealized',
      'required_minimum_cover',
      'cover_surplus'
    )
  ),
  asset_key TEXT,
  before_value TEXT,
  after_value TEXT,
  formula TEXT,
  source_fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, subject_type, subject_id, transaction_hash, metric_type)
);

CREATE INDEX balance_history_subject_order
  ON balance_history (network, epoch_id, subject_type, subject_id, ledger_index, transaction_index);

CREATE INDEX balance_history_metric_asset
  ON balance_history (network, epoch_id, metric_type, asset_key, close_time DESC);
