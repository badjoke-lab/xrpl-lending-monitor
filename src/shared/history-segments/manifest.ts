export const HISTORY_SEGMENT_FILE_KINDS = [
  'ledgers',
  'protocol_events',
  'object_changes',
  'loan_lifecycle',
  'archived_objects',
  'balance_history',
  'current_projection_mutations',
] as const

export type HistorySegmentFileKind = typeof HISTORY_SEGMENT_FILE_KINDS[number]

export interface HistorySegmentFile {
  kind: HistorySegmentFileKind
  path: string
  bytes: number
  records: number
  sha256: string
}

export interface HistorySegmentManifest {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  segmentId: string
  startLedgerIndex: number
  startLedgerHash: string
  startParentHash: string
  endLedgerIndex: number
  endLedgerHash: string
  ledgerCount: number
  sourceRevision: string
  generatedAt: string
  previousSegmentId: string | null
  previousSegmentEndHash: string | null
  files: HistorySegmentFile[]
}

const HASH = /^[A-F0-9]{64}$/

function nonEmpty(value: string, field: string): void {
  if (value.length === 0) throw new Error(`${field} must be non-empty`)
}

function safeNonNegative(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}

function hash(value: string, field: string): void {
  if (!HASH.test(value)) throw new Error(`${field} must be a 64-character uppercase hexadecimal hash`)
}

export function assertHistorySegmentManifest(manifest: HistorySegmentManifest): void {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported history segment schema version')
  if (manifest.network !== 'devnet') throw new Error('History segment network must be devnet')
  nonEmpty(manifest.epochId, 'epochId')
  nonEmpty(manifest.segmentId, 'segmentId')
  nonEmpty(manifest.sourceRevision, 'sourceRevision')
  nonEmpty(manifest.generatedAt, 'generatedAt')
  safeNonNegative(manifest.startLedgerIndex, 'startLedgerIndex')
  safeNonNegative(manifest.endLedgerIndex, 'endLedgerIndex')
  safeNonNegative(manifest.ledgerCount, 'ledgerCount')
  hash(manifest.startLedgerHash, 'startLedgerHash')
  hash(manifest.startParentHash, 'startParentHash')
  hash(manifest.endLedgerHash, 'endLedgerHash')

  if (manifest.endLedgerIndex < manifest.startLedgerIndex) {
    throw new Error('History segment end ledger precedes start ledger')
  }
  const expectedLedgerCount = manifest.endLedgerIndex - manifest.startLedgerIndex + 1
  if (manifest.ledgerCount !== expectedLedgerCount) {
    throw new Error('History segment ledger count does not match the inclusive range')
  }
  if ((manifest.previousSegmentId === null) !== (manifest.previousSegmentEndHash === null)) {
    throw new Error('Previous segment identity and hash must be both present or both null')
  }
  if (manifest.previousSegmentId !== null) nonEmpty(manifest.previousSegmentId, 'previousSegmentId')
  if (manifest.previousSegmentEndHash !== null) hash(manifest.previousSegmentEndHash, 'previousSegmentEndHash')

  const expectedKinds = new Set<HistorySegmentFileKind>(HISTORY_SEGMENT_FILE_KINDS)
  const paths = new Set<string>()
  for (const file of manifest.files) {
    if (!expectedKinds.delete(file.kind)) throw new Error(`Duplicate or unsupported history segment file kind: ${file.kind}`)
    nonEmpty(file.path, `files.${file.kind}.path`)
    if (paths.has(file.path)) throw new Error(`Duplicate history segment file path: ${file.path}`)
    paths.add(file.path)
    safeNonNegative(file.bytes, `files.${file.kind}.bytes`)
    safeNonNegative(file.records, `files.${file.kind}.records`)
    hash(file.sha256, `files.${file.kind}.sha256`)
  }
  if (expectedKinds.size > 0) {
    throw new Error(`History segment manifest is missing file kinds: ${[...expectedKinds].join(', ')}`)
  }
  const ledgerFile = manifest.files.find((file) => file.kind === 'ledgers')
  if (ledgerFile?.records !== manifest.ledgerCount) {
    throw new Error('Ledger file record count does not match segment ledger count')
  }
}

export function assertAdjacentHistorySegments(
  previous: HistorySegmentManifest,
  next: HistorySegmentManifest,
): void {
  assertHistorySegmentManifest(previous)
  assertHistorySegmentManifest(next)
  if (previous.network !== next.network || previous.epochId !== next.epochId) {
    throw new Error('Adjacent history segments must share network and epoch')
  }
  if (next.previousSegmentId !== previous.segmentId) {
    throw new Error('Next history segment does not reference the previous segment ID')
  }
  if (next.previousSegmentEndHash !== previous.endLedgerHash) {
    throw new Error('Next history segment previous hash does not match the prior terminal hash')
  }
  if (next.startLedgerIndex !== previous.endLedgerIndex + 1) {
    throw new Error('Adjacent history segment ledger indexes are not contiguous')
  }
  if (next.startParentHash !== previous.endLedgerHash) {
    throw new Error('Adjacent history segment parent hash does not match the prior terminal hash')
  }
}
