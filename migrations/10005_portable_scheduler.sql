-- Durable scheduler reference schema for the provider-neutral R2 runtime.
--
-- Scheduler payloads contain only canonical typed control messages. Complete
-- ledger and semantic payloads remain in collector work and payload chunks.

CREATE TABLE IF NOT EXISTS collector_scheduler_messages (
  message_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  phase TEXT NOT NULL CHECK (phase IN ('scan', 'commit', 'finalize')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'completed', 'error')),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  result_json TEXT,
  error_classification TEXT,
  error_message TEXT,
  successor_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (status <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND result_json IS NOT NULL) OR
    status <> 'completed'
  ),
  CHECK (
    (status = 'error' AND error_classification IS NOT NULL) OR
    status <> 'error'
  )
);

CREATE INDEX IF NOT EXISTS collector_scheduler_messages_ready_idx
  ON collector_scheduler_messages (status, available_at, created_at, message_id);

CREATE INDEX IF NOT EXISTS collector_scheduler_messages_lease_idx
  ON collector_scheduler_messages (status, lease_expires_at);

CREATE TABLE IF NOT EXISTS collector_scheduler_outbox (
  current_message_id TEXT PRIMARY KEY,
  successor_message_id TEXT NOT NULL UNIQUE,
  successor_payload_json TEXT NOT NULL,
  successor_available_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched')),
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  CHECK (
    (status = 'dispatched' AND dispatched_at IS NOT NULL) OR
    (status = 'pending' AND dispatched_at IS NULL)
  ),
  FOREIGN KEY (current_message_id)
    REFERENCES collector_scheduler_messages (message_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS collector_scheduler_outbox_pending_idx
  ON collector_scheduler_outbox (status, created_at, current_message_id);
