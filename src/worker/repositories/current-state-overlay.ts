export type CurrentStateOverlayObjectType = 'vault' | 'loan_broker' | 'loan'

export interface CurrentStateOverlayBaseIdentity {
  network: 'devnet'
  epochId: string
  baseSnapshotId: string
  baseLedgerIndex: number
  baseLedgerHash: string
}

export interface CurrentStateOverlaySource {
  ledgerIndex: number
  ledgerHash: string
  transactionHash: string
  transactionIndex: number
  updatedAt: string
}

export interface CurrentStateOverlayRelationships {
  owner?: string | null
  account?: string | null
  borrower?: string | null
  vaultId?: string | null
  loanBrokerId?: string | null
  assetKey?: string | null
  onLedgerStatus?: 'active' | 'impaired' | 'defaulted' | null
}

export type CurrentStateOverlayMutation =
  | {
      operation: 'upsert'
      objectType: CurrentStateOverlayObjectType
      objectId: string
      projectionJson: string
      relationships?: CurrentStateOverlayRelationships
    }
  | {
      operation: 'deleted'
      objectType: CurrentStateOverlayObjectType
      objectId: string
      relationships?: CurrentStateOverlayRelationships
    }

export interface CurrentStateOverlayState {
  network: 'devnet'
  epochId: string
  baseSnapshotId: string
  baseLedgerIndex: number
  baseLedgerHash: string
  overlayLedgerIndex: number
  overlayLedgerHash: string
  updatedAt: string
}

interface StateRow {
  network: string
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
  overlay_ledger_index: number
  overlay_ledger_hash: string
  updated_at: string
}

interface ObjectRow {
  operation: 'upsert' | 'deleted'
  projection_json: string | null
  source_ledger_index: number
  source_ledger_hash: string
  source_transaction_hash: string
  source_transaction_index: number
}

function nonEmpty(value: string, field: string): void {
  if (value.length === 0) throw new Error(`${field} must be non-empty`)
}

function nonNegative(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`)
}

function validateBase(base: CurrentStateOverlayBaseIdentity): void {
  nonEmpty(base.epochId, 'epochId')
  nonEmpty(base.baseSnapshotId, 'baseSnapshotId')
  nonNegative(base.baseLedgerIndex, 'baseLedgerIndex')
  nonEmpty(base.baseLedgerHash, 'baseLedgerHash')
}

function validateSource(source: CurrentStateOverlaySource): void {
  nonNegative(source.ledgerIndex, 'ledgerIndex')
  nonEmpty(source.ledgerHash, 'ledgerHash')
  nonEmpty(source.transactionHash, 'transactionHash')
  nonNegative(source.transactionIndex, 'transactionIndex')
  nonEmpty(source.updatedAt, 'updatedAt')
}

function mapState(row: StateRow): CurrentStateOverlayState {
  if (row.network !== 'devnet') throw new Error('Overlay state network is invalid')
  return {
    network: 'devnet',
    epochId: row.epoch_id,
    baseSnapshotId: row.base_snapshot_id,
    baseLedgerIndex: row.base_ledger_index,
    baseLedgerHash: row.base_ledger_hash,
    overlayLedgerIndex: row.overlay_ledger_index,
    overlayLedgerHash: row.overlay_ledger_hash,
    updatedAt: row.updated_at,
  }
}

function sameBase(state: CurrentStateOverlayState, base: CurrentStateOverlayBaseIdentity): boolean {
  return state.network === base.network &&
    state.epochId === base.epochId &&
    state.baseSnapshotId === base.baseSnapshotId &&
    state.baseLedgerIndex === base.baseLedgerIndex &&
    state.baseLedgerHash === base.baseLedgerHash
}

async function readState(db: D1Database, base: CurrentStateOverlayBaseIdentity): Promise<CurrentStateOverlayState | null> {
  const row = await db.prepare(
    `SELECT network, epoch_id, base_snapshot_id, base_ledger_index,
            base_ledger_hash, overlay_ledger_index, overlay_ledger_hash, updated_at
     FROM current_state_overlay_state
     WHERE network = ?1 AND epoch_id = ?2 AND base_snapshot_id = ?3
     LIMIT 1`,
  ).bind(base.network, base.epochId, base.baseSnapshotId).first<StateRow>()
  return row ? mapState(row) : null
}

export async function initializeCurrentStateOverlay(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
  initializedAt: string
}): Promise<CurrentStateOverlayState> {
  validateBase(options.base)
  nonEmpty(options.initializedAt, 'initializedAt')
  await options.db.prepare(
    `INSERT INTO current_state_overlay_state (
       network, epoch_id, base_snapshot_id, base_ledger_index,
       base_ledger_hash, overlay_ledger_index, overlay_ledger_hash, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?5, ?6)
     ON CONFLICT(network, epoch_id, base_snapshot_id) DO NOTHING`,
  ).bind(
    options.base.network,
    options.base.epochId,
    options.base.baseSnapshotId,
    options.base.baseLedgerIndex,
    options.base.baseLedgerHash,
    options.initializedAt,
  ).run()
  return assertCurrentStateOverlayBase({ db: options.db, base: options.base })
}

export async function assertCurrentStateOverlayBase(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
}): Promise<CurrentStateOverlayState> {
  validateBase(options.base)
  const state = await readState(options.db, options.base)
  if (!state) throw new Error('Current-state overlay state is unavailable for the active base')
  if (!sameBase(state, options.base)) throw new Error('Current-state overlay base identity mismatch')
  return state
}

async function readObject(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
  objectType: CurrentStateOverlayObjectType
  objectId: string
}): Promise<ObjectRow | null> {
  return options.db.prepare(
    `SELECT operation, projection_json, source_ledger_index, source_ledger_hash,
            source_transaction_hash, source_transaction_index
     FROM current_state_overlay_objects
     WHERE network = ?1 AND epoch_id = ?2 AND base_snapshot_id = ?3
       AND object_type = ?4 AND object_id = ?5
     LIMIT 1`,
  ).bind(
    options.base.network,
    options.base.epochId,
    options.base.baseSnapshotId,
    options.objectType,
    options.objectId,
  ).first<ObjectRow>()
}

function compareIncoming(existing: ObjectRow, source: CurrentStateOverlaySource): number {
  if (source.ledgerIndex !== existing.source_ledger_index) return source.ledgerIndex - existing.source_ledger_index
  return source.transactionIndex - existing.source_transaction_index
}

function sameMutation(row: ObjectRow, mutation: CurrentStateOverlayMutation, source: CurrentStateOverlaySource, projection: string | null): boolean {
  return row.source_ledger_index === source.ledgerIndex &&
    row.source_transaction_index === source.transactionIndex &&
    row.source_ledger_hash === source.ledgerHash &&
    row.source_transaction_hash === source.transactionHash &&
    row.operation === mutation.operation &&
    row.projection_json === projection
}

export async function applyCurrentStateOverlayMutation(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
  mutation: CurrentStateOverlayMutation
  source: CurrentStateOverlaySource
}): Promise<'applied' | 'replayed' | 'stale'> {
  validateBase(options.base)
  validateSource(options.source)
  nonEmpty(options.mutation.objectId, 'objectId')
  if (options.source.ledgerIndex <= options.base.baseLedgerIndex) throw new Error('Overlay mutation must occur after the base ledger')
  await assertCurrentStateOverlayBase({ db: options.db, base: options.base })

  const projection = options.mutation.operation === 'upsert' ? options.mutation.projectionJson : null
  if (projection !== null) nonEmpty(projection, 'projectionJson')
  const existing = await readObject({
    db: options.db,
    base: options.base,
    objectType: options.mutation.objectType,
    objectId: options.mutation.objectId,
  })
  if (existing) {
    const order = compareIncoming(existing, options.source)
    if (order < 0) return 'stale'
    if (order === 0) {
      if (sameMutation(existing, options.mutation, options.source, projection)) return 'replayed'
      throw new Error('Conflicting current-state overlay mutation at the same source position')
    }
  }

  const links = options.mutation.relationships ?? {}
  await options.db.prepare(
    `INSERT INTO current_state_overlay_objects (
       network, epoch_id, base_snapshot_id, object_type, object_id, operation,
       projection_json, owner, account, borrower, vault_id, loan_broker_id,
       asset_key, on_ledger_status, source_ledger_index, source_ledger_hash,
       source_transaction_hash, source_transaction_index, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
     ON CONFLICT(network, epoch_id, base_snapshot_id, object_type, object_id)
     DO UPDATE SET
       operation = excluded.operation,
       projection_json = excluded.projection_json,
       owner = excluded.owner,
       account = excluded.account,
       borrower = excluded.borrower,
       vault_id = excluded.vault_id,
       loan_broker_id = excluded.loan_broker_id,
       asset_key = excluded.asset_key,
       on_ledger_status = excluded.on_ledger_status,
       source_ledger_index = excluded.source_ledger_index,
       source_ledger_hash = excluded.source_ledger_hash,
       source_transaction_hash = excluded.source_transaction_hash,
       source_transaction_index = excluded.source_transaction_index,
       updated_at = excluded.updated_at
     WHERE excluded.source_ledger_index > current_state_overlay_objects.source_ledger_index
        OR (excluded.source_ledger_index = current_state_overlay_objects.source_ledger_index
            AND excluded.source_transaction_index > current_state_overlay_objects.source_transaction_index)`,
  ).bind(
    options.base.network,
    options.base.epochId,
    options.base.baseSnapshotId,
    options.mutation.objectType,
    options.mutation.objectId,
    options.mutation.operation,
    projection,
    links.owner ?? null,
    links.account ?? null,
    links.borrower ?? null,
    links.vaultId ?? null,
    links.loanBrokerId ?? null,
    links.assetKey ?? null,
    links.onLedgerStatus ?? null,
    options.source.ledgerIndex,
    options.source.ledgerHash,
    options.source.transactionHash,
    options.source.transactionIndex,
    options.source.updatedAt,
  ).run()

  const persisted = await readObject({
    db: options.db,
    base: options.base,
    objectType: options.mutation.objectType,
    objectId: options.mutation.objectId,
  })
  if (!persisted) throw new Error('Current-state overlay mutation did not persist')
  if (sameMutation(persisted, options.mutation, options.source, projection)) return 'applied'
  if (compareIncoming(persisted, options.source) < 0) return 'stale'
  throw new Error('Current-state overlay mutation lost its canonical ordering race')
}

export async function advanceCurrentStateOverlayWatermark(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
  expectedPreviousLedgerIndex: number
  expectedPreviousLedgerHash: string
  nextLedgerIndex: number
  nextLedgerHash: string
  advancedAt: string
}): Promise<'advanced' | 'replayed'> {
  validateBase(options.base)
  nonNegative(options.expectedPreviousLedgerIndex, 'expectedPreviousLedgerIndex')
  nonNegative(options.nextLedgerIndex, 'nextLedgerIndex')
  nonEmpty(options.expectedPreviousLedgerHash, 'expectedPreviousLedgerHash')
  nonEmpty(options.nextLedgerHash, 'nextLedgerHash')
  nonEmpty(options.advancedAt, 'advancedAt')
  if (options.nextLedgerIndex <= options.expectedPreviousLedgerIndex) throw new Error('Overlay watermark must advance to a later ledger')

  const state = await assertCurrentStateOverlayBase({ db: options.db, base: options.base })
  if (state.overlayLedgerIndex === options.nextLedgerIndex && state.overlayLedgerHash === options.nextLedgerHash) return 'replayed'
  if (state.overlayLedgerIndex !== options.expectedPreviousLedgerIndex || state.overlayLedgerHash !== options.expectedPreviousLedgerHash) {
    throw new Error('Current-state overlay watermark changed before advancement')
  }

  const result = await options.db.prepare(
    `UPDATE current_state_overlay_state
     SET overlay_ledger_index = ?1, overlay_ledger_hash = ?2, updated_at = ?3
     WHERE network = ?4 AND epoch_id = ?5 AND base_snapshot_id = ?6
       AND base_ledger_index = ?7 AND base_ledger_hash = ?8
       AND overlay_ledger_index = ?9 AND overlay_ledger_hash = ?10`,
  ).bind(
    options.nextLedgerIndex,
    options.nextLedgerHash,
    options.advancedAt,
    options.base.network,
    options.base.epochId,
    options.base.baseSnapshotId,
    options.base.baseLedgerIndex,
    options.base.baseLedgerHash,
    options.expectedPreviousLedgerIndex,
    options.expectedPreviousLedgerHash,
  ).run()

  if (result.meta.changes === 1) return 'advanced'
  const current = await assertCurrentStateOverlayBase({ db: options.db, base: options.base })
  if (current.overlayLedgerIndex === options.nextLedgerIndex && current.overlayLedgerHash === options.nextLedgerHash) return 'replayed'
  throw new Error('Current-state overlay watermark advancement was not committed')
}
