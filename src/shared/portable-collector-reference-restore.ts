import {
  canonicalPortableJson,
  PortableCollectorReferenceStore,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'

interface PortableExportStateV1 {
  schemaVersion: 1
  work: Record<string, unknown>[]
  payloadChunks: Record<string, unknown>[]
  commitChunks: Record<string, unknown>[]
  referenceRows: Record<string, unknown>[]
  watermarks: Record<string, unknown>[]
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function records(value: unknown, name: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  return value.map((entry, index) => record(entry, `${name}[${index}]`))
}

function stringValue(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${key} must be a string or null`)
  return value
}

function integerValue(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${key} must be a safe integer`)
  }
  return value
}

function nullableInteger(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${key} must be a safe integer or null`)
  }
  return value
}

function hexPayload(row: Record<string, unknown>): Uint8Array {
  const payload = record(row.payload, 'payload')
  if (payload.encoding !== 'hex' || typeof payload.value !== 'string') {
    throw new Error('payload must use the deterministic hex export encoding')
  }
  if (payload.value.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(payload.value)) {
    throw new Error('payload hex is invalid')
  }
  const bytes = new Uint8Array(payload.value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(payload.value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function parseExport(exportedState: string): PortableExportStateV1 {
  let raw: unknown
  try {
    raw = JSON.parse(exportedState)
  } catch {
    throw new Error('portable export is not valid JSON')
  }
  const parsed = record(raw, 'export')
  if (parsed.schemaVersion !== 1) throw new Error('unsupported portable export schema version')
  return {
    schemaVersion: 1,
    work: records(parsed.work, 'work'),
    payloadChunks: records(parsed.payloadChunks, 'payloadChunks'),
    commitChunks: records(parsed.commitChunks, 'commitChunks'),
    referenceRows: records(parsed.referenceRows, 'referenceRows'),
    watermarks: records(parsed.watermarks, 'watermarks'),
  }
}

function requireEmptyReferenceStore(db: PortableSqliteDatabase): void {
  for (const table of [
    'collector_work',
    'collector_payload_chunks',
    'collector_commit_chunks',
    'collector_reference_rows',
    'collector_committed_watermarks',
  ]) {
    const count = db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count ?? 0
    if (count !== 0) throw new Error(`restore target is not empty: ${table}`)
  }
}

function insertWork(db: PortableSqliteDatabase, row: Record<string, unknown>): void {
  const parameters: PortableSqliteValue[] = [
    stringValue(row, 'work_id'),
    integerValue(row, 'schema_version'),
    stringValue(row, 'network'),
    stringValue(row, 'epoch_id'),
    stringValue(row, 'base_identity'),
    integerValue(row, 'previous_ledger_index'),
    integerValue(row, 'start_ledger_index'),
    stringValue(row, 'expected_parent_hash'),
    integerValue(row, 'planned_end_ledger_index'),
    nullableInteger(row, 'scanned_end_ledger_index'),
    nullableString(row, 'final_ledger_hash'),
    stringValue(row, 'status'),
    stringValue(row, 'plan_json'),
    nullableString(row, 'semantic_counts_json'),
    nullableString(row, 'payload_digest'),
    integerValue(row, 'expected_payload_chunks'),
    integerValue(row, 'expected_commit_chunks'),
    nullableString(row, 'error_code'),
    nullableString(row, 'error_message'),
    nullableString(row, 'lease_owner'),
    nullableString(row, 'lease_expires_at'),
    stringValue(row, 'created_at'),
    stringValue(row, 'updated_at'),
    nullableString(row, 'committed_at'),
  ]
  db.run(
    `INSERT INTO collector_work (
       work_id, schema_version, network, epoch_id, base_identity,
       previous_ledger_index, start_ledger_index, expected_parent_hash,
       planned_end_ledger_index, scanned_end_ledger_index, final_ledger_hash,
       status, plan_json, semantic_counts_json, payload_digest,
       expected_payload_chunks, expected_commit_chunks, error_code,
       error_message, lease_owner, lease_expires_at, created_at, updated_at,
       committed_at
     ) VALUES (${parameters.map(() => '?').join(', ')})`,
    parameters,
  )
}

function insertPayloadChunk(db: PortableSqliteDatabase, row: Record<string, unknown>): void {
  db.run(
    `INSERT INTO collector_payload_chunks (
       work_id, chunk_index, encoding, payload, payload_digest,
       byte_count, record_count, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'work_id'),
      integerValue(row, 'chunk_index'),
      stringValue(row, 'encoding'),
      hexPayload(row),
      stringValue(row, 'payload_digest'),
      integerValue(row, 'byte_count'),
      integerValue(row, 'record_count'),
      stringValue(row, 'created_at'),
    ],
  )
}

function insertCommitChunk(db: PortableSqliteDatabase, row: Record<string, unknown>): void {
  db.run(
    `INSERT INTO collector_commit_chunks (
       work_id, chunk_index, status, operation_count, row_mutation_count,
       chunk_digest, error_message, created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'work_id'),
      integerValue(row, 'chunk_index'),
      stringValue(row, 'status'),
      integerValue(row, 'operation_count'),
      integerValue(row, 'row_mutation_count'),
      stringValue(row, 'chunk_digest'),
      nullableString(row, 'error_message'),
      stringValue(row, 'created_at'),
      stringValue(row, 'updated_at'),
      nullableString(row, 'completed_at'),
    ],
  )
}

function insertReferenceRow(db: PortableSqliteDatabase, row: Record<string, unknown>): void {
  db.run(
    `INSERT INTO collector_reference_rows (
       work_id, semantic_class, canonical_key, source_ledger_index,
       source_ledger_hash, source_transaction_hash, object_id,
       relationship_ids_json, value_json, is_tombstone, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'work_id'),
      stringValue(row, 'semantic_class'),
      stringValue(row, 'canonical_key'),
      integerValue(row, 'source_ledger_index'),
      stringValue(row, 'source_ledger_hash'),
      nullableString(row, 'source_transaction_hash'),
      nullableString(row, 'object_id'),
      stringValue(row, 'relationship_ids_json'),
      nullableString(row, 'value_json'),
      integerValue(row, 'is_tombstone'),
      stringValue(row, 'created_at'),
    ],
  )
}

function insertWatermark(db: PortableSqliteDatabase, row: Record<string, unknown>): void {
  db.run(
    `INSERT INTO collector_committed_watermarks (
       network, epoch_id, base_identity, ledger_index, ledger_hash,
       work_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'network'),
      stringValue(row, 'epoch_id'),
      stringValue(row, 'base_identity'),
      integerValue(row, 'ledger_index'),
      stringValue(row, 'ledger_hash'),
      stringValue(row, 'work_id'),
      stringValue(row, 'updated_at'),
    ],
  )
}

export function restorePortableCollectorState(
  db: PortableSqliteDatabase,
  exportedState: string,
): void {
  const parsed = parseExport(exportedState)
  const canonicalInput = canonicalPortableJson(parsed)

  db.transaction(() => {
    requireEmptyReferenceStore(db)
    for (const row of parsed.work) insertWork(db, row)
    for (const row of parsed.payloadChunks) insertPayloadChunk(db, row)
    for (const row of parsed.commitChunks) insertCommitChunk(db, row)
    for (const row of parsed.referenceRows) insertReferenceRow(db, row)
    for (const row of parsed.watermarks) insertWatermark(db, row)

    const restored = new PortableCollectorReferenceStore(db).exportState()
    if (restored !== canonicalInput) {
      throw new Error('restored portable collector state does not match the exported state')
    }
  })
}
