PRAGMA foreign_keys = ON;

CREATE TABLE loan_lifecycle_events (
  network TEXT NOT NULL CHECK (network IN ('devnet', 'mainnet')),
  epoch_id TEXT NOT NULL,
  loan_id TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  ledger_index INTEGER NOT NULL CHECK (ledger_index >= 0),
  transaction_index INTEGER NOT NULL CHECK (transaction_index >= 0),
  close_time INTEGER NOT NULL CHECK (close_time >= 0),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'created',
      'payment',
      'paid',
      'impaired',
      'unimpaired',
      'defaulted',
      'deleted',
      'updated'
    )
  ),
  transaction_type TEXT NOT NULL,
  result_code TEXT NOT NULL,
  status_before TEXT NOT NULL,
  status_after TEXT NOT NULL,
  principal_before TEXT,
  principal_after TEXT,
  total_value_before TEXT,
  total_value_after TEXT,
  payment_remaining_before INTEGER CHECK (
    payment_remaining_before IS NULL OR payment_remaining_before >= 0
  ),
  payment_remaining_after INTEGER CHECK (
    payment_remaining_after IS NULL OR payment_remaining_after >= 0
  ),
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, loan_id, transaction_hash, event_type)
);

CREATE INDEX loan_lifecycle_order
  ON loan_lifecycle_events (network, epoch_id, loan_id, ledger_index, transaction_index);

CREATE INDEX loan_lifecycle_event_type
  ON loan_lifecycle_events (network, epoch_id, event_type, close_time DESC);
