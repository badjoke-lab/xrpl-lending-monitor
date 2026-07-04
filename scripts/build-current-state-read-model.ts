import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { createGunzip } from 'node:zlib'

import {
  normalizeLoan,
  normalizeLoanBroker,
  normalizeVault,
} from '../src/collector/current-state/normalize-current-objects'
import type { ScannedLedgerObject } from '../src/collector/current-state/scan-ledger-objects'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import { parseReleaseNativeManifest, type ReleaseNativeDataRecord } from '../src/shared/current-state/release-native-reader'

type ReadKind = 'vault' | 'loan-broker' | 'loan'

type Arguments = {
  inputDir: string
  outputDir: string
  pageSize: number
  lookupPrefixLength: number
}

type StoredProjectionRow = {
  id: string
  projection_json: string
}

type LookupRow = {
  id: string
  kind: ReadKind
  page_no: number
  offset_no: number
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
  counts: { vaults: number; loanBrokers: number; loans: number }
  pageCounts: { vaults: number; loanBrokers: number; loans: number }
  manifestSha256: string | null
}

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
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
  return {
    inputDir: resolve(argumentValue(args, '--input-dir') ?? '.local/current-state-release/assets'),
    outputDir: resolve(argumentValue(args, '--output-dir') ?? '.local/current-state-read-model'),
    pageSize: positiveInteger(args, '--page-size', 50),
    lookupPrefixLength: positiveInteger(args, '--lookup-prefix-length', 3),
  }
}

function normalizeRecord(record: ReleaseNativeDataRecord): unknown {
  const object = record.value as ScannedLedgerObject
  if (record.kind === 'vault') return normalizeVault(object)
  if (record.kind === 'loan-broker') return normalizeLoanBroker(object)
  return normalizeLoan(object)
}

function withoutRaw(value: Record<string, unknown>): Record<string, unknown> {
  const { raw: _raw, ...rest } = value
  return rest
}

async function writeGzipJson(path: string, value: unknown): Promise<void> {
  const compressed = await gzipDeterministic(utf8(`${canonicalJson(value)}\n`))
  await writeFile(path, compressed)
}

async function ingestDataAsset(
  db: DatabaseSync,
  assetPath: string,
  expectedRecords: number,
): Promise<number> {
  const insert = db.prepare('INSERT INTO objects (id, kind, projection_json) VALUES (?, ?, ?)')
  const input = createReadStream(assetPath).pipe(createGunzip())
  const lines = createInterface({ input, crlfDelay: Infinity })
  let count = 0
  let batch = 0
  db.exec('BEGIN')
  try {
    for await (const line of lines) {
      if (!line) continue
      const record = JSON.parse(line) as ReleaseNativeDataRecord
      insert.run(record.id, record.kind, canonicalJson(normalizeRecord(record)))
      count += 1
      batch += 1
      if (batch >= 2_000) {
        db.exec('COMMIT')
        db.exec('BEGIN')
        batch = 0
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  if (count !== expectedRecords) throw new Error(`Record count mismatch for ${assetPath}: ${count} != ${expectedRecords}`)
  return count
}

function requiredProjection(
  statement: ReturnType<DatabaseSync['prepare']>,
  id: string,
  kind: ReadKind,
): Record<string, unknown> {
  const row = statement.get(id, kind) as StoredProjectionRow | undefined
  if (!row) throw new Error(`Missing ${kind} projection ${id}`)
  return JSON.parse(row.projection_json) as Record<string, unknown>
}

async function writeKindPages(options: {
  db: DatabaseSync
  outputDir: string
  kind: ReadKind
  pageSize: number
}): Promise<number> {
  const { db, outputDir, kind, pageSize } = options
  const pageDir = join(outputDir, 'read-model', 'pages', kind)
  await mkdir(pageDir, { recursive: true })

  const query = db.prepare('SELECT id, projection_json FROM objects WHERE kind = ? ORDER BY id ASC')
  const byId = db.prepare('SELECT id, projection_json FROM objects WHERE id = ? AND kind = ?')
  const insertRef = db.prepare('INSERT INTO refs (id, kind, page_no, offset_no) VALUES (?, ?, ?, ?)')
  const records: unknown[] = []
  let pageNo = 0
  let rowCount = 0

  async function flush(): Promise<void> {
    if (records.length === 0) return
    await writeGzipJson(
      join(pageDir, `${String(pageNo).padStart(8, '0')}.json.gz`),
      { schemaVersion: 1, kind, page: pageNo, records },
    )
    pageNo += 1
    records.length = 0
  }

  db.exec('BEGIN')
  try {
    for (const rowValue of query.iterate(kind)) {
      const row = rowValue as StoredProjectionRow
      const projection = JSON.parse(row.projection_json) as Record<string, unknown>
      let pageRecord: unknown
      if (kind === 'vault') {
        pageRecord = projection
      } else if (kind === 'loan-broker') {
        const vaultId = String(projection.vaultId)
        const vault = withoutRaw(requiredProjection(byId, vaultId, 'vault'))
        pageRecord = { broker: projection, vault }
      } else {
        const brokerId = String(projection.loanBrokerId)
        const broker = requiredProjection(byId, brokerId, 'loan-broker')
        const vault = withoutRaw(requiredProjection(byId, String(broker.vaultId), 'vault'))
        pageRecord = { loan: projection, broker: withoutRaw(broker), vault }
      }
      const offset = records.length
      records.push(pageRecord)
      insertRef.run(row.id, kind, pageNo, offset)
      rowCount += 1
      if (records.length >= pageSize) await flush()
    }
    await flush()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  process.stderr.write(`Wrote ${pageNo} ${kind} pages for ${rowCount} records.\n`)
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
  if (prefixLength > 6) throw new Error('lookup prefix length is too large')
  const lookupDir = join(outputDir, 'read-model', 'lookup')
  await mkdir(lookupDir, { recursive: true })
  const query = db.prepare(`
    SELECT id, kind, page_no, offset_no
    FROM refs
    WHERE id >= ? AND (? IS NULL OR id < ?)
    ORDER BY id ASC
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
        records: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          page: row.page_no,
          offset: row.offset_no,
        })),
      },
    )
    if ((index + 1) % 256 === 0) process.stderr.write(`Wrote ${index + 1}/${bucketCount} lookup buckets.\n`)
  }
  return bucketCount
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  if (args.lookupPrefixLength < 1 || args.lookupPrefixLength > 6) throw new Error('lookup prefix length must be between 1 and 6')
  await rm(args.outputDir, { recursive: true, force: true })
  await mkdir(join(args.outputDir, 'read-model'), { recursive: true })

  const sourceManifest = parseReleaseNativeManifest(
    JSON.parse(await readFile(join(args.inputDir, 'manifest.json'), 'utf8')),
  )
  if (!sourceManifest.complete) throw new Error('Read model requires a complete source snapshot')

  const workDir = resolve(`${args.outputDir}.work`)
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  const db = new DatabaseSync(join(workDir, 'read-model.sqlite'))
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
  `)

  let ingested = 0
  for (const asset of sourceManifest.dataAssets) {
    process.stderr.write(`Ingesting ${asset.assetName} (${asset.recordCount} records).\n`)
    ingested += await ingestDataAsset(db, join(args.inputDir, asset.assetName), asset.recordCount)
  }
  if (ingested !== sourceManifest.relevantObjectCount) throw new Error('Total ingested object count mismatch')

  const vaultPages = await writeKindPages({ db, outputDir: args.outputDir, kind: 'vault', pageSize: args.pageSize })
  const brokerPages = await writeKindPages({ db, outputDir: args.outputDir, kind: 'loan-broker', pageSize: args.pageSize })
  const loanPages = await writeKindPages({ db, outputDir: args.outputDir, kind: 'loan', pageSize: args.pageSize })
  const lookupBuckets = await writeLookupBuckets(db, args.outputDir, args.lookupPrefixLength)

  const manifestWithoutDigest: ReadModelManifest = {
    schemaVersion: 1,
    snapshotId: sourceManifest.snapshotId,
    epochId: sourceManifest.epochId,
    releaseTag: sourceManifest.releaseTag,
    ledgerIndex: sourceManifest.ledgerIndex,
    ledgerHash: sourceManifest.ledgerHash,
    complete: true,
    pageSize: args.pageSize,
    lookupPrefixLength: args.lookupPrefixLength,
    counts: sourceManifest.counts,
    pageCounts: {
      vaults: vaultPages,
      loanBrokers: brokerPages,
      loans: loanPages,
    },
    manifestSha256: null,
  }
  const manifestSha256 = await sha256Hex(`${canonicalJson(manifestWithoutDigest)}\n`)
  const manifest: ReadModelManifest = { ...manifestWithoutDigest, manifestSha256 }
  await writeFile(join(args.outputDir, 'read-model', 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8')
  await writeFile(join(args.outputDir, 'read-model-summary.json'), `${canonicalJson({
    snapshotId: manifest.snapshotId,
    releaseTag: manifest.releaseTag,
    pageSize: manifest.pageSize,
    lookupPrefixLength: manifest.lookupPrefixLength,
    lookupBuckets,
    pageCounts: manifest.pageCounts,
    counts: manifest.counts,
    manifestSha256,
  })}\n`, 'utf8')

  db.close()
  await rm(workDir, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({ manifestSha256, pageCounts: manifest.pageCounts, lookupBuckets }, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
