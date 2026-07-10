import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { decodeGzipNdjsonWithMetadata } from '../src/shared/current-state/artifact-reader-codec'
import { canonicalJson, gzipDeterministic, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import {
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

interface Arguments {
  publicationPath: string
  artifactRoot: string
  outputDir: string
  assetPrefix: string
  bucketCount: number
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

function positiveInteger(args: readonly string[], name: string, fallback: number): number {
  const raw = value(args, name)
  if (raw === null) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive safe integer`)
  return parsed
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
  if (!args.includes('--local')) throw new Error('History exact index generation requires --local')
  return {
    publicationPath: resolve(required(args, '--publication')),
    artifactRoot: resolve(required(args, '--artifact-root')),
    outputDir: resolve(required(args, '--output-dir')),
    assetPrefix: safePrefix(value(args, '--asset-prefix') ?? 'history/index/exact'),
    bucketCount: positiveInteger(args, '--bucket-count', 256),
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

function segmentBasePath(manifestPath: string): string {
  const slash = manifestPath.lastIndexOf('/')
  return slash < 0 ? '' : manifestPath.slice(0, slash + 1)
}

async function loadSegment(artifactRoot: string, descriptor: PublishedHistorySegment): Promise<{ manifest: HistorySegmentManifest; manifestBase: string }> {
  const path = join(artifactRoot, descriptor.manifestPath)
  const bytes = new Uint8Array(await readFile(path))
  if (await sha256Hex(bytes) !== descriptor.manifestSha256) throw new Error(`Segment manifest digest mismatch: ${descriptor.segmentId}`)
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as HistorySegmentManifest
  assertHistorySegmentManifest(manifest)
  if (manifest.segmentId !== descriptor.segmentId || manifest.endLedgerHash !== descriptor.endLedgerHash) throw new Error(`Segment publication identity mismatch: ${descriptor.segmentId}`)
  return { manifest, manifestBase: segmentBasePath(descriptor.manifestPath) }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const publicationBytes = new Uint8Array(await readFile(options.publicationPath))
  const publication = JSON.parse(new TextDecoder().decode(publicationBytes)) as HistorySegmentChainPublication
  await assertHistorySegmentPublicationDigest(publication)

  const buckets = Array.from({ length: options.bucketCount }, () => [] as HistoryExactIndexRecord[])
  for (const descriptor of publication.segments) {
    const { manifest, manifestBase } = await loadSegment(options.artifactRoot, descriptor)
    for (const file of manifest.files) {
      if (!['protocol_events', 'object_changes', 'archived_objects', 'loan_lifecycle', 'balance_history'].includes(file.kind)) continue
      const bytes = new Uint8Array(await readFile(join(options.artifactRoot, manifestBase, file.path)))
      const decoded = await decodeGzipNdjsonWithMetadata({ bytes, sha256: file.sha256 })
      if (decoded.records.length !== file.records) throw new Error(`Segment record count mismatch: ${descriptor.segmentId}:${file.kind}`)
      for (const value of decoded.records) {
        const extracted = extractEntries({ epochId: publication.epochId, segmentId: descriptor.segmentId, fileKind: file.kind, value })
        if (!extracted) continue
        for (const term of extracted.terms) {
          const bucket = await historyExactIndexBucket(term, options.bucketCount)
          buckets[bucket]!.push({ schemaVersion: 2, bucket, term, reference: extracted.reference })
        }
      }
    }
  }

  await rm(options.outputDir, { recursive: true, force: true })
  await mkdir(options.outputDir, { recursive: true })
  const assets: HistoryExactIndexManifest['assets'] = []
  let totalRecords = 0
  for (let bucket = 0; bucket < options.bucketCount; bucket += 1) {
    const records = buckets[bucket]!
    records.sort((left, right) => left.term.localeCompare(right.term)
      || right.reference.ledgerIndex - left.reference.ledgerIndex
      || left.reference.kind.localeCompare(right.reference.kind)
      || left.reference.segmentId.localeCompare(right.reference.segmentId))
    const text = records.length ? `${records.map((entry) => canonicalJson(entry)).join('\n')}\n` : ''
    const bytes = await gzipDeterministic(utf8(text))
    const name = `${String(bucket).padStart(4, '0')}.ndjson.gz`
    await writeFile(join(options.outputDir, name), bytes)
    assets.push({ bucket, path: `${options.assetPrefix}/${name}`, sha256: await sha256Hex(bytes), compressedBytes: bytes.byteLength, recordCount: records.length, firstTerm: records[0]?.term ?? null, lastTerm: records.at(-1)?.term ?? null })
    totalRecords += records.length
  }

  const manifest: HistoryExactIndexManifest = {
    schemaVersion: 2,
    network: 'devnet',
    epochId: publication.epochId,
    chainId: publication.chainId,
    publicationSha256: publication.publicationSha256,
    bucketCount: options.bucketCount,
    hashFunction: 'sha256-first-u32-mod-bucket-count',
    assets,
    totalRecords,
    sourceRevision: options.sourceRevision,
    generatedAt: publication.publishedAt,
    manifestSha256: '0'.repeat(64),
  }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  const manifestText = `${canonicalJson(manifest)}\n`
  await writeFile(join(options.outputDir, 'manifest.json'), manifestText, 'utf8')
  process.stdout.write(manifestText)
}

await main()
