import { readFastLaneShadowBaseBinding } from './fast-lane-shadow-base-binding'
import { readFastLaneShadowState } from './fast-lane-shadow-repository'

interface CanonicalOverlayStateRow {
  overlay_ledger_index: number
  overlay_ledger_hash: string
  updated_at: string
}

interface DiffAggregateRow {
  sampled_rows: number
  canonical_missing_rows: number
  canonical_ahead_rows: number
  fast_ahead_rows: number
  exact_source_matches: number
  exact_projection_matches: number
  exact_projection_mismatches: number
}

export interface FastLaneShadowDiffEvidence {
  schemaVersion: 1
  status: 'ok' | 'unavailable'
  passed: boolean
  reason: string | null
  binding: Awaited<ReturnType<typeof readFastLaneShadowBaseBinding>>
  fastLane: {
    ledgerIndex: number
    ledgerHash: string
    updatedAt: string
  } | null
  canonicalOverlay: {
    ledgerIndex: number
    ledgerHash: string
    updatedAt: string
  } | null
  sample: {
    limit: number
    sampledRows: number
    canonicalMissingRows: number
    canonicalAheadRows: number
    fastAheadRows: number
    exactSourceMatches: number
    exactProjectionMatches: number
    exactProjectionMismatches: number
  } | null
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new Error('fast-lane diff sample limit must be from 1 to 500')
  }
  return value
}

export async function readFastLaneShadowDiff(options: {
  db: D1Database
  sampleLimit?: number
}): Promise<FastLaneShadowDiffEvidence> {
  const limit = positiveLimit(options.sampleLimit ?? 200)
  const [binding, state] = await Promise.all([
    readFastLaneShadowBaseBinding(options.db),
    readFastLaneShadowState(options.db),
  ])

  if (!binding) {
    return {
      schemaVersion: 1,
      status: 'unavailable',
      passed: false,
      reason: 'fast_lane_base_binding_unavailable',
      binding: null,
      fastLane: state
        ? {
            ledgerIndex: state.lastProcessedLedger,
            ledgerHash: state.lastProcessedHash,
            updatedAt: state.updatedAt,
          }
        : null,
      canonicalOverlay: null,
      sample: null,
    }
  }

  if (!state || state.epochId !== binding.shadowEpochId) {
    return {
      schemaVersion: 1,
      status: 'unavailable',
      passed: false,
      reason: 'fast_lane_state_binding_mismatch',
      binding,
      fastLane: state
        ? {
            ledgerIndex: state.lastProcessedLedger,
            ledgerHash: state.lastProcessedHash,
            updatedAt: state.updatedAt,
          }
        : null,
      canonicalOverlay: null,
      sample: null,
    }
  }

  const canonical = await options.db.prepare(
    `SELECT overlay_ledger_index, overlay_ledger_hash, updated_at
     FROM current_state_overlay_state
     WHERE network = 'devnet'
       AND epoch_id = ?1
       AND base_snapshot_id = ?2
       AND base_ledger_index = ?3
       AND base_ledger_hash = ?4
     LIMIT 1`,
  ).bind(
    binding.base.epochId,
    binding.base.snapshotId,
    binding.base.ledgerIndex,
    binding.base.ledgerHash,
  ).first<CanonicalOverlayStateRow>()

  if (!canonical) {
    return {
      schemaVersion: 1,
      status: 'unavailable',
      passed: false,
      reason: 'canonical_overlay_for_bound_base_unavailable',
      binding,
      fastLane: {
        ledgerIndex: state.lastProcessedLedger,
        ledgerHash: state.lastProcessedHash,
        updatedAt: state.updatedAt,
      },
      canonicalOverlay: null,
      sample: null,
    }
  }

  const aggregate = await options.db.prepare(
    `WITH sampled AS (
       SELECT object_type, object_id, operation, projection_json,
              source_ledger_index, source_transaction_index
       FROM fast_lane_shadow_objects_compact
       WHERE network = 'devnet' AND epoch_id = ?1
       ORDER BY object_type ASC, object_id ASC
       LIMIT ?2
     )
     SELECT
       COUNT(*) AS sampled_rows,
       SUM(CASE WHEN c.object_id IS NULL THEN 1 ELSE 0 END) AS canonical_missing_rows,
       SUM(CASE WHEN c.object_id IS NOT NULL AND (
         c.source_ledger_index > f.source_ledger_index OR
         (c.source_ledger_index = f.source_ledger_index AND c.source_transaction_index > f.source_transaction_index)
       ) THEN 1 ELSE 0 END) AS canonical_ahead_rows,
       SUM(CASE WHEN c.object_id IS NOT NULL AND (
         c.source_ledger_index < f.source_ledger_index OR
         (c.source_ledger_index = f.source_ledger_index AND c.source_transaction_index < f.source_transaction_index)
       ) THEN 1 ELSE 0 END) AS fast_ahead_rows,
       SUM(CASE WHEN c.object_id IS NOT NULL
         AND c.source_ledger_index = f.source_ledger_index
         AND c.source_transaction_index = f.source_transaction_index
         THEN 1 ELSE 0 END) AS exact_source_matches,
       SUM(CASE WHEN c.object_id IS NOT NULL
         AND c.source_ledger_index = f.source_ledger_index
         AND c.source_transaction_index = f.source_transaction_index
         AND c.operation = f.operation
         AND COALESCE(c.projection_json, '') = COALESCE(f.projection_json, '')
         THEN 1 ELSE 0 END) AS exact_projection_matches,
       SUM(CASE WHEN c.object_id IS NOT NULL
         AND c.source_ledger_index = f.source_ledger_index
         AND c.source_transaction_index = f.source_transaction_index
         AND (c.operation <> f.operation OR COALESCE(c.projection_json, '') <> COALESCE(f.projection_json, ''))
         THEN 1 ELSE 0 END) AS exact_projection_mismatches
     FROM sampled f
     LEFT JOIN current_state_overlay_objects c
       ON c.network = 'devnet'
      AND c.epoch_id = ?3
      AND c.base_snapshot_id = ?4
      AND c.object_type = f.object_type
      AND c.object_id = f.object_id`,
  ).bind(
    binding.shadowEpochId,
    limit,
    binding.base.epochId,
    binding.base.snapshotId,
  ).first<DiffAggregateRow>()

  const sample = {
    limit,
    sampledRows: Number(aggregate?.sampled_rows ?? 0),
    canonicalMissingRows: Number(aggregate?.canonical_missing_rows ?? 0),
    canonicalAheadRows: Number(aggregate?.canonical_ahead_rows ?? 0),
    fastAheadRows: Number(aggregate?.fast_ahead_rows ?? 0),
    exactSourceMatches: Number(aggregate?.exact_source_matches ?? 0),
    exactProjectionMatches: Number(aggregate?.exact_projection_matches ?? 0),
    exactProjectionMismatches: Number(aggregate?.exact_projection_mismatches ?? 0),
  }

  return {
    schemaVersion: 1,
    status: 'ok',
    passed: sample.exactProjectionMismatches === 0,
    reason: sample.exactProjectionMismatches === 0 ? null : 'exact_source_projection_mismatch',
    binding,
    fastLane: {
      ledgerIndex: state.lastProcessedLedger,
      ledgerHash: state.lastProcessedHash,
      updatedAt: state.updatedAt,
    },
    canonicalOverlay: {
      ledgerIndex: canonical.overlay_ledger_index,
      ledgerHash: canonical.overlay_ledger_hash,
      updatedAt: canonical.updated_at,
    },
    sample,
  }
}
