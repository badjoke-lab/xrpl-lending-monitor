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

export async function digestHex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
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

export async function beginSnapshot(
  db: D1Database,
  identity: SnapshotIdentity,
): Promise<void> {
  const existing = await loadSnapshot(db, identity.id)
  if (existing) {
    if (
      existing.network !== identity.network ||
      existing.epoch_id !== identity.epochId ||
      existing.ledger_index !== identity.ledgerIndex ||
      existing.ledger_hash !== identity.ledgerHash
    ) {
      throw new Error('Existing D1 snapshot identity does not match')
    }
    return
  }

  await db
    .prepare(
      `INSERT INTO current_state_d1_snapshots (
         id, network, epoch_id, status, ledger_index, ledger_hash, endpoint,
         started_at, created_at, updated_at
       ) VALUES (?1, ?2, ?3, 'building', ?4, ?5, ?6, ?7, ?7, ?7)`,
    )
    .bind(
      identity.id,
      identity.network,
      identity.epochId,
      identity.ledgerIndex,
      identity.ledgerHash,
      identity.endpoint,
      identity.startedAt,
    )
    .run()
}

export async function failSnapshot(options: {
  db: D1Database
  snapshotId: string
  failedAt: string
  code: string
  message: string
}): Promise<void> {
  await options.db
    .prepare(
      `UPDATE current_state_d1_snapshots
       SET status = 'failed', error_code = ?1, error_message = ?2,
           completed_at = ?3, updated_at = ?3
       WHERE id = ?4 AND status = 'building'`,
    )
    .bind(options.code, options.message, options.failedAt, options.snapshotId)
    .run()
}
