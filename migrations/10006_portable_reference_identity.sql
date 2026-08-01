-- Preserve the complete normalized candidate identity in the portable
-- reference store before R2b2 finalization.

ALTER TABLE collector_reference_rows
  ADD COLUMN source_transaction_hash TEXT;

ALTER TABLE collector_reference_rows
  ADD COLUMN object_id TEXT;

ALTER TABLE collector_reference_rows
  ADD COLUMN relationship_ids_json TEXT NOT NULL DEFAULT '[]';

DROP VIEW IF EXISTS collector_committed_reference_rows;

CREATE VIEW collector_committed_reference_rows AS
SELECT
  rows.work_id,
  rows.semantic_class,
  rows.canonical_key,
  rows.source_ledger_index,
  rows.source_ledger_hash,
  rows.source_transaction_hash,
  rows.object_id,
  rows.relationship_ids_json,
  rows.value_json,
  rows.is_tombstone,
  rows.created_at
FROM collector_reference_rows AS rows
INNER JOIN collector_work AS work
  ON work.work_id = rows.work_id
WHERE work.status = 'committed';
