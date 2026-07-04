export type CurrentStateOverlayObjectType = 'vault' | 'loan_broker' | 'loan'
export type CurrentStateOverlayOperation = 'upsert' | 'deleted'

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

export interface CurrentStateOverlayUpsert {
  operation: 'upsert'
  objectType: CurrentStateOverlayObjectType
  objectId: string
  projectionJson: string
  relationships?: CurrentStateOverlayRelationships
}

export interface CurrentStateOverlayTombstone {
  operation: 'deleted'
  objectType: CurrentStateOverlayObjectType
  objectId: string
  relationships?: CurrentStateOverlayRelationships
}

export type CurrentStateOverlayMutation =
  | CurrentStateOverlayUpsert
  | CurrentStateOverlayTombstone

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

export type OverlayMutationResult = 'applied' | 'replayed' | 'stale'
export type OverlayWatermarkResult = 'advanced' | 'replayed'

interface OverlayStateRow {
  network: string
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
  overlay_ledger_index: number
  overlay_ledger_hash: string
  updated_at: string
}

interface OverlayObjectRow {
  operation: CurrentStateOverlayOperation
  projection_json: string | null
  source_ledger_index: number
  source_ledger_hash: string
  source_transaction_hash: string
  source_transaction_index: number
}

function assertNonEmpty(value: string, field: string): void {
  if (value.length === 0) throw new Error(`${field} must be non-empty`)
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}

function validateBaseIdentity(base: CurrentStateOverlayBaseIdentity): void {
  if (base.network !== 'devnet') throw new Error('Overlay network must be devnet')
  assertNonEmpty(base.epochId, 'epochId')
  assertNonEmpty(base.baseSnapshotId, 'baseSnapshotId')
  assertNonNegativeInteger(base.baseLedgerIndex, 'baseLedgerIndex')
  assertNonEmpty(base.baseLedgerHash, 'baseLedgerHash')
}

function validateSource(source: CurrentStateOverlaySource): void {
  assertNonNegativeInteger(source.ledgerIndex, 'ledgerIndex')
  assertNonEmpty(source.ledgerHash, 'ledgerHash')
  assertNonEmpty(source.transactionHash, 'transactionHash')
  assertNonNegativeInteger(source.transactionIndex, 'transactionIndex')
  assertNonEmpty(source.updatedAt, 'updatedAt')
}

function stateFromRow(row: OverlayStateRow): CurrentStateOverlayState {
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

function assertMatchingBase(
  actual: CurrentStateOverlayState,
  expected: CurrentStateOverlayBaseIdentity,
): void {
  if (
    actual.network !== expected.network ||
    actual.epochId !== expected.epochId ||
    actual.baseSnapshotId !== expected.baseSnapshotId ||
    actual.baseLedgerIndex !== expected.baseLedgerIndex ||
    actual.baseLedgerHash !== expected.baseLedgerHash
  ) {
    throw new Error('Current-state overlay base identity mismatch')
  }
}

async function readOverlayState(
  db: D1Database,
  base: CurrentStateOverlayBaseIdentity,
): Promise<CurrentStateOverlayState | null> {
  const row = await db
    .prepare(
      `SELECT network, epoch_id, base_snapshot_id, base_ledger_index,
              base_ledger_hash, overlay_ledger_index, overlay_ledger_hash,
              updated_at
       FROM current_state_overlay_state
       WHERE network = ?1
         AND epoch_id = ?2
         AND base_snapshot_id = ?3
       LIMIT 1`,
    )
    .bind(base.network, base.epochId, base.baseSnapshotId)
    .first<OverlayStateRow>()

  return row ? stateFromRow(row) : null
}

export async function initializeCurrentStateOverlay(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
  initializedAt: string
}): Promise<CurrentStateOverlayState> {
  validateBaseIdentity(options.base)
  assertNonEmpty(options.initializedAt, 'initializedAt')

  await options.db
    .prepare(
      `INSERT INTO current_state_overlay_state (
         network, epoch_id, base_snapshot_id, base_ledger_index,
         base_ledger_hash, overlay_ledger_index, overlay_ledger_hash, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?5, ?6)
       ON CONFLICT(network, epoch_id, base_snapshot_id) DO NOTHING`,
    )
    .bind(
      options.base.network,
      options.base.epochId,
      options.base.baseSnapshotId,
      options.base.baseLedgerIndex,
      options.base.baseLedgerHash,
      options.initializedAt,
    )
    .run()

  const state = await readOverlayState(options.db, options.base)
  if (!state) throw new Error('Current-state overlay initialization did not persist state')
  assertMatchingBase(state, options.base)
  return state
}

export async function assertCurrentStateOverlayBase(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
}): Promise<CurrentStateOverlayState> {
  validateBaseIdentity(options.base)
  const state = await readOverlayState(options.db, options.base)
  if (!state) throw new Error('Current-state overlay state is unavailable for the active base')
  assertMatchingBase(state, options.base)
  return state
}

function compareSourcePosition(
  existing: OverlayObjectRow,
  source: CurrentStateOverlaySource,
): number {
  if (source.ledgerIndex !== existing.source_ledger_index) {
    return source.ledgerIndex - existing.source_ledger_index
  }
  return source.transactionIndex - existing.source_transaction_index
}

function projectionForMutation(mutation: CurrentStateOverlayMutation): string | null {
  if (mutation.operation === 'deleted') return null
  assertNonEmpty(mutation.projectionJson, 'projectionJson')
  return mutation.projectionJson
}

function isReplay(
  existing: OverlayObjectRow,
  mutation: CurrentStateOverlayMutation,
  source: CurrentStateOverlaySource,
  projectionJson: string | null,
): boolean {
  return (
    existing.source_ledger_index === source.ledgerIndex &&
    existing.source_transaction_index === source.transactionIndex &&
    existing.source_ledger_hash === source.ledgerHash &&
    existing.source_transaction_hash === source.transactionHash &&
    existing.operation === mutation.operation &&
    existing.projection_json === projectionJson
  )
}

async function readOverlayObject(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
  objectType: CurrentStateOverlayObjectType
  objectId: string
}): Promise<OverlayObjectRow | null> {
  return options.db
    .prepare(
      `SELECT operation, projection_json, source_ledger_index,
              source_ledger_hash, source_transaction_hash,
              source_transaction_index
       FROM current_state_overlay_objects
       WHERE network = ?1
         AND epoch_id = ?2
         AND base_snapshot_id = ?3
         AND object_type = ?4
         AND object_id = ?5
       LIMIT 1`,
    )
    .bind(
      options.base.network,
      options.base.epochId,
      options.base.baseSnapshotId,
      options.objectType,
      options.objectId,
    )
    .first<OverlayObjectRow>()
}

export async function applyCurrentStateOverlayMutation(options: {
  db: D1Database
  base: CurrentStateOverlayBaseIdentity
  mutation: CurrentStateOverlayMutation
  source: CurrentStateOverlaySource
}): Promise<OverlayMutationResult> {
  validateBaseIdentity(options.base)
  validateSource(options.source)
  assertNonEmpty(options.mutation.objectId, 'objectId')
  if (options.source.ledgerIndex <= options.base.baseLedgerIndex) {
    throw new Error('Overlay mutation must occur after the base ledger')
  }

  await assertCurrentStateOverlayBase({ db: options.db, base: options.base })

  const projectionJson = projectionForMutation(options.mutation)
  const existing = await readOverlayObject({
    db: options.db,
    base: options.base,
    objectType: options.mutation.objectType,
    objectId: options.mutation.objectId,
  })

  if (existing) {
    const comparison = compareSourcePosition(existing, options.source)
    if (comparison < 0) return 'stale'
    if (comparison === 0) {
      if (isReplay(existing, options.mutation, options.source, projectionJson)) return 'replayed'
      throw new Error('Conflicting current-state overlay mutation at the same source position')
    }
  }

  const relationships = options.mutation.relationships ?? {}
  await options.db
    .prepare(
      `INSERT INTO current_state_overlay_objects (
         network, epoch_id, base_snapshot_id, object_type, object_id,
         operation, projection_json, owner, account, borrower, vault_id,
         loan_broker_id, asset_key, on_ledger_status, source_ledger_index,
         source_ledger_hash, source_transaction_hash, source_transaction_index,
         updated_at
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5,
         ?6, ?7, ?8, ?9, ?10, ?11,
         ?12, ?13, ?14, ?15,
         ?16, ?17, ?18, ?19
       )
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
          OR (
            excluded.source_ledger_index = current_state_overlay_objects.source_ledger_index
            AND excluded.source_transaction_index > current_state_overlay_objects.source_transaction_index
          )`,
    )
    .bind(
      options.base.network,
      options.base.epochId,
      options.base.baseSnapshotId,
      options.mutation.objectType,
      options.mutation.objectId,
      options.mutation.operation,
      projectionJson,
      relationships.owner ?? null,
      relationships.account ?? null,
      relationships.borrower ?? null,
      relationships.vaultId ?? null,
      relationships.loanBrokerId ?? null,
      relationships.assetKey ?? null,
      relationships.onLedgerStatus ?? null,
      options.source.ledgerIndex,
      options.source.ledgerHash,
      options.source.transactionHash,
      options.source.transactionIndex,
      options.source.updatedAt,
    )
    .run()

  const persisted = await readOverlayObject({
    db: options.db,
    base: options.base,
    objectType: options.mutation.objectType,
    objectId: options.mutation.objectId,
  })
  if (!persisted) throw new Error('Current-state overlay mutation did not persist')
  if (isReplay(persisted, options.mutation, options.source, projectionJson)) return 'applied'

  const comparison = compareSourcePosition(persisted, options.source)
  if (comparison > 0) return 'stale'
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
}): Promise<OverlayWatermarkResult> {
  validateBaseIdentity(options.base)
  assertNonNegativeInteger(options.expectedPreviousLedgerIndex, 'expectedPreviousLedgerIndex')
  assertNonEmpty(options.expectedPreviousLedgerHash, 'expectedPreviousLedgerHash')
  assertNonNegativeInteger(options.nextLedgerIndex, 'nextLedgerIndex')
  assertNonEmpty(options.nextLedgerHash, 'nextLedgerHash')
  assertNonEmpty(options.advancedAt, 'advancedAt')

  if (options.nextLedgerIndex <= options.expectedPreviousLedgerIndex) {
    throw new Error('Overlay watermark must advance to a later ledger')
  }

  const state = await assertCurrentStateOverlayBase({ db: options.db, base: options.base })
  if (
    state.overlayLedgerIndex === options.nextLedgerIndex &&
    state.overlayLedgerHash === options.nextLedgerHash
  ) {
    return 'replayed'
  }
  if (
    state.overlayLedgerIndex !== options.expectedPreviousLedgerIndex ||
    state.overlayLedgerHash !== options.expectedPreviousLedgerHash
  ) {
    throw new Error('Current-state overlay watermark changed before advancement')
  }

  const result = await options.db
    .prepare(
      `UPDATE current_state_overlay_state
       SET overlay_ledger_index = ?1,
           overlay_ledger_hash = ?2,
           updated_at = ?3
       WHERE network = ?4
         AND epoch_id = ?5
         AND base_snapshot_id = ?6
         AND base_ledger_index = ?7
         AND base_ledger_hash = ?8
         AND overlay_ledger_index = ?9
         AND overlay_ledger_hash = ?10`,
    )
    .bind(
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
    )
    .run()

  if (result.meta.changes !== 1) {
    const current = await assertCurrentStateOverlayBase({ db: options.db, base: options.base })
    if (
      current.overlayLedgerIndex === options.nextLedgerIndex &&
      current.overlayLedgerHash === options.nextLedgerHash
    ) {
      return 'replayed'
    }
    throw new Error('Current-state overlay watermark advancement was not committed')
  }

  return 'advanced'
}
