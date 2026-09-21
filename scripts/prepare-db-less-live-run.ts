import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { readLatestValidatedLedgerHead } from '../src/collector/incremental/read-latest-validated-head'
import { scanValidatedLedgerRange } from '../src/collector/incremental/scan-validated-ledgers'
import {
  verifyDbLessChannel,
  type DbLessChannelV1,
} from '../src/shared/db-less/channel'
import {
  verifyDbLessLiveChainManifest,
  type DbLessLiveChainManifestV1,
} from '../src/shared/db-less/live-chain'
import {
  finalizeDbLessLivePublication,
  prepareDbLessLiveDelta,
} from '../src/shared/db-less/live-publication'
import { selectDbLessLiveReleaseShard } from '../src/shared/db-less/github-release-shard-selector'
import { canonicalJson } from '../src/shared/current-state/canonical-json'

type Arguments = {
  channelPath: string
  previousChainPath: string | null
  outputDir: string
  sourceRevision: string
  liveRepository: string
  liveReleaseTag: string | null
  liveReleasePrefix: string | null
  shardBucketHours: number
  shardMaxAssets: number
  shardMaxRotations: number
  endpoints: string[]
  timeoutMs: number
  maxHeadAgeSeconds: number
  maxLedgers: number
  readWindowSize: number
}

function argumentValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
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

function parseArguments(args: readonly string[]): Arguments {
  if (!args.includes('--local')) throw new Error('DB-less live collector preparation requires --local')
  const endpoints = argumentValues(args, '--endpoint')
  if (endpoints.length === 0) throw new Error('At least one --endpoint is required')

  const liveReleaseTag = argumentValue(args, '--live-release-tag')
  const liveReleasePrefix = argumentValue(args, '--live-release-prefix')
  if ((liveReleaseTag === null) === (liveReleasePrefix === null)) {
    throw new Error('Exactly one of --live-release-tag or --live-release-prefix is required')
  }

  return {
    channelPath: resolve(requiredArgument(args, '--channel')),
    previousChainPath: argumentValue(args, '--previous-chain')
      ? resolve(requiredArgument(args, '--previous-chain'))
      : null,
    outputDir: resolve(argumentValue(args, '--output-dir') ?? '.local/db-less-live'),
    sourceRevision: requiredArgument(args, '--source-revision'),
    liveRepository: requiredArgument(args, '--live-repository'),
    liveReleaseTag,
    liveReleasePrefix,
    shardBucketHours: positiveInteger(args, '--shard-bucket-hours', 6),
    shardMaxAssets: positiveInteger(args, '--shard-max-assets', 720),
    shardMaxRotations: positiveInteger(args, '--shard-max-rotations', 24),
    endpoints,
    timeoutMs: positiveInteger(args, '--timeout-ms', 8_000),
    maxHeadAgeSeconds: positiveInteger(args, '--max-head-age-seconds', 30),
    maxLedgers: positiveInteger(args, '--max-ledgers', 256),
    readWindowSize: positiveInteger(args, '--read-window-size', 16),
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${canonicalJson(value)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const channel = await readJson<DbLessChannelV1>(args.channelPath)
  await verifyDbLessChannel(channel)

  let previousChain: DbLessLiveChainManifestV1 | null = null
  if (args.previousChainPath) {
    previousChain = await readJson<DbLessLiveChainManifestV1>(args.previousChainPath)
    await verifyDbLessLiveChainManifest(previousChain)
  }

  const head = await readLatestValidatedLedgerHead({
    endpoints: args.endpoints,
    timeoutMs: args.timeoutMs,
    maxAgeSeconds: args.maxHeadAgeSeconds,
  })
  const startLedgerIndex = channel.lastCommittedLedgerIndex + 1
  const scan = await scanValidatedLedgerRange({
    endpoint: head.endpoint,
    timeoutMs: args.timeoutMs,
    startLedgerIndex,
    latestValidatedLedger: head.ledgerIndex,
    maxLedgers: args.maxLedgers,
    expectedPreviousHash: channel.lastCommittedLedgerHash,
    readWindowSize: args.readWindowSize,
  })

  const prepared = await prepareDbLessLiveDelta({
    channel,
    previousChain,
    scan,
    sourceRevision: args.sourceRevision,
  })

  await rm(args.outputDir, { recursive: true, force: true })
  await mkdir(args.outputDir, { recursive: true })

  if (prepared.status === 'caught-up') {
    const summary = {
      schemaVersion: 1,
      status: 'caught-up',
      sourceRevision: args.sourceRevision,
      liveRepository: args.liveRepository,
      liveReleaseTag: args.liveReleaseTag,
      liveReleasePrefix: args.liveReleasePrefix,
      endpoint: head.endpoint,
      latestValidatedLedger: head.ledgerIndex,
      latestValidatedLedgerHash: head.ledgerHash,
      latestValidatedAgeSeconds: head.ageSeconds,
      committedLedgerIndex: channel.lastCommittedLedgerIndex,
      committedLedgerHash: channel.lastCommittedLedgerHash,
      scannedLedgers: 0,
      immutableArtifacts: 0,
    }
    await writeJson(join(args.outputDir, 'run-summary.json'), summary)
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    return
  }

  let selectedReleaseTag = args.liveReleaseTag
  let shardSelection: Awaited<ReturnType<typeof selectDbLessLiveReleaseShard>> | null = null
  if (selectedReleaseTag === null) {
    const token = process.env.GH_TOKEN
    if (!token) throw new Error('GH_TOKEN is required for --live-release-prefix mode')
    shardSelection = await selectDbLessLiveReleaseShard({
      repository: args.liveRepository,
      tagPrefix: args.liveReleasePrefix!,
      timestamp: prepared.delta.manifest.generatedAt,
      plannedArtifacts: prepared.immutableArtifactCountBeforeChain + 1,
      token,
      bucketHours: args.shardBucketHours,
      maxAssets: args.shardMaxAssets,
      maxRotations: args.shardMaxRotations,
    })
    selectedReleaseTag = shardSelection.plan.releaseTag
  }

  const publication = await finalizeDbLessLivePublication({
    prepared,
    publicationLocation: {
      provider: 'github-release',
      repository: args.liveRepository,
      releaseTag: selectedReleaseTag,
    },
  })

  const artifactsDir = join(args.outputDir, 'immutable')
  const plannedArtifacts: Array<{
    key: string
    path: string
    bytes: number
    sha256: string
  }> = []

  for (const artifact of publication.immutableArtifacts) {
    const path = join(artifactsDir, artifact.key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, artifact.bytes)
    plannedArtifacts.push({
      key: artifact.key,
      path: `immutable/${artifact.key}`,
      bytes: artifact.bytes.byteLength,
      sha256: artifact.sha256,
    })
  }

  await writeFile(join(args.outputDir, 'next-channel.json'), publication.nextChannelBytes)
  await writeJson(join(args.outputDir, 'publication-plan.json'), {
    schemaVersion: 1,
    sourceRevision: args.sourceRevision,
    liveRepository: args.liveRepository,
    liveReleaseTag: selectedReleaseTag,
    expectedPreviousChannelSha256: channel.channelSha256,
    releaseShard: shardSelection
      ? {
          ...shardSelection.plan,
          releaseExists: shardSelection.releaseExists,
        }
      : null,
    immutableArtifacts: plannedArtifacts,
    nextChannel: {
      path: 'next-channel.json',
      channelSha256: publication.nextChannel.channelSha256,
      lastCommittedLedgerIndex: publication.nextChannel.lastCommittedLedgerIndex,
      lastCommittedLedgerHash: publication.nextChannel.lastCommittedLedgerHash,
    },
  })

  const summary = {
    schemaVersion: 1,
    status: 'prepared',
    sourceRevision: args.sourceRevision,
    liveRepository: args.liveRepository,
    liveReleaseTag: selectedReleaseTag,
    releaseShard: shardSelection
      ? {
          ...shardSelection.plan,
          releaseExists: shardSelection.releaseExists,
        }
      : null,
    endpoint: head.endpoint,
    latestValidatedLedger: head.ledgerIndex,
    latestValidatedLedgerHash: head.ledgerHash,
    latestValidatedAgeSeconds: head.ageSeconds,
    previousCommittedLedgerIndex: channel.lastCommittedLedgerIndex,
    previousCommittedLedgerHash: channel.lastCommittedLedgerHash,
    startLedgerIndex: publication.delta.manifest.startLedgerIndex,
    endLedgerIndex: publication.delta.manifest.endLedgerIndex,
    endLedgerHash: publication.delta.manifest.endLedgerHash,
    scannedLedgers: publication.delta.manifest.ledgerCount,
    completeToLatest: scan.completeToLatest,
    semanticCounts: publication.delta.manifest.semanticCounts,
    deltaGenerationId: publication.delta.manifest.generationId,
    liveChainGenerationId: publication.chain.manifest.generationId,
    liveChainGenerations: publication.chain.manifest.generationCount,
    immutableArtifacts: plannedArtifacts.length,
    nextChannelSha256: publication.nextChannel.channelSha256,
  }
  await writeJson(join(args.outputDir, 'run-summary.json'), summary)
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})