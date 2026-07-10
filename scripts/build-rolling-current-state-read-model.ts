import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'

import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import {
  parseRollingCurrentStateBaseManifest,
  rollingBaseManifestDigest,
  rollingBaseSegmentForId,
  type RollingBaseKind,
  type RollingCurrentStateBaseManifest,
} from '../src/shared/current-state/rolling-base'
import {
  compareReplacementMutationPosition,
  prepareReplacementMutation,
  type PreparedReplacementMutation,
} from '../src/shared/current-state/replacement-read-model'
import { assertHistoryExtensionPlan, type HistoryExtensionPlan } from '../src/shared/history-segments/extension-plan'
import { assertHistorySegmentManifest, type HistorySegmentManifest } from '../src/shared/history-segments/manifest'

type ReadKind = 'vault' | 'loan-broker' | 'loan'

type Arguments = {
  baseReadModelDir: string | null
  baseRollingDir: string | null
  historyRoot: string
  planPath: string
  outputDir: string
  pageSize: number
  lookupPrefixLength: number
  rollingSegments: number
  snapshotId: string | null
  releaseTag: string | null
}

type Counts = { vaults: number; loanBrokers: number; loans: number }

type BaseIdentity = {
  epochId: string
  snapshotId: string
  ledgerIndex: number
  ledgerHash: string
  counts: Counts
}

type ReadModelManifest = {
  schemaVersion: 1
  snapshotId: string
  epochId: string
  releaseTag: string
  ledgerIndex: number
  ledgerHash: string
  complete: true
  pageSize: number
  lookupPrefixLength: number
  counts: Counts
  pageCounts: Counts
  manifestSha256: string | null
}

type StoredProjectionRow = { id: string; kind: ReadKind; projection_json: string }
type LookupRow = { id: string; kind: ReadKind; page_no: number; offset_no: number }
type MutationSourceRow = {
  ledger_index: number
  transaction_index: number
  ledger_hash: string
  transaction_hash: string
  operation: 'upsert' | 'deleted'
  kind: ReadKind
  projection_json: string | null
}
type MutationStats = { records: number; appliedUpserts: number; appliedDeletes: number; replayed: number }
type RollingBaseRecord = { schemaVersion: 1; id: string; kind: ReadKind; projection: Record<string, unknown> }

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function requiredArgument(args: readonly string[], name: string): string {
  const value = argumentValue(args, name)
  if (value === null) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(args: readonly string[], name: string, fallback: number): number {
  const raw = argumentValue(args, name)
  if (raw === null) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('Rolling current-state generation requires --local')
  const baseReadModel = argumentValue(args, '--base-read-model-dir')
  const baseRolling = argumentValue(args, '--base-rolling-dir')
  if ((baseReadModel === null) === (baseRolling === null)) {
    throw new Error('Exactly one of --base-read-model-dir or --base-rolling-dir is required')
  }
  return {
    baseReadModelDir: baseReadModel === null ? null : resolve(baseReadModel),
    baseRollingDir: baseRolling === null ? null : resolve(baseRolling),
    historyRoot: resolve(requiredArgument(args, '--history-root')),
    planPath: resolve(requiredArgument(args, '--plan')),
    outputDir: resolve(requiredArgument(args, '--output-dir')),
    pageSize: positiveInteger(args, '--page-size', 50),
    lookupPrefixLength: positiveInteger(args, '--lookup-prefix-length', 3),
    rollingSegments: positiveInteger(args, '--rolling-segments', 64),
    snapshotId: argumentValue(args, '--snapshot-id'),
    releaseTag: argumentValue(args, '--release-tag'),
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${field} must be a safe integer >= ${minimum}`)
  return Number(value)
}

function id(value: unknown, field: string): string {
  const result = text(value, field).toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(result)) throw new Error(`${field} must be a 64-character object ID`)
  return result
}

function flatText(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`${field} must be a flat safe identifier`)
  return value
}

function emptyCounts(): Counts {
  return { vaults: 0, loanBrokers: 0, loans: 0 }
}

function addKindCount(counts: Counts, kind: ReadKind): void {
  if (kind === 'vault') counts.vaults += 1
  else if (kind === 'loan-broker') counts.loanBrokers += 1
  else counts.loans += 1
}

function addCounts(target: Counts, source: Counts): void {
  target.vaults += source.vaults
  target.loanBrokers += source.loanBrokers
  target.loans += source.loans
}

function projectionKind(kind: ReadKind): string {
  return kind === 'loan-broker' ? 'loan_broker' : kind
}

function pageProjection(kind: ReadKind, value: unknown): Record<string, unknown> {
  const source = record(value, `${kind} page record`)
  if (kind === 'vault') return source
  return record(source[kind === 'loan-broker' ? 'broker' : 'loan'], `${kind} page projection`)
}

function createWorkDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE objects (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      projection_json TEXT NOT NULL
    );
    CREATE INDEX objects_kind_id ON objects(kind, id);
    CREATE TABLE refs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      page_no INTEGER NOT NULL,
      offset_no INTEGER NOT NULL
    );
    CREATE TABLE mutation_sources (
      id TEXT PRIMARY KEY,
      ledger_index INTEGER NOT NULL,
      transaction_index INTEGER NOT NULL,
      ledger_hash TEXT NOT NULL,
      transaction_hash TEXT NOT NULL,
      operation TEXT NOT NULL,
      kind TEXT NOT NULL,
      projection_json TEXT
    );
  `)
  return db
}

async function ingestReadModelBase(db: DatabaseSync, baseDir: string): Promise<BaseIdentity> {
  const manifest = record(JSON.parse(await readFile(join(baseDir, 'manifest.json'), 'utf8')), 'read-model manifest')
  if (manifest.schemaVersion !== 1 || manifest.complete !== true) throw new Error('Base read-model manifest is incomplete or unsupported')
  const epochId = text(manifest.epochId, 'manifest.epochId')
  const snapshotId = text(manifest.snapshotId, 'manifest.snapshotId')
  const ledgerIndex = integer(manifest.ledgerIndex, 'manifest.ledgerIndex', 1)
  const ledgerHash = id(manifest.ledgerHash, 'manifest.ledgerHash')
  const manifestCounts = record(manifest.counts, 'manifest.counts')
  const pageCounts = record(manifest.pageCounts, 'manifest.pageCounts')
  const expected: Counts = {
    vaults: integer(manifestCounts.vaults, 'counts.vaults'),
    loanBrokers: integer(manifestCounts.loanBrokers, 'counts.loanBrokers'),
    loans: integer(manifestCounts.loans, 'counts.loans'),
  }
  const pages: Record<ReadKind, number> = {
    vault: integer(pageCounts.vaults, 'pageCounts.vaults'),
    'loan-broker': integer(pageCounts.loanBrokers, 'pageCounts.loanBrokers'),
    loan: integer(pageCounts.loans, 'pageCounts.loans'),
  }
  const insert = db.prepare('INSERT INTO objects (id, kind, projection_json) VALUES (?, ?, ?)')
  const actual = emptyCounts()
  let batch = 0
  db.exec('BEGIN')
  try {
    for (const kind of ['vault', 'loan-broker', 'loan'] as const) {
      for (let pageNo = 0; pageNo < pages[kind]; pageNo += 1) {
        const path = join(baseDir, 'pages', kind, `${String(pageNo).padStart(8, '0')}.json.gz`)
        const page = record(JSON.parse(gunzipSync(await readFile(path)).toString('utf8')), `${kind} page ${pageNo}`)
        if (!Array.isArray(page.records)) throw new Error(`${kind} page ${pageNo} records are unavailable`)
        for (const pageRecord of page.records) {
          const projection = pageProjection(kind, pageRecord)
          if (projection.kind !== projectionKind(kind)) throw new Error(`Projection kind mismatch in ${kind} page ${pageNo}`)
          const objectId = id(projection.id, 'projection.id')
          insert.run(objectId, kind, canonicalJson(projection))
          addKindCount(actual, kind)
          batch += 1
          if (batch >= 20_000) {
            db.exec('COMMIT')
            db.exec('BEGIN')
            batch = 0
          }
        }
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error('Base read-model counts do not match its manifest')
  return { epochId, snapshotId, ledgerIndex, ledgerHash, counts: actual }
}

async function ingestRollingBase(db: DatabaseSync, baseDir: string): Promise<BaseIdentity> {
  const manifestValue = JSON.parse(await readFile(join(baseDir, 'manifest.json'), 'utf8'))
  const manifest = parseRollingCurrentStateBaseManifest(manifestValue)
  if (await rollingBaseManifestDigest(manifest) !== manifest.manifestSha256) throw new Error('Rolling base manifest digest mismatch')
  const insert = db.prepare('INSERT INTO objects (id, kind, projection_json) VALUES (?, ?, ?)')
  const actual = emptyCounts()
  let batch = 0
  db.exec('BEGIN')
  try {
    for (const asset of manifest.assets) {
      const compressed = new Uint8Array(await readFile(join(baseDir, asset.path)))
      if (compressed.byteLength !== asset.bytes || await sha256Hex(compressed) !== asset.sha256) {
        throw new Error(`Rolling base asset integrity mismatch: ${asset.path}`)
      }
      const lines = gunzipSync(compressed).toString('utf8').split('\n').filter(Boolean)
      if (lines.length !== asset.records) throw new Error(`Rolling base record count mismatch: ${asset.path}`)
      for (const line of lines) {
        const value = record(JSON.parse(line), 'rolling base record')
        if (value.schemaVersion !== 1) throw new Error('Rolling base record schema is unsupported')
        const kind = value.kind
        if (kind !== 'vault' && kind !== 'loan-broker' && kind !== 'loan') throw new Error('Rolling base record kind is invalid')
        const objectId = id(value.id, 'rolling base record id')
        const projection = record(value.projection, 'rolling base projection')
        if (projection.kind !== projectionKind(kind)) throw new Error('Rolling base projection kind mismatch')
        if (id(projection.id, 'rolling base projection id') !== objectId) throw new Error('Rolling base projection ID mismatch')
        insert.run(objectId, kind, canonicalJson(projection))
        addKindCount(actual, kind)
        batch += 1
        if (batch >= 20_000) {
          db.exec('COMMIT')
          db.exec('BEGIN')
          batch = 0
        }
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  if (canonicalJson(actual) !== canonicalJson(manifest.counts)) throw new Error('Rolling base ingested counts mismatch')
  return {
    epochId: manifest.epochId,
    snapshotId: manifest.snapshotId,
    ledgerIndex: manifest.ledgerIndex,
    ledgerHash: manifest.ledgerHash,
    counts: actual,
  }
}

function sameSource(row: MutationSourceRow, mutation: PreparedReplacementMutation): boolean {
  return row.ledger_index === mutation.ledgerIndex
    && row.transaction_index === mutation.transactionIndex
    && row.ledger_hash === mutation.ledgerHash
    && row.transaction_hash === mutation.transactionHash
    && row.operation === mutation.operation
    && row.kind === mutation.readKind
    && row.projection_json === mutation.projectionJson
}

function applyPreparedMutation(db: DatabaseSync, mutation: PreparedReplacementMutation): 'upsert' | 'delete' | 'replay' {
  const sourceById = db.prepare(`
    SELECT ledger_index, transaction_index, ledger_hash, transaction_hash,
           operation, kind, projection_json
    FROM mutation_sources WHERE id = ?
  `)
  const objectById = db.prepare('SELECT id, kind, projection_json FROM objects WHERE id = ?')
  const existingSource = sourceById.get(mutation.objectId) as MutationSourceRow | undefined
  if (existingSource) {
    const order = compareReplacementMutationPosition(
      { ledgerIndex: mutation.ledgerIndex, transactionIndex: mutation.transactionIndex },
      { ledgerIndex: existingSource.ledger_index, transactionIndex: existingSource.transaction_index },
    )
    if (order < 0) throw new Error(`Stale rolling mutation for ${mutation.objectId}`)
    if (order === 0) {
      if (sameSource(existingSource, mutation)) return 'replay'
      throw new Error(`Conflicting rolling mutation at the same source position for ${mutation.objectId}`)
    }
  }
  const existing = objectById.get(mutation.objectId) as StoredProjectionRow | undefined
  if (existing && existing.kind !== mutation.readKind) throw new Error(`Rolling mutation changes object kind for ${mutation.objectId}`)
  if (mutation.operation === 'upsert') {
    if (mutation.projectionJson === null) throw new Error('Rolling upsert is missing projection JSON')
    if (canonicalJson(JSON.parse(mutation.projectionJson)) !== mutation.projectionJson) {
      throw new Error(`Rolling projection JSON is not canonical for ${mutation.objectId}`)
    }
    db.prepare(`
      INSERT INTO objects (id, kind, projection_json) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, projection_json=excluded.projection_json
    `).run(mutation.objectId, mutation.readKind, mutation.projectionJson)
  } else {
    const result = db.prepare('DELETE FROM objects WHERE id = ?').run(mutation.objectId)
    if (Number(result.changes) !== 1) throw new Error(`Rolling deletion target is unavailable: ${mutation.objectId}`)
  }
  db.prepare(`
    INSERT INTO mutation_sources (
      id, ledger_index, transaction_index, ledger_hash, transaction_hash,
      operation, kind, projection_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ledger_index=excluded.ledger_index,
      transaction_index=excluded.transaction_index,
      ledger_hash=excluded.ledger_hash,
      transaction_hash=excluded.transaction_hash,
      operation=excluded.operation,
      kind=excluded.kind,
      projection_json=excluded.projection_json
  `).run(
    mutation.objectId,
    mutation.ledgerIndex,
    mutation.transactionIndex,
    mutation.ledgerHash,
    mutation.transactionHash,
    mutation.operation,
    mutation.readKind,
    mutation.projectionJson,
  )
  return mutation.operation === 'upsert' ? 'upsert' : 'delete'
}

async function applyDeltaMutations(options: {
  db: DatabaseSync
  historyRoot: string
  plan: HistoryExtensionPlan
}): Promise<MutationStats> {
  const stats: MutationStats = { records: 0, appliedUpserts: 0, appliedDeletes: 0, replayed: 0 }
  let previous: PreparedReplacementMutation | null = null
  for (const descriptor of options.plan.extension.segments) {
    const manifestPath = join(options.historyRoot, 'history', options.plan.epochId, descriptor.segmentId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as HistorySegmentManifest
    assertHistorySegmentManifest(manifest)
    if (
      manifest.segmentId !== descriptor.segmentId
      || manifest.startLedgerIndex !== descriptor.startLedgerIndex
      || manifest.endLedgerIndex !== descriptor.endLedgerIndex
    ) throw new Error(`Rolling segment identity mismatch: ${descriptor.segmentId}`)
    const mutationFile = manifest.files.find((file) => file.kind === 'current_projection_mutations')
    if (!mutationFile) throw new Error(`Rolling mutation file is unavailable: ${descriptor.segmentId}`)
    const mutationPath = join(dirname(manifestPath), mutationFile.path)
    const compressed = new Uint8Array(await readFile(mutationPath))
    if (compressed.byteLength !== mutationFile.bytes || await sha256Hex(compressed) !== mutationFile.sha256) {
      throw new Error(`Rolling mutation asset integrity mismatch: ${descriptor.segmentId}`)
    }
    const lines = gunzipSync(compressed).toString('utf8').split('\n').filter(Boolean)
    if (lines.length !== mutationFile.records) throw new Error(`Rolling mutation record count mismatch: ${descriptor.segmentId}`)
    options.db.exec('BEGIN')
    try {
      for (const line of lines) {
        const mutation = prepareReplacementMutation(JSON.parse(line))
        if (previous && compareReplacementMutationPosition(previous, mutation) > 0) {
          throw new Error('Rolling mutation stream is not globally ordered')
        }
        previous = mutation
        const result = applyPreparedMutation(options.db, mutation)
        stats.records += 1
        if (result === 'upsert') stats.appliedUpserts += 1
        else if (result === 'delete') stats.appliedDeletes += 1
        else stats.replayed += 1
      }
      options.db.exec('COMMIT')
    } catch (error) {
      options.db.exec('ROLLBACK')
      throw error
    }
  }
  return stats
}

function requiredProjection(
  statement: ReturnType<DatabaseSync['prepare']>,
  objectId: string,
  kind: ReadKind,
): Record<string, unknown> {
  const row = statement.get(objectId, kind) as StoredProjectionRow | undefined
  if (!row) throw new Error(`Missing ${kind} projection ${objectId}`)
  return JSON.parse(row.projection_json) as Record<string, unknown>
}

function withoutRaw(value: Record<string, unknown>): Record<string, unknown> {
  const { raw: _raw, ...rest } = value
  return rest
}

async function writeGzipJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, await gzipDeterministic(utf8(`${canonicalJson(value)}\n`)))
}

async function writeKindPages(options: {
  db: DatabaseSync
  outputDir: string
  kind: ReadKind
  pageSize: number
}): Promise<number> {
  const pageDir = join(options.outputDir, 'read-model', 'pages', options.kind)
  await mkdir(pageDir, { recursive: true })
  const query = options.db.prepare('SELECT id, projection_json FROM objects WHERE kind = ? ORDER BY id ASC')
  const byId = options.db.prepare('SELECT id, projection_json FROM objects WHERE id = ? AND kind = ?')
  const insertRef = options.db.prepare('INSERT INTO refs (id, kind, page_no, offset_no) VALUES (?, ?, ?, ?)')
  const records: unknown[] = []
  let pageNo = 0
  async function flush(): Promise<void> {
    if (records.length === 0) return
    await writeGzipJson(
      join(pageDir, `${String(pageNo).padStart(8, '0')}.json.gz`),
      { schemaVersion: 1, kind: options.kind, page: pageNo, records },
    )
    pageNo += 1
    records.length = 0
  }
  options.db.exec('BEGIN')
  try {
    for (const rowValue of query.iterate(options.kind)) {
      const row = rowValue as StoredProjectionRow
      const projection = JSON.parse(row.projection_json) as Record<string, unknown>
      let pageRecord: unknown
      if (options.kind === 'vault') pageRecord = projection
      else if (options.kind === 'loan-broker') {
        const vault = withoutRaw(requiredProjection(byId, String(projection.vaultId), 'vault'))
        pageRecord = { broker: projection, vault }
      } else {
        const broker = requiredProjection(byId, String(projection.loanBrokerId), 'loan-broker')
        const vault = withoutRaw(requiredProjection(byId, String(broker.vaultId), 'vault'))
        pageRecord = { loan: projection, broker: withoutRaw(broker), vault }
      }
      const offset = records.length
      records.push(pageRecord)
      insertRef.run(row.id, options.kind, pageNo, offset)
      if (records.length >= options.pageSize) await flush()
    }
    await flush()
    options.db.exec('COMMIT')
  } catch (error) {
    options.db.exec('ROLLBACK')
    throw error
  }
  return pageNo
}

function nextHexPrefix(prefix: string): string | null {
  const value = Number.parseInt(prefix, 16)
  const limit = 16 ** prefix.length
  if (value + 1 >= limit) return null
  return (value + 1).toString(16).toUpperCase().padStart(prefix.length, '0')
}

async function writeLookupBuckets(
  db: DatabaseSync,
  outputDir: string,
  prefixLength: number,
): Promise<number> {
  if (prefixLength < 1 || prefixLength > 6) throw new Error('lookup prefix length must be between 1 and 6')
  const lookupDir = join(outputDir, 'read-model', 'lookup')
  await mkdir(lookupDir, { recursive: true })
  const query = db.prepare(`
    SELECT id, kind, page_no, offset_no FROM refs
    WHERE id >= ? AND (? IS NULL OR id < ?) ORDER BY id ASC
  `)
  const bucketCount = 16 ** prefixLength
  for (let index = 0; index < bucketCount; index += 1) {
    const prefix = index.toString(16).toUpperCase().padStart(prefixLength, '0')
    const next = nextHexPrefix(prefix)
    const rows = query.all(prefix, next, next) as LookupRow[]
    await writeGzipJson(
      join(lookupDir, `${prefix}.json.gz`),
      {
        schemaVersion: 1,
        prefix,
        records: rows.map((row) => ({ id: row.id, kind: row.kind, page: row.page_no, offset: row.offset_no })),
      },
    )
  }
  return bucketCount
}

function currentCounts(db: DatabaseSync): Counts {
  const rows = db.prepare('SELECT kind, COUNT(*) AS count FROM objects GROUP BY kind').all() as { kind: ReadKind; count: number }[]
  const result = emptyCounts()
  for (const row of rows) {
    if (row.kind === 'vault') result.vaults = Number(row.count)
    else if (row.kind === 'loan-broker') result.loanBrokers = Number(row.count)
    else if (row.kind === 'loan') result.loans = Number(row.count)
    else throw new Error(`Unknown rolling read-model kind: ${String(row.kind)}`)
  }
  return result
}

async function writeRollingBase(options: {
  db: DatabaseSync
  outputDir: string
  epochId: string
  snapshotId: string
  ledgerIndex: number
  ledgerHash: string
  segmentCount: number
}): Promise<RollingCurrentStateBaseManifest> {
  const baseDir = join(options.outputDir, 'rolling-base')
  await mkdir(baseDir, { recursive: true })
  const query = options.db.prepare('SELECT id, kind, projection_json FROM objects WHERE id >= ? AND (? IS NULL OR id < ?) ORDER BY id ASC')
  const assets: RollingCurrentStateBaseManifest['assets'] = []
  const totalCounts = emptyCounts()
  for (let ordinal = 0; ordinal < options.segmentCount; ordinal += 1) {
    const startValue = Math.floor((ordinal * 0x1_0000_0000) / options.segmentCount)
    const endValue = ordinal + 1 >= options.segmentCount
      ? null
      : Math.floor(((ordinal + 1) * 0x1_0000_0000) / options.segmentCount)
    const start = startValue.toString(16).toUpperCase().padStart(8, '0')
    const end = endValue === null ? null : endValue.toString(16).toUpperCase().padStart(8, '0')
    const rows = query.all(start, end, end) as StoredProjectionRow[]
    const counts = emptyCounts()
    const records: RollingBaseRecord[] = rows.map((row) => {
      const objectId = id(row.id, 'rolling output id')
      if (rollingBaseSegmentForId(objectId, options.segmentCount) !== ordinal) throw new Error('Rolling segment partition disagreement')
      addKindCount(counts, row.kind)
      return { schemaVersion: 1, id: objectId, kind: row.kind, projection: JSON.parse(row.projection_json) as Record<string, unknown> }
    })
    addCounts(totalCounts, counts)
    const textValue = records.length === 0 ? '' : `${records.map((value) => canonicalJson(value)).join('\n')}\n`
    const compressed = await gzipDeterministic(utf8(textValue))
    const path = `segment-${String(ordinal).padStart(5, '0')}.ndjson.gz`
    await writeFile(join(baseDir, path), compressed)
    assets.push({
      path,
      ordinal,
      sha256: await sha256Hex(compressed),
      bytes: compressed.byteLength,
      records: records.length,
      firstObjectId: records[0]?.id ?? null,
      lastObjectId: records.at(-1)?.id ?? null,
      counts,
    })
  }
  const manifestWithoutDigest = {
    schemaVersion: 1 as const,
    network: 'devnet' as const,
    epochId: options.epochId,
    snapshotId: options.snapshotId,
    ledgerIndex: options.ledgerIndex,
    ledgerHash: options.ledgerHash,
    complete: true as const,
    segmentCount: options.segmentCount,
    counts: totalCounts,
    assets,
  }
  const manifestSha256 = await rollingBaseManifestDigest({ ...manifestWithoutDigest, manifestSha256: '0'.repeat(64) })
  const manifest: RollingCurrentStateBaseManifest = { ...manifestWithoutDigest, manifestSha256 }
  await writeFile(join(baseDir, 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8')
  return manifest
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const plan = JSON.parse(await readFile(args.planPath, 'utf8')) as HistoryExtensionPlan
  assertHistoryExtensionPlan(plan)
  await rm(args.outputDir, { recursive: true, force: true })
  await mkdir(args.outputDir, { recursive: true })
  const workDir = resolve(`${args.outputDir}.work`)
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  const db = createWorkDatabase(join(workDir, 'rolling.sqlite'))

  const base = args.baseReadModelDir !== null
    ? await ingestReadModelBase(db, args.baseReadModelDir)
    : await ingestRollingBase(db, args.baseRollingDir!)

  if (
    base.epochId !== plan.epochId
    || base.ledgerIndex !== plan.source.endLedgerIndex
    || base.ledgerHash !== plan.source.endLedgerHash
  ) throw new Error('Rolling base identity does not match extension source terminal')

  const mutationStats = await applyDeltaMutations({ db, historyRoot: args.historyRoot, plan })
  const counts = currentCounts(db)
  const snapshotId = flatText(
    args.snapshotId ?? `devnet-${plan.target.ledgerIndex}-${plan.target.ledgerHash.slice(0, 12).toLowerCase()}`,
    'snapshotId',
  )
  const releaseTag = flatText(args.releaseTag ?? `replacement-current-state-${plan.target.ledgerIndex}`, 'releaseTag')

  const vaultPages = await writeKindPages({ db, outputDir: args.outputDir, kind: 'vault', pageSize: args.pageSize })
  const brokerPages = await writeKindPages({ db, outputDir: args.outputDir, kind: 'loan-broker', pageSize: args.pageSize })
  const loanPages = await writeKindPages({ db, outputDir: args.outputDir, kind: 'loan', pageSize: args.pageSize })
  const lookupBuckets = await writeLookupBuckets(db, args.outputDir, args.lookupPrefixLength)

  const manifestWithoutDigest: ReadModelManifest = {
    schemaVersion: 1,
    snapshotId,
    epochId: plan.epochId,
    releaseTag,
    ledgerIndex: plan.target.ledgerIndex,
    ledgerHash: plan.target.ledgerHash,
    complete: true,
    pageSize: args.pageSize,
    lookupPrefixLength: args.lookupPrefixLength,
    counts,
    pageCounts: { vaults: vaultPages, loanBrokers: brokerPages, loans: loanPages },
    manifestSha256: null,
  }
  const manifestSha256 = await sha256Hex(`${canonicalJson(manifestWithoutDigest)}\n`)
  const readModelManifest: ReadModelManifest = { ...manifestWithoutDigest, manifestSha256 }
  await writeFile(join(args.outputDir, 'read-model', 'manifest.json'), `${canonicalJson(readModelManifest)}\n`, 'utf8')

  const rollingBase = await writeRollingBase({
    db,
    outputDir: args.outputDir,
    epochId: plan.epochId,
    snapshotId,
    ledgerIndex: plan.target.ledgerIndex,
    ledgerHash: plan.target.ledgerHash,
    segmentCount: args.rollingSegments,
  })
  if (canonicalJson(rollingBase.counts) !== canonicalJson(counts)) throw new Error('Rolling base output counts differ from read model')

  const summary = {
    schemaVersion: 1,
    source: base,
    target: {
      snapshotId,
      releaseTag,
      ledgerIndex: readModelManifest.ledgerIndex,
      ledgerHash: readModelManifest.ledgerHash,
      counts,
      pageCounts: readModelManifest.pageCounts,
      manifestSha256,
    },
    extension: {
      sourcePublicationSha256: plan.source.publicationSha256,
      startLedgerIndex: plan.extension.startLedgerIndex,
      endLedgerIndex: plan.extension.endLedgerIndex,
      ledgerCount: plan.extension.ledgerCount,
      segmentCount: plan.extension.segmentCount,
    },
    mutationStats,
    pageSize: args.pageSize,
    lookupPrefixLength: args.lookupPrefixLength,
    lookupBuckets,
    rollingBase: {
      manifestSha256: rollingBase.manifestSha256,
      segmentCount: rollingBase.segmentCount,
      counts: rollingBase.counts,
    },
  }
  await writeFile(join(args.outputDir, 'rolling-read-model-summary.json'), `${canonicalJson(summary)}\n`, 'utf8')
  db.close()
  await rm(workDir, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
