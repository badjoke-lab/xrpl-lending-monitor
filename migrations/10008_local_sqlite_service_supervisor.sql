-- R4C1 local SQLite service supervisor state.
-- This state controls process ownership on one host. It is intentionally
-- separate from the portable collector complete-state envelope because an
-- active process lease must not be transferred to another host.

CREATE TABLE IF NOT EXISTS collector_local_service_supervisor (
  profile_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  generation INTEGER NOT NULL CHECK (generation >= 0),
  status TEXT NOT NULL CHECK (status IN ('stopped', 'running', 'halted')),
  owner_id TEXT,
  lease_expires_at TEXT,
  last_heartbeat_at TEXT,
  restart_count INTEGER NOT NULL CHECK (restart_count >= 0),
  next_start_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status = 'running'
      AND owner_id IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND last_heartbeat_at IS NOT NULL
      AND next_start_at IS NULL)
    OR
    (status = 'stopped'
      AND owner_id IS NULL
      AND lease_expires_at IS NULL
      AND last_heartbeat_at IS NULL)
    OR
    (status = 'halted'
      AND owner_id IS NULL
      AND lease_expires_at IS NULL
      AND last_heartbeat_at IS NULL
      AND next_start_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS collector_local_service_events (
  profile_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  event_sequence INTEGER NOT NULL CHECK (event_sequence >= 0),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'initialized',
      'started',
      'reclaimed',
      'heartbeat',
      'retry_scheduled',
      'stopped',
      'halted'
    )
  ),
  owner_id TEXT,
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL,
  PRIMARY KEY (profile_id, generation, event_sequence),
  FOREIGN KEY (profile_id)
    REFERENCES collector_local_service_supervisor(profile_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collector_local_service_events_time
  ON collector_local_service_events(profile_id, occurred_at, generation, event_sequence);
