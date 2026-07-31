-- Migration filenames sort lexically, so this additive migration runs before
-- 9999_fast_lane_queue_slots.sql on a fresh database. Create the predecessor
-- shape here while retaining 9999 as the production upgrade-path migration.
CREATE TABLE IF NOT EXISTS fast_lane_queue_slots (
  scheduled_time INTEGER PRIMARY KEY,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'error', 'completed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  next_scheduled_time INTEGER,
  error_message TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE fast_lane_queue_slots
ADD COLUMN next_cron TEXT
CHECK (next_cron IN ('queue-self-schedule', 'queue-catch-up'));
