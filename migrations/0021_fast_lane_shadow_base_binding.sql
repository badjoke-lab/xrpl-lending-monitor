PRAGMA foreign_keys = ON;

CREATE TABLE fast_lane_shadow_base_binding (
  network TEXT PRIMARY KEY CHECK (network = 'devnet'),
  shadow_epoch_id TEXT NOT NULL,
  base_epoch_id TEXT NOT NULL,
  base_snapshot_id TEXT NOT NULL,
  base_ledger_index INTEGER NOT NULL CHECK (base_ledger_index >= 0),
  base_ledger_hash TEXT NOT NULL,
  bound_at TEXT NOT NULL
) WITHOUT ROWID;
