import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import {
  HISTORY_RECONSTRUCTION_ACTIVE_END_HASH,
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_NETWORK,
  HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
  reconstructionSegmentRange,
} from './identity'
import { assertRawCheckpoint, type RawCheckpoint } from './schema'

export type CheckpointClassification = 'accepted' | 'duplicate_identical' | 'orphan' | 'conflicting_digest'

export interface ClassifiedCheckpoint {
  checkpoint: RawCheckpoint
  digest: string
  classification: CheckpointClassification
}

export interface ResumeDiscovery {
  prefix: ClassifiedCheckpoint[]
  rejected: ClassifiedCheckpoint[]
  nextSegmentId: number | null
}

export function classifyCheckpointPlan(value: unknown): 'current' | 'stale_plan' | 'invalid' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid'
  const checkpoint = value as Record<string, unknown>
  if (checkpoint.kind !== 'immutable-history-raw-checkpoint' || checkpoint.schemaVersion !== 1) return 'invalid'
  if (checkpoint.reconstructionId !== HISTORY_RECONSTRUCTION_ID
    || checkpoint.network !== HISTORY_RECONSTRUCTION_NETWORK
    || checkpoint.epochId !== HISTORY_RECONSTRUCTION_EPOCH_ID) return 'stale_plan'
  return 'current'
}

async function checkpointDigest(checkpoint: RawCheckpoint): Promise<string> {
  return sha256Hex(canonicalJson(checkpoint))
}

export async function discoverResume(checkpoints: readonly unknown[]): Promise<ResumeDiscovery> {
  const validated: { checkpoint: RawCheckpoint; digest: string }[] = []
  for (const value of checkpoints) {
    const planStatus = classifyCheckpointPlan(value)
    if (planStatus !== 'current') throw new Error(`Checkpoint classification: ${planStatus}`)
    assertRawCheckpoint(value)
    validated.push({ checkpoint: value, digest: await checkpointDigest(value) })
  }
  const bySegment = new Map<number, typeof validated>()
  for (const item of validated) bySegment.set(item.checkpoint.segmentId, [...(bySegment.get(item.checkpoint.segmentId) ?? []), item])
  const prefix: ClassifiedCheckpoint[] = []
  const rejected: ClassifiedCheckpoint[] = []
  let predecessorDigest: string | null = null
  let predecessorTerminalHash = HISTORY_RECONSTRUCTION_ACTIVE_END_HASH

  for (let segmentId = 0; segmentId < HISTORY_RECONSTRUCTION_SEGMENT_COUNT; segmentId += 1) {
    const items = bySegment.get(segmentId) ?? []
    if (items.length === 0) break
    const digests = new Set(items.map((item) => item.digest))
    if (digests.size > 1) {
      rejected.push(...items.map((item) => ({ ...item, classification: 'conflicting_digest' as const })))
      throw new Error(`Conflicting checkpoint digests for segment ${segmentId}`)
    }
    const canonical = items[0]!
    if (canonical.checkpoint.predecessorDigest !== predecessorDigest) break
    if (canonical.checkpoint.firstParentHash !== predecessorTerminalHash) {
      throw new Error(`Parent-hash discontinuity before segment ${segmentId}`)
    }
    prefix.push({ ...canonical, classification: 'accepted' })
    for (const duplicate of items.slice(1)) rejected.push({ ...duplicate, classification: 'duplicate_identical' })
    predecessorDigest = canonical.digest
    predecessorTerminalHash = canonical.checkpoint.terminalHash
  }

  const acceptedIds = new Set(prefix.map((item) => item.checkpoint.segmentId))
  for (const item of validated) {
    if (acceptedIds.has(item.checkpoint.segmentId) || rejected.some((entry) => entry.checkpoint === item.checkpoint)) continue
    rejected.push({ ...item, classification: 'orphan' })
  }
  const nextSegmentId = prefix.length === HISTORY_RECONSTRUCTION_SEGMENT_COUNT ? null : prefix.length
  if (nextSegmentId !== null) reconstructionSegmentRange(nextSegmentId)
  return { prefix, rejected, nextSegmentId }
}
