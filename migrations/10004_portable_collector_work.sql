-- Portable collector reference schema.
--
-- These tables define the implementation-neutral work/chunk/finalize contract.
-- Remote deployment profiles may use adapter-specific migrations, but they must
-- preserve these identities, state transitions, and committed-only visibility.

CREATE TABLE IF NOT EXISTS collector_work (
  work_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  network TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  base_identity TEXT NOT NULL,
  previous_ledger_index INTEGER NOT NULL CHECK (previous_ledger_index >= 0),
  start_ledger_index INTEGER NOT NULL CHECK (start_ledger_index = previous_ledger_index + 1),
  expected_parent_hash TEXT NOT NULL,
  planned_end_ledger_index INTEGER NOT NULL CHECK (planned_end_ledger_index >= start_ledger_index),
  scanned_end_ledger_index INTEGER,
  final_ledger_hash TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('planned', 'scanning', 'staged', 'committing', 'finalizing', 'committed', 'error', 'abandoned')
  ),
  plan_json TEXT NOT NULL,
  semantic_counts_json TEXT,
  payload_digest TEXT,
  expected_payload_chunks INTEGER NOT NULL DEFAULT 0 CHECK (expected_payload_chunks >= 0),
  expected_commit_chunks INTEGER NOT NULL DEFAULT 0 CHECK (expected_commit_chunks >= 0),
  error_code TEXT,
  error_message TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  committed_at TEXT,
  UNIQUE (
    network,
    epoch_id,
    base_identity,
    start_ledger_index,
    expected_parent_hash
  ),
  CHECK (
    scanned_end_ledger_index IS NULL OR
    scanned_end_ledger_index BETWEEN start_ledger_index AND planned_end_ledger_index
  ),
  CHECK (
    (status = 'committed' AND committed_at IS NOT NULL AND final_ledger_hash IS NOT NULL) OR
    status <> 'committed'
  )
);

CREATE INDEX IF NOT EXISTS collector_work_status_updated_idx
  ON collector_work (status, updated_at);

CREATE INDEX IF NOT EXISTS collector_work_scope_start_idx
  ON collector_work (network, epoch_id, base_identity, start_ledger_index);

CREATE TABLE IF NOT EXISTS collector_payload_chunks (
  work_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  encoding TEXT NOT NULL,
  payload BLOB NOT NULL,
  payload_digest TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_id, chunk_index),
  FOREIGN KEY (work_id) REFERENCES collector_work (work_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collector_commit_chunks (
  work_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  operation_count INTEGER NOT NULL DEFAULT 0 CHECK (operation_count >= 0),
  row_mutation_count INTEGER NOT NULL DEFAULT 0 CHECK (row_mutation_count >= 0),
  chunk_digest TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (work_id, chunk_index),
  FOREIGN KEY (work_id) REFERENCES collector_work (work_id) ON DELETE CASCADE,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    status <> 'completed'
  )
);

CREATE INDEX IF NOT EXISTS collector_commit_chunks_status_idx
  ON collector_commit_chunks (work_id, status, chunk_index);

-- Reference rows prove the visibility contract without coupling R1 to the
-- production semantic table layout. R2/R3 adapters map the same work_id gate
-- onto protocol events, changes, lifecycle, archives, balances, and overlays.
CREATE TABLE IF NOT EXISTS collector_reference_rows (
  work_id TEXT NOT NULL,
  semantic_class TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  source_ledger_index INTEGER NOT NULL,
  source_ledger_hash TEXT NOT NULL,
  value_json TEXT,
  is_tombstone INTEGER NOT NULL DEFAULT 0 CHECK (is_tombstone IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_id, semantic_class, canonical_key),
  FOREIGN KEY (work_id) REFERENCES collector_work (work_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS collector_reference_rows_lookup_idx
  ON collector_reference_rows (semantic_class, canonical_key, source_ledger_index);

CREATE TABLE IF NOT EXISTS collector_committed_watermarks (
  network TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  base_identity TEXT NOT NULL,
  ledger_index INTEGER NOT NULL CHECK (ledger_index >= 0),
  ledger_hash TEXT NOT NULL,
  work_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, base_identity),
  FOREIGN KEY (work_id) REFERENCES collector_work (work_id)
);

CREATE VIEW IF NOT EXISTS collector_committed_reference_rows AS
SELECT
  rows.work_id,
  rows.semantic_class,
  rows.canonical_key,
  rows.source_ledger_index,
  rows.source_ledger_hash,
  rows.value_json,
  rows.is_tombstone,
  rows.created_at
FROM collector_reference_rows AS rows
INNER JOIN collector_work AS work
  ON work.work_id = rows.work_id
WHERE work.status = 'committed';
