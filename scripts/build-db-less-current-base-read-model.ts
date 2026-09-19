import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'

import {
  normalizeLoan,
  normalizeLoanBroker,
  normalizeVault,
} from '../src/collector/current-state/normalize-current-objects'
import type { ScannedLedgerObject } from '../src/collector/current-state/scan-ledger-objects'
import {
  buildDbLessBaseManifest,
  type DbLessBaseAssetDescriptorV1,
  type DbLessBaseAssetKind,
} from '../src/shared/db-less/base-manifest'
import {
  canonicalJson,
  gzipDeterministic,
  sha256Hex,
  utf8,
} from '../src/shared/current-state/canonical-json'
import {
  parseReleaseNativeManifest,
  releaseNativeManifestDigest,
  type ReleaseNativeDataAsset,
  type ReleaseNativeDataRecord,
} from '../src/shared/current-state/release-native-reader'

type ReadKind = 'vault' | 'loan-broker' | 'loan'

type StoredProjectionRow = {
  id: string
  kind: ReadKind
  projection_json: string
}

type LookupRow = {
  id: string
  kind: ReadKind
  page_no: number
  offset_no: number
}

type Counts = {
  vaults: number
  loanBrokers: number
  loans: number
}

type Arguments = {
  inputDir: string
  outputDir: string
  pageSize: number
  lookupPrefixLength: number
  snapshotId: string | null
  sourceRevision: string
}

type PageWriteResult = {
  pageCount: number
  descriptors: DbLessBaseAssetDescriptorV1[]
}

type LookupWriteResult = {
  bucketCount: number
  descriptors: DbLessBaseAssetDescriptorV1[]
}

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

function flatText(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${field} must be a flat safe identifier`)
  }
  return value
}

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('DB-less Current base generation requires --local')
  return {
    inputDir: resolve(requiredArgument(args, '--input-dir')),
    outputDir: resolve(requiredArgument(args, '--output-dir')),
    pageSize: positiveInteger(args, '--page-size', 4_096),
    lookupPrefixLength: positiveInteger(args, '--lookup-prefix-length', 2),
    snapshotId: argumentValue(args, '--snapshot-id'),
    sourceRevision: requiredArgument(args, '--source-revision'),
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

function emptyCounts(): Counts {
  return { vaults: 0, loanBrokers: 0, loans: 0 }
}

function addKindCount(counts: Counts, kind: ReadKind): void {
  if (kind === 'vault') counts.vaults += 1
  else if (kind === 'loan-broker') counts.loanBrokers += 1
  else counts.loans += 1
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function verifySourceDataAsset(inputDir: string, asset: ReleaseNativeDataAsset): Promise<string> {
  const path = join(inputDir, asset.assetName)
  const info = await stat(path)
  if (info.size !== asset.compressedBytes) {
    throw new Error(`Source asset byte size mismatch: ${asset.assetName}`)
  }
  if (await fileSha256(path) !== asset.sha256) {
    throw new Error(`Source asset SHA-256 mismatch: ${asset.assetName}`)
  }
  return path
}

async function ingestDataAsset(
  db: DatabaseSync,
  asset: ReleaseNativeDataAsset,
  assetPath: string,
  counts: Counts,
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
      if (record.schemaVersion !== 1) throw new Error(`Invalid source record schema in ${asset.assetName}`)
      if (record.segmentId !== asset.segmentId) {
        throw new Error(`Source record segment mismatch in ${asset.assetName}`)
      }
      if (await sha256Hex(canonicalJson(record.value)) !== record.valueSha256) {
        throw new Error(`Source record value digest mismatch for ${record.id}`)
      }

      const projection = canonicalJson(normalizeRecord(record))
      insert.run(record.id, record.kind, projection)
      addKindCount(counts, record.kind)
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

  if (count !== asset.recordCount) {
    throw new Error(`Source record count mismatch for ${asset.assetName}: ${count} != ${asset.recordCount}`)
  }
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

function pageAssetKind(kind: ReadKind): DbLessBaseAssetKind {
  if (kind === 'vault') return 'vault-page'
  if (kind === 'loan-broker') return 'loan-broker-page'
  return 'loan-page'
}

function pageAssetKey(kind: ReadKind, ordinal: number): string {
  return `${pageAssetKind(kind)}-${String(ordinal).padStart(6, '0')}.json.gz`
}

async function writeCompressedJsonAsset(options: {
  assetsDir: string
  key: string
  kind: DbLessBaseAssetKind
  ordinal: number
  records: number
  value: unknown
}): Promise<DbLessBaseAssetDescriptorV1> {
  const bytes = await gzipDeterministic(utf8(`${canonicalJson(options.value)}\n`))
  await writeFile(join(options.assetsDir, options.key), bytes)
  return {
    key: options.key,
    kind: options.kind,
    ordinal: options.ordinal,
    records: options.records,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  }
}

async function writeKindPages(options: {
  db: DatabaseSync
  assetsDir: string
  kind: ReadKind
  pageSize: number
}): Promise<PageWriteResult> {
  const { db, assetsDir, kind, pageSize } = options
  const query = db.prepare('SELECT id, projection_json FROM objects WHERE kind = ? ORDER BY id ASC')
  const byId = db.prepare('SELECT id, kind, projection_json FROM objects WHERE id = ? AND kind = ?')
  const insertRef = db.prepare('INSERT INTO refs (id, kind, page_no, offset_no) VALUES (?, ?, ?, ?)')
  const records: unknown[] = []
  const descriptors: DbLessBaseAssetDescriptorV1[] = []
  let pageNo = 0

  async function flush(): Promise<void> {
    if (records.length === 0) return
    const key = pageAssetKey(kind, pageNo)
    descriptors.push(await writeCompressedJsonAsset({
      assetsDir,
      key,
      kind: pageAssetKind(kind),
      ordinal: pageNo,
      records: records.length,
      value: { schemaVersion: 1, kind, page: pageNo, records },
    }))
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
        const vault = withoutRaw(requiredProjection(byId, String(projection.vaultId), 'vault'))
        pageRecord = { broker: projection, vault }
      } else {
        const broker = requiredProjection(byId, String(projection.loanBrokerId), 'loan-broker')
        const vault = withoutRaw(requiredProjection(byId, String(broker.vaultId), 'vault'))
        pageRecord = { loan: projection, broker: withoutRaw(broker), vault }
      }

      const offset = records.length
      records.push(pageRecord)
      insertRef.run(row.id, kind, pageNo, offset)
      if (records.length >= pageSize) await flush()
    }
    await flush()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return { pageCount: pageNo, descriptors }
}

function nextHexPrefix(prefix: string): string | null {
  const value = Number.parseInt(prefix, 16)
  const limit = 16 ** prefix.length
  if (value + 1 >= limit) return null
  return (value + 1).toString(16).toUpperCase().padStart(prefix.length, '0')
}

async function writeLookupBuckets(options: {
  db: DatabaseSync
  assetsDir: string
  prefixLength: number
}): Promise<LookupWriteResult> {
  if (options.prefixLength < 1 || options.prefixLength > 4) {
    throw new Error('lookup prefix length must be between 1 and 4')
  }

  const query = options.db.prepare(`
    SELECT id, kind, page_no, offset_no FROM refs
    WHERE id >= ? AND (? IS NULL OR id < ?) ORDER BY id ASC
  `)
  const bucketCount = 16 ** options.prefixLength
  const descriptors: DbLessBaseAssetDescriptorV1[] = []

  for (let index = 0; index < bucketCount; index += 1) {
    const prefix = index.toString(16).toUpperCase().padStart(options.prefixLength, '0')
    const next = nextHexPrefix(prefix)
    const rows = query.all(prefix, next, next) as LookupRow[]
    const key = `lookup-${prefix}.json.gz`

    descriptors.push(await writeCompressedJsonAsset({
      assetsDir: options.assetsDir,
      key,
      kind: 'lookup',
      ordinal: index,
      records: rows.length,
      value: {
        schemaVersion: 1,
        prefix,
        records: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          page: row.page_no,
          offset: row.offset_no,
        })),
      },
    }))
  }

  return { bucketCount, descriptors }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const sourceManifestPath = join(args.inputDir, 'manifest.json')
  const sourceManifestBytes = new Uint8Array(await readFile(sourceManifestPath))
  const sourceManifest = parseReleaseNativeManifest(
    JSON.parse(new TextDecoder().decode(sourceManifestBytes)),
  )

  if (!sourceManifest.complete) throw new Error('DB-less Current base requires a complete source snapshot')
  if (await releaseNativeManifestDigest(sourceManifest) !== sourceManifest.manifestSha256) {
    throw new Error('Source release-native manifest digest mismatch')
  }

  const snapshotId = flatText(args.snapshotId ?? sourceManifest.snapshotId, 'snapshotId')
  const sourceRevisionDigest = await sha256Hex(args.sourceRevision)
  const generationId = flatText(
    `base-v1-${sourceManifest.ledgerIndex}-${sourceManifest.ledgerHash.slice(0, 12).toLowerCase()}-${sourceManifest.manifestSha256.slice(0, 12)}-${sourceRevisionDigest.slice(0, 12)}`,
    'generationId',
  )

  await rm(args.outputDir, { recursive: true, force: true })
  const assetsDir = join(args.outputDir, 'assets')
  await mkdir(assetsDir, { recursive: true })

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

  try {
    const counts = emptyCounts()
    let ingested = 0
    for (const asset of sourceManifest.dataAssets) {
      const assetPath = await verifySourceDataAsset(args.inputDir, asset)
      ingested += await ingestDataAsset(db, asset, assetPath, counts)
    }

    if (ingested !== sourceManifest.relevantObjectCount) {
      throw new Error('Total DB-less base ingested object count mismatch')
    }
    if (canonicalJson(counts) !== canonicalJson(sourceManifest.counts)) {
      throw new Error('DB-less base object type counts mismatch')
    }

    const vault = await writeKindPages({
      db,
      assetsDir,
      kind: 'vault',
      pageSize: args.pageSize,
    })
    const broker = await writeKindPages({
      db,
      assetsDir,
      kind: 'loan-broker',
      pageSize: args.pageSize,
    })
    const loan = await writeKindPages({
      db,
      assetsDir,
      kind: 'loan',
      pageSize: args.pageSize,
    })
    const lookup = await writeLookupBuckets({
      db,
      assetsDir,
      prefixLength: args.lookupPrefixLength,
    })

    const descriptors = [
      ...vault.descriptors,
      ...broker.descriptors,
      ...loan.descriptors,
      ...lookup.descriptors,
    ]
    const manifest = await buildDbLessBaseManifest({
      schemaVersion: 1,
      network: 'devnet',
      epochId: sourceManifest.epochId,
      snapshotId,
      generationId,
      sourceRevision: args.sourceRevision,
      sourceManifestSha256: sourceManifest.manifestSha256,
      ledgerIndex: sourceManifest.ledgerIndex,
      ledgerHash: sourceManifest.ledgerHash,
      complete: true,
      pageSize: args.pageSize,
      lookupPrefixLength: args.lookupPrefixLength,
      counts,
      pageCounts: {
        vaults: vault.pageCount,
        loanBrokers: broker.pageCount,
        loans: loan.pageCount,
      },
      assets: descriptors,
    })

    await writeFile(
      join(assetsDir, 'base-manifest.json'),
      `${canonicalJson(manifest)}\n`,
      'utf8',
    )

    const totalCompressedBytes = descriptors.reduce((total, asset) => total + asset.bytes, 0)
    const largestAssetBytes = descriptors.reduce((largest, asset) => Math.max(largest, asset.bytes), 0)
    const summary = {
      schemaVersion: 1,
      generationId,
      snapshotId,
      sourceRevision: args.sourceRevision,
      sourceManifestSha256: sourceManifest.manifestSha256,
      ledgerIndex: sourceManifest.ledgerIndex,
      ledgerHash: sourceManifest.ledgerHash,
      counts,
      pageSize: args.pageSize,
      pageCounts: manifest.pageCounts,
      lookupPrefixLength: args.lookupPrefixLength,
      lookupBuckets: lookup.bucketCount,
      releaseAssetCount: descriptors.length + 1,
      totalCompressedBytes,
      largestAssetBytes,
      manifestSha256: manifest.manifestSha256,
    }

    await writeFile(
      join(args.outputDir, 'base-read-model-summary.json'),
      `${canonicalJson(summary)}\n`,
      'utf8',
    )
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } finally {
    db.close()
    await rm(workDir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
