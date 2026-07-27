import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'

import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../../src/shared/current-state/canonical-json'
import { extractHistoryExactEntries } from '../../src/shared/history-segments/exact-index-entries'
import {
  assertHistoryExactIndexRecord,
  type HistoryExactIndexAsset,
  type HistoryExactIndexRecord,
} from '../../src/shared/history-segments/exact-index'
import type { HistorySegmentFileKind } from '../../src/shared/history-segments/manifest'
import { planExactSpill, splitExactSuperBuckets } from '../../src/shared/history-reconstruction/exact-spill'
import {
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_EXACT_BUCKET_COUNT,
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT,
} from '../../src/shared/history-reconstruction/identity'
import {
  assertSpillShardEvidence,
  assertSuperBucketEvidence,
  type SpillShardEvidence,
  type SuperBucketEvidence,
} from '../../src/shared/history-reconstruction/schema'
import {
  sortExactIndexRecords,
  spillShardRange,
} from '../../src/shared/history-reconstruction/runner'
import {
  exists,
  fileSetDigest,
  parseNdjson,
  segmentDirectory,
  verifySegmentDirectory,
  writeExclusiveCanonical,
} from './common'

const unzip = promisify(gunzip)
const INDEXABLE = new Set<HistorySegmentFileKind>([
  'protocol_events', 'object_changes', 'loan_lifecycle', 'archived_objects', 'balance_history',
])

function shardDirectory(outputDir: string, shardId: number): string {
  return join(outputDir, 'spill', `shard-${String(shardId).padStart(2, '0')}`)
}

function shardSuperPath(outputDir: string, shardId: number, superBucket: number): string {
  return join(shardDirectory(outputDir, shardId), `super-${String(superBucket).padStart(2, '0')}.ndjson`)
}

export function exactDirectory(outputDir: string): string {
  return join(outputDir, 'candidate', 'history', 'index', 'exact')
}

async function exactInputsForSegment(outputDir: string, id: number): Promise<Omit<HistoryExactIndexRecord, 'bucket'>[]> {
  const directory = segmentDirectory(outputDir, id)
  const { manifest } = await verifySegmentDirectory(directory, id)
  const result: Omit<HistoryExactIndexRecord, 'bucket'>[] = []
  for (const file of manifest.files) {
    if (!INDEXABLE.has(file.kind)) continue
    const bytes = new Uint8Array(await readFile(join(directory, file.path)))
    const records = parseNdjson(new TextDecoder().decode(await unzip(bytes)))
    for (const value of records) {
      const extracted = extractHistoryExactEntries({
        epochId: HISTORY_RECONSTRUCTION_EPOCH_ID,
        segmentId: manifest.segmentId,
        fileKind: file.kind,
        value,
      })
      if (!extracted) continue
      for (const term of extracted.terms) {
        result.push({ schemaVersion: 2, term, reference: extracted.reference })
      }
    }
  }
  return result
}

async function verifySpillShard(outputDir: string, shardId: number): Promise<SpillShardEvidence> {
  const directory = shardDirectory(outputDir, shardId)
  const evidence = JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8')) as SpillShardEvidence
  assertSpillShardEvidence(evidence)
  if (evidence.shardId !== shardId) throw new Error(`Spill shard ${shardId} evidence identity mismatch`)
  const paths = Array.from({ length: 16 }, (_, superBucket) => shardSuperPath(outputDir, shardId, superBucket))
  if (await fileSetDigest(paths) !== evidence.digest) throw new Error(`Spill shard ${shardId} output digest mismatch`)
  let recordCount = 0
  for (const path of paths) recordCount += parseNdjson(await readFile(path, 'utf8')).length
  if (recordCount !== evidence.recordCount) throw new Error(`Spill shard ${shardId} record count mismatch`)
  return evidence
}

export async function buildSpillShard(outputDir: string, shardId: number): Promise<SpillShardEvidence> {
  const finalDirectory = shardDirectory(outputDir, shardId)
  if (await exists(join(finalDirectory, 'evidence.json'))) return verifySpillShard(outputDir, shardId)
  const range = spillShardRange(shardId)
  const temporary = join(outputDir, 'work', `shard-${String(shardId).padStart(2, '0')}-${process.pid}-${Date.now()}`)
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true })
  const rawHash = createHash('sha256')
  let recordCount = 0

  for (let id = range.firstSegmentId; id <= range.lastSegmentId; id += 1) {
    const inputs = await exactInputsForSegment(outputDir, id)
    for (const input of inputs) rawHash.update(`${canonicalJson(input)}\n`)
    const split = splitExactSuperBuckets(await planExactSpill(inputs))
    for (let superBucket = 0; superBucket < 16; superBucket += 1) {
      const records = split.get(superBucket) ?? []
      if (records.length > 0) {
        await appendFile(
          join(temporary, `super-${String(superBucket).padStart(2, '0')}.ndjson`),
          `${records.map((record) => canonicalJson(record)).join('\n')}\n`,
        )
      }
      recordCount += records.length
    }
  }

  const paths: string[] = []
  for (let superBucket = 0; superBucket < 16; superBucket += 1) {
    const path = join(temporary, `super-${String(superBucket).padStart(2, '0')}.ndjson`)
    if (!(await exists(path))) await writeFile(path, '')
    paths.push(path)
  }
  const evidence: SpillShardEvidence = {
    schemaVersion: 1,
    kind: 'history-exact-spill-shard',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    shardId,
    rawInputDigest: rawHash.digest('hex'),
    firstSegmentId: range.firstSegmentId,
    lastSegmentId: range.lastSegmentId,
    superBucketCount: 16,
    recordCount,
    digest: await fileSetDigest(paths),
    productionMutation: false,
  }
  assertSpillShardEvidence(evidence)
  await writeFile(join(temporary, 'evidence.json'), `${canonicalJson(evidence)}\n`)
  await mkdir(dirname(finalDirectory), { recursive: true })
  try {
    await rename(temporary, finalDirectory)
  } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes(String((error as NodeJS.ErrnoException).code))) throw error
    await rm(temporary, { recursive: true, force: true })
  }
  return verifySpillShard(outputDir, shardId)
}

async function verifySuperBucket(outputDir: string, superBucket: number): Promise<SuperBucketEvidence> {
  const path = join(outputDir, 'super-buckets', `${String(superBucket).padStart(2, '0')}.json`)
  const evidence = JSON.parse(await readFile(path, 'utf8')) as SuperBucketEvidence
  assertSuperBucketEvidence(evidence)
  const firstBucket = superBucket * 16
  const assets = Array.from({ length: 16 }, (_, offset) => (
    join(exactDirectory(outputDir), `${String(firstBucket + offset).padStart(4, '0')}.ndjson.gz`)
  ))
  if (await fileSetDigest(assets) !== evidence.digest) throw new Error(`Super-bucket ${superBucket} output digest mismatch`)
  return evidence
}

export async function buildSuperBucket(outputDir: string, superBucket: number): Promise<SuperBucketEvidence> {
  if (!Number.isSafeInteger(superBucket) || superBucket < 0 || superBucket >= 16) {
    throw new Error('Super-bucket ID is invalid')
  }
  const evidencePath = join(outputDir, 'super-buckets', `${String(superBucket).padStart(2, '0')}.json`)
  if (await exists(evidencePath)) return verifySuperBucket(outputDir, superBucket)

  const firstBucket = superBucket * 16
  const temporary = join(outputDir, 'work', `super-${String(superBucket).padStart(2, '0')}-${process.pid}-${Date.now()}`)
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true })
  const inputHash = createHash('sha256')
  let recordCount = 0

  for (let shardId = 0; shardId < 33; shardId += 1) {
    await verifySpillShard(outputDir, shardId)
    const source = await readFile(shardSuperPath(outputDir, shardId, superBucket), 'utf8')
    inputHash.update(source)
    const grouped = new Map<number, string[]>()
    for (const value of parseNdjson(source)) {
      const record = value as HistoryExactIndexRecord
      assertHistoryExactIndexRecord(record, 256)
      if (Math.floor(record.bucket / 16) !== superBucket) throw new Error('Spill record super-bucket mismatch')
      const lines = grouped.get(record.bucket) ?? []
      lines.push(canonicalJson(record))
      grouped.set(record.bucket, lines)
      recordCount += 1
    }
    for (const [bucket, lines] of grouped) {
      await appendFile(join(temporary, `${String(bucket).padStart(4, '0')}.ndjson`), `${lines.join('\n')}\n`)
    }
  }

  await mkdir(exactDirectory(outputDir), { recursive: true })
  const finalPaths: string[] = []
  for (let bucket = firstBucket; bucket < firstBucket + 16; bucket += 1) {
    const plainPath = join(temporary, `${String(bucket).padStart(4, '0')}.ndjson`)
    const source = await readFile(plainPath, 'utf8').catch(() => '')
    const records = sortExactIndexRecords(parseNdjson(source) as HistoryExactIndexRecord[])
    if (records.some((record) => record.bucket !== bucket)) throw new Error(`Exact bucket ${bucket} contains a foreign record`)
    const text = records.length > 0 ? `${records.map((record) => canonicalJson(record)).join('\n')}\n` : ''
    const finalPath = join(exactDirectory(outputDir), `${String(bucket).padStart(4, '0')}.ndjson.gz`)
    await writeFile(finalPath, await gzipDeterministic(utf8(text)))
    finalPaths.push(finalPath)
  }

  const evidence: SuperBucketEvidence = {
    schemaVersion: 1,
    kind: 'history-exact-super-bucket',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    superBucket,
    rawInputDigest: inputHash.digest('hex'),
    firstBucket,
    lastBucket: firstBucket + 15,
    recordCount,
    digest: await fileSetDigest(finalPaths),
    productionMutation: false,
  }
  assertSuperBucketEvidence(evidence)
  await writeExclusiveCanonical(evidencePath, evidence)
  await rm(temporary, { recursive: true, force: true })
  return verifySuperBucket(outputDir, superBucket)
}

export async function buildAllExactBuckets(outputDir: string): Promise<void> {
  for (let shardId = 0; shardId < 33; shardId += 1) await buildSpillShard(outputDir, shardId)
  for (let superBucket = 0; superBucket < HISTORY_RECONSTRUCTION_SUPER_BUCKET_COUNT; superBucket += 1) {
    await buildSuperBucket(outputDir, superBucket)
  }
}

export async function inspectExactAssets(outputDir: string): Promise<HistoryExactIndexAsset[]> {
  const assets: HistoryExactIndexAsset[] = []
  for (let bucket = 0; bucket < HISTORY_RECONSTRUCTION_EXACT_BUCKET_COUNT; bucket += 1) {
    const path = join(exactDirectory(outputDir), `${String(bucket).padStart(4, '0')}.ndjson.gz`)
    const bytes = new Uint8Array(await readFile(path))
    const records = parseNdjson(new TextDecoder().decode(await unzip(bytes))) as HistoryExactIndexRecord[]
    for (const record of records) {
      assertHistoryExactIndexRecord(record, 256)
      if (record.bucket !== bucket) throw new Error(`Exact bucket ${bucket} contains a foreign record`)
    }
    if (canonicalJson(sortExactIndexRecords(records)) !== canonicalJson(records)) {
      throw new Error(`Exact bucket ${bucket} is not canonically sorted`)
    }
    assets.push({
      bucket,
      path: `history/index/exact/${String(bucket).padStart(4, '0')}.ndjson.gz`,
      sha256: await sha256Hex(bytes),
      compressedBytes: bytes.byteLength,
      recordCount: records.length,
      firstTerm: records[0]?.term ?? null,
      lastTerm: records.at(-1)?.term ?? null,
    })
  }
  return assets
}
