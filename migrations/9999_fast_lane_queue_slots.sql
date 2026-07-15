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

CREATE INDEX IF NOT EXISTS fast_lane_queue_slots_status_updated_idx
  ON fast_lane_queue_slots (status, updated_at);
