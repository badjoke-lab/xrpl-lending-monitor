PRAGMA foreign_keys = ON;

CREATE TABLE incremental_collector_state (
  network TEXT PRIMARY KEY CHECK (network = 'devnet'),
  status TEXT NOT NULL CHECK (
    status IN ('uninitialized', 'awaiting_initialization', 'healthy', 'behind', 'stale', 'error', 'reset_suspected')
  ),
  last_attempt_at TEXT,
  last_success_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  lag_ledgers INTEGER CHECK (lag_ledgers IS NULL OR lag_ledgers >= 0),
  endpoint TEXT,
  last_run_duration_ms INTEGER CHECK (last_run_duration_ms IS NULL OR last_run_duration_ms >= 0),
  last_rpc_requests INTEGER NOT NULL DEFAULT 0 CHECK (last_rpc_requests >= 0),
  last_endpoint_attempts INTEGER NOT NULL DEFAULT 0 CHECK (last_endpoint_attempts >= 0),
  last_ledgers_processed INTEGER NOT NULL DEFAULT 0 CHECK (last_ledgers_processed >= 0),
  last_inspected_transactions INTEGER NOT NULL DEFAULT 0 CHECK (last_inspected_transactions >= 0),
  last_lending_transactions INTEGER NOT NULL DEFAULT 0 CHECK (last_lending_transactions >= 0),
  last_estimated_rows INTEGER NOT NULL DEFAULT 0 CHECK (last_estimated_rows >= 0),
  last_estimated_statements INTEGER NOT NULL DEFAULT 0 CHECK (last_estimated_statements >= 0),
  last_overlay_mutations INTEGER NOT NULL DEFAULT 0 CHECK (last_overlay_mutations >= 0),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
