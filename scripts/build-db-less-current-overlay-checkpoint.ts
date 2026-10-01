import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  DbLessArtifactLocationV1,
  DbLessLivePointerV1,
} from '../src/shared/db-less/channel'
import {
  readDbLessCurrentOverlaySourceAfterCheckpoint,
  readDbLessCurrentOverlaySourceFromChannel,
} from '../src/shared/db-less/current-overlay-chain-compactor'
import {
  buildDbLessCurrentOverlayCheckpoint,
  type DbLessCurrentOverlayCheckpointManifest,
} from '../src/shared/db-less/current-overlay-checkpoint'
import {
  verifyDbLessCurrentOverlayEquivalence,
  verifyDbLessCurrentOverlayIncrementalEquivalence,
} from '../src/shared/db-less/current-overlay-equivalence'
import { GitHubReleaseCurrentOverlayChannelStore } from '../src/shared/db-less/current-overlay-channel-github-release'
import { DbLessCurrentOverlayReader } from '../src/shared/db-less/current-overlay-reader'
import { compareDbLessCurrentProjectionCanonicalKeys } from '../src/shared/db-less/current-projection-identity'
import { GitHubReleaseDbLessStore } from '../src/shared/db-less/github-release-publication'
import { canonicalJson, sha256Hex } from '../src/shared/current-state/canonical-json'

const SHA256 = /^[a-f0-9]{64}$/

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

function positiveInteger(args: readonly string[], name: string, fallback: number): number {
  const raw = argumentValue(args, name)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}

async function readActiveCheckpointSeed(options: {
  repository: string
  channelReleaseTag: string
  token: string
  maxBytesPerShard: number
}): Promise<{
  manifest: DbLessCurrentOverlayCheckpointManifest
  entries: Awaited<ReturnType<DbLessCurrentOverlayReader['readAll']>>['items']
  shardReads: number
  stateSha256: string
}> {
  const channelStore = new GitHubReleaseCurrentOverlayChannelStore({
    repository: options.repository,
    releaseTag: options.channelReleaseTag,
    token: options.token,
  })
  const channelRead = await channelStore.read()
  if (!channelRead) {
    throw new Error('D4 active channel Release does not contain a checkpoint')
  }
  const active = channelRead.channel.active
  if (
    active.location.repository !== options.repository
    || active.location.provider !== 'github-release'
  ) {
    throw new Error('D4 active checkpoint location is unsupported')
  }

  const checkpointStore = new GitHubReleaseDbLessStore({
    repository: options.repository,
    releaseTag: active.location.releaseTag,
    token: options.token,
    maxAssets: 900,
    downloadRetryDelaysMs: [2_000, 5_000, 15_000, 30_000, 60_000],
    downloadPacingMs: 25,
    preferBrowserDownload: true,
  })
  const manifestBytes = await checkpointStore.readImmutable(active.manifestKey)
  if (!manifestBytes || await sha256Hex(manifestBytes) !== active.manifestSha256) {
    throw new Error('D4 active checkpoint manifest is missing or does not match the channel')
  }

  let manifest: DbLessCurrentOverlayCheckpointManifest
  try {
    manifest = JSON.parse(
      new TextDecoder().decode(manifestBytes),
    ) as DbLessCurrentOverlayCheckpointManifest
  } catch {
    throw new Error('D4 active checkpoint manifest is not valid JSON')
  }
  if (
    manifest.epochId !== channelRead.channel.epochId
    || manifest.baseIdentity !== active.baseIdentity
    || manifest.throughLedgerIndex !== active.throughLedgerIndex
    || manifest.throughLedgerHash !== active.throughLedgerHash
    || manifest.generationCount !== active.generationCount
    || manifest.entryCount !== active.entryCount
    || manifest.tombstoneCount !== active.tombstoneCount
    || manifest.bucketCount !== active.bucketCount
  ) {
    throw new Error('D4 active checkpoint manifest does not match its channel pointer')
  }

  const reader = new DbLessCurrentOverlayReader({
    manifest,
    readArtifact: async (key) => checkpointStore.readImmutable(key),
    maxShardBytes: options.maxBytesPerShard,
  })
  const seed = await reader.readAll()
  const ordered = [...seed.items].sort((left, right) =>
    compareDbLessCurrentProjectionCanonicalKeys(
      left.canonicalKey,
      right.canonicalKey,
    ))
  const stateSha256 = await sha256Hex(`${canonicalJson(ordered)}\n`)
  if (stateSha256 !== active.stateSha256) {
    throw new Error('D4 active checkpoint state digest does not match the channel')
  }

  return {
    manifest,
    entries: seed.items,
    shardReads: seed.shardReads,
    stateSha256,
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) {
    throw new Error('D4 Current overlay rehearsal requires --local')
  }

  const repository = requiredArgument(args, '--repository')
  const channelReleaseTag = requiredArgument(args, '--channel-release-tag')
  const outputDir = resolve(requiredArgument(args, '--output-dir'))
  const activeOverlayChannelReleaseTag = argumentValue(
    args,
    '--active-overlay-channel-release-tag',
  )
  const expectedChannelSha256 = argumentValue(args, '--expected-channel-sha256')
  if (expectedChannelSha256 !== null && !SHA256.test(expectedChannelSha256)) {
    throw new Error('--expected-channel-sha256 must be a lowercase SHA-256 digest')
  }
  const maxGenerations = positiveInteger(args, '--max-generations', 2_048)
  const bucketCount = positiveInteger(args, '--bucket-count', 256)
  const maxRecordsPerShard = positiveInteger(args, '--max-records-per-shard', 50_000)
  const maxBytesPerShard = positiveInteger(args, '--max-bytes-per-shard', 2_000_000)
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('GH_TOKEN is required')

  const channelStore = new GitHubReleaseDbLessStore({
    repository,
    releaseTag: channelReleaseTag,
    token,
    maxAssets: 1,
  })
  const channelRead = await channelStore.readChannel()
  if (!channelRead) throw new Error('DB-less control channel Release does not contain a channel')
  if (
    expectedChannelSha256 !== null
    && channelRead.channel.channelSha256 !== expectedChannelSha256
  ) {
    throw new Error('DB-less control channel SHA-256 does not match the authorized source')
  }

  const stores = new Map<string, GitHubReleaseDbLessStore>()
  const storeFor = (location: DbLessArtifactLocationV1): GitHubReleaseDbLessStore => {
    if (location.provider !== 'github-release') {
      throw new Error('D4 rehearsal supports GitHub Release live artifacts only')
    }
    if (location.repository !== repository) {
      throw new Error('D4 rehearsal live artifact repository changed unexpectedly')
    }
    let store = stores.get(location.releaseTag)
    if (!store) {
      store = new GitHubReleaseDbLessStore({
        repository,
        releaseTag: location.releaseTag,
        token,
        maxAssets: 900,
        downloadRetryDelaysMs: [2_000, 5_000, 15_000, 30_000, 60_000],
        downloadPacingMs: 25,
        preferBrowserDownload: true,
      })
      stores.set(location.releaseTag, store)
    }
    return store
  }

  const progress = (label: string) => (value: {
    phase: string
    completed: number
    total: number | null
  }) => {
    const total = value.total === null ? '?' : String(value.total)
    process.stdout.write(
      `D4 ${label}: ${value.phase} ${value.completed}/${total}\n`,
    )
  }

  let mode: 'initial' | 'incremental' = 'initial'
  let seedThroughLedgerIndex: number | null = null
  let seedShardReads = 0
  let incrementalGenerationCount: number | null = null
  let traversedIncrementalManifests: number | null = null

  let checkpoint: Awaited<ReturnType<typeof buildDbLessCurrentOverlayCheckpoint>>
  let equivalence: Awaited<ReturnType<typeof verifyDbLessCurrentOverlayEquivalence>>
  let verifiedGenerationCount: number

  if (activeOverlayChannelReleaseTag === null) {
    process.stdout.write(
      `D4 initial compaction: source channel head ${channelRead.channel.lastCommittedLedgerIndex}\n`,
    )
    const source = await readDbLessCurrentOverlaySourceFromChannel({
      channel: channelRead.channel,
      maxGenerations,
      readChainArtifact: async (pointer: DbLessLivePointerV1) =>
        storeFor(pointer.location).readImmutable(pointer.manifestKey),
      readLocatedArtifact: async (location, key) =>
        storeFor(location).readImmutable(key),
      onProgress: progress('initial compaction'),
    })
    process.stdout.write(
      `D4 initial compaction: source read complete (${source.generations.length} generations)\n`,
    )
    checkpoint = await buildDbLessCurrentOverlayCheckpoint({
      epochId: channelRead.channel.epochId,
      baseIdentity: channelRead.channel.base.generationId,
      throughLedgerIndex: channelRead.channel.lastCommittedLedgerIndex,
      throughLedgerHash: channelRead.channel.lastCommittedLedgerHash,
      generations: source.generations,
      bucketCount,
      maxRecordsPerShard,
      maxBytesPerShard,
    })
    const localArtifacts = new Map(
      checkpoint.shardArtifacts.map((artifact) => [artifact.key, artifact.bytes] as const),
    )
    equivalence = await verifyDbLessCurrentOverlayEquivalence({
      generations: source.generations,
      reader: new DbLessCurrentOverlayReader({
        manifest: checkpoint.manifest,
        readArtifact: async (key) => localArtifacts.get(key) ?? null,
        maxShardBytes: maxBytesPerShard,
      }),
    })
    verifiedGenerationCount = source.verification.generationCount
  } else {
    mode = 'incremental'
    process.stdout.write(
      `D4 incremental compaction: source channel head ${channelRead.channel.lastCommittedLedgerIndex}\n`,
    )
    const seed = await readActiveCheckpointSeed({
      repository,
      channelReleaseTag: activeOverlayChannelReleaseTag,
      token,
      maxBytesPerShard,
    })
    seedThroughLedgerIndex = seed.manifest.throughLedgerIndex
    seedShardReads = seed.shardReads
    process.stdout.write(
      `D4 incremental compaction: seed checkpoint ${seedThroughLedgerIndex} with ${seedShardReads} shard reads\n`,
    )

    const source = await readDbLessCurrentOverlaySourceAfterCheckpoint({
      channel: channelRead.channel,
      checkpoint: seed.manifest,
      maxNewGenerations: maxGenerations,
      readChainArtifact: async (pointer: DbLessLivePointerV1) =>
        storeFor(pointer.location).readImmutable(pointer.manifestKey),
      readLocatedArtifact: async (location, key) =>
        storeFor(location).readImmutable(key),
      onProgress: progress('incremental compaction'),
    })
    if (source.generations.length === 0) {
      throw new Error('D4 incremental rehearsal has no new D3 generations')
    }
    incrementalGenerationCount = source.generations.length
    traversedIncrementalManifests = source.traversedManifests
    checkpoint = await buildDbLessCurrentOverlayCheckpoint({
      epochId: channelRead.channel.epochId,
      baseIdentity: channelRead.channel.base.generationId,
      throughLedgerIndex: channelRead.channel.lastCommittedLedgerIndex,
      throughLedgerHash: channelRead.channel.lastCommittedLedgerHash,
      generations: source.generations,
      seed: {
        manifest: seed.manifest,
        entries: seed.entries,
      },
      bucketCount,
      maxRecordsPerShard,
      maxBytesPerShard,
    })
    const localArtifacts = new Map(
      checkpoint.shardArtifacts.map((artifact) => [artifact.key, artifact.bytes] as const),
    )
    equivalence = await verifyDbLessCurrentOverlayIncrementalEquivalence({
      seedManifest: seed.manifest,
      seedEntries: seed.entries,
      generations: source.generations,
      reader: new DbLessCurrentOverlayReader({
        manifest: checkpoint.manifest,
        readArtifact: async (key) => localArtifacts.get(key) ?? null,
        maxShardBytes: maxBytesPerShard,
      }),
    })
    verifiedGenerationCount = checkpoint.manifest.generationCount
  }

  await mkdir(outputDir, { recursive: true })
  await writeFile(
    resolve(outputDir, checkpoint.manifestArtifact.key),
    checkpoint.manifestArtifact.bytes,
  )
  for (const artifact of checkpoint.shardArtifacts) {
    await writeFile(resolve(outputDir, artifact.key), artifact.bytes)
  }

  const summary = {
    schemaVersion: 1,
    mode,
    repository,
    channelReleaseTag,
    channelSha256: channelRead.channel.channelSha256,
    baseIdentity: checkpoint.manifest.baseIdentity,
    throughLedgerIndex: checkpoint.manifest.throughLedgerIndex,
    throughLedgerHash: checkpoint.manifest.throughLedgerHash,
    generationCount: checkpoint.manifest.generationCount,
    entryCount: checkpoint.manifest.entryCount,
    tombstoneCount: checkpoint.manifest.tombstoneCount,
    bucketCount: checkpoint.manifest.bucketCount,
    shardCount: checkpoint.manifest.shards.length,
    manifestKey: checkpoint.manifestArtifact.key,
    manifestSha256: checkpoint.manifestArtifact.sha256,
    storesRead: stores.size,
    verifiedGenerationCount,
    seedThroughLedgerIndex,
    seedShardReads,
    incrementalGenerationCount,
    traversedIncrementalManifests,
    equivalence,
  }
  await writeFile(
    resolve(outputDir, 'rehearsal-summary.json'),
    `${canonicalJson(summary)}\n`,
    'utf8',
  )
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
