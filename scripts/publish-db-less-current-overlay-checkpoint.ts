import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  buildDbLessCurrentOverlayChannel,
  type DbLessCurrentOverlayPointerV1,
} from '../src/shared/db-less/current-overlay-channel'
import { GitHubReleaseCurrentOverlayChannelStore } from '../src/shared/db-less/current-overlay-channel-github-release'
import type { DbLessCurrentOverlayCheckpointManifestV1 } from '../src/shared/db-less/current-overlay-checkpoint'
import { GitHubReleaseDbLessStore } from '../src/shared/db-less/github-release-publication'
import type { DbLessArtifact } from '../src/shared/db-less/live-delta'
import { canonicalJson, sha256Hex } from '../src/shared/current-state/canonical-json'

const SHA256 = /^[a-f0-9]{64}$/
const CHECKPOINT_TAG = /^db-less-current-overlay-v1-(\d+)$/

type RehearsalSummary = {
  schemaVersion: 1
  repository: string
  channelReleaseTag: string
  channelSha256: string
  baseIdentity: string
  throughLedgerIndex: number
  throughLedgerHash: string
  generationCount: number
  entryCount: number
  tombstoneCount: number
  bucketCount: number
  shardCount: number
  manifestKey: string
  manifestSha256: string
  equivalence: {
    checkpointStateSha256: string
    sourceStateSha256: string
    equivalent: true
  }
}

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function requiredArgument(args: readonly string[], name: string): string {
  const value = argumentValue(args, name)
  if (value === null) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
  return value
}

function digest(value: string, field: string): string {
  if (!SHA256.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`)
  return value
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function assertSummary(summary: RehearsalSummary, repository: string): void {
  if (summary.schemaVersion !== 1 || summary.repository !== repository) {
    throw new Error('D4 publication rehearsal summary identity is invalid')
  }
  positiveInteger(summary.throughLedgerIndex, 'throughLedgerIndex')
  positiveInteger(summary.generationCount, 'generationCount')
  positiveInteger(summary.bucketCount, 'bucketCount')
  positiveInteger(summary.shardCount, 'shardCount')
  if (!Number.isSafeInteger(summary.entryCount) || summary.entryCount < 0) {
    throw new Error('entryCount must be a non-negative safe integer')
  }
  if (
    !Number.isSafeInteger(summary.tombstoneCount)
    || summary.tombstoneCount < 0
    || summary.tombstoneCount > summary.entryCount
  ) {
    throw new Error('tombstoneCount is invalid')
  }
  digest(summary.channelSha256, 'channelSha256')
  digest(summary.manifestSha256, 'manifestSha256')
  digest(summary.equivalence.sourceStateSha256, 'sourceStateSha256')
  digest(summary.equivalence.checkpointStateSha256, 'checkpointStateSha256')
  if (
    summary.equivalence.equivalent !== true
    || summary.equivalence.sourceStateSha256 !== summary.equivalence.checkpointStateSha256
  ) {
    throw new Error('D4 publication requires a successful equivalence proof')
  }
}

async function artifactFromFile(options: {
  key: string
  path: string
  expectedSha256: string
  expectedBytes?: number
}): Promise<DbLessArtifact> {
  const bytes = new Uint8Array(await readFile(options.path))
  if (options.expectedBytes !== undefined && bytes.byteLength !== options.expectedBytes) {
    throw new Error(`D4 checkpoint asset byte mismatch: ${options.key}`)
  }
  const sha256 = await sha256Hex(bytes)
  if (sha256 !== options.expectedSha256) {
    throw new Error(`D4 checkpoint asset SHA-256 mismatch: ${options.key}`)
  }
  return {
    key: options.key,
    mediaType: 'application/json',
    bytes,
    sha256,
    immutable: true,
  }
}

async function ensureImmutable(
  store: GitHubReleaseDbLessStore,
  artifact: DbLessArtifact,
): Promise<'uploaded' | 'reused'> {
  const existing = await store.inspect(artifact.key)
  if (existing) {
    if (
      existing.bytes !== artifact.bytes.byteLength
      || existing.sha256 !== artifact.sha256
    ) {
      throw new Error(`D4 checkpoint remote asset conflict: ${artifact.key}`)
    }
    return 'reused'
  }

  await store.writeImmutable(artifact)
  const verified = await store.inspect(artifact.key)
  if (
    !verified
    || verified.bytes !== artifact.bytes.byteLength
    || verified.sha256 !== artifact.sha256
  ) {
    throw new Error(`D4 checkpoint remote asset verification failed: ${artifact.key}`)
  }
  return 'uploaded'
}

function activePointer(options: {
  repository: string
  checkpointReleaseTag: string
  summary: RehearsalSummary
}): DbLessCurrentOverlayPointerV1 {
  const { summary } = options
  return {
    location: {
      provider: 'github-release',
      repository: options.repository,
      releaseTag: options.checkpointReleaseTag,
    },
    manifestKey: summary.manifestKey,
    manifestSha256: summary.manifestSha256,
    sourceChannelSha256: summary.channelSha256,
    stateSha256: summary.equivalence.checkpointStateSha256,
    baseIdentity: summary.baseIdentity,
    throughLedgerIndex: summary.throughLedgerIndex,
    throughLedgerHash: summary.throughLedgerHash,
    generationCount: summary.generationCount,
    entryCount: summary.entryCount,
    tombstoneCount: summary.tombstoneCount,
    bucketCount: summary.bucketCount,
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('D4 checkpoint publication requires --local')

  const repository = requiredArgument(args, '--repository')
  const inputDir = resolve(requiredArgument(args, '--input-dir'))
  const checkpointReleaseTag = requiredArgument(args, '--checkpoint-release-tag')
  const channelReleaseTag = requiredArgument(args, '--channel-release-tag')
  const updatedAt = requiredArgument(args, '--updated-at')
  const output = resolve(requiredArgument(args, '--output'))
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('GH_TOKEN is required')

  const summary = await readJson<RehearsalSummary>(resolve(inputDir, 'rehearsal-summary.json'))
  assertSummary(summary, repository)

  const tagMatch = CHECKPOINT_TAG.exec(checkpointReleaseTag)
  if (!tagMatch || Number(tagMatch[1]) !== summary.throughLedgerIndex) {
    throw new Error('D4 checkpoint Release tag does not match rehearsal through ledger')
  }

  const manifestPath = resolve(inputDir, summary.manifestKey)
  const manifestArtifact = await artifactFromFile({
    key: summary.manifestKey,
    path: manifestPath,
    expectedSha256: summary.manifestSha256,
  })
  const manifest = JSON.parse(
    new TextDecoder().decode(manifestArtifact.bytes),
  ) as DbLessCurrentOverlayCheckpointManifestV1

  if (
    manifest.schemaVersion !== 1
    || manifest.network !== 'devnet'
    || manifest.baseIdentity !== summary.baseIdentity
    || manifest.throughLedgerIndex !== summary.throughLedgerIndex
    || manifest.throughLedgerHash !== summary.throughLedgerHash
    || manifest.generationCount !== summary.generationCount
    || manifest.entryCount !== summary.entryCount
    || manifest.tombstoneCount !== summary.tombstoneCount
    || manifest.bucketCount !== summary.bucketCount
    || manifest.shards.length !== summary.shardCount
  ) {
    throw new Error('D4 checkpoint manifest does not match rehearsal summary')
  }
  if (manifest.shards.length + 1 > 900) {
    throw new Error('D4 checkpoint exceeds the 900-asset publication ceiling')
  }

  const shardArtifacts: DbLessArtifact[] = []
  for (const shard of manifest.shards) {
    shardArtifacts.push(await artifactFromFile({
      key: shard.key,
      path: resolve(inputDir, shard.key),
      expectedSha256: shard.artifactSha256,
      expectedBytes: shard.bytes,
    }))
  }

  const checkpointStore = new GitHubReleaseDbLessStore({
    repository,
    releaseTag: checkpointReleaseTag,
    token,
    maxAssets: 900,
  })

  let uploaded = 0
  let reused = 0
  for (const artifact of shardArtifacts) {
    const result = await ensureImmutable(checkpointStore, artifact)
    if (result === 'uploaded') uploaded += 1
    else reused += 1
  }
  const manifestResult = await ensureImmutable(checkpointStore, manifestArtifact)
  if (manifestResult === 'uploaded') uploaded += 1
  else reused += 1

  const channelStore = new GitHubReleaseCurrentOverlayChannelStore({
    repository,
    releaseTag: channelReleaseTag,
    token,
  })
  const current = await channelStore.read()
  const pointer = activePointer({ repository, checkpointReleaseTag, summary })

  let channelAlreadyActive = false
  let published = current
  if (current && canonicalJson(current.channel.active) === canonicalJson(pointer)) {
    channelAlreadyActive = true
  } else {
    const channel = await buildDbLessCurrentOverlayChannel({
      schemaVersion: 1,
      network: 'devnet',
      epochId: manifest.epochId,
      active: pointer,
      updatedAt,
    })
    published = await channelStore.publish({
      channel,
      expectedPreviousChannelSha256: current?.channel.channelSha256 ?? null,
      expectedRevision: current?.revision ?? null,
    })
  }
  if (!published) throw new Error('D4 Current overlay channel publication did not produce a channel')

  const readback = await channelStore.read()
  if (
    !readback
    || readback.channel.channelSha256 !== published.channel.channelSha256
    || canonicalJson(readback.channel.active) !== canonicalJson(pointer)
  ) {
    throw new Error('D4 Current overlay channel readback verification failed')
  }

  const result = {
    schemaVersion: 1,
    repository,
    checkpointReleaseTag,
    channelReleaseTag,
    throughLedgerIndex: summary.throughLedgerIndex,
    throughLedgerHash: summary.throughLedgerHash,
    manifestKey: summary.manifestKey,
    manifestSha256: summary.manifestSha256,
    stateSha256: summary.equivalence.checkpointStateSha256,
    sourceChannelSha256: summary.channelSha256,
    shardCount: summary.shardCount,
    uploadedAssets: uploaded,
    reusedAssets: reused,
    channelAlreadyActive,
    channelSha256: readback.channel.channelSha256,
    channelRevision: readback.revision,
  }
  await writeFile(output, `${canonicalJson(result)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
