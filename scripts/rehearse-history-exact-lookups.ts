import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type {
  ArtifactMetadata,
  ArtifactStore,
} from '../src/shared/current-state/artifact-metadata'
import { canonicalJson, sha256Hex } from '../src/shared/current-state/canonical-json'
import {
  assertHistoryExactIndexManifest,
  historyExactIndexManifestDigest,
  normalizeHistoryExactTerm,
  type HistoryExactIndexManifest,
  type HistoryExactIndexReference,
} from '../src/shared/history-segments/exact-index'
import { HistoryExactIndexReader } from '../src/shared/history-segments/exact-index-reader'
import {
  assertHistorySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from '../src/shared/history-segments/publication'
import {
  HistorySegmentChainReader,
  type HistorySegmentFileReference,
} from '../src/shared/history-segments/reader'

interface Arguments {
  publicationPath: string
  exactIndexManifestPath: string
  artifactRoot: string
  terms: string[]
}

interface TermSummary {
  term: string
  bucket: number
  referenceCount: number
  referenceKinds: string[]
  referencedAssets: number
  indexAssetReads: number
  historyAssetReads: number
  indexCompressedBytes: number
  indexDecompressedBytes: number
  historyCompressedBytes: number
  historyDecompressedBytes: number
  recordsExamined: number
  matchedRecords: number
  referenceLedgers: number[]
  matchedLedgers: number[]
}

function argumentValues(args: readonly string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    values.push(value)
  }
  return values
}

function requiredArgument(args: readonly string[], name: string): string {
  const values = argumentValues(args, name)
  if (values.length !== 1) throw new Error(`${name} must be supplied exactly once`)
  return values[0]!
}

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('Exact history rehearsal requires --local')
  const terms = argumentValues(args, '--term')
  if (terms.length === 0) throw new Error('At least one --term is required')
  return {
    publicationPath: resolve(requiredArgument(args, '--publication')),
    exactIndexManifestPath: resolve(requiredArgument(args, '--exact-index-manifest')),
    artifactRoot: resolve(requiredArgument(args, '--artifact-root')),
    terms,
  }
}

function safeArtifactKey(value: string): string {
  if (
    value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(value)
  ) throw new Error(`Unsafe local artifact key: ${value}`)
  return value
}

class LocalReadOnlyArtifactStore implements ArtifactStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  write(): Promise<void> {
    return Promise.reject(new Error('Exact history rehearsal artifact store is read-only'))
  }

  async read(key: string): Promise<Uint8Array | null> {
    const path = join(this.#root, safeArtifactKey(key))
    try {
      return new Uint8Array(await readFile(path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async inspect(key: string): Promise<ArtifactMetadata | null> {
    const bytes = await this.read(key)
    if (!bytes) return null
    return { key, size: bytes.byteLength, sha256: await sha256Hex(bytes) }
  }

  enumerate(): Promise<ArtifactMetadata[]> {
    return Promise.resolve([])
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function sameTerm(value: unknown, term: string): boolean {
  return typeof value === 'string' && normalizeHistoryExactTerm(value) === term
}

function recordLedger(kind: HistoryExactIndexReference['fileKind'], value: Record<string, unknown>): number | null {
  const candidate = kind === 'archived_objects' ? value.deletionLedgerIndex : value.ledgerIndex
  return Number.isSafeInteger(candidate) ? Number(candidate) : null
}

function recordMatchesTerm(
  kind: HistoryExactIndexReference['fileKind'],
  raw: unknown,
  term: string,
  ledgerIndexes: ReadonlySet<number>,
): boolean {
  const value = object(raw)
  if (!value) return false
  const ledger = recordLedger(kind, value)
  if (ledger === null || !ledgerIndexes.has(ledger)) return false

  if (kind === 'protocol_events') return sameTerm(value.eventHash, term)
  if (kind === 'object_changes') {
    const relationships = object(value.relationships) ?? {}
    return [
      value.transactionHash,
      value.objectId,
      relationships.vaultId,
      relationships.loanBrokerId,
      relationships.loanId,
      relationships.account,
      relationships.owner,
      relationships.borrower,
      relationships.assetKey,
      relationships.mptIssuanceId,
    ].some((candidate) => sameTerm(candidate, term))
  }
  if (kind === 'archived_objects') {
    return [
      value.deletionTransactionHash,
      value.objectId,
      value.vaultId,
      value.loanBrokerId,
      value.loanId,
      value.owner,
      value.account,
      value.borrower,
      value.assetKey,
    ].some((candidate) => sameTerm(candidate, term))
  }
  if (kind === 'loan_lifecycle') {
    return [value.transactionHash, value.loanId].some((candidate) => sameTerm(candidate, term))
  }
  if (kind === 'balance_history') {
    return [value.transactionHash, value.subjectId, value.assetKey]
      .some((candidate) => sameTerm(candidate, term))
  }
  return false
}

function groupReferences(references: readonly HistoryExactIndexReference[]): Map<string, HistoryExactIndexReference[]> {
  const groups = new Map<string, HistoryExactIndexReference[]>()
  for (const reference of references) {
    const key = `${reference.segmentId}:${reference.fileKind}`
    const group = groups.get(key) ?? []
    group.push(reference)
    groups.set(key, group)
  }
  return groups
}

async function rehearseTerm(options: {
  termValue: string
  exactIndex: HistoryExactIndexReader
  history: HistorySegmentChainReader
}): Promise<TermSummary> {
  const lookup = await options.exactIndex.find(options.termValue, { limit: 100 })
  if (lookup.references.length === 0) throw new Error(`Exact history term has no references: ${lookup.term}`)

  const groups = groupReferences(lookup.references)
  let historyAssetReads = 0
  let historyCompressedBytes = 0
  let historyDecompressedBytes = 0
  let recordsExamined = 0
  let matchedRecords = 0
  const matchedLedgers = new Set<number>()

  for (const group of groups.values()) {
    const first = group[0]!
    const referenceLedgers = new Set(group.map((reference) => reference.ledgerIndex))
    const references: HistorySegmentFileReference[] = group.map((reference) => ({
      segmentId: reference.segmentId,
      fileKind: reference.fileKind,
      ledgerIndex: reference.ledgerIndex,
    }))
    const result = await options.history.readReferenced({
      references,
      predicate: (value) => recordMatchesTerm(first.fileKind, value, lookup.term, referenceLedgers),
      limit: 100,
      maxAssetReads: 1,
    })
    historyAssetReads += result.assetReads
    historyCompressedBytes += result.compressedBytes
    historyDecompressedBytes += result.decompressedBytes
    recordsExamined += result.recordsExamined
    matchedRecords += result.items.length
    for (const raw of result.items) {
      const value = object(raw)
      if (!value) continue
      const ledger = recordLedger(first.fileKind, value)
      if (ledger !== null) matchedLedgers.add(ledger)
    }
    for (const ledger of referenceLedgers) {
      if (!matchedLedgers.has(ledger)) {
        throw new Error(`Exact history reference did not resolve to a matching record: ${lookup.term}:${first.segmentId}:${first.fileKind}:${ledger}`)
      }
    }
  }

  const referenceLedgers = [...new Set(lookup.references.map((reference) => reference.ledgerIndex))]
    .sort((left, right) => left - right)
  return {
    term: lookup.term,
    bucket: lookup.bucket,
    referenceCount: lookup.references.length,
    referenceKinds: [...new Set(lookup.references.map((reference) => reference.kind))].sort(),
    referencedAssets: groups.size,
    indexAssetReads: lookup.assetReads,
    historyAssetReads,
    indexCompressedBytes: lookup.compressedBytes,
    indexDecompressedBytes: lookup.decompressedBytes,
    historyCompressedBytes,
    historyDecompressedBytes,
    recordsExamined,
    matchedRecords,
    referenceLedgers,
    matchedLedgers: [...matchedLedgers].sort((left, right) => left - right),
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  await stat(options.artifactRoot)
  const publication = JSON.parse(await readFile(options.publicationPath, 'utf8')) as HistorySegmentChainPublication
  await assertHistorySegmentPublicationDigest(publication)
  const exactIndexManifest = JSON.parse(
    await readFile(options.exactIndexManifestPath, 'utf8'),
  ) as HistoryExactIndexManifest
  assertHistoryExactIndexManifest(exactIndexManifest, publication)
  if (await historyExactIndexManifestDigest(exactIndexManifest) !== exactIndexManifest.manifestSha256) {
    throw new Error('Exact history rehearsal manifest digest mismatch')
  }

  const store = new LocalReadOnlyArtifactStore(options.artifactRoot)
  const history = await HistorySegmentChainReader.open({ store, publication })
  const exactIndex = await HistoryExactIndexReader.open({
    store,
    publication,
    manifest: exactIndexManifest,
  })

  const terms: TermSummary[] = []
  for (const termValue of options.terms) {
    terms.push(await rehearseTerm({ termValue, exactIndex, history }))
  }

  const summary = {
    schemaVersion: 1,
    passed: true,
    network: publication.network,
    epochId: publication.epochId,
    chainId: publication.chainId,
    startLedgerIndex: publication.startLedgerIndex,
    endLedgerIndex: publication.endLedgerIndex,
    segmentCount: publication.segmentCount,
    ledgerCount: publication.ledgerCount,
    publicationSha256: publication.publicationSha256,
    exactIndexManifestSha256: exactIndexManifest.manifestSha256,
    bucketCount: exactIndexManifest.bucketCount,
    exactIndexRecords: exactIndexManifest.totalRecords,
    termCount: terms.length,
    terms,
  }
  process.stdout.write(`${canonicalJson(summary)}\n`)
}

await main()
