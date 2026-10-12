/**
 * D5 isolation: retention decision ONLY. Never deletes a Release.
 * Fail-closed reachability protects immutable shards needed by active and
 * kept historical v3 checkpoints, including their cross-Release references.
 * A caller must re-fetch the exact active channel and all manifest digests
 * immediately before any future externally authorized delete.
 */
import { sha256Hex } from '../current-state/canonical-json'
import { assertDbLessStableD4CheckpointV3, type DbLessStableD4CheckpointV3 } from './current-overlay-stable-checkpoint-v3'

const TAG = /^d5-stable-d4-v3-(\d+)$/

export interface DbLessStableD4ReleaseV3 {
  id: number
  tagName: string
  draft: boolean
  prerelease: boolean
}
export interface DbLessStableD4VerifiedManifestInputV3 {
  releaseTag: string
  bytes: Uint8Array
  sha256: string
}
export interface DbLessStableD4RetentionPlanV3 {
  schemaVersion: 3
  activeReleaseTag: string
  keepReleaseTags: string[]
  pinnedShardReleaseTags: string[]
  protectedReleaseTags: string[]
  deleteCandidateTags: string[]
  ignoredReleaseTags: string[]
}

function ledger(tag: string): number | null {
  const m = TAG.exec(tag)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error('D4 v3 retention tag ledger is invalid')
  }
  return n
}

export async function planDbLessStableD4RetentionV3(options: {
  releases: readonly DbLessStableD4ReleaseV3[]
  activeReleaseTag: string
  manifestInputs: readonly DbLessStableD4VerifiedManifestInputV3[]
  keepCount?: number
}): Promise<DbLessStableD4RetentionPlanV3> {
  const keepCount = options.keepCount ?? 3
  if (!Number.isSafeInteger(keepCount) || keepCount < 2) {
    throw new Error('D4 v3 retention keepCount must be at least 2')
  }
  const activeLedger = ledger(options.activeReleaseTag)
  if (activeLedger === null) throw new Error('D4 v3 retention active tag class is invalid')
  const all = new Map<string, DbLessStableD4ReleaseV3>()
  const ids = new Set<number>()
  const eligible: DbLessStableD4ReleaseV3[] = []
  const ignored: string[] = []
  for (const r of options.releases) {
    if (!Number.isSafeInteger(r.id) || r.id < 1 || !r.tagName
      || typeof r.draft !== 'boolean' || typeof r.prerelease !== 'boolean'
      || all.has(r.tagName) || ids.has(r.id)) {
      throw new Error('D4 v3 retention release metadata is invalid/duplicated')
    }
    all.set(r.tagName, r)
    ids.add(r.id)
    const n = ledger(r.tagName)
    if (n === null) {
      ignored.push(r.tagName)
    } else if (!r.draft && r.prerelease) {
      if (n > activeLedger) {
        throw new Error('D4 v3 retention has an unactivated newer published checkpoint')
      }
      eligible.push(r)
    }
  }
  if (!all.has(options.activeReleaseTag)
    || all.get(options.activeReleaseTag)!.draft
    || !all.get(options.activeReleaseTag)!.prerelease) {
    throw new Error('D4 v3 retention active Release is not published')
  }
  eligible.sort((a,b) => ledger(b.tagName)! - ledger(a.tagName)! || b.id - a.id)
  if (eligible[0]?.tagName !== options.activeReleaseTag) {
    throw new Error('D4 v3 retention active release is not newest')
  }
  const keepReleaseTags = eligible.slice(0, keepCount).map(r => r.tagName)
  const sources = new Map<string, DbLessStableD4CheckpointV3>()
  for (const item of options.manifestInputs) {
    if (sources.has(item.releaseTag) || ledger(item.releaseTag) === null
      || item.bytes.byteLength > 1_000_000
      || !/^[a-f0-9]{64}$/.test(item.sha256)
      || await sha256Hex(item.bytes) !== item.sha256) {
      throw new Error('D4 v3 retention manifest SHA/identity is invalid')
    }
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(item.bytes)) as DbLessStableD4CheckpointV3
    assertDbLessStableD4CheckpointV3(value)
    if (value.throughLedgerIndex !== ledger(item.releaseTag)) {
      throw new Error('D4 v3 retention checkpoint manifest/release ledger mismatch')
    }
    sources.set(item.releaseTag, value)
  }
  const pinned = new Set<string>()
  for (const tag of keepReleaseTags) {
    const manifest = sources.get(tag)
    if (!manifest) throw new Error(`D4 v3 retention missing verified kept checkpoint: ${tag}`)
    for (const ref of manifest.shards) {
      const remote = all.get(ref.releaseTag)
      if (!remote || remote.draft || !remote.prerelease) {
        throw new Error(`D4 v3 retention referenced Release is missing/unpublished: ${ref.releaseTag}`)
      }
      pinned.add(ref.releaseTag)
    }
  }
  const protectedTags = new Set([...keepReleaseTags, ...pinned])
  const deleteCandidateTags = eligible
    .filter(r => !protectedTags.has(r.tagName))
    .map(r => r.tagName)
  return {
    schemaVersion: 3,
    activeReleaseTag: options.activeReleaseTag,
    keepReleaseTags,
    pinnedShardReleaseTags: [...pinned].sort(),
    protectedReleaseTags: [...protectedTags].sort(),
    deleteCandidateTags,
    ignoredReleaseTags: ignored.sort(),
  }
}
