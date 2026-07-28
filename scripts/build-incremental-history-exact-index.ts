import { basename, dirname, join, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { decodeGzipNdjsonWithMetadata } from '../src/shared/current-state/artifact-reader-codec'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import {
  assertHistoryExactIndexManifest,
  assertHistoryExactIndexRecord,
  historyExactIndexBucket,
  historyExactIndexManifestDigest,
  type HistoryExactIndexManifest,
  type HistoryExactIndexRecord,
} from '../src/shared/history-segments/exact-index'
import { extractHistoryExactEntries } from '../src/shared/history-segments/exact-index-entries'
import { assertHistoryExtensionPlan, type HistoryExtensionPlan } from '../src/shared/history-segments/extension-plan'
import { assertHistorySegmentManifest, type HistorySegmentManifest } from '../src/shared/history-segments/manifest'
import {
  assertHistorySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from '../src/shared/history-segments/publication'

type Mode = 'extract-delta' | 'merge-range' | 'assemble'

interface Arguments {
  mode: Mode
  publicationPath: string
  planPath: string
  artifactRoot: string | null
  baseIndexDir: string
  basePublicationPath: string
  outputDir: string
  deltaDir: string | null
  bucketStart: number | null
  bucketEnd: number | null
  partManifestPaths: string[]
  assetPrefix: string
  sourceRevision: string
}

interface DeltaAsset {
  bucket: number
  path: string
  sha256: string
  compressedBytes: number
  recordCount: number
}

interface DeltaManifest {
  schemaVersion: 1
  bucketCount: number
  baseRecords: number
  addedRecords: number
  assets: DeltaAsset[]
}

interface PartManifest {
  schemaVersion: 1
  bucketStart: number
  bucketEnd: number
  bucketCount: number
  baseRecords: number
  addedRecords: number
  partRecords: number
  assets: HistoryExactIndexManifest['assets']
}

interface Context {
  publication: HistorySegmentChainPublication
  basePublication: HistorySegmentChainPublication
  plan: HistoryExtensionPlan
  baseManifest: HistoryExactIndexManifest
}

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
  return Number(raw)
}

function safeId(input: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input)) throw new Error(`${field} is invalid`)
  return input
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

function parseMode(raw: string): Mode {
  if (raw === 'extract-delta' || raw === 'merge-range' || raw === 'assemble') return raw
  throw new Error('--mode must be extract-delta, merge-range, or assemble')
}

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('Incremental history exact index generation requires --local')
  const mode = parseMode(required(args, '--mode'))
  const artifactRoot = value(args, '--artifact-root')
  const deltaDir = value(args, '--delta-dir')
  const bucketStart = value(args, '--bucket-start') === null ? null : integer(args, '--bucket-start')
  const bucketEnd = value(args, '--bucket-end') === null ? null : integer(args, '--bucket-end')
  const partManifestPaths = values(args, '--part-manifest').map((item) => resolve(item))

  if (mode === 'extract-delta' && artifactRoot === null) throw new Error('--artifact-root is required for extract-delta')
  if (mode === 'merge-range' && deltaDir === null) throw new Error('--delta-dir is required for merge-range')
  if (mode === 'merge-range' && (bucketStart === null || bucketEnd === null)) {
    throw new Error('--bucket-start and --bucket-end are required for merge-range')
  }
  if (mode === 'assemble' && partManifestPaths.length === 0) throw new Error('--part-manifest is required for assemble')

  return {
    mode,
    publicationPath: resolve(required(args, '--publication')),
    planPath: resolve(required(args, '--plan')),
    artifactRoot: artifactRoot === null ? null : resolve(artifactRoot),
    baseIndexDir: resolve(required(args, '--base-index-dir')),
    basePublicationPath: resolve(required(args, '--base-publication')),
    outputDir: resolve(required(args, '--output-dir')),
    deltaDir: deltaDir === null ? null : resolve(deltaDir),
    bucketStart,
    bucketEnd,
    partManifestPaths,
    assetPrefix: safePrefix(value(args, '--asset-prefix') ?? 'history/index/exact'),
    sourceRevision: safeId(required(args, '--source-revision'), 'sourceRevision'),
  }
}

function compareRecords(left: HistoryExactIndexRecord, right: HistoryExactIndexRecord): number {
  return left.term.localeCompare(right.term)
    || right.reference.ledgerIndex - left.reference.ledgerIndex
    || left.reference.kind.localeCompare(right.reference.kind)
    || left.reference.segmentId.localeCompare(right.reference.segmentId)
}

function sortRecords(records: HistoryExactIndexRecord[]): void {
  records.sort(compareRecords)
}

function assertSorted(records: readonly HistoryExactIndexRecord[], field: string): void {
  for (let index = 1; index < records.length; index += 1) {
    if (compareRecords(records[index - 1]!, records[index]!) > 0) {
      throw new Error(`${field} is not sorted at offset ${index}`)
    }
  }
}

function mergeSortedRecords(
  base: readonly HistoryExactIndexRecord[],
  delta: readonly HistoryExactIndexRecord[],
): HistoryExactIndexRecord[] {
  const merged = new Array<HistoryExactIndexRecord>(base.length + delta.length)
  let baseIndex = 0
  let deltaIndex = 0
  let outputIndex = 0

  while (baseIndex < base.length && deltaIndex < delta.length) {
    const baseRecord = base[baseIndex]!
    const deltaRecord = delta[deltaIndex]!
    if (compareRecords(baseRecord, deltaRecord) <= 0) {
      merged[outputIndex++] = baseRecord
      baseIndex += 1
    } else {
      merged[outputIndex++] = deltaRecord
      deltaIndex += 1
    }
  }
  while (baseIndex < base.length) merged[outputIndex++] = base[baseIndex++]!
  while (deltaIndex < delta.length) merged[outputIndex++] = delta[deltaIndex++]!
  return merged
}

const MAX_EXACT_INDEX_DECOMPRESSED_BYTES = 128 * 1024 * 1024

type ExactIndexAsset = HistoryExactIndexManifest['assets'][number]

function assetsByBucket<T extends { bucket: number }>(assets: readonly T[], bucketCount: number, field: string): Map<number, T> {
  const result = new Map<number, T>()
  for (const asset of assets) {
    if (!Number.isInteger(asset.bucket) || asset.bucket < 0 || asset.bucket >= bucketCount) {
      throw new Error(`${field} has invalid bucket: ${asset.bucket}`)
    }
    if (result.has(asset.bucket)) throw new Error(`${field} has duplicate bucket: ${asset.bucket}`)
    result.set(asset.bucket, asset)
  }
  return result
}

async function loadRecordsAsset(options: {
  path: string
  sha256: string
  compressedBytes: number
  recordCount: number
  bucket: number
  bucketCount: number
  field: string
}): Promise<HistoryExactIndexRecord[]> {
  const bytes = new Uint8Array(await readFile(options.path))
  if (bytes.byteLength !== options.compressedBytes || await sha256Hex(bytes) !== options.sha256) {
    throw new Error(`${options.field} integrity mismatch: ${options.path}`)
  }
  const decoded = await decodeGzipNdjsonWithMetadata({
    bytes,
    sha256: options.sha256,
    maxDecompressedBytes: MAX_EXACT_INDEX_DECOMPRESSED_BYTES,
  })
  if (decoded.records.length !== options.recordCount) {
    throw new Error(`${options.field} record count mismatch: ${options.path}`)
  }
  const records = decoded.records as HistoryExactIndexRecord[]
  for (const record of records) {
    assertHistoryExactIndexRecord(record, options.bucketCount)
    if (record.bucket !== options.bucket) throw new Error(`${options.field} bucket mismatch: ${options.path}`)
  }
  assertSorted(records, `${options.field} bucket ${options.bucket}`)
  return records
}

async function writeRecordsAsset(options: {
  outputDir: string
  bucket: number
  records: HistoryExactIndexRecord[]
  assetPrefix: string | null
}): Promise<ExactIndexAsset | DeltaAsset> {
  const text = options.records.length
    ? `${options.records.map((entry) => canonicalJson(entry)).join('\n')}\n`
    : ''
  const bytes = await gzipDeterministic(utf8(text))
  const name = `${String(options.bucket).padStart(4, '0')}.ndjson.gz`
  await writeFile(join(options.outputDir, name), bytes)
  return {
    bucket: options.bucket,
    path: options.assetPrefix === null ? name : `${options.assetPrefix}/${name}`,
    sha256: await sha256Hex(bytes),
    compressedBytes: bytes.byteLength,
    recordCount: options.records.length,
    ...(options.assetPrefix === null ? {} : {
      firstTerm: options.records[0]?.term ?? null,
      lastTerm: options.records.at(-1)?.term ?? null,
    }),
  } as ExactIndexAsset | DeltaAsset
}

async function loadContext(options: Arguments): Promise<Context> {
  const publication = JSON.parse(await readFile(options.publicationPath, 'utf8')) as HistorySegmentChainPublication
  const basePublication = JSON.parse(await readFile(options.basePublicationPath, 'utf8')) as HistorySegmentChainPublication
  const plan = JSON.parse(await readFile(options.planPath, 'utf8')) as HistoryExtensionPlan
  const baseManifest = JSON.parse(await readFile(join(options.baseIndexDir, 'manifest.json'), 'utf8')) as HistoryExactIndexManifest

  await assertHistorySegmentPublicationDigest(publication)
  await assertHistorySegmentPublicationDigest(basePublication)
  assertHistoryExtensionPlan(plan)
  assertHistoryExactIndexManifest(baseManifest, basePublication)
  if (await historyExactIndexManifestDigest(baseManifest) !== baseManifest.manifestSha256) {
    throw new Error('Base exact-index manifest digest mismatch')
  }
  if (
    plan.source.chainId !== basePublication.chainId
    || plan.source.publicationSha256 !== basePublication.publicationSha256
    || plan.source.endLedgerIndex !== basePublication.endLedgerIndex
    || plan.source.endLedgerHash !== basePublication.endLedgerHash
  ) throw new Error('Incremental exact-index plan source does not match base publication')
  if (
    plan.target.ledgerIndex !== publication.endLedgerIndex
    || plan.target.ledgerHash !== publication.endLedgerHash
    || plan.epochId !== publication.epochId
  ) throw new Error('Incremental exact-index plan target does not match target publication')
  return { publication, basePublication, plan, baseManifest }
}

async function appendDeltaEntries(options: {
  deltaBuckets: HistoryExactIndexRecord[][]
  bucketCount: number
  artifactRoot: string
  plan: HistoryExtensionPlan
}): Promise<number> {
  let added = 0
  let processedSegments = 0
  for (const descriptor of options.plan.extension.segments) {
    processedSegments += 1
    process.stderr.write(`[exact-index] delta-segment ${processedSegments}/${options.plan.extension.segments.length} ${descriptor.segmentId}\n`)
    const manifestPath = join(options.artifactRoot, 'history', options.plan.epochId, descriptor.segmentId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as HistorySegmentManifest
    assertHistorySegmentManifest(manifest)
    if (
      manifest.segmentId !== descriptor.segmentId
      || manifest.startLedgerIndex !== descriptor.startLedgerIndex
      || manifest.endLedgerIndex !== descriptor.endLedgerIndex
    ) throw new Error(`Incremental exact-index segment identity mismatch: ${descriptor.segmentId}`)

    const manifestBase = dirname(manifestPath)
    for (const file of manifest.files) {
      if (!['protocol_events', 'object_changes', 'archived_objects', 'loan_lifecycle', 'balance_history'].includes(file.kind)) continue
      const bytes = new Uint8Array(await readFile(join(manifestBase, file.path)))
      const decoded = await decodeGzipNdjsonWithMetadata({ bytes, sha256: file.sha256 })
      if (decoded.records.length !== file.records) throw new Error(`Delta exact-index record count mismatch: ${descriptor.segmentId}:${file.kind}`)
      for (const rawRecord of decoded.records) {
        const extracted = extractHistoryExactEntries({
          epochId: options.plan.epochId,
          segmentId: descriptor.segmentId,
          fileKind: file.kind,
          value: rawRecord,
        })
        if (!extracted) continue
        for (const term of extracted.terms) {
          const bucket = await historyExactIndexBucket(term, options.bucketCount)
          options.deltaBuckets[bucket]!.push({ schemaVersion: 2, bucket, term, reference: extracted.reference })
          added += 1
        }
      }
    }
  }
  return added
}

async function extractDelta(options: Arguments, context: Context): Promise<void> {
  const artifactRoot = options.artifactRoot!
  const bucketCount = context.baseManifest.bucketCount
  const deltaBuckets = Array.from({ length: bucketCount }, () => [] as HistoryExactIndexRecord[])
  const addedRecords = await appendDeltaEntries({
    deltaBuckets,
    bucketCount,
    artifactRoot,
    plan: context.plan,
  })
  for (const bucket of deltaBuckets) sortRecords(bucket)

  await mkdir(options.outputDir, { recursive: true })
  const assets: DeltaAsset[] = []
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    process.stderr.write(`[exact-index] delta-bucket ${bucket + 1}/${bucketCount} write\n`)
    assets.push(await writeRecordsAsset({
      outputDir: options.outputDir,
      bucket,
      records: deltaBuckets[bucket]!,
      assetPrefix: null,
    }) as DeltaAsset)
    deltaBuckets[bucket] = []
  }

  const manifest: DeltaManifest = {
    schemaVersion: 1,
    bucketCount,
    baseRecords: context.baseManifest.totalRecords,
    addedRecords,
    assets,
  }
  await writeFile(join(options.outputDir, 'delta-manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8')
  process.stdout.write(`${canonicalJson({
    passed: true,
    mode: options.mode,
    baseRecords: manifest.baseRecords,
    addedRecords: manifest.addedRecords,
    bucketCount,
  })}\n`)
}

async function mergeRange(options: Arguments, context: Context): Promise<void> {
  const bucketStart = options.bucketStart!
  const bucketEnd = options.bucketEnd!
  const bucketCount = context.baseManifest.bucketCount
  if (bucketStart < 0 || bucketEnd > bucketCount || bucketStart >= bucketEnd) {
    throw new Error(`Invalid bucket range: ${bucketStart}-${bucketEnd}`)
  }

  const deltaManifest = JSON.parse(
    await readFile(join(options.deltaDir!, 'delta-manifest.json'), 'utf8'),
  ) as DeltaManifest
  if (
    deltaManifest.schemaVersion !== 1
    || deltaManifest.bucketCount !== bucketCount
    || deltaManifest.baseRecords !== context.baseManifest.totalRecords
    || !Number.isInteger(deltaManifest.addedRecords)
    || deltaManifest.addedRecords <= 0
  ) throw new Error('Delta exact-index manifest identity mismatch')

  const baseAssets = assetsByBucket(context.baseManifest.assets, bucketCount, 'Base exact-index manifest')
  const deltaAssets = assetsByBucket(deltaManifest.assets, bucketCount, 'Delta exact-index manifest')
  if (deltaAssets.size !== bucketCount) throw new Error('Delta exact-index manifest does not cover every bucket')

  await mkdir(options.outputDir, { recursive: true })
  const assets: HistoryExactIndexManifest['assets'] = []
  let partRecords = 0
  for (let bucket = bucketStart; bucket < bucketEnd; bucket += 1) {
    process.stderr.write(`[exact-index] bucket ${bucket}/${bucketEnd - 1} start range=${bucketStart}-${bucketEnd}\n`)
    const baseAsset = baseAssets.get(bucket)!
    const deltaAsset = deltaAssets.get(bucket)!
    const baseRecords = await loadRecordsAsset({
      path: join(options.baseIndexDir, basename(baseAsset.path)),
      sha256: baseAsset.sha256,
      compressedBytes: baseAsset.compressedBytes,
      recordCount: baseAsset.recordCount,
      bucket,
      bucketCount,
      field: 'Base exact-index asset',
    })
    const deltaRecords = await loadRecordsAsset({
      path: join(options.deltaDir!, basename(deltaAsset.path)),
      sha256: deltaAsset.sha256,
      compressedBytes: deltaAsset.compressedBytes,
      recordCount: deltaAsset.recordCount,
      bucket,
      bucketCount,
      field: 'Delta exact-index asset',
    })
    const records = mergeSortedRecords(baseRecords, deltaRecords)
    for (const record of records) assertHistoryExactIndexRecord(record, bucketCount)
    const asset = await writeRecordsAsset({
      outputDir: options.outputDir,
      bucket,
      records,
      assetPrefix: options.assetPrefix,
    }) as ExactIndexAsset
    assets.push(asset)
    partRecords += records.length
    process.stderr.write(`[exact-index] bucket ${bucket} done records=${records.length} range=${bucketStart}-${bucketEnd}\n`)
  }

  const manifest: PartManifest = {
    schemaVersion: 1,
    bucketStart,
    bucketEnd,
    bucketCount,
    baseRecords: deltaManifest.baseRecords,
    addedRecords: deltaManifest.addedRecords,
    partRecords,
    assets,
  }
  const partName = `part-${String(bucketStart).padStart(3, '0')}-${String(bucketEnd).padStart(3, '0')}.json`
  await writeFile(join(options.outputDir, partName), `${canonicalJson(manifest)}\n`, 'utf8')
  process.stdout.write(`${canonicalJson({
    passed: true,
    mode: options.mode,
    bucketStart,
    bucketEnd,
    bucketCount,
    baseRecords: manifest.baseRecords,
    addedRecords: manifest.addedRecords,
    partRecords,
  })}\n`)
}

async function assemble(options: Arguments, context: Context): Promise<void> {
  const bucketCount = context.baseManifest.bucketCount
  const assetsByNumber = new Map<number, ExactIndexAsset>()
  let baseRecords: number | null = null
  let addedRecords: number | null = null

  for (const path of options.partManifestPaths) {
    const part = JSON.parse(await readFile(path, 'utf8')) as PartManifest
    if (
      part.schemaVersion !== 1
      || part.bucketCount !== bucketCount
      || !Number.isInteger(part.bucketStart)
      || !Number.isInteger(part.bucketEnd)
      || part.bucketStart < 0
      || part.bucketStart >= part.bucketEnd
      || part.bucketEnd > bucketCount
    ) throw new Error(`Invalid exact-index part manifest: ${path}`)
    if (baseRecords === null) baseRecords = part.baseRecords
    if (addedRecords === null) addedRecords = part.addedRecords
    if (part.baseRecords !== baseRecords || part.addedRecords !== addedRecords) {
      throw new Error(`Exact-index part accounting mismatch: ${path}`)
    }
    if (part.partRecords !== part.assets.reduce((sum, asset) => sum + asset.recordCount, 0)) {
      throw new Error(`Exact-index part record count mismatch: ${path}`)
    }
    for (const asset of part.assets) {
      if (asset.bucket < part.bucketStart || asset.bucket >= part.bucketEnd) {
        throw new Error(`Exact-index part contains out-of-range bucket: ${path}:${asset.bucket}`)
      }
      if (assetsByNumber.has(asset.bucket)) throw new Error(`Duplicate exact-index part bucket: ${asset.bucket}`)
      const bytes = new Uint8Array(await readFile(join(options.outputDir, basename(asset.path))))
      if (bytes.byteLength !== asset.compressedBytes || await sha256Hex(bytes) !== asset.sha256) {
        throw new Error(`Exact-index part asset integrity mismatch: ${asset.path}`)
      }
      assetsByNumber.set(asset.bucket, asset)
    }
  }

  if (baseRecords === null || addedRecords === null) throw new Error('No exact-index part accounting was loaded')
  const assets: HistoryExactIndexManifest['assets'] = []
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const asset = assetsByNumber.get(bucket)
    if (!asset) throw new Error(`Missing exact-index part bucket: ${bucket}`)
    assets.push(asset)
  }
  const totalRecords = assets.reduce((sum, asset) => sum + asset.recordCount, 0)
  if (totalRecords !== baseRecords + addedRecords) throw new Error('Incremental exact-index accounting mismatch')

  const manifest: HistoryExactIndexManifest = {
    schemaVersion: 2,
    network: 'devnet',
    epochId: context.publication.epochId,
    chainId: context.publication.chainId,
    publicationSha256: context.publication.publicationSha256,
    bucketCount,
    hashFunction: 'sha256-first-u32-mod-bucket-count',
    assets,
    totalRecords,
    sourceRevision: options.sourceRevision,
    generatedAt: context.publication.publishedAt,
    manifestSha256: '0'.repeat(64),
  }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  assertHistoryExactIndexManifest(manifest, context.publication)
  await writeFile(join(options.outputDir, 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8')
  process.stdout.write(`${canonicalJson({
    passed: true,
    mode: options.mode,
    mergeStrategy: 'partitioned-sorted-linear-merge',
    basePublicationSha256: context.basePublication.publicationSha256,
    targetPublicationSha256: context.publication.publicationSha256,
    baseRecords,
    addedRecords,
    totalRecords,
    manifestSha256: manifest.manifestSha256,
  })}\n`)
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const context = await loadContext(options)
  if (options.mode === 'extract-delta') await extractDelta(options, context)
  else if (options.mode === 'merge-range') await mergeRange(options, context)
  else await assemble(options, context)
}

await main()
