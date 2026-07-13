CREATE TABLE IF NOT EXISTS fast_lane_history_windows (
  network TEXT NOT NULL CHECK (network = 'devnet'),
  epoch_id TEXT NOT NULL,
  start_ledger_index INTEGER NOT NULL,
  end_ledger_index INTEGER NOT NULL,
  end_ledger_hash TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, start_ledger_index),
  CHECK (start_ledger_index > 0),
  CHECK (end_ledger_index >= start_ledger_index),
  CHECK (length(end_ledger_hash) = 64)
);

CREATE INDEX IF NOT EXISTS idx_fast_lane_history_windows_boundary
  ON fast_lane_history_windows (network, end_ledger_index DESC);
