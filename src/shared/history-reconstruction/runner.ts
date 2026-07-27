import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import {
  assertHistoryExactIndexRecord,
  type HistoryExactIndexRecord,
} from '../history-segments/exact-index'
import {
  assertHistorySegmentManifest,
  type HistorySegmentManifest,
} from '../history-segments/manifest'
import {
  HISTORY_RECONSTRUCTION_ACTIVE_END_HASH,
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_NETWORK,
  HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
  reconstructionSegmentRange,
} from './identity'
import { discoverResume } from './resume'
import {
  assertRawCheckpoint,
  type RawCheckpoint,
  type ReconstructionSemanticCounts,
} from './schema'

const CHECKPOINT_FILE = /^(\d{4})\.json$/

export interface ReconstructionPredecessor {
  checkpoint: RawCheckpoint
  digest: string
}

export function checkpointFileName(segmentId: number): string {
  reconstructionSegmentRange(segmentId)
  return `${String(segmentId).padStart(4, '0')}.json`
}

export function committedCheckpointFiles(names: readonly string[]): string[] {
  const committed: { id: number; name: string }[] = []
  for (const name of names) {
    if (name.includes('.tmp-') || name.endsWith('.partial')) continue
    if (!name.endsWith('.json')) continue
    const match = CHECKPOINT_FILE.exec(name)
    if (!match) throw new Error(`Unexpected checkpoint file: ${name}`)
    const id = Number(match[1])
    reconstructionSegmentRange(id)
    committed.push({ id, name })
  }
  committed.sort((left, right) => left.id - right.id)
  const ids = new Set<number>()
  for (const item of committed) {
    if (ids.has(item.id)) throw new Error(`Duplicate checkpoint file for segment ${item.id}`)
    ids.add(item.id)
  }
  return committed.map((item) => item.name)
}

export function spillShardRange(shardId: number): {
  shardId: number
  firstSegmentId: number
  lastSegmentId: number
} {
  if (!Number.isSafeInteger(shardId) || shardId < 0 || shardId >= 33) {
    throw new Error('Spill shard ID is out of range')
  }
  const firstSegmentId = shardId * 8
  const lastSegmentId = shardId === 32 ? 262 : firstSegmentId + 7
  reconstructionSegmentRange(firstSegmentId)
  reconstructionSegmentRange(lastSegmentId)
  return { shardId, firstSegmentId, lastSegmentId }
}

export function spillShardForSegment(segmentId: number): number {
  reconstructionSegmentRange(segmentId)
  return Math.floor(segmentId / 8)
}

function semanticCounts(manifest: HistorySegmentManifest): ReconstructionSemanticCounts {
  const records = (kind: HistorySegmentManifest['files'][number]['kind']): number => (
    manifest.files.find((file) => file.kind === kind)?.records ?? 0
  )
  return {
    protocolEvents: records('protocol_events'),
    objectChanges: records('object_changes'),
    loanLifecycle: records('loan_lifecycle'),
    archivedObjects: records('archived_objects'),
    balanceHistory: records('balance_history'),
  }
}

export async function rawCheckpointDigest(checkpoint: RawCheckpoint): Promise<string> {
  assertRawCheckpoint(checkpoint)
  return sha256Hex(canonicalJson(checkpoint))
}

export async function buildRawCheckpoint(options: {
  segmentId: number
  manifest: HistorySegmentManifest
  manifestText: string
  sourceImplementationSha: string
  predecessor: ReconstructionPredecessor | null
}): Promise<RawCheckpoint> {
  const range = reconstructionSegmentRange(options.segmentId)
  const manifest = options.manifest
  assertHistorySegmentManifest(manifest)
  const expectedSegmentId = `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${range.startLedgerIndex}-${range.endLedgerIndex}`
  if (manifest.network !== HISTORY_RECONSTRUCTION_NETWORK
    || manifest.epochId !== HISTORY_RECONSTRUCTION_EPOCH_ID
    || manifest.segmentId !== expectedSegmentId) {
    throw new Error('Segment manifest reconstruction identity mismatch')
  }
  if (manifest.startLedgerIndex !== range.startLedgerIndex
    || manifest.endLedgerIndex !== range.endLedgerIndex
    || manifest.ledgerCount !== range.ledgerCount) {
    throw new Error('Segment manifest range mismatch')
  }
  if (manifest.sourceRevision !== options.sourceImplementationSha) {
    throw new Error('Segment source revision mismatch')
  }

  let predecessorDigest: string | null = null
  let expectedParentHash = HISTORY_RECONSTRUCTION_ACTIVE_END_HASH
  if (options.segmentId === 0) {
    if (options.predecessor !== null
      || manifest.previousSegmentId !== null
      || manifest.previousSegmentEndHash !== null) {
      throw new Error('First reconstruction segment must not declare a predecessor')
    }
  } else {
    if (options.predecessor === null) throw new Error('Non-initial reconstruction segment requires a predecessor')
    const previous = options.predecessor.checkpoint
    if (previous.segmentId !== options.segmentId - 1) throw new Error('Predecessor segment ID mismatch')
    if (await rawCheckpointDigest(previous) !== options.predecessor.digest) {
      throw new Error('Predecessor checkpoint digest mismatch')
    }
    const previousRange = reconstructionSegmentRange(previous.segmentId)
    const expectedPreviousSegmentId = `${HISTORY_RECONSTRUCTION_EPOCH_ID}-${previousRange.startLedgerIndex}-${previousRange.endLedgerIndex}`
    if (manifest.previousSegmentId !== expectedPreviousSegmentId
      || manifest.previousSegmentEndHash !== previous.terminalHash) {
      throw new Error('Segment manifest predecessor identity mismatch')
    }
    predecessorDigest = options.predecessor.digest
    expectedParentHash = previous.terminalHash
  }
  if (manifest.startParentHash !== expectedParentHash) {
    throw new Error(`Parent-hash discontinuity before segment ${options.segmentId}`)
  }

  const checkpoint: RawCheckpoint = {
    schemaVersion: 1,
    kind: 'immutable-history-raw-checkpoint',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    network: HISTORY_RECONSTRUCTION_NETWORK,
    epochId: HISTORY_RECONSTRUCTION_EPOCH_ID,
    segmentId: options.segmentId,
    startLedgerIndex: range.startLedgerIndex,
    endLedgerIndex: range.endLedgerIndex,
    ledgerCount: range.ledgerCount,
    firstParentHash: manifest.startParentHash,
    terminalHash: manifest.endLedgerHash,
    predecessorDigest,
    manifestSha256: await sha256Hex(utf8(options.manifestText)),
    semanticCounts: semanticCounts(manifest),
    decodePassed: true,
    conflictCount: 0,
    sourceImplementationSha: options.sourceImplementationSha,
    productionMutation: false,
  }
  assertRawCheckpoint(checkpoint)
  return checkpoint
}

export async function assertAppendableCheckpoint(options: {
  checkpoints: readonly RawCheckpoint[]
  candidate: RawCheckpoint
}): Promise<void> {
  const discovery = await discoverResume([...options.checkpoints, options.candidate])
  const accepted = discovery.prefix.at(-1)?.checkpoint
  if (accepted !== options.candidate) throw new Error('Candidate checkpoint is not the next accepted prefix member')
}

export async function assertCompleteCheckpointPrefix(checkpoints: readonly RawCheckpoint[]): Promise<void> {
  const discovery = await discoverResume(checkpoints)
  if (discovery.nextSegmentId !== null || discovery.prefix.length !== HISTORY_RECONSTRUCTION_SEGMENT_COUNT) {
    throw new Error('Reconstruction checkpoint prefix is incomplete')
  }
  if (discovery.rejected.some((item) => item.classification !== 'duplicate_identical')) {
    throw new Error('Reconstruction checkpoint set contains rejected checkpoints')
  }
}

export function sortExactIndexRecords(records: readonly HistoryExactIndexRecord[]): HistoryExactIndexRecord[] {
  const copy = records.map((record) => {
    assertHistoryExactIndexRecord(record, 256)
    return record
  })
  return copy.sort((left, right) => left.bucket - right.bucket
    || left.term.localeCompare(right.term)
    || right.reference.ledgerIndex - left.reference.ledgerIndex
    || canonicalJson(left.reference).localeCompare(canonicalJson(right.reference)))
}
