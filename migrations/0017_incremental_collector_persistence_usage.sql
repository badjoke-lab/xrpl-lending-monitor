PRAGMA foreign_keys = ON;

ALTER TABLE incremental_collector_state
  ADD COLUMN last_persistence_batch_results INTEGER NOT NULL DEFAULT 0
  CHECK (last_persistence_batch_results >= 0);

ALTER TABLE incremental_collector_state
  ADD COLUMN last_persistence_statements INTEGER NOT NULL DEFAULT 0
  CHECK (last_persistence_statements >= 0);

ALTER TABLE incremental_collector_state
  ADD COLUMN last_persistence_rows_read INTEGER NOT NULL DEFAULT 0
  CHECK (last_persistence_rows_read >= 0);

ALTER TABLE incremental_collector_state
  ADD COLUMN last_persistence_rows_written INTEGER NOT NULL DEFAULT 0
  CHECK (last_persistence_rows_written >= 0);
