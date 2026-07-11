PRAGMA foreign_keys = ON;

CREATE TABLE fast_lane_shadow_run_metrics (
  network TEXT NOT NULL CHECK (network = 'devnet'),
  run_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('caught_up', 'committed', 'reanchored', 'error')),
  start_ledger_index INTEGER,
  end_ledger_index INTEGER,
  latest_observed_ledger INTEGER NOT NULL CHECK (latest_observed_ledger >= 0),
  lag_ledgers INTEGER NOT NULL CHECK (lag_ledgers >= 0),
  ledgers_processed INTEGER NOT NULL CHECK (ledgers_processed >= 0),
  lending_transactions INTEGER NOT NULL CHECK (lending_transactions >= 0),
  coalesced_object_rows INTEGER NOT NULL CHECK (coalesced_object_rows >= 0),
  persistence_rows_read INTEGER NOT NULL CHECK (persistence_rows_read >= 0),
  persistence_rows_written INTEGER NOT NULL CHECK (persistence_rows_written >= 0),
  PRIMARY KEY (network, run_at)
) WITHOUT ROWID;
