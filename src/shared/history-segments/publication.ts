import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import { HISTORY_SEGMENT_FILE_KINDS, type HistorySegmentFileKind } from './manifest'

export type HistorySegmentRecordCounts = Record<HistorySegmentFileKind, number>

export interface PublishedHistorySegment {
  segmentId: string
  manifestPath: string
  manifestSha256: string
  startLedgerIndex: number
  startLedgerHash: string
  startParentHash: string
  endLedgerIndex: number
  endLedgerHash: string
  ledgerCount: number
  previousSegmentId: string | null
  previousSegmentEndHash: string | null
  recordCounts: HistorySegmentRecordCounts
}

export interface HistorySegmentChainPublication {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  chainId: string
  complete: true
  startLedgerIndex: number
  startLedgerHash: string
  startParentHash: string
  endLedgerIndex: number
  endLedgerHash: string
  segmentCount: number
  ledgerCount: number
  sourceRevision: string
  publishedAt: string
  segments: PublishedHistorySegment[]
  publicationSha256: string
}

const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/

function safeInteger(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${field} is invalid`)
}

function text(value: string, field: string): void {
  if (!value) throw new Error(`${field} must be non-empty`)
}

function hash(value: string, field: string): void {
  if (!LEDGER_HASH.test(value)) throw new Error(`${field} is invalid`)
}

function digest(value: string, field: string): void {
  if (!SHA256.test(value)) throw new Error(`${field} is invalid`)
}

function safePath(value: string): void {
  if (
    value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(value)
  ) throw new Error('Published history manifest path is unsafe')
}

export function assertHistorySegmentChainPublication(publication: HistorySegmentChainPublication): void {
  if (publication.schemaVersion !== 1 || publication.network !== 'devnet' || publication.complete !== true) {
    throw new Error('History segment publication schema is invalid')
  }
  text(publication.epochId, 'epochId')
  text(publication.chainId, 'chainId')
  text(publication.sourceRevision, 'sourceRevision')
  text(publication.publishedAt, 'publishedAt')
  safeInteger(publication.startLedgerIndex, 'startLedgerIndex', 1)
  safeInteger(publication.endLedgerIndex, 'endLedgerIndex', 1)
  safeInteger(publication.segmentCount, 'segmentCount', 1)
  safeInteger(publication.ledgerCount, 'ledgerCount', 1)
  hash(publication.startLedgerHash, 'startLedgerHash')
  hash(publication.startParentHash, 'startParentHash')
  hash(publication.endLedgerHash, 'endLedgerHash')
  digest(publication.publicationSha256, 'publicationSha256')
  if (publication.segments.length !== publication.segmentCount) throw new Error('Publication segment count mismatch')

  const ids = new Set<string>()
  let expectedStart = publication.startLedgerIndex
  let totalLedgers = 0
  let previous: PublishedHistorySegment | null = null

  publication.segments.forEach((segment, index) => {
    text(segment.segmentId, `segments[${index}].segmentId`)
    if (ids.has(segment.segmentId)) throw new Error(`Duplicate published history segment ID: ${segment.segmentId}`)
    ids.add(segment.segmentId)
    safePath(segment.manifestPath)
    digest(segment.manifestSha256, `segments[${index}].manifestSha256`)
    safeInteger(segment.startLedgerIndex, `segments[${index}].startLedgerIndex`, 1)
    safeInteger(segment.endLedgerIndex, `segments[${index}].endLedgerIndex`, 1)
    safeInteger(segment.ledgerCount, `segments[${index}].ledgerCount`, 1)
    hash(segment.startLedgerHash, `segments[${index}].startLedgerHash`)
    hash(segment.startParentHash, `segments[${index}].startParentHash`)
    hash(segment.endLedgerHash, `segments[${index}].endLedgerHash`)
    if ((segment.previousSegmentId === null) !== (segment.previousSegmentEndHash === null)) {
      throw new Error('Published history predecessor identity is incomplete')
    }
    if (segment.previousSegmentEndHash !== null) hash(segment.previousSegmentEndHash, 'previousSegmentEndHash')
    for (const kind of HISTORY_SEGMENT_FILE_KINDS) safeInteger(segment.recordCounts[kind], `recordCounts.${kind}`)
    if (segment.endLedgerIndex - segment.startLedgerIndex + 1 !== segment.ledgerCount) {
      throw new Error('Published history segment ledger count mismatch')
    }
    if (segment.recordCounts.ledgers !== segment.ledgerCount) throw new Error('Ledger record count mismatch')
    if (segment.startLedgerIndex !== expectedStart) throw new Error('Published history segment indexes are not contiguous')
    if (previous) {
      if (segment.previousSegmentId !== previous.segmentId) throw new Error('Published history predecessor ID mismatch')
      if (segment.previousSegmentEndHash !== previous.endLedgerHash || segment.startParentHash !== previous.endLedgerHash) {
        throw new Error('Published history predecessor hash mismatch')
      }
    }
    expectedStart = segment.endLedgerIndex + 1
    totalLedgers += segment.ledgerCount
    previous = segment
  })

  const first = publication.segments[0]!
  const last = publication.segments.at(-1)!
  if (first.startLedgerIndex !== publication.startLedgerIndex || first.startLedgerHash !== publication.startLedgerHash || first.startParentHash !== publication.startParentHash) {
    throw new Error('Publication start boundary mismatch')
  }
  if (last.endLedgerIndex !== publication.endLedgerIndex || last.endLedgerHash !== publication.endLedgerHash) {
    throw new Error('Publication end boundary mismatch')
  }
  if (totalLedgers !== publication.ledgerCount) throw new Error('Publication total ledger count mismatch')
}

export function historySegmentPublicationDigest(publication: HistorySegmentChainPublication): Promise<string> {
  return sha256Hex(`${canonicalJson({ ...publication, publicationSha256: null })}\n`)
}

export async function assertHistorySegmentPublicationDigest(publication: HistorySegmentChainPublication): Promise<void> {
  assertHistorySegmentChainPublication(publication)
  if (await historySegmentPublicationDigest(publication) !== publication.publicationSha256) {
    throw new Error('History segment publication digest mismatch')
  }
}
