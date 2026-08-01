export type PortableSqliteValue = string | number | bigint | Uint8Array | null

export interface PortableSqliteRunResult {
  changes: number
}

export interface PortableSqliteDatabase {
  run(sql: string, parameters?: readonly PortableSqliteValue[]): PortableSqliteRunResult
  get<T>(sql: string, parameters?: readonly PortableSqliteValue[]): T | undefined
  all<T>(sql: string, parameters?: readonly PortableSqliteValue[]): T[]
  transaction<T>(operation: () => T): T
}

export interface PortableCollectorWorkDefinition {
  workId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  expectedParentHash: string
  plannedEndLedgerIndex: number
  planJson: string
  createdAt: string
}

export interface PortableCollectorWorkSnapshot {
  workId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  startLedgerIndex: number
  expectedParentHash: string
  plannedEndLedgerIndex: number
  scannedEndLedgerIndex: number | null
  finalLedgerHash: string | null
  status: string
  planJson: string
  semanticCountsJson: string | null
  payloadDigest: string | null
  expectedPayloadChunks: number
  expectedCommitChunks: number
  committedAt: string | null
}

export interface PortablePayloadChunk {
  workId: string
  chunkIndex: number
  encoding: string
  payload: Uint8Array
  payloadDigest: string
  recordCount: number
  createdAt: string
}

export interface PortablePayloadChunkSnapshot extends PortablePayloadChunk {
  byteCount: number
}

export interface PortableReferenceRow {
  workId: string
  semanticClass: string
  canonicalKey: string
  sourceLedgerIndex: number
  sourceLedgerHash: string
  valueJson: string | null
  isTombstone: boolean
  createdAt: string
}

export interface PortableCommitChunk {
  workId: string
  chunkIndex: number
  operationCount: number
  rowMutationCount: number
  chunkDigest: string
  completedAt: string
}

export interface PortableCommitChunkSnapshot extends PortableCommitChunk {
  status: string
  createdAt: string
  updatedAt: string
}

export interface PortableCommittedWatermark {
  network: string
  epochId: string
  baseIdentity: string
  ledgerIndex: number
  ledgerHash: string
  workId: string
  updatedAt: string
}

interface CollectorWorkRow {
  work_id: string
  network: string
  epoch_id: string
  base_identity: string
  previous_ledger_index: number
  start_ledger_index: number
  expected_parent_hash: string
  planned_end_ledger_index: number
  scanned_end_ledger_index: number | null
  final_ledger_hash: string | null
  status: string
  plan_json: string
  semantic_counts_json: string | null
  payload_digest: string | null
  expected_payload_chunks: number
  expected_commit_chunks: number
  committed_at: string | null
}

interface PayloadChunkRow {
  work_id: string
  chunk_index: number
  encoding: string
  payload: Uint8Array
  payload_digest: string
  byte_count: number
  record_count: number
  created_at: string
}

interface CommitChunkRow {
  work_id: string
  chunk_index: number
  status: string
  operation_count: number
  row_mutation_count: number
  chunk_digest: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface CountRow {
  count: number
}

interface ReferenceRowResult {
  work_id: string
  semantic_class: string
  canonical_key: string
  source_ledger_index: number
  source_ledger_hash: string
  value_json: string | null
  is_tombstone: number
  created_at: string
}

interface WatermarkRow {
  network: string
  epoch_id: string
  base_identity: string
  ledger_index: number
  ledger_hash: string
  work_id: string
  updated_at: string
}

const workSelect = `SELECT
  work_id, network, epoch_id, base_identity, previous_ledger_index,
  start_ledger_index, expected_parent_hash, planned_end_ledger_index,
  scanned_end_ledger_index, final_ledger_hash, status, plan_json,
  semantic_counts_json, payload_digest, expected_payload_chunks,
  expected_commit_chunks, committed_at
FROM collector_work`

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function requireNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}

function requireWork(db: PortableSqliteDatabase, workId: string): CollectorWorkRow {
  const work = db.get<CollectorWorkRow>(`${workSelect} WHERE work_id = ?`, [workId])
  if (!work) throw new Error(`collector work not found: ${workId}`)
  return work
}

function assertSameWork(existing: CollectorWorkRow, definition: PortableCollectorWorkDefinition): void {
  const expectedParentHash = definition.expectedParentHash.trim().toUpperCase()
  const mismatches = [
    existing.network !== definition.network,
    existing.epoch_id !== definition.epochId,
    existing.base_identity !== definition.baseIdentity,
    existing.previous_ledger_index !== definition.previousLedgerIndex,
    existing.start_ledger_index !== definition.previousLedgerIndex + 1,
    existing.expected_parent_hash !== expectedParentHash,
    existing.planned_end_ledger_index !== definition.plannedEndLedgerIndex,
    existing.plan_json !== definition.planJson,
  ]
  if (mismatches.some(Boolean)) {
    throw new Error(`collector work identity conflict: ${definition.workId}`)
  }
}

function mapWork(row: CollectorWorkRow): PortableCollectorWorkSnapshot {
  return {
    workId: row.work_id,
    network: row.network,
    epochId: row.epoch_id,
    baseIdentity: row.base_identity,
    previousLedgerIndex: row.previous_ledger_index,
    startLedgerIndex: row.start_ledger_index,
    expectedParentHash: row.expected_parent_hash,
    plannedEndLedgerIndex: row.planned_end_ledger_index,
    scannedEndLedgerIndex: row.scanned_end_ledger_index,
    finalLedgerHash: row.final_ledger_hash,
    status: row.status,
    planJson: row.plan_json,
    semanticCountsJson: row.semantic_counts_json,
    payloadDigest: row.payload_digest,
    expectedPayloadChunks: row.expected_payload_chunks,
    expectedCommitChunks: row.expected_commit_chunks,
    committedAt: row.committed_at,
  }
}

function mapPayloadChunk(row: PayloadChunkRow): PortablePayloadChunkSnapshot {
  return {
    workId: row.work_id,
    chunkIndex: row.chunk_index,
    encoding: row.encoding,
    payload: row.payload,
    payloadDigest: row.payload_digest,
    byteCount: row.byte_count,
    recordCount: row.record_count,
    createdAt: row.created_at,
  }
}

function mapCommitChunk(row: CommitChunkRow): PortableCommitChunkSnapshot {
  if (row.completed_at === null) {
    throw new Error(`commit chunk is missing completed_at: ${row.work_id}/${row.chunk_index}`)
  }
  return {
    workId: row.work_id,
    chunkIndex: row.chunk_index,
    status: row.status,
    operationCount: row.operation_count,
    rowMutationCount: row.row_mutation_count,
    chunkDigest: row.chunk_digest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function mapReferenceRow(row: ReferenceRowResult): PortableReferenceRow {
  return {
    workId: row.work_id,
    semanticClass: row.semantic_class,
    canonicalKey: row.canonical_key,
    sourceLedgerIndex: row.source_ledger_index,
    sourceLedgerHash: row.source_ledger_hash,
    valueJson: row.value_json,
    isTombstone: row.is_tombstone === 1,
    createdAt: row.created_at,
  }
}

function mapWatermark(row: WatermarkRow): PortableCommittedWatermark {
  return {
    network: row.network,
    epochId: row.epoch_id,
    baseIdentity: row.base_identity,
    ledgerIndex: row.ledger_index,
    ledgerHash: row.ledger_hash,
    workId: row.work_id,
    updatedAt: row.updated_at,
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0')
  return value
}

function normalizeExportValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { encoding: 'hex', value: bytesToHex(value) }
  }
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(normalizeExportValue)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeExportValue(nested)])
    return Object.fromEntries(entries)
  }
  return value
}

export function canonicalPortableJson(value: unknown): string {
  return JSON.stringify(normalizeExportValue(value))
}

export class PortableCollectorReferenceStore {
  constructor(private readonly db: PortableSqliteDatabase) {}

  beginWork(definition: PortableCollectorWorkDefinition): PortableCollectorWorkSnapshot {
    requireNonEmpty(definition.workId, 'workId')
    requireNonEmpty(definition.network, 'network')
    requireNonEmpty(definition.epochId, 'epochId')
    requireNonEmpty(definition.baseIdentity, 'baseIdentity')
    requireNonNegativeInteger(definition.previousLedgerIndex, 'previousLedgerIndex')
    requirePositiveInteger(definition.plannedEndLedgerIndex, 'plannedEndLedgerIndex')
    requireNonEmpty(definition.planJson, 'planJson')
    const expectedParentHash = requireNonEmpty(
      definition.expectedParentHash,
      'expectedParentHash',
    ).toUpperCase()
    if (definition.plannedEndLedgerIndex < definition.previousLedgerIndex + 1) {
      throw new Error('plannedEndLedgerIndex must not precede the start ledger')
    }

    this.db.run(
      `INSERT OR IGNORE INTO collector_work (
         work_id, schema_version, network, epoch_id, base_identity,
         previous_ledger_index, start_ledger_index, expected_parent_hash,
         planned_end_ledger_index, status, plan_json, created_at, updated_at
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)`,
      [
        definition.workId,
        definition.network,
        definition.epochId,
        definition.baseIdentity,
        definition.previousLedgerIndex,
        definition.previousLedgerIndex + 1,
        expectedParentHash,
        definition.plannedEndLedgerIndex,
        definition.planJson,
        definition.createdAt,
        definition.createdAt,
      ],
    )

    const work = requireWork(this.db, definition.workId)
    assertSameWork(work, definition)
    return mapWork(work)
  }

  getWork(workId: string): PortableCollectorWorkSnapshot | undefined {
    const row = this.db.get<CollectorWorkRow>(`${workSelect} WHERE work_id = ?`, [workId])
    return row ? mapWork(row) : undefined
  }

  getPayloadChunk(workId: string, chunkIndex: number): PortablePayloadChunkSnapshot | undefined {
    requireNonNegativeInteger(chunkIndex, 'chunkIndex')
    const row = this.db.get<PayloadChunkRow>(
      `SELECT work_id, chunk_index, encoding, payload, payload_digest,
              byte_count, record_count, created_at
       FROM collector_payload_chunks
       WHERE work_id = ? AND chunk_index = ?`,
      [workId, chunkIndex],
    )
    return row ? mapPayloadChunk(row) : undefined
  }

  listPayloadChunks(workId: string): PortablePayloadChunkSnapshot[] {
    return this.db.all<PayloadChunkRow>(
      `SELECT work_id, chunk_index, encoding, payload, payload_digest,
              byte_count, record_count, created_at
       FROM collector_payload_chunks
       WHERE work_id = ?
       ORDER BY chunk_index`,
      [workId],
    ).map(mapPayloadChunk)
  }

  listCommitChunks(workId: string): PortableCommitChunkSnapshot[] {
    return this.db.all<CommitChunkRow>(
      `SELECT work_id, chunk_index, status, operation_count, row_mutation_count,
              chunk_digest, created_at, updated_at, completed_at
       FROM collector_commit_chunks
       WHERE work_id = ?
       ORDER BY chunk_index`,
      [workId],
    ).map(mapCommitChunk)
  }

  listReferenceRowsForWork(workId: string): PortableReferenceRow[] {
    return this.db.all<ReferenceRowResult>(
      `SELECT work_id, semantic_class, canonical_key, source_ledger_index,
              source_ledger_hash, value_json, is_tombstone, created_at
       FROM collector_reference_rows
       WHERE work_id = ?
       ORDER BY source_ledger_index, semantic_class, canonical_key`,
      [workId],
    ).map(mapReferenceRow)
  }

  stagePayloadChunk(chunk: PortablePayloadChunk): void {
    requireNonNegativeInteger(chunk.chunkIndex, 'chunkIndex')
    requireNonNegativeInteger(chunk.recordCount, 'recordCount')
    requireNonEmpty(chunk.encoding, 'encoding')
    requireNonEmpty(chunk.payloadDigest, 'payloadDigest')
    requireWork(this.db, chunk.workId)

    this.db.run(
      `INSERT OR IGNORE INTO collector_payload_chunks (
         work_id, chunk_index, encoding, payload, payload_digest,
         byte_count, record_count, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chunk.workId,
        chunk.chunkIndex,
        chunk.encoding,
        chunk.payload,
        chunk.payloadDigest,
        chunk.payload.byteLength,
        chunk.recordCount,
        chunk.createdAt,
      ],
    )

    const existing = this.db.get<{
      encoding: string
      payload_digest: string
      byte_count: number
      record_count: number
    }>(
      `SELECT encoding, payload_digest, byte_count, record_count
       FROM collector_payload_chunks
       WHERE work_id = ? AND chunk_index = ?`,
      [chunk.workId, chunk.chunkIndex],
    )
    if (
      !existing ||
      existing.encoding !== chunk.encoding ||
      existing.payload_digest !== chunk.payloadDigest ||
      existing.byte_count !== chunk.payload.byteLength ||
      existing.record_count !== chunk.recordCount
    ) {
      throw new Error(`payload chunk conflict: ${chunk.workId}/${chunk.chunkIndex}`)
    }
  }

  stageReferenceRow(row: PortableReferenceRow): void {
    requireNonEmpty(row.semanticClass, 'semanticClass')
    requireNonEmpty(row.canonicalKey, 'canonicalKey')
    requireNonNegativeInteger(row.sourceLedgerIndex, 'sourceLedgerIndex')
    const sourceLedgerHash = requireNonEmpty(row.sourceLedgerHash, 'sourceLedgerHash').toUpperCase()
    requireWork(this.db, row.workId)

    this.db.run(
      `INSERT OR IGNORE INTO collector_reference_rows (
         work_id, semantic_class, canonical_key, source_ledger_index,
         source_ledger_hash, value_json, is_tombstone, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.workId,
        row.semanticClass,
        row.canonicalKey,
        row.sourceLedgerIndex,
        sourceLedgerHash,
        row.valueJson,
        row.isTombstone ? 1 : 0,
        row.createdAt,
      ],
    )

    const existing = this.db.get<{
      source_ledger_index: number
      source_ledger_hash: string
      value_json: string | null
      is_tombstone: number
    }>(
      `SELECT source_ledger_index, source_ledger_hash, value_json, is_tombstone
       FROM collector_reference_rows
       WHERE work_id = ? AND semantic_class = ? AND canonical_key = ?`,
      [row.workId, row.semanticClass, row.canonicalKey],
    )
    if (
      !existing ||
      existing.source_ledger_index !== row.sourceLedgerIndex ||
      existing.source_ledger_hash !== sourceLedgerHash ||
      existing.value_json !== row.valueJson ||
      existing.is_tombstone !== (row.isTombstone ? 1 : 0)
    ) {
      throw new Error(
        `reference row conflict: ${row.workId}/${row.semanticClass}/${row.canonicalKey}`,
      )
    }
  }

  sealScan(options: {
    workId: string
    scannedEndLedgerIndex: number
    finalLedgerHash: string
    semanticCountsJson: string
    payloadDigest: string
    expectedPayloadChunks: number
    expectedCommitChunks: number
    updatedAt: string
  }): void {
    const work = requireWork(this.db, options.workId)
    requireNonNegativeInteger(options.expectedPayloadChunks, 'expectedPayloadChunks')
    requireNonNegativeInteger(options.expectedCommitChunks, 'expectedCommitChunks')
    if (
      options.scannedEndLedgerIndex < work.start_ledger_index ||
      options.scannedEndLedgerIndex > work.planned_end_ledger_index
    ) {
      throw new Error('scannedEndLedgerIndex is outside the planned range')
    }

    const payloadCount = this.db.get<CountRow>(
      'SELECT COUNT(*) AS count FROM collector_payload_chunks WHERE work_id = ?',
      [options.workId],
    )?.count
    if (payloadCount !== options.expectedPayloadChunks) {
      throw new Error(
        `payload chunk count mismatch: expected ${options.expectedPayloadChunks}, received ${payloadCount ?? 0}`,
      )
    }

    const result = this.db.run(
      `UPDATE collector_work
       SET status = 'staged',
           scanned_end_ledger_index = ?,
           final_ledger_hash = ?,
           semantic_counts_json = ?,
           payload_digest = ?,
           expected_payload_chunks = ?,
           expected_commit_chunks = ?,
           updated_at = ?
       WHERE work_id = ?
         AND status IN ('planned', 'scanning', 'staged')`,
      [
        options.scannedEndLedgerIndex,
        requireNonEmpty(options.finalLedgerHash, 'finalLedgerHash').toUpperCase(),
        requireNonEmpty(options.semanticCountsJson, 'semanticCountsJson'),
        requireNonEmpty(options.payloadDigest, 'payloadDigest'),
        options.expectedPayloadChunks,
        options.expectedCommitChunks,
        options.updatedAt,
        options.workId,
      ],
    )
    if (result.changes !== 1) throw new Error(`collector work cannot be staged: ${options.workId}`)
  }

  completeCommitChunk(chunk: PortableCommitChunk): void {
    requireNonNegativeInteger(chunk.chunkIndex, 'chunkIndex')
    requireNonNegativeInteger(chunk.operationCount, 'operationCount')
    requireNonNegativeInteger(chunk.rowMutationCount, 'rowMutationCount')
    requireNonEmpty(chunk.chunkDigest, 'chunkDigest')
    const work = requireWork(this.db, chunk.workId)
    if (!['staged', 'committing'].includes(work.status)) {
      throw new Error(`collector work cannot accept commit chunks from status ${work.status}`)
    }

    this.db.run(
      `INSERT OR IGNORE INTO collector_commit_chunks (
         work_id, chunk_index, status, operation_count, row_mutation_count,
         chunk_digest, created_at, updated_at, completed_at
       ) VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?)`,
      [
        chunk.workId,
        chunk.chunkIndex,
        chunk.operationCount,
        chunk.rowMutationCount,
        chunk.chunkDigest,
        chunk.completedAt,
        chunk.completedAt,
        chunk.completedAt,
      ],
    )

    const existing = this.db.get<{
      status: string
      operation_count: number
      row_mutation_count: number
      chunk_digest: string
    }>(
      `SELECT status, operation_count, row_mutation_count, chunk_digest
       FROM collector_commit_chunks
       WHERE work_id = ? AND chunk_index = ?`,
      [chunk.workId, chunk.chunkIndex],
    )
    if (
      !existing ||
      existing.status !== 'completed' ||
      existing.operation_count !== chunk.operationCount ||
      existing.row_mutation_count !== chunk.rowMutationCount ||
      existing.chunk_digest !== chunk.chunkDigest
    ) {
      throw new Error(`commit chunk conflict: ${chunk.workId}/${chunk.chunkIndex}`)
    }

    this.db.run(
      `UPDATE collector_work
       SET status = 'committing', updated_at = ?
       WHERE work_id = ? AND status IN ('staged', 'committing')`,
      [chunk.completedAt, chunk.workId],
    )
  }

  finalizeWork(options: {
    workId: string
    committedAt: string
  }): PortableCommittedWatermark {
    return this.db.transaction(() => this.finalizeWorkInTransaction(options))
  }

  finalizeWorkInTransaction(options: {
    workId: string
    committedAt: string
  }): PortableCommittedWatermark {
    let work = requireWork(this.db, options.workId)
    if (work.status === 'committed') {
      const existing = this.getWatermark(work.network, work.epoch_id, work.base_identity)
      if (!existing || existing.workId !== work.work_id) {
        throw new Error(`committed work is not the active watermark: ${work.work_id}`)
      }
      return existing
    }
    if (!['staged', 'committing', 'finalizing'].includes(work.status)) {
      throw new Error(`collector work cannot finalize from status ${work.status}`)
    }
    if (work.scanned_end_ledger_index === null || work.final_ledger_hash === null) {
      throw new Error('collector work is missing sealed scan evidence')
    }

    const payloadCount = this.db.get<CountRow>(
      'SELECT COUNT(*) AS count FROM collector_payload_chunks WHERE work_id = ?',
      [work.work_id],
    )?.count ?? 0
    const completedCommitCount = this.db.get<CountRow>(
      `SELECT COUNT(*) AS count
       FROM collector_commit_chunks
       WHERE work_id = ? AND status = 'completed'`,
      [work.work_id],
    )?.count ?? 0
    if (payloadCount !== work.expected_payload_chunks) {
      throw new Error('cannot finalize before every payload chunk exists')
    }
    if (completedCommitCount !== work.expected_commit_chunks) {
      throw new Error('cannot finalize before every commit chunk is complete')
    }

    const current = this.getWatermark(work.network, work.epoch_id, work.base_identity)
    if (
      current &&
      (current.ledgerIndex !== work.previous_ledger_index ||
        current.ledgerHash !== work.expected_parent_hash)
    ) {
      throw new Error('committed watermark does not match the work parent boundary')
    }

    const finalizing = this.db.run(
      `UPDATE collector_work
       SET status = 'finalizing', updated_at = ?
       WHERE work_id = ? AND status IN ('staged', 'committing', 'finalizing')`,
      [options.committedAt, work.work_id],
    )
    if (finalizing.changes !== 1) throw new Error(`failed to claim finalization: ${work.work_id}`)

    this.db.run(
      `INSERT INTO collector_committed_watermarks (
         network, epoch_id, base_identity, ledger_index, ledger_hash,
         work_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (network, epoch_id, base_identity) DO UPDATE SET
         ledger_index = excluded.ledger_index,
         ledger_hash = excluded.ledger_hash,
         work_id = excluded.work_id,
         updated_at = excluded.updated_at`,
      [
        work.network,
        work.epoch_id,
        work.base_identity,
        work.scanned_end_ledger_index,
        work.final_ledger_hash,
        work.work_id,
        options.committedAt,
      ],
    )

    const committed = this.db.run(
      `UPDATE collector_work
       SET status = 'committed', committed_at = ?, updated_at = ?
       WHERE work_id = ? AND status = 'finalizing'`,
      [options.committedAt, options.committedAt, work.work_id],
    )
    if (committed.changes !== 1) throw new Error(`failed to commit collector work: ${work.work_id}`)

    work = requireWork(this.db, options.workId)
    if (work.status !== 'committed') throw new Error(`collector work did not commit: ${work.work_id}`)
    const watermark = this.getWatermark(work.network, work.epoch_id, work.base_identity)
    if (!watermark || watermark.workId !== work.work_id) {
      throw new Error(`collector watermark did not advance: ${work.work_id}`)
    }
    return watermark
  }

  getWatermark(
    network: string,
    epochId: string,
    baseIdentity: string,
  ): PortableCommittedWatermark | undefined {
    const row = this.db.get<WatermarkRow>(
      `SELECT network, epoch_id, base_identity, ledger_index, ledger_hash, work_id, updated_at
       FROM collector_committed_watermarks
       WHERE network = ? AND epoch_id = ? AND base_identity = ?`,
      [network, epochId, baseIdentity],
    )
    return row ? mapWatermark(row) : undefined
  }

  listCommittedReferenceRows(): PortableReferenceRow[] {
    return this.db.all<ReferenceRowResult>(
      `SELECT
         work_id, semantic_class, canonical_key, source_ledger_index,
         source_ledger_hash, value_json, is_tombstone, created_at
       FROM collector_committed_reference_rows
       ORDER BY source_ledger_index, semantic_class, canonical_key, work_id`,
    ).map(mapReferenceRow)
  }

  exportState(): string {
    return canonicalPortableJson({
      schemaVersion: 1,
      work: this.db.all<Record<string, unknown>>(
        'SELECT * FROM collector_work ORDER BY created_at, work_id',
      ),
      payloadChunks: this.db.all<Record<string, unknown>>(
        'SELECT * FROM collector_payload_chunks ORDER BY work_id, chunk_index',
      ),
      commitChunks: this.db.all<Record<string, unknown>>(
        'SELECT * FROM collector_commit_chunks ORDER BY work_id, chunk_index',
      ),
      referenceRows: this.db.all<Record<string, unknown>>(
        `SELECT * FROM collector_reference_rows
         ORDER BY work_id, semantic_class, canonical_key`,
      ),
      watermarks: this.db.all<Record<string, unknown>>(
        `SELECT * FROM collector_committed_watermarks
         ORDER BY network, epoch_id, base_identity`,
      ),
    })
  }
}
