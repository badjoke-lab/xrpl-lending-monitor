import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { decodeGzipNdjsonWithMetadata } from '../src/shared/current-state/artifact-reader-codec'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import {
  assertHistoryExactIndexManifest,
  assertHistoryExactIndexRecord,
  historyExactIndexBucket,
  historyExactIndexManifestDigest,
  normalizeHistoryExactTerm,
  type HistoryExactIndexManifest,
  type HistoryExactIndexRecord,
  type HistoryExactIndexReference,
  type HistoryExactReferenceKind,
  type HistoryExactSearchResultMetadata,
} from '../src/shared/history-segments/exact-index'
import {
  assertHistorySegmentManifest,
  type HistorySegmentFileKind,
  type HistorySegmentManifest,
} from '../src/shared/history-segments/manifest'
import {
  assertHistorySegmentPublicationDigest,
  type HistorySegmentChainPublication,
  type PublishedHistorySegment,
} from '../src/shared/history-segments/publication'

type Arguments = {
  sourcePublicationPath: string
  sourceManifestPath: string
  sourceRoot: string
  targetPublicationPath: string
  targetRoot: string
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
  if (!args.includes('--local')) throw new Error('Rolling history exact-index generation requires --local')
  return {
    sourcePublicationPath: resolve(required(args, '--source-publication')),
    sourceManifestPath: resolve(required(args, '--source-manifest')),
    sourceRoot: resolve(required(args, '--source-root')),
    targetPublicationPath: resolve(required(args, '--target-publication')),
    targetRoot: resolve(required(args, '--target-root')),
    outputDir: resolve(required(args, '--output-dir')),
    assetPrefix: safePrefix(value(args, '--asset-prefix') ?? 'history/index/exact'),
    sourceRevision: safeId(required(args, '--source-revision'), 'sourceRevision'),
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function ledgerIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('Indexed history record ledger index is invalid')
  return Number(value)
}

function optionalTerm(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? normalizeHistoryExactTerm(value) : null
}

function terms(values: readonly unknown[]): string[] {
  return [...new Set(values.map(optionalTerm).filter((term): term is string => term !== null))]
}

function reference(options: {
  kind: HistoryExactReferenceKind
  segmentId: string
  fileKind: HistorySegmentFileKind
  ledgerIndex: number
  searchResult: HistoryExactSearchResultMetadata | null
}): HistoryExactIndexReference {
  return options
}

function extractEntries(options: {
  epochId: string
  segmentId: string
  fileKind: HistorySegmentFileKind
  value: unknown
}): { terms: string[]; reference: HistoryExactIndexReference } | null {
  const source = record(options.value, `${options.fileKind} record`)
  if (options.fileKind === 'protocol_events') {
    const transactionHash = stringValue(source.eventHash, 'protocol event hash')
    const index = ledgerIndex(source.ledgerIndex)
    return {
      terms: terms([transactionHash]),
      reference: reference({
        kind: 'transaction_event', segmentId: options.segmentId, fileKind: options.fileKind, ledgerIndex: index,
        searchResult: { kind: 'transaction', epochId: options.epochId, ledgerIndex: index, transactionHash, objectType: null, objectId: null, loanId: null },
      }),
    }
  }
  if (options.fileKind === 'object_changes') {
    const relationships = record(source.relationships, 'object change relationships')
    const transactionHash = stringValue(source.transactionHash, 'object change transaction hash')
    const objectType = stringValue(source.objectType, 'object change object type')
    const objectId = stringValue(source.objectId, 'object change object id')
    const loanId = optionalString(relationships.loanId)
    const index = ledgerIndex(source.ledgerIndex)
    return {
      terms: terms([transactionHash, objectId, relationships.vaultId, relationships.loanBrokerId, relationships.loanId, relationships.account, relationships.owner, relationships.borrower, relationships.assetKey, relationships.mptIssuanceId]),
      reference: reference({
        kind: 'object_change', segmentId: options.segmentId, fileKind: options.fileKind, ledgerIndex: index,
        searchResult: { kind: 'object_change', epochId: options.epochId, ledgerIndex: index, transactionHash, objectType, objectId, loanId },
      }),
    }
  }
  if (options.fileKind === 'archived_objects') {
    const transactionHash = stringValue(source.deletionTransactionHash, 'archive transaction hash')
    const objectType = stringValue(source.objectType, 'archive object type')
    const objectId = stringValue(source.objectId, 'archive object id')
    const loanId = optionalString(source.loanId)
    const index = ledgerIndex(source.deletionLedgerIndex)
    return {
      terms: terms([transactionHash, objectId, source.vaultId, source.loanBrokerId, source.loanId, source.owner, source.account, source.borrower, source.assetKey]),
      reference: reference({
        kind: 'archived_object', segmentId: options.segmentId, fileKind: options.fileKind, ledgerIndex: index,
        searchResult: { kind: 'archived_object', epochId: options.epochId, ledgerIndex: index, transactionHash, objectType, objectId, loanId },
      }),
    }
  }
  if (options.fileKind === 'loan_lifecycle') {
    const transactionHash = stringValue(source.transactionHash, 'lifecycle transaction hash')
    const loanId = stringValue(source.loanId, 'lifecycle loan id')
    const index = ledgerIndex(source.ledgerIndex)
    return {
      terms: terms([transactionHash, loanId]),
      reference: reference({
        kind: 'loan_lifecycle', segmentId: options.segmentId, fileKind: options.fileKind, ledgerIndex: index,
        searchResult: { kind: 'loan_lifecycle', epochId: options.epochId, ledgerIndex: index, transactionHash, objectType: 'Loan', objectId: loanId, loanId },
      }),
    }
  }
  if (options.fileKind === 'balance_history') {
    return {
      terms: terms([source.transactionHash, source.subjectId, source.assetKey]),
      reference: reference({
        kind: 'balance_history', segmentId: options.segmentId, fileKind: options.fileKind,
        ledgerIndex: ledgerIndex(source.ledgerIndex), searchResult: null,
      }),
    }
  }
  return null
}

function compareRecords(left: HistoryExactIndexRecord, right: HistoryExactIndexRecord): number {
  return left.term.localeCompare(right.term)
    || right.reference.ledgerIndex - left.reference.ledgerIndex
    || left.reference.kind.localeCompare(right.reference.kind)
    || left.reference.segmentId.localeCompare(right.reference.segmentId)
}

function mergeSortedRecords(
  source: readonly HistoryExactIndexRecord[],
  delta: readonly HistoryExactIndexRecord[],
): HistoryExactIndexRecord[] {
  const merged: HistoryExactIndexRecord[] = []
  let sourceIndex = 0
  let deltaIndex = 0
  while (sourceIndex < source.length && deltaIndex < delta.length) {
    const sourceRecord = source[sourceIndex]!
    const deltaRecord = delta[deltaIndex]!
    if (compareRecords(sourceRecord, deltaRecord) <= 0) {
      merged.push(sourceRecord)
      sourceIndex += 1
    } else {
      merged.push(deltaRecord)
      deltaIndex += 1
    }
  }
  while (sourceIndex < source.length) merged.push(source[sourceIndex++]!)
  while (deltaIndex < delta.length) merged.push(delta[deltaIndex++]!)
  return merged
}

function assertPublicationExtension(
  source: HistorySegmentChainPublication,
  target: HistorySegmentChainPublication,
): PublishedHistorySegment[] {
  if (source.epochId !== target.epochId || source.startLedgerIndex !== target.startLedgerIndex || source.startParentHash !== target.startParentHash) {
    throw new Error('Target publication does not extend the source publication identity')
  }
  if (target.endLedgerIndex <= source.endLedgerIndex || target.segments.length <= source.segments.length) {
    throw new Error('Target publication must advance beyond source publication')
  }
  for (let index = 0; index < source.segments.length; index += 1) {
    if (canonicalJson(source.segments[index]) !== canonicalJson(target.segments[index])) {
      throw new Error(`Target publication changed source segment ${index}`)
    }
  }
  const delta = target.segments.slice(source.segments.length)
  const first = delta[0]
  if (!first || first.startLedgerIndex !== source.endLedgerIndex + 1 || first.previousSegmentEndHash !== source.endLedgerHash) {
    throw new Error('Target publication delta is not contiguous with source terminal')
  }
  return delta
}

function segmentBasePath(manifestPath: string): string {
  const slash = manifestPath.lastIndexOf('/')
  return slash < 0 ? '' : manifestPath.slice(0, slash + 1)
}

async function loadDeltaRecords(options: {
  targetRoot: string
  targetPublication: HistorySegmentChainPublication
  deltaSegments: readonly PublishedHistorySegment[]
  bucketCount: number
}): Promise<HistoryExactIndexRecord[][]> {
  const buckets = Array.from({ length: options.bucketCount }, () => [] as HistoryExactIndexRecord[])
  for (const descriptor of options.deltaSegments) {
    const manifestPath = join(options.targetRoot, descriptor.manifestPath)
    const manifestBytes = new Uint8Array(await readFile(manifestPath))
    if (await sha256Hex(manifestBytes) !== descriptor.manifestSha256) {
      throw new Error(`Delta segment manifest digest mismatch: ${descriptor.segmentId}`)
    }
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as HistorySegmentManifest
    assertHistorySegmentManifest(manifest)
    if (manifest.segmentId !== descriptor.segmentId || manifest.endLedgerHash !== descriptor.endLedgerHash) {
      throw new Error(`Delta segment publication identity mismatch: ${descriptor.segmentId}`)
    }
    const manifestBase = segmentBasePath(descriptor.manifestPath)
    for (const file of manifest.files) {
      if (!['protocol_events', 'object_changes', 'archived_objects', 'loan_lifecycle', 'balance_history'].includes(file.kind)) continue
      const bytes = new Uint8Array(await readFile(join(options.targetRoot, manifestBase, file.path)))
      const decoded = await decodeGzipNdjsonWithMetadata({ bytes, sha256: file.sha256 })
      if (decoded.records.length !== file.records) throw new Error(`Delta record count mismatch: ${descriptor.segmentId}:${file.kind}`)
      for (const raw of decoded.records) {
        const extracted = extractEntries({
          epochId: options.targetPublication.epochId,
          segmentId: descriptor.segmentId,
          fileKind: file.kind,
          value: raw,
        })
        if (!extracted) continue
        for (const term of extracted.terms) {
          const bucket = await historyExactIndexBucket(term, options.bucketCount)
          const indexRecord: HistoryExactIndexRecord = {
            schemaVersion: 2,
            bucket,
            term,
            reference: extracted.reference,
          }
          assertHistoryExactIndexRecord(indexRecord, options.bucketCount)
          buckets[bucket]!.push(indexRecord)
        }
      }
    }
  }
  for (const bucket of buckets) bucket.sort(compareRecords)
  return buckets
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const sourcePublication = JSON.parse(await readFile(options.sourcePublicationPath, 'utf8')) as HistorySegmentChainPublication
  const targetPublication = JSON.parse(await readFile(options.targetPublicationPath, 'utf8')) as HistorySegmentChainPublication
  await assertHistorySegmentPublicationDigest(sourcePublication)
  await assertHistorySegmentPublicationDigest(targetPublication)
  const deltaSegments = assertPublicationExtension(sourcePublication, targetPublication)

  const sourceManifestBytes = new Uint8Array(await readFile(options.sourceManifestPath))
  const sourceManifest = JSON.parse(new TextDecoder().decode(sourceManifestBytes)) as HistoryExactIndexManifest
  assertHistoryExactIndexManifest(sourceManifest, sourcePublication)
  if (await historyExactIndexManifestDigest(sourceManifest) !== sourceManifest.manifestSha256) {
    throw new Error('Source exact-index manifest digest mismatch')
  }

  const deltaBuckets = await loadDeltaRecords({
    targetRoot: options.targetRoot,
    targetPublication,
    deltaSegments,
    bucketCount: sourceManifest.bucketCount,
  })

  await rm(options.outputDir, { recursive: true, force: true })
  await mkdir(options.outputDir, { recursive: true })
  const assets: HistoryExactIndexManifest['assets'] = []
  let totalRecords = 0
  let deltaRecordCount = 0

  for (let bucket = 0; bucket < sourceManifest.bucketCount; bucket += 1) {
    const sourceAsset = sourceManifest.assets[bucket]!
    const sourceBytes = new Uint8Array(await readFile(join(options.sourceRoot, sourceAsset.path)))
    if (sourceBytes.byteLength !== sourceAsset.compressedBytes || await sha256Hex(sourceBytes) !== sourceAsset.sha256) {
      throw new Error(`Source exact-index asset integrity mismatch: bucket ${bucket}`)
    }
    const decoded = await decodeGzipNdjsonWithMetadata({ bytes: sourceBytes, sha256: sourceAsset.sha256 })
    if (decoded.records.length !== sourceAsset.recordCount) throw new Error(`Source exact-index record count mismatch: bucket ${bucket}`)
    const sourceRecords = decoded.records as HistoryExactIndexRecord[]
    for (const sourceRecord of sourceRecords) {
      assertHistoryExactIndexRecord(sourceRecord, sourceManifest.bucketCount)
      if (sourceRecord.bucket !== bucket) throw new Error(`Source exact-index bucket mismatch: ${bucket}`)
    }
    const deltaRecords = deltaBuckets[bucket]!
    deltaRecordCount += deltaRecords.length
    const merged = mergeSortedRecords(sourceRecords, deltaRecords)
    const text = merged.length ? `${merged.map((entry) => canonicalJson(entry)).join('\n')}\n` : ''
    const bytes = await gzipDeterministic(utf8(text))
    const name = `${String(bucket).padStart(4, '0')}.ndjson.gz`
    await writeFile(join(options.outputDir, name), bytes)
    assets.push({
      bucket,
      path: `${options.assetPrefix}/${name}`,
      sha256: await sha256Hex(bytes),
      compressedBytes: bytes.byteLength,
      recordCount: merged.length,
      firstTerm: merged[0]?.term ?? null,
      lastTerm: merged.at(-1)?.term ?? null,
    })
    totalRecords += merged.length
  }

  if (totalRecords !== sourceManifest.totalRecords + deltaRecordCount) {
    throw new Error('Rolling exact-index record accounting mismatch')
  }

  const manifest: HistoryExactIndexManifest = {
    schemaVersion: 2,
    network: 'devnet',
    epochId: targetPublication.epochId,
    chainId: targetPublication.chainId,
    publicationSha256: targetPublication.publicationSha256,
    bucketCount: sourceManifest.bucketCount,
    hashFunction: 'sha256-first-u32-mod-bucket-count',
    assets,
    totalRecords,
    sourceRevision: options.sourceRevision,
    generatedAt: targetPublication.publishedAt,
    manifestSha256: '0'.repeat(64),
  }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  assertHistoryExactIndexManifest(manifest, targetPublication)
  await writeFile(join(options.outputDir, 'manifest.json'), `${canonicalJson(manifest)}\n`, 'utf8')

  const summary = {
    schemaVersion: 1,
    source: {
      chainId: sourcePublication.chainId,
      publicationSha256: sourcePublication.publicationSha256,
      ledgerIndex: sourcePublication.endLedgerIndex,
      totalRecords: sourceManifest.totalRecords,
    },
    target: {
      chainId: targetPublication.chainId,
      publicationSha256: targetPublication.publicationSha256,
      ledgerIndex: targetPublication.endLedgerIndex,
      totalRecords,
      manifestSha256: manifest.manifestSha256,
    },
    delta: {
      segmentCount: deltaSegments.length,
      recordCount: deltaRecordCount,
    },
  }
  await writeFile(join(options.outputDir, 'rolling-summary.json'), `${canonicalJson(summary)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

await main()
