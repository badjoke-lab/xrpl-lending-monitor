export const DATABASE_SIZE_LIMIT_BYTES = 500_000_000
export const BOOTSTRAP_STOP_ESTIMATE_BYTES = 350_000_000
export const ROW_SIZE_LIMIT_BYTES = 1_900_000
export const MAX_BATCH_OBJECTS = 80

export interface SnapshotIdentity {
  id: string
  network: 'devnet'
  epochId: string
  ledgerIndex: number
  ledgerHash: string
  endpoint: string
  startedAt: string
}

export interface SnapshotRow {
  id: string
  network: 'devnet'
  epoch_id: string
  status: 'building' | 'verified' | 'failed' | 'superseded'
  ledger_index: number
  ledger_hash: string
  manifest_hash: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  )
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function serializeMarker(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Current-state marker is not JSON serializable')
  return encoded
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export async function loadSnapshot(
  db: D1Database,
  snapshotId: string,
): Promise<SnapshotRow | null> {
  return db
    .prepare(
      `SELECT id, network, epoch_id, status, ledger_index, ledger_hash, manifest_hash
       FROM current_state_d1_snapshots
       WHERE id = ?1`,
    )
    .bind(snapshotId)
    .first<SnapshotRow>()
}
