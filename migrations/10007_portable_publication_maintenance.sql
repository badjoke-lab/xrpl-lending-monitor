-- Provider-neutral publication and maintenance state for R3D.
-- Collection watermarks remain in collector_committed_watermarks and are never
-- advanced by these tables.

CREATE TABLE IF NOT EXISTS collector_publication_candidates (
  publication_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  previous_publication_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'verified')),
  asset_json TEXT NOT NULL,
  asset_digest TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  FOREIGN KEY (previous_publication_id)
    REFERENCES collector_publication_candidates(publication_id)
);

CREATE INDEX IF NOT EXISTS idx_collector_publication_candidates_stream
  ON collector_publication_candidates(stream_id, created_at, publication_id);

CREATE TABLE IF NOT EXISTS collector_publication_works (
  publication_id TEXT NOT NULL,
  work_position INTEGER NOT NULL CHECK (work_position >= 0),
  work_id TEXT NOT NULL,
  network TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  base_identity TEXT NOT NULL,
  previous_ledger_index INTEGER NOT NULL CHECK (previous_ledger_index >= 0),
  expected_parent_hash TEXT NOT NULL,
  start_ledger_index INTEGER NOT NULL CHECK (start_ledger_index >= 1),
  end_ledger_index INTEGER NOT NULL CHECK (end_ledger_index >= start_ledger_index),
  end_ledger_hash TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  semantic_counts_json TEXT NOT NULL,
  PRIMARY KEY (publication_id, work_position),
  UNIQUE (publication_id, work_id),
  FOREIGN KEY (publication_id)
    REFERENCES collector_publication_candidates(publication_id)
    ON DELETE CASCADE,
  FOREIGN KEY (work_id)
    REFERENCES collector_work(work_id)
);

CREATE INDEX IF NOT EXISTS idx_collector_publication_works_work
  ON collector_publication_works(work_id, publication_id);

CREATE TABLE IF NOT EXISTS collector_publication_watermarks (
  stream_id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  ledger_index INTEGER NOT NULL CHECK (ledger_index >= 0),
  ledger_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (publication_id)
    REFERENCES collector_publication_candidates(publication_id),
  FOREIGN KEY (work_id)
    REFERENCES collector_work(work_id)
);

CREATE TABLE IF NOT EXISTS collector_maintenance_plans (
  plan_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  verified_publication_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'applied')),
  plan_json TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (verified_publication_id)
    REFERENCES collector_publication_candidates(publication_id)
);

CREATE INDEX IF NOT EXISTS idx_collector_maintenance_plans_stream
  ON collector_maintenance_plans(stream_id, created_at, plan_id);

CREATE TABLE IF NOT EXISTS collector_maintenance_mutations (
  plan_id TEXT NOT NULL,
  mutation_index INTEGER NOT NULL CHECK (mutation_index >= 0),
  table_name TEXT NOT NULL CHECK (
    table_name IN ('collector_payload_chunks', 'collector_commit_chunks')
  ),
  work_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason = 'verified_publication_retention'),
  status TEXT NOT NULL CHECK (status IN ('planned', 'applied')),
  applied_at TEXT,
  PRIMARY KEY (plan_id, mutation_index),
  FOREIGN KEY (plan_id)
    REFERENCES collector_maintenance_plans(plan_id)
    ON DELETE CASCADE,
  FOREIGN KEY (work_id)
    REFERENCES collector_work(work_id)
);
