import { basename, join, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { decodeGzipNdjsonWithMetadata } from '../src/shared/current-state/artifact-reader-codec'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import {
  assertHistoryExactIndexManifest,
  assertHistoryExactIndexRecord,
  historyExactIndexBucket,
  historyExactIndexManifestDigest,
  type HistoryExactIndexAsset,
  type HistoryExactIndexManifest,
  type HistoryExactIndexRecord,
} from '../src/shared/history-segments/exact-index'
import {
  assertHistorySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from '../src/shared/history-segments/publication'

type Mode = 'split-range' | 'assemble'

interface Arguments {
  mode: Mode
  publicationPath: string
  sourceManifestPath: string
  inputDir: string
  outputDir: string
  bucketStart: number | null
  bucketEnd: number | null
  partManifestPaths: string[]
  assetPrefix: string
  sourceRevision: string
}

interface RebucketAsset extends HistoryExactIndexAsset {
  decompressedBytes: number
  sourceBucket: number
}

interface PartManifest {
  schemaVersion: 1
  sourceBucketStart: number
  sourceBucketEnd: number
  sourceBucketCount: 256
  targetBucketCount: 1024
  sourceRecords: number
  outputRecords: number
  maxDecompressedBytes: number
  assets: RebucketAsset[]
}

const SOURCE_BUCKET_COUNT = 256
const TARGET_BUCKET_COUNT = 1024
const REFINEMENT_FACTOR = TARGET_BUCKET_COUNT / SOURCE_BUCKET_COUNT
const SOURCE_READ_LIMIT = 128 * 1024 * 1024
const PRODUCTION_READ_LIMIT = 64 * 1024 * 1024

function value(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const result = args[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${name} requires a value`)
  return result
}

function values(args: readonly string[], name: string): string[] {
  const result: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue
    const item = args[index + 1]
    if (!item || item.startsWith('--')) throw new Error(`${name} requires a value`)
    result.push(item)
  }
  return result
}

function required(args: readonly string[], name: string): string {
  const result = value(args, name)
  if (result === null) throw new Error(`${name} is required`)
  return result
}

function integer(args: readonly string[], name: string): number {
  const raw = required(args, name)
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer`)
  const result = Number(raw)
  if (!Number.isSafeInteger(result)) throw new Error(`${name} must be a safe integer`)
  return result
}

function safePrefix(input: string): string {
  const normalized = input.replace(/\/$/, '')
  if (
    normalized.startsWith('/')
    || normalized.includes('\\')
    || normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(normalized)
  ) throw new Error('--asset-prefix must be a safe relative path')
  return normalized
}

function safeId(input: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input)) throw new Error('--source-revision is invalid')
  return input
}

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('History exact-index rebucketing requires --local')
  const modeValue = required(args, '--mode')
  if (modeValue !== 'split-range' && modeValue !== 'assemble') {
    throw new Error('--mode must be split-range or assemble')
  }
  const bucketStart = value(args, '--bucket-start') === null ? null : integer(args, '--bucket-start')
  const bucketEnd = value(args, '--bucket-end') === null ? null : integer(args, '--bucket-end')
  const partManifestPaths = values(args, '--part-manifest').map((item) => resolve(item))
  if (modeValue === 'split-range' && (bucketStart === null || bucketEnd === null)) {
    throw new Error('--bucket-start and --bucket-end are required for split-range')
  }
  if (modeValue === 'assemble' && partManifestPaths.length === 0) {
    throw new Error('--part-manifest is required for assemble')
  }
  return {
    mode: modeValue,
    publicationPath: resolve(required(args, '--publication')),
    sourceManifestPath: resolve(required(args, '--source-manifest')),
    inputDir: resolve(required(args, '--input-dir')),
    outputDir: resolve(required(args, '--output-dir')),
    bucketStart,
    bucketEnd,
    partManifestPaths,
    assetPrefix: safePrefix(value(args, '--asset-prefix') ?? 'history/index/exact'),
    sourceRevision: safeId(required(args, '--source-revision')),
  }
}

function compareRecords(left: HistoryExactIndexRecord, right: HistoryExactIndexRecord): number {
  return left.term.localeCompare(right.term)
    || right.reference.ledgerIndex - left.reference.ledgerIndex
    || left.reference.kind.localeCompare(right.reference.kind)
    || left.reference.segmentId.localeCompare(right.reference.segmentId)
}

function assertSorted(records: readonly HistoryExactIndexRecord[], field: string): void {
  for (let index = 1; index < records.length; index += 1) {
    if (compareRecords(records[index - 1]!, records[index]!) > 0) {
      throw new Error(`${field} is not sorted at offset ${index}`)
    }
  }
}

async function loadIdentity(options: Arguments): Promise<{
  publication: HistorySegmentChainPublication
  sourceManifest: HistoryExactIndexManifest
}> {
  const publication = JSON.parse(await readFile(options.publicationPath, 'utf8')) as HistorySegmentChainPublication
  const sourceManifest = JSON.parse(await readFile(options.sourceManifestPath, 'utf8')) as HistoryExactIndexManifest
  await assertHistorySegmentPublicationDigest(publication)
  assertHistoryExactIndexManifest(sourceManifest, publication)
  if (await historyExactIndexManifestDigest(sourceManifest) !== sourceManifest.manifestSha256) {
    throw new Error('Source exact-index manifest digest mismatch')
  }
  if (sourceManifest.bucketCount !== SOURCE_BUCKET_COUNT) {
    throw new Error(`Source exact-index bucket count must be ${SOURCE_BUCKET_COUNT}`)
  }
  return { publication, sourceManifest }
}

async function writeTargetAsset(options: {
  outputDir: string
  assetPrefix: string
  sourceBucket: number
  targetBucket: number
  records: HistoryExactIndexRecord[]
}): Promise<RebucketAsset> {
  assertSorted(options.records, `Target bucket ${options.targetBucket}`)
  const text = options.records.length === 0
    ? ''
    : `${options.records.map((record) => canonicalJson(record)).join('\n')}\n`
  const decompressed = utf8(text)
  if (decompressed.byteLength > PRODUCTION_READ_LIMIT) {
    throw new Error(
      `Target bucket ${options.targetBucket} exceeds production decompression limit: ${decompressed.byteLength}`,
    )
  }
  const compressed = await gzipDeterministic(decompressed)
  const name = `${String(options.targetBucket).padStart(4, '0')}.ndjson.gz`
  await writeFile(join(options.outputDir, name), compressed)
  return {
    bucket: options.targetBucket,
    path: `${options.assetPrefix}/${name}`,
    sha256: await sha256Hex(compressed),
    compressedBytes: compressed.byteLength,
    decompressedBytes: decompressed.byteLength,
    recordCount: options.records.length,
    firstTerm: options.records[0]?.term ?? null,
    lastTerm: options.records.at(-1)?.term ?? null,
    sourceBucket: options.sourceBucket,
  }
}

async function splitRange(options: Arguments, sourceManifest: HistoryExactIndexManifest): Promise<void> {
  const start = options.bucketStart!
  const end = options.bucketEnd!
  if (start < 0 || end > SOURCE_BUCKET_COUNT || start >= end) {
    throw new Error(`Invalid source bucket range: ${start}-${end}`)
  }
  await mkdir(options.outputDir, { recursive: true })
  const assets: RebucketAsset[] = []
  let sourceRecords = 0
  let outputRecords = 0
  let maxDecompressedBytes = 0

  for (let sourceBucket = start; sourceBucket < end; sourceBucket += 1) {
    const descriptor = sourceManifest.assets[sourceBucket]
    if (!descriptor || descriptor.bucket !== sourceBucket) {
      throw new Error(`Missing source exact-index bucket ${sourceBucket}`)
    }
    process.stderr.write(`[rebucket] source ${sourceBucket}/${end - 1} start\n`)
    const compressed = new Uint8Array(await readFile(join(options.inputDir, basename(descriptor.path))))
    if (compressed.byteLength !== descriptor.compressedBytes || await sha256Hex(compressed) !== descriptor.sha256) {
      throw new Error(`Source exact-index bucket integrity mismatch: ${sourceBucket}`)
    }
    const decoded = await decodeGzipNdjsonWithMetadata({
      bytes: compressed,
      sha256: descriptor.sha256,
      maxDecompressedBytes: SOURCE_READ_LIMIT,
    })
    if (decoded.records.length !== descriptor.recordCount) {
      throw new Error(`Source exact-index bucket record count mismatch: ${sourceBucket}`)
    }

    const groups = Array.from({ length: REFINEMENT_FACTOR }, () => [] as HistoryExactIndexRecord[])
    for (const raw of decoded.records) {
      const record = raw as HistoryExactIndexRecord
      assertHistoryExactIndexRecord(record, SOURCE_BUCKET_COUNT)
      if (record.bucket !== sourceBucket) throw new Error(`Source record bucket mismatch: ${sourceBucket}`)
      const targetBucket = await historyExactIndexBucket(record.term, TARGET_BUCKET_COUNT)
      if (targetBucket % SOURCE_BUCKET_COUNT !== sourceBucket) {
        throw new Error(`Target bucket is not a valid refinement: ${sourceBucket}:${targetBucket}`)
      }
      const groupIndex = Math.floor(targetBucket / SOURCE_BUCKET_COUNT)
      const targetRecord: HistoryExactIndexRecord = { ...record, bucket: targetBucket }
      assertHistoryExactIndexRecord(targetRecord, TARGET_BUCKET_COUNT)
      groups[groupIndex]!.push(targetRecord)
    }

    let sourceMax = 0
    for (let groupIndex = 0; groupIndex < REFINEMENT_FACTOR; groupIndex += 1) {
      const targetBucket = sourceBucket + (groupIndex * SOURCE_BUCKET_COUNT)
      const records = groups[groupIndex]!
      const asset = await writeTargetAsset({
        outputDir: options.outputDir,
        assetPrefix: options.assetPrefix,
        sourceBucket,
        targetBucket,
        records,
      })
      assets.push(asset)
      outputRecords += records.length
      sourceMax = Math.max(sourceMax, asset.decompressedBytes)
      maxDecompressedBytes = Math.max(maxDecompressedBytes, asset.decompressedBytes)
    }
    sourceRecords += descriptor.recordCount
    process.stderr.write(`[rebucket] source ${sourceBucket} done records=${descriptor.recordCount} max=${sourceMax}\n`)
  }

  if (sourceRecords !== outputRecords) throw new Error('Rebucket range record accounting mismatch')
  const part: PartManifest = {
    schemaVersion: 1,
    sourceBucketStart: start,
    sourceBucketEnd: end,
    sourceBucketCount: SOURCE_BUCKET_COUNT,
    targetBucketCount: TARGET_BUCKET_COUNT,
    sourceRecords,
    outputRecords,
    maxDecompressedBytes,
    assets,
  }
  const partName = `part-${String(start).padStart(3, '0')}-${String(end).padStart(3, '0')}.json`
  await writeFile(join(options.outputDir, partName), `${canonicalJson(part)}\n`, 'utf8')
  process.stdout.write(`${canonicalJson({
    passed: true,
    mode: options.mode,
    sourceBucketStart: start,
    sourceBucketEnd: end,
    sourceRecords,
    outputRecords,
    targetAssets: assets.length,
    maxDecompressedBytes,
    productionReadLimit: PRODUCTION_READ_LIMIT,
  })}\n`)
}

async function assemble(
  options: Arguments,
  publication: HistorySegmentChainPublication,
  sourceManifest: HistoryExactIndexManifest,
): Promise<void> {
  await mkdir(options.outputDir, { recursive: true })
  const sourceBuckets = new Set<number>()
  const targetAssets = new Map<number, RebucketAsset>()
  let sourceRecords = 0
  let outputRecords = 0
  let maxDecompressedBytes = 0

  for (const path of options.partManifestPaths) {
    const part = JSON.parse(await readFile(path, 'utf8')) as PartManifest
    if (
      part.schemaVersion !== 1
      || part.sourceBucketCount !== SOURCE_BUCKET_COUNT
      || part.targetBucketCount !== TARGET_BUCKET_COUNT
      || !Number.isInteger(part.sourceBucketStart)
      || !Number.isInteger(part.sourceBucketEnd)
      || part.sourceBucketStart < 0
      || part.sourceBucketStart >= part.sourceBucketEnd
      || part.sourceBucketEnd > SOURCE_BUCKET_COUNT
    ) throw new Error(`Invalid rebucket part manifest: ${path}`)
    for (let bucket = part.sourceBucketStart; bucket < part.sourceBucketEnd; bucket += 1) {
      if (sourceBuckets.has(bucket)) throw new Error(`Duplicate rebucket source bucket: ${bucket}`)
      sourceBuckets.add(bucket)
    }
    if (part.sourceRecords !== part.outputRecords) throw new Error(`Rebucket part accounting mismatch: ${path}`)
    sourceRecords += part.sourceRecords
    outputRecords += part.outputRecords
    maxDecompressedBytes = Math.max(maxDecompressedBytes, part.maxDecompressedBytes)
    for (const asset of part.assets) {
      if (targetAssets.has(asset.bucket)) throw new Error(`Duplicate target bucket: ${asset.bucket}`)
      if (asset.decompressedBytes > PRODUCTION_READ_LIMIT) {
        throw new Error(`Target bucket exceeds production decompression limit: ${asset.bucket}`)
      }
      const compressed = new Uint8Array(await readFile(join(options.outputDir, basename(asset.path))))
      if (compressed.byteLength !== asset.compressedBytes || await sha256Hex(compressed) !== asset.sha256) {
        throw new Error(`Target bucket integrity mismatch: ${asset.bucket}`)
      }
      targetAssets.set(asset.bucket, asset)
    }
  }

  if (sourceBuckets.size !== SOURCE_BUCKET_COUNT) throw new Error('Rebucket parts do not cover all source buckets')
  if (targetAssets.size !== TARGET_BUCKET_COUNT) throw new Error('Rebucket parts do not cover all target buckets')
  if (sourceRecords !== sourceManifest.totalRecords || outputRecords !== sourceManifest.totalRecords) {
    throw new Error('Rebucket total record accounting mismatch')
  }

  const assets: HistoryExactIndexAsset[] = []
  for (let bucket = 0; bucket < TARGET_BUCKET_COUNT; bucket += 1) {
    const asset = targetAssets.get(bucket)
    if (!asset) throw new Error(`Missing target bucket ${bucket}`)
    const { decompressedBytes: _decompressedBytes, sourceBucket: _sourceBucket, ...manifestAsset } = asset
    assets.push(manifestAsset)
  }

  const manifest: HistoryExactIndexManifest = {
    schemaVersion: 2,
    network: 'devnet',
    epochId: publication.epochId,
    chainId: publication.chainId,
    publicationSha256: publication.publicationSha256,
    bucketCount: TARGET_BUCKET_COUNT,
    hashFunction: 'sha256-first-u32-mod-bucket-count',
    assets,
    totalRecords: sourceManifest.totalRecords,
    sourceRevision: options.sourceRevision,
    generatedAt: publication.publishedAt,
    manifestSha256: '0'.repeat(64),
  }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  assertHistoryExactIndexManifest(manifest, publication)
  await writeFile(join(options.outputDir, 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8')
  process.stdout.write(`${canonicalJson({
    passed: true,
    mode: options.mode,
    sourceBucketCount: SOURCE_BUCKET_COUNT,
    targetBucketCount: TARGET_BUCKET_COUNT,
    totalRecords: manifest.totalRecords,
    maxDecompressedBytes,
    productionReadLimit: PRODUCTION_READ_LIMIT,
    manifestSha256: manifest.manifestSha256,
  })}\n`)
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const { publication, sourceManifest } = await loadIdentity(options)
  if (options.mode === 'split-range') await splitRange(options, sourceManifest)
  else await assemble(options, publication, sourceManifest)
}

await main()
