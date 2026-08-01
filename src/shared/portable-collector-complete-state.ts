import type { PortableCollectorCompleteStateTransferAdapter } from './portable-collector-adapters'
import {
  canonicalPortableJson,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'
import {
  exportPortableCollectorRuntimeState,
  type PortableCollectorRuntimeExportV3,
} from './portable-collector-runtime-state'

export interface PortableCollectorCompleteStateExportV1 {
  schemaVersion: 1
  runtime: PortableCollectorRuntimeExportV3
  publicationCandidates: Record<string, unknown>[]
  publicationWorks: Record<string, unknown>[]
  publicationWatermarks: Record<string, unknown>[]
  maintenancePlans: Record<string, unknown>[]
  maintenanceMutations: Record<string, unknown>[]
}

export class PortableCollectorCompleteStateError extends Error {
  constructor(
    readonly code:
      | 'invalid_export'
      | 'unsupported_version'
      | 'target_not_empty'
      | 'restore_integrity_failure',
    message: string,
  ) {
    super(message)
    this.name = 'PortableCollectorCompleteStateError'
  }
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      `${name} must be an object`,
    )
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort()
  const required = [...expected].sort()
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      `${name} contains unexpected or missing fields`,
    )
  }
}

function recordArray(value: unknown, name: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      `${name} must be an array`,
    )
  }
  return value.map((entry, index) => objectValue(entry, `${name}[${index}]`))
}

function stringValue(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      `${key} must be a string`,
    )
  }
  return value
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      `${key} must be a string or null`,
    )
  }
  return value
}

function integerValue(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      `${key} must be a safe integer`,
    )
  }
  return value
}

function nullableInteger(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      `${key} must be a safe integer or null`,
    )
  }
  return value
}

function hexPayload(row: Record<string, unknown>): Uint8Array {
  const payload = objectValue(row.payload, 'payload')
  exactKeys(payload, ['encoding', 'value'], 'payload')
  if (payload.encoding !== 'hex' || typeof payload.value !== 'string') {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      'payload must use deterministic hex encoding',
    )
  }
  if (payload.value.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(payload.value)) {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      'payload hex is invalid',
    )
  }
  const bytes = new Uint8Array(payload.value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(payload.value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function parseRuntime(value: unknown): PortableCollectorRuntimeExportV3 {
  const runtime = objectValue(value, 'runtime')
  exactKeys(
    runtime,
    [
      'schemaVersion',
      'work',
      'payloadChunks',
      'commitChunks',
      'referenceRows',
      'watermarks',
      'schedulerMessages',
      'schedulerOutbox',
    ],
    'runtime',
  )
  if (runtime.schemaVersion !== 3) {
    throw new PortableCollectorCompleteStateError(
      'unsupported_version',
      'complete state requires portable runtime schema version 3',
    )
  }
  return {
    schemaVersion: 3,
    work: recordArray(runtime.work, 'runtime.work'),
    payloadChunks: recordArray(runtime.payloadChunks, 'runtime.payloadChunks'),
    commitChunks: recordArray(runtime.commitChunks, 'runtime.commitChunks'),
    referenceRows: recordArray(runtime.referenceRows, 'runtime.referenceRows'),
    watermarks: recordArray(runtime.watermarks, 'runtime.watermarks'),
    schedulerMessages: recordArray(
      runtime.schedulerMessages,
      'runtime.schedulerMessages',
    ),
    schedulerOutbox: recordArray(runtime.schedulerOutbox, 'runtime.schedulerOutbox'),
  }
}

function parseCompleteState(exportedState: string): PortableCollectorCompleteStateExportV1 {
  let raw: unknown
  try {
    raw = JSON.parse(exportedState)
  } catch {
    throw new PortableCollectorCompleteStateError(
      'invalid_export',
      'complete state export is not valid JSON',
    )
  }
  const parsed = objectValue(raw, 'completeState')
  exactKeys(
    parsed,
    [
      'schemaVersion',
      'runtime',
      'publicationCandidates',
      'publicationWorks',
      'publicationWatermarks',
      'maintenancePlans',
      'maintenanceMutations',
    ],
    'completeState',
  )
  if (parsed.schemaVersion !== 1) {
    throw new PortableCollectorCompleteStateError(
      'unsupported_version',
      'unsupported complete state schema version',
    )
  }
  return {
    schemaVersion: 1,
    runtime: parseRuntime(parsed.runtime),
    publicationCandidates: recordArray(
      parsed.publicationCandidates,
      'publicationCandidates',
    ),
    publicationWorks: recordArray(parsed.publicationWorks, 'publicationWorks'),
    publicationWatermarks: recordArray(
      parsed.publicationWatermarks,
      'publicationWatermarks',
    ),
    maintenancePlans: recordArray(parsed.maintenancePlans, 'maintenancePlans'),
    maintenanceMutations: recordArray(
      parsed.maintenanceMutations,
      'maintenanceMutations',
    ),
  }
}

function requireEmptyCompleteTarget(db: PortableSqliteDatabase): void {
  for (const table of [
    'collector_work',
    'collector_payload_chunks',
    'collector_commit_chunks',
    'collector_reference_rows',
    'collector_committed_watermarks',
    'collector_scheduler_messages',
    'collector_scheduler_outbox',
    'collector_publication_candidates',
    'collector_publication_works',
    'collector_publication_watermarks',
    'collector_maintenance_plans',
    'collector_maintenance_mutations',
  ]) {
    const count =
      db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count ?? 0
    if (count !== 0) {
      throw new PortableCollectorCompleteStateError(
        'target_not_empty',
        `complete state restore target is not empty: ${table}`,
      )
    }
  }
}

function placeholders(parameters: readonly PortableSqliteValue[]): string {
  return parameters.map(() => '?').join(', ')
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
     ) VALUES (${placeholders(parameters)})`,
    parameters,
  )
}

function insertPayloadChunk(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
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

function insertCommitChunk(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
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

function insertReferenceRow(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
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

function insertWatermark(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
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

function insertSchedulerMessage(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
  db.run(
    `INSERT INTO collector_scheduler_messages (
       message_id, schema_version, phase, payload_json, status,
       available_at, lease_owner, lease_expires_at, attempt_count,
       result_json, error_classification, error_message,
       successor_message_id, created_at, updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'message_id'),
      integerValue(row, 'schema_version'),
      stringValue(row, 'phase'),
      stringValue(row, 'payload_json'),
      stringValue(row, 'status'),
      stringValue(row, 'available_at'),
      nullableString(row, 'lease_owner'),
      nullableString(row, 'lease_expires_at'),
      integerValue(row, 'attempt_count'),
      nullableString(row, 'result_json'),
      nullableString(row, 'error_classification'),
      nullableString(row, 'error_message'),
      nullableString(row, 'successor_message_id'),
      stringValue(row, 'created_at'),
      stringValue(row, 'updated_at'),
      nullableString(row, 'completed_at'),
    ],
  )
}

function insertSchedulerOutbox(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
  db.run(
    `INSERT INTO collector_scheduler_outbox (
       current_message_id, successor_message_id, successor_payload_json,
       successor_available_at, status, created_at, dispatched_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'current_message_id'),
      stringValue(row, 'successor_message_id'),
      stringValue(row, 'successor_payload_json'),
      stringValue(row, 'successor_available_at'),
      stringValue(row, 'status'),
      stringValue(row, 'created_at'),
      nullableString(row, 'dispatched_at'),
    ],
  )
}

function insertPublicationCandidates(
  db: PortableSqliteDatabase,
  rows: readonly Record<string, unknown>[],
): void {
  const remaining = [...rows]
  const inserted = new Set<string>()
  while (remaining.length > 0) {
    let progressed = false
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const row = remaining[index]!
      const publicationId = stringValue(row, 'publication_id')
      const previousPublicationId = nullableString(row, 'previous_publication_id')
      if (previousPublicationId !== null && !inserted.has(previousPublicationId)) {
        continue
      }
      db.run(
        `INSERT INTO collector_publication_candidates (
           publication_id, stream_id, previous_publication_id, status,
           asset_json, asset_digest, manifest_json, manifest_digest,
           created_at, verified_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicationId,
          stringValue(row, 'stream_id'),
          previousPublicationId,
          stringValue(row, 'status'),
          stringValue(row, 'asset_json'),
          stringValue(row, 'asset_digest'),
          stringValue(row, 'manifest_json'),
          stringValue(row, 'manifest_digest'),
          stringValue(row, 'created_at'),
          nullableString(row, 'verified_at'),
        ],
      )
      inserted.add(publicationId)
      remaining.splice(index, 1)
      progressed = true
    }
    if (!progressed) {
      throw new PortableCollectorCompleteStateError(
        'invalid_export',
        'publication candidate chain contains a cycle or missing parent',
      )
    }
  }
}

function insertPublicationWork(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
  db.run(
    `INSERT INTO collector_publication_works (
       publication_id, work_position, work_id, network, epoch_id,
       base_identity, previous_ledger_index, expected_parent_hash,
       start_ledger_index, end_ledger_index, end_ledger_hash,
       payload_digest, semantic_counts_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'publication_id'),
      integerValue(row, 'work_position'),
      stringValue(row, 'work_id'),
      stringValue(row, 'network'),
      stringValue(row, 'epoch_id'),
      stringValue(row, 'base_identity'),
      integerValue(row, 'previous_ledger_index'),
      stringValue(row, 'expected_parent_hash'),
      integerValue(row, 'start_ledger_index'),
      integerValue(row, 'end_ledger_index'),
      stringValue(row, 'end_ledger_hash'),
      stringValue(row, 'payload_digest'),
      stringValue(row, 'semantic_counts_json'),
    ],
  )
}

function insertPublicationWatermark(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
  db.run(
    `INSERT INTO collector_publication_watermarks (
       stream_id, publication_id, work_id, ledger_index, ledger_hash, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'stream_id'),
      stringValue(row, 'publication_id'),
      stringValue(row, 'work_id'),
      integerValue(row, 'ledger_index'),
      stringValue(row, 'ledger_hash'),
      stringValue(row, 'updated_at'),
    ],
  )
}

function insertMaintenancePlan(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
  db.run(
    `INSERT INTO collector_maintenance_plans (
       plan_id, stream_id, verified_publication_id, status,
       plan_json, plan_digest, created_at, applied_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'plan_id'),
      stringValue(row, 'stream_id'),
      stringValue(row, 'verified_publication_id'),
      stringValue(row, 'status'),
      stringValue(row, 'plan_json'),
      stringValue(row, 'plan_digest'),
      stringValue(row, 'created_at'),
      nullableString(row, 'applied_at'),
    ],
  )
}

function insertMaintenanceMutation(
  db: PortableSqliteDatabase,
  row: Record<string, unknown>,
): void {
  db.run(
    `INSERT INTO collector_maintenance_mutations (
       plan_id, mutation_index, table_name, work_id, reason,
       status, applied_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      stringValue(row, 'plan_id'),
      integerValue(row, 'mutation_index'),
      stringValue(row, 'table_name'),
      stringValue(row, 'work_id'),
      stringValue(row, 'reason'),
      stringValue(row, 'status'),
      nullableString(row, 'applied_at'),
    ],
  )
}

function runtimeObject(db: PortableSqliteDatabase): PortableCollectorRuntimeExportV3 {
  const parsed = JSON.parse(exportPortableCollectorRuntimeState(db)) as unknown
  return parseRuntime(parsed)
}

export function exportPortableCollectorCompleteState(
  db: PortableSqliteDatabase,
): string {
  return canonicalPortableJson({
    schemaVersion: 1,
    runtime: runtimeObject(db),
    publicationCandidates: db.all<Record<string, unknown>>(
      `SELECT * FROM collector_publication_candidates
       ORDER BY created_at, publication_id`,
    ),
    publicationWorks: db.all<Record<string, unknown>>(
      `SELECT * FROM collector_publication_works
       ORDER BY publication_id, work_position`,
    ),
    publicationWatermarks: db.all<Record<string, unknown>>(
      `SELECT * FROM collector_publication_watermarks
       ORDER BY stream_id`,
    ),
    maintenancePlans: db.all<Record<string, unknown>>(
      `SELECT * FROM collector_maintenance_plans
       ORDER BY created_at, plan_id`,
    ),
    maintenanceMutations: db.all<Record<string, unknown>>(
      `SELECT * FROM collector_maintenance_mutations
       ORDER BY plan_id, mutation_index`,
    ),
  })
}

export function restorePortableCollectorCompleteState(
  db: PortableSqliteDatabase,
  exportedState: string,
): void {
  const parsed = parseCompleteState(exportedState)
  const canonicalInput = canonicalPortableJson(parsed)

  db.transaction(() => {
    requireEmptyCompleteTarget(db)
    for (const row of parsed.runtime.work) insertWork(db, row)
    for (const row of parsed.runtime.payloadChunks) insertPayloadChunk(db, row)
    for (const row of parsed.runtime.commitChunks) insertCommitChunk(db, row)
    for (const row of parsed.runtime.referenceRows) insertReferenceRow(db, row)
    for (const row of parsed.runtime.watermarks) insertWatermark(db, row)
    for (const row of parsed.runtime.schedulerMessages) {
      insertSchedulerMessage(db, row)
    }
    for (const row of parsed.runtime.schedulerOutbox) insertSchedulerOutbox(db, row)
    insertPublicationCandidates(db, parsed.publicationCandidates)
    for (const row of parsed.publicationWorks) insertPublicationWork(db, row)
    for (const row of parsed.publicationWatermarks) {
      insertPublicationWatermark(db, row)
    }
    for (const row of parsed.maintenancePlans) insertMaintenancePlan(db, row)
    for (const row of parsed.maintenanceMutations) {
      insertMaintenanceMutation(db, row)
    }

    const restored = exportPortableCollectorCompleteState(db)
    if (restored !== canonicalInput) {
      throw new PortableCollectorCompleteStateError(
        'restore_integrity_failure',
        'restored complete state does not match the exported state',
      )
    }
  })
}

export class SqlitePortableCollectorCompleteStateTransferAdapter
implements PortableCollectorCompleteStateTransferAdapter {
  constructor(private readonly db: PortableSqliteDatabase) {}

  exportCompleteState(): string {
    return exportPortableCollectorCompleteState(this.db)
  }

  restoreCompleteState(exportedState: string): void {
    restorePortableCollectorCompleteState(this.db, exportedState)
  }
}
