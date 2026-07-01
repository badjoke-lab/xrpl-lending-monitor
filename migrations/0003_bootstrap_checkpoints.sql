PRAGMA foreign_keys = ON;

ALTER TABLE current_state_snapshots
  ADD COLUMN manifest_hash TEXT;

CREATE TABLE current_state_bootstrap_checkpoints (
  snapshot_id TEXT PRIMARY KEY
    REFERENCES current_state_snapshots(id) ON DELETE CASCADE,
  checkpoint_json TEXT NOT NULL,
  next_page_number INTEGER NOT NULL CHECK (next_page_number > 0),
  scan_complete INTEGER NOT NULL CHECK (scan_complete IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE INDEX current_state_bootstrap_checkpoint_updated
  ON current_state_bootstrap_checkpoints (updated_at);
