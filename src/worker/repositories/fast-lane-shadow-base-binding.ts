import type { CatchUpBaseIdentity } from '../../shared/catch-up-base-identity'

export interface FastLaneShadowBaseBinding {
  shadowEpochId: string
  base: CatchUpBaseIdentity
  boundAt: string
}

interface BindingRow {
  shadow_epoch_id: string
  base_epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
  bound_at: string
}

export async function readFastLaneShadowBaseBinding(
  db: D1Database,
): Promise<FastLaneShadowBaseBinding | null> {
  const row = await db.prepare(
    `SELECT shadow_epoch_id, base_epoch_id, base_snapshot_id,
            base_ledger_index, base_ledger_hash, bound_at
     FROM fast_lane_shadow_base_binding
     WHERE network = 'devnet'`,
  ).first<BindingRow>()

  return row
    ? {
        shadowEpochId: row.shadow_epoch_id,
        base: {
          epochId: row.base_epoch_id,
          snapshotId: row.base_snapshot_id,
          ledgerIndex: row.base_ledger_index,
          ledgerHash: row.base_ledger_hash,
        },
        boundAt: row.bound_at,
      }
    : null
}

export function sameFastLaneShadowBaseBinding(options: {
  binding: FastLaneShadowBaseBinding | null
  shadowEpochId: string
  base: CatchUpBaseIdentity
}): boolean {
  const { binding, base } = options
  return binding !== null
    && binding.shadowEpochId === options.shadowEpochId
    && binding.base.epochId === base.epochId
    && binding.base.snapshotId === base.snapshotId
    && binding.base.ledgerIndex === base.ledgerIndex
    && binding.base.ledgerHash === base.ledgerHash
}

export async function bindFastLaneShadowBase(options: {
  db: D1Database
  shadowEpochId: string
  base: CatchUpBaseIdentity
  boundAt: string
}): Promise<void> {
  await options.db.prepare(
    `INSERT INTO fast_lane_shadow_base_binding (
       network, shadow_epoch_id, base_epoch_id, base_snapshot_id,
       base_ledger_index, base_ledger_hash, bound_at
     ) VALUES ('devnet', ?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(network) DO UPDATE SET
       shadow_epoch_id = excluded.shadow_epoch_id,
       base_epoch_id = excluded.base_epoch_id,
       base_snapshot_id = excluded.base_snapshot_id,
       base_ledger_index = excluded.base_ledger_index,
       base_ledger_hash = excluded.base_ledger_hash,
       bound_at = excluded.bound_at`,
  ).bind(
    options.shadowEpochId,
    options.base.epochId,
    options.base.snapshotId,
    options.base.ledgerIndex,
    options.base.ledgerHash,
    options.boundAt,
  ).run()
}
