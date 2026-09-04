PRAGMA foreign_keys = ON;

CREATE TABLE incremental_collector_state_contract_repair (
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
  updated_at TEXT NOT NULL,
  last_persistence_batch_results INTEGER NOT NULL DEFAULT 0 CHECK (last_persistence_batch_results >= 0),
  last_persistence_statements INTEGER NOT NULL DEFAULT 0 CHECK (last_persistence_statements >= 0),
  last_persistence_rows_read INTEGER NOT NULL DEFAULT 0 CHECK (last_persistence_rows_read >= 0),
  last_persistence_rows_written INTEGER NOT NULL DEFAULT 0 CHECK (last_persistence_rows_written >= 0)
);

INSERT INTO incremental_collector_state_contract_repair (
  network, status, last_attempt_at, last_success_at, consecutive_failures,
  lag_ledgers, endpoint, last_run_duration_ms, last_rpc_requests,
  last_endpoint_attempts, last_ledgers_processed, last_inspected_transactions,
  last_lending_transactions, last_estimated_rows, last_estimated_statements,
  last_overlay_mutations, error_code, error_message, created_at, updated_at,
  last_persistence_batch_results, last_persistence_statements,
  last_persistence_rows_read, last_persistence_rows_written
)
SELECT
  network, status, last_attempt_at, last_success_at, consecutive_failures,
  lag_ledgers, endpoint, last_run_duration_ms, last_rpc_requests,
  last_endpoint_attempts, last_ledgers_processed, last_inspected_transactions,
  last_lending_transactions, last_estimated_rows, last_estimated_statements,
  last_overlay_mutations, error_code, error_message, created_at, updated_at,
  last_persistence_batch_results, last_persistence_statements,
  last_persistence_rows_read, last_persistence_rows_written
FROM incremental_collector_state;

DROP TABLE incremental_collector_state;
ALTER TABLE incremental_collector_state_contract_repair RENAME TO incremental_collector_state;
