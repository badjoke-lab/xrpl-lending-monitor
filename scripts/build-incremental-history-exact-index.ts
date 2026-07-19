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

interface Arguments {
  publicationPath: string
  planPath: string
  artifactRoot: string
  baseIndexDir: string
  basePublicationPath: string
  outputDir: string
  assetPrefix: string
  sourceRevision: string
}

function value(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const result = args[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${name} requires a value`)
  return result
}

function required(args: readonly string[], name: string): string {
  const result = value(args, name)
  if (result === null) throw new Error(`${name} is required`)
  return result
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

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('Incremental history exact index generation requires --local')
  return {
    publicationPath: resolve(required(args, '--publication')),
    planPath: resolve(required(args, '--plan')),
    artifactRoot: resolve(required(args, '--artifact-root')),
    baseIndexDir: resolve(required(args, '--base-index-dir')),
    basePublicationPath: resolve(required(args, '--base-publication')),
    outputDir: resolve(required(args, '--output-dir')),
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

const MAX_BASE_EXACT_INDEX_DECOMPRESSED_BYTES = 128 * 1024 * 1024

type ExactIndexAsset = HistoryExactIndexManifest['assets'][number]

function assetsByBucket(manifest: HistoryExactIndexManifest): Map<number, ExactIndexAsset> {
  const result = new Map<number, ExactIndexAsset>()
  for (const asset of manifest.assets) {
    if (result.has(asset.bucket)) throw new Error(`Duplicate base exact-index bucket: ${asset.bucket}`)
    result.set(asset.bucket, asset)
  }
  for (let bucket = 0; bucket < manifest.bucketCount; bucket += 1) {
    if (!result.has(bucket)) throw new Error(`Missing base exact-index bucket: ${bucket}`)
  }
  return result
}

async function loadBaseBucket(options: {
  manifest: HistoryExactIndexManifest
  indexDir: string
  asset: ExactIndexAsset
}): Promise<HistoryExactIndexRecord[]> {
  const path = join(options.indexDir, basename(options.asset.path))
  const bytes = new Uint8Array(await readFile(path))
  if (
    bytes.byteLength !== options.asset.compressedBytes
    || await sha256Hex(bytes) !== options.asset.sha256
  ) throw new Error(`Base exact-index asset integrity mismatch: ${options.asset.path}`)

  const decoded = await decodeGzipNdjsonWithMetadata({
    bytes,
    sha256: options.asset.sha256,
    maxDecompressedBytes: MAX_BASE_EXACT_INDEX_DECOMPRESSED_BYTES,
  })
  if (decoded.records.length !== options.asset.recordCount) {
    throw new Error(`Base exact-index record count mismatch: ${options.asset.path}`)
  }
  const records = decoded.records as HistoryExactIndexRecord[]
  for (const indexRecord of records) {
    assertHistoryExactIndexRecord(indexRecord, options.manifest.bucketCount)
    if (indexRecord.bucket !== options.asset.bucket) {
      throw new Error(`Base exact-index bucket mismatch: ${options.asset.path}`)
    }
  }
  assertSorted(records, `Base exact-index bucket ${options.asset.bucket}`)
  return records
}

async function appendDeltaEntries(options: {
  deltaBuckets: HistoryExactIndexRecord[][]
  bucketCount: number
  artifactRoot: string
  plan: HistoryExtensionPlan
}): Promise<number> {
  let added = 0
  for (const descriptor of options.plan.extension.segments) {
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

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
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

  const baseAssets = assetsByBucket(baseManifest)
  const deltaBuckets = Array.from({ length: baseManifest.bucketCount }, () => [] as HistoryExactIndexRecord[])
  const baseRecords = baseManifest.totalRecords
  const addedRecords = await appendDeltaEntries({
    deltaBuckets,
    bucketCount: baseManifest.bucketCount,
    artifactRoot: options.artifactRoot,
    plan,
  })
  for (const delta of deltaBuckets) sortRecords(delta)

  await mkdir(options.outputDir, { recursive: true })
  const assets: HistoryExactIndexManifest['assets'] = []
  let totalRecords = 0
  for (let bucket = 0; bucket < baseManifest.bucketCount; bucket += 1) {
    const asset = baseAssets.get(bucket)!
    const baseBucket = await loadBaseBucket({
      manifest: baseManifest,
      indexDir: options.baseIndexDir,
      asset,
    })
    const records = mergeSortedRecords(baseBucket, deltaBuckets[bucket]!)
    for (const indexRecord of records) assertHistoryExactIndexRecord(indexRecord, baseManifest.bucketCount)
    const text = records.length ? `${records.map((entry) => canonicalJson(entry)).join('\n')}\n` : ''
    const bytes = await gzipDeterministic(utf8(text))
    const name = `${String(bucket).padStart(4, '0')}.ndjson.gz`
    await writeFile(join(options.outputDir, name), bytes)
    assets.push({
      bucket,
      path: `${options.assetPrefix}/${name}`,
      sha256: await sha256Hex(bytes),
      compressedBytes: bytes.byteLength,
      recordCount: records.length,
      firstTerm: records[0]?.term ?? null,
      lastTerm: records.at(-1)?.term ?? null,
    })
    totalRecords += records.length
    deltaBuckets[bucket] = []
  }
  if (totalRecords !== baseRecords + addedRecords) throw new Error('Incremental exact-index accounting mismatch')

  const manifest: HistoryExactIndexManifest = {
    schemaVersion: 2,
    network: 'devnet',
    epochId: publication.epochId,
    chainId: publication.chainId,
    publicationSha256: publication.publicationSha256,
    bucketCount: baseManifest.bucketCount,
    hashFunction: 'sha256-first-u32-mod-bucket-count',
    assets,
    totalRecords,
    sourceRevision: options.sourceRevision,
    generatedAt: publication.publishedAt,
    manifestSha256: '0'.repeat(64),
  }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  await writeFile(join(options.outputDir, 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8')
  process.stdout.write(`${canonicalJson({
    passed: true,
    mergeStrategy: 'sorted-linear-merge',
    basePublicationSha256: basePublication.publicationSha256,
    targetPublicationSha256: publication.publicationSha256,
    baseRecords,
    addedRecords,
    totalRecords,
    manifestSha256: manifest.manifestSha256,
  })}\n`)
}

await main()
