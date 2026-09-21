import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import {
  buildPortableXrplNormalizedWork,
  type PortableXrplNormalizedWorkV1,
} from '../../collector/history-segments/portable-xrpl-normalization'
import type { SemanticCountsV1 } from '../portable-collector-payload'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'

const RIPPLE_EPOCH_UNIX_SECONDS = 946_684_800
const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/
const PORTABLE_DIGEST = /^sha256:[a-f0-9]{64}$/

export interface DbLessArtifact {
  key: string
  mediaType: 'application/json'
  bytes: Uint8Array
  sha256: string
  immutable: true
}

export interface DbLessLiveDeltaChunkV1 {
  chunkIndex: number
  key: string
  records: number
  bytes: number
  artifactSha256: string
  chunkDigest: string
}

export interface DbLessLiveDeltaManifestV1 {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  baseIdentity: string
  generationId: string
  workId: string
  sourceRevision: string
  generatedAt: string
  previousLedgerIndex: number
  expectedParentHash: string
  startLedgerIndex: number
  startLedgerHash: string
  endLedgerIndex: number
  endLedgerHash: string
  ledgerCount: number
  payloadDigest: string
  semanticCounts: SemanticCountsV1
  chunks: DbLessLiveDeltaChunkV1[]
}

export interface DbLessLiveDeltaArtifactSet {
  manifest: DbLessLiveDeltaManifestV1
  manifestArtifact: DbLessArtifact
  chunkArtifacts: DbLessArtifact[]
  normalized: PortableXrplNormalizedWorkV1
}

function nonEmpty(value: string, field: string): void {
  if (value.length === 0) throw new Error(`${field} must be non-empty`)
}

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function ledgerHash(value: string, field: string): void {
  if (!LEDGER_HASH.test(value)) throw new Error(`${field} must be an uppercase 64-character ledger hash`)
}

function artifactDigest(value: string, field: string): void {
  if (!SHA256.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`)
}

function portableDigest(value: string, field: string): void {
  if (!PORTABLE_DIGEST.test(value)) throw new Error(`${field} must be a portable SHA-256 digest`)
}

function safeKey(value: string, field: string): void {
  nonEmpty(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${field} must be a flat GitHub Release asset name`)
  }
}

function generatedAtFromCloseTime(closeTime: number): string {
  nonNegativeInteger(closeTime, 'closeTime')
  return new Date((closeTime + RIPPLE_EPOCH_UNIX_SECONDS) * 1000).toISOString()
}

function digestSuffix(payloadDigest: string): string {
  portableDigest(payloadDigest, 'payloadDigest')
  return payloadDigest.slice('sha256:'.length, 'sha256:'.length + 16)
}

export function assertDbLessLiveDeltaManifest(manifest: DbLessLiveDeltaManifestV1): void {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported DB-less live delta schema version')
  if (manifest.network !== 'devnet') throw new Error('DB-less live delta network must be devnet')
  nonEmpty(manifest.epochId, 'epochId')
  nonEmpty(manifest.baseIdentity, 'baseIdentity')
  nonEmpty(manifest.generationId, 'generationId')
  nonEmpty(manifest.workId, 'workId')
  nonEmpty(manifest.sourceRevision, 'sourceRevision')
  nonEmpty(manifest.generatedAt, 'generatedAt')
  nonNegativeInteger(manifest.previousLedgerIndex, 'previousLedgerIndex')
  positiveInteger(manifest.startLedgerIndex, 'startLedgerIndex')
  positiveInteger(manifest.endLedgerIndex, 'endLedgerIndex')
  positiveInteger(manifest.ledgerCount, 'ledgerCount')
  ledgerHash(manifest.expectedParentHash, 'expectedParentHash')
  ledgerHash(manifest.startLedgerHash, 'startLedgerHash')
  ledgerHash(manifest.endLedgerHash, 'endLedgerHash')
  portableDigest(manifest.payloadDigest, 'payloadDigest')

  if (manifest.startLedgerIndex !== manifest.previousLedgerIndex + 1) {
    throw new Error('Live delta start ledger must immediately follow previousLedgerIndex')
  }
  if (manifest.endLedgerIndex < manifest.startLedgerIndex) {
    throw new Error('Live delta end ledger precedes start ledger')
  }
  if (manifest.ledgerCount !== manifest.endLedgerIndex - manifest.startLedgerIndex + 1) {
    throw new Error('Live delta ledgerCount does not match its inclusive range')
  }
  if (manifest.semanticCounts.validatedLedgers !== manifest.ledgerCount) {
    throw new Error('Live delta validated ledger count does not match ledgerCount')
  }

  const seenKeys = new Set<string>()
  let records = 0
  manifest.chunks.forEach((chunk, index) => {
    if (chunk.chunkIndex !== index) throw new Error('Live delta chunk indexes must be contiguous')
    safeKey(chunk.key, `chunks[${index}].key`)
    if (seenKeys.has(chunk.key)) throw new Error('Live delta chunk keys must be unique')
    seenKeys.add(chunk.key)
    nonNegativeInteger(chunk.records, `chunks[${index}].records`)
    positiveInteger(chunk.bytes, `chunks[${index}].bytes`)
    artifactDigest(chunk.artifactSha256, `chunks[${index}].artifactSha256`)
    portableDigest(chunk.chunkDigest, `chunks[${index}].chunkDigest`)
    records += chunk.records
  })

  if (records !== manifest.semanticCounts.totalRecords) {
    throw new Error('Live delta chunk record total does not match semanticCounts.totalRecords')
  }
}

export async function buildDbLessLiveDeltaArtifacts(options: {
  scan: IncrementalScanResult
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  expectedParentHash: string
  sourceRevision: string
}): Promise<DbLessLiveDeltaArtifactSet> {
  const first = options.scan.ledgers[0]
  const last = options.scan.ledgers.at(-1)
  if (!first || !last || options.scan.endLedgerIndex === null) {
    throw new Error('DB-less live delta requires a non-empty validated scan')
  }
  nonEmpty(options.epochId, 'epochId')
  nonEmpty(options.baseIdentity, 'baseIdentity')
  nonEmpty(options.sourceRevision, 'sourceRevision')

  const provisionalWorkId = [
    'db-less-live-v1',
    options.epochId,
    options.previousLedgerIndex,
    options.scan.startLedgerIndex,
    options.scan.endLedgerIndex,
    options.expectedParentHash,
  ].join(':')

  const normalized = await buildPortableXrplNormalizedWork({
    scan: options.scan,
    workId: provisionalWorkId,
    network: 'devnet',
    epochId: options.epochId,
    baseIdentity: options.baseIdentity,
    previousLedgerIndex: options.previousLedgerIndex,
    expectedParentHash: options.expectedParentHash,
  })

  const sourceRevisionDigest = await sha256Hex(options.sourceRevision)
  const generationId = [
    'live-v1',
    options.scan.startLedgerIndex,
    options.scan.endLedgerIndex,
    digestSuffix(normalized.payload.digest),
    sourceRevisionDigest.slice(0, 12),
  ].join('-')

  const chunkArtifacts: DbLessArtifact[] = []
  const chunks: DbLessLiveDeltaChunkV1[] = []
  for (const built of normalized.chunks) {
    const key = `${generationId}-chunk-${String(built.chunk.chunkIndex).padStart(4, '0')}.json`
    const artifactSha256 = await sha256Hex(built.encoded)
    chunkArtifacts.push({
      key,
      mediaType: 'application/json',
      bytes: built.encoded,
      sha256: artifactSha256,
      immutable: true,
    })
    chunks.push({
      chunkIndex: built.chunk.chunkIndex,
      key,
      records: built.chunk.records.length,
      bytes: built.encoded.byteLength,
      artifactSha256,
      chunkDigest: built.chunk.chunkDigest,
    })
  }

  const manifest: DbLessLiveDeltaManifestV1 = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: options.epochId,
    baseIdentity: options.baseIdentity,
    generationId,
    workId: normalized.payload.workId,
    sourceRevision: options.sourceRevision,
    generatedAt: generatedAtFromCloseTime(last.closeTime),
    previousLedgerIndex: options.previousLedgerIndex,
    expectedParentHash: options.expectedParentHash.toUpperCase(),
    startLedgerIndex: first.ledgerIndex,
    startLedgerHash: first.ledgerHash.toUpperCase(),
    endLedgerIndex: last.ledgerIndex,
    endLedgerHash: last.ledgerHash.toUpperCase(),
    ledgerCount: normalized.payload.semanticCounts.validatedLedgers,
    payloadDigest: normalized.payload.digest,
    semanticCounts: normalized.payload.semanticCounts,
    chunks,
  }
  assertDbLessLiveDeltaManifest(manifest)

  const manifestBytes = utf8(`${canonicalJson(manifest)}\n`)
  const manifestArtifact: DbLessArtifact = {
    key: `${generationId}-manifest.json`,
    mediaType: 'application/json',
    bytes: manifestBytes,
    sha256: await sha256Hex(manifestBytes),
    immutable: true,
  }

  return {
    manifest,
    manifestArtifact,
    chunkArtifacts,
    normalized,
  }
}