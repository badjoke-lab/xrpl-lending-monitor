PRAGMA foreign_keys = ON;

ALTER TABLE incremental_collector_state ADD COLUMN last_d1_rows_read INTEGER NOT NULL DEFAULT 0 CHECK (last_d1_rows_read >= 0);
ALTER TABLE incremental_collector_state ADD COLUMN last_d1_rows_written INTEGER NOT NULL DEFAULT 0 CHECK (last_d1_rows_written >= 0);
ALTER TABLE incremental_collector_state ADD COLUMN last_d1_duration_ms REAL NOT NULL DEFAULT 0 CHECK (last_d1_duration_ms >= 0);
ALTER TABLE incremental_collector_state ADD COLUMN last_d1_size_after_bytes INTEGER CHECK (last_d1_size_after_bytes IS NULL OR last_d1_size_after_bytes >= 0);
