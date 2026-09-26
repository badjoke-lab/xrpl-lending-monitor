import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  DbLessArtifactLocationV1,
  DbLessLivePointerV1,
} from '../src/shared/db-less/channel'
import { readDbLessCurrentOverlaySourceFromChannel } from '../src/shared/db-less/current-overlay-chain-compactor'
import { buildDbLessCurrentOverlayCheckpoint } from '../src/shared/db-less/current-overlay-checkpoint'
import { verifyDbLessCurrentOverlayEquivalence } from '../src/shared/db-less/current-overlay-equivalence'
import { DbLessCurrentOverlayReader } from '../src/shared/db-less/current-overlay-reader'
import { GitHubReleaseDbLessStore } from '../src/shared/db-less/github-release-publication'
import { canonicalJson } from '../src/shared/current-state/canonical-json'

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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) {
    throw new Error('D4 Current overlay rehearsal requires --local')
  }

  const repository = requiredArgument(args, '--repository')
  const channelReleaseTag = requiredArgument(args, '--channel-release-tag')
  const outputDir = resolve(requiredArgument(args, '--output-dir'))
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

  process.stdout.write(`D4 initial compaction: source channel head ${channelRead.channel.lastCommittedLedgerIndex}\n`)
  const source = await readDbLessCurrentOverlaySourceFromChannel({
    channel: channelRead.channel,
    maxGenerations,
    readChainArtifact: async (pointer: DbLessLivePointerV1) =>
      storeFor(pointer.location).readImmutable(pointer.manifestKey),
    readLocatedArtifact: async (location, key) =>
      storeFor(location).readImmutable(key),
    onProgress: (progress) => {
      const total = progress.total === null ? '?' : String(progress.total)
      process.stdout.write(
        `D4 initial compaction: ${progress.phase} ${progress.completed}/${total}\n`,
      )
    },
  })
  process.stdout.write(`D4 initial compaction: source read complete (${source.generations.length} generations)\n`)

  process.stdout.write('D4 initial compaction: building checkpoint\n')
  const checkpoint = await buildDbLessCurrentOverlayCheckpoint({
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
  process.stdout.write('D4 initial compaction: verifying equivalence\n')
  const equivalence = await verifyDbLessCurrentOverlayEquivalence({
    generations: source.generations,
    reader: new DbLessCurrentOverlayReader({
      manifest: checkpoint.manifest,
      readArtifact: async (key) => localArtifacts.get(key) ?? null,
      maxShardBytes: maxBytesPerShard,
    }),
  })

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
    verifiedGenerationCount: source.verification.generationCount,
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
