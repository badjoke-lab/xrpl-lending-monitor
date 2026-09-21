import { readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import { verifyDbLessChannel, type DbLessChannelV1 } from '../src/shared/db-less/channel'
import { GitHubReleaseDbLessStore } from '../src/shared/db-less/github-release-publication'
import type { DbLessArtifact } from '../src/shared/db-less/live-delta'
import { publishArtifactsThenChannel } from '../src/shared/db-less/publication'
import { canonicalJson, sha256Hex } from '../src/shared/current-state/canonical-json'

const LIVE_RELEASE_OPERATIONAL_ASSET_CEILING = 720

interface PlannedArtifact {
  key: string
  path: string
  bytes: number
  sha256: string
}

interface PublicationPlanV1 {
  schemaVersion: 1
  sourceRevision: string
  liveRepository: string
  liveReleaseTag: string
  expectedPreviousChannelSha256: string
  immutableArtifacts: PlannedArtifact[]
  nextChannel: {
    path: string
    channelSha256: string
    lastCommittedLedgerIndex: number
    lastCommittedLedgerHash: string
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

function safeRelativePath(value: string, field: string): string {
  if (
    !value.length
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(value)
  ) {
    throw new Error(`${field} is unsafe`)
  }
  return value
}

function resolvedInside(root: string, relative: string): string {
  const path = resolve(root, safeRelativePath(relative, 'artifact path'))
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error('Artifact path escapes publication root')
  }
  return path
}

function parsePlan(value: unknown): PublicationPlanV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Publication plan must be an object')
  }
  const plan = value as Partial<PublicationPlanV1>
  if (plan.schemaVersion !== 1) throw new Error('Unsupported publication plan schema')
  if (typeof plan.sourceRevision !== 'string' || !plan.sourceRevision.length) {
    throw new Error('Publication plan sourceRevision is invalid')
  }
  if (typeof plan.liveRepository !== 'string' || !plan.liveRepository.length) {
    throw new Error('Publication plan liveRepository is invalid')
  }
  if (typeof plan.liveReleaseTag !== 'string' || !plan.liveReleaseTag.length) {
    throw new Error('Publication plan liveReleaseTag is invalid')
  }
  if (
    typeof plan.expectedPreviousChannelSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(plan.expectedPreviousChannelSha256)
  ) {
    throw new Error('Publication plan expected previous channel digest is invalid')
  }
  if (!Array.isArray(plan.immutableArtifacts) || plan.immutableArtifacts.length < 1) {
    throw new Error('Publication plan must contain immutable artifacts')
  }
  if (typeof plan.nextChannel !== 'object' || plan.nextChannel === null) {
    throw new Error('Publication plan nextChannel is invalid')
  }
  return plan as PublicationPlanV1
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('DB-less live Release publication requires --local')

  const rootDir = resolve(requiredArgument(args, '--root-dir'))
  const planPath = resolve(requiredArgument(args, '--plan'))
  const outputPath = resolve(requiredArgument(args, '--output'))
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('GH_TOKEN is required')

  const plan = parsePlan(JSON.parse(await readFile(planPath, 'utf8')) as unknown)
  const dataRepository = requiredArgument(args, '--data-repository')
  const dataReleaseTag = requiredArgument(args, '--data-release-tag')
  const channelRepository = requiredArgument(args, '--channel-repository')
  const channelReleaseTag = requiredArgument(args, '--channel-release-tag')
  if (
    plan.liveRepository !== dataRepository
    || plan.liveReleaseTag !== dataReleaseTag
  ) {
    throw new Error('Publication plan data Release location does not match requested destination')
  }

  const nextChannelPath = resolvedInside(rootDir, plan.nextChannel.path)
  const nextChannel = JSON.parse(await readFile(nextChannelPath, 'utf8')) as DbLessChannelV1
  await verifyDbLessChannel(nextChannel)
  if (nextChannel.channelSha256 !== plan.nextChannel.channelSha256) {
    throw new Error('Next channel digest does not match publication plan')
  }
  if (
    nextChannel.lastCommittedLedgerIndex !== plan.nextChannel.lastCommittedLedgerIndex
    || nextChannel.lastCommittedLedgerHash !== plan.nextChannel.lastCommittedLedgerHash
  ) {
    throw new Error('Next channel committed head does not match publication plan')
  }

  const artifacts: DbLessArtifact[] = []
  const seen = new Set<string>()
  for (const [index, item] of plan.immutableArtifacts.entries()) {
    if (
      typeof item.key !== 'string'
      || typeof item.path !== 'string'
      || !Number.isSafeInteger(item.bytes)
      || item.bytes < 1
      || typeof item.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(item.sha256)
    ) {
      throw new Error(`Publication plan artifact ${index} is invalid`)
    }
    if (seen.has(item.key)) throw new Error('Publication plan artifact keys must be unique')
    seen.add(item.key)

    const bytes = new Uint8Array(await readFile(resolvedInside(rootDir, item.path)))
    if (bytes.byteLength !== item.bytes) {
      throw new Error(`Publication plan artifact byte mismatch: ${item.key}`)
    }
    if (await sha256Hex(bytes) !== item.sha256) {
      throw new Error(`Publication plan artifact digest mismatch: ${item.key}`)
    }
    artifacts.push({
      key: item.key,
      mediaType: 'application/json',
      bytes,
      sha256: item.sha256,
      immutable: true,
    })
  }

  const dataStore = new GitHubReleaseDbLessStore({
    repository: dataRepository,
    releaseTag: dataReleaseTag,
    token,
    maxAssets: LIVE_RELEASE_OPERATIONAL_ASSET_CEILING,
  })
  const channelStore = new GitHubReleaseDbLessStore({
    repository: channelRepository,
    releaseTag: channelReleaseTag,
    token,
    maxAssets: 1,
  })
  const result = await publishArtifactsThenChannel({
    writer: dataStore,
    publisher: channelStore,
    artifacts,
    nextChannel,
    expectedPreviousChannelSha256: plan.expectedPreviousChannelSha256,
  })

  const readback = await channelStore.readChannel()
  if (!readback || readback.channel.channelSha256 !== nextChannel.channelSha256) {
    throw new Error('Final GitHub Release channel readback mismatch')
  }

  const summary = {
    schemaVersion: 1,
    sourceRevision: plan.sourceRevision,
    dataRepository,
    dataReleaseTag,
    channelRepository,
    channelReleaseTag,
    previousChannelSha256: plan.expectedPreviousChannelSha256,
    channelSha256: nextChannel.channelSha256,
    lastCommittedLedgerIndex: nextChannel.lastCommittedLedgerIndex,
    lastCommittedLedgerHash: nextChannel.lastCommittedLedgerHash,
    immutableArtifacts: artifacts.length,
    written: result.artifacts.written,
    reused: result.artifacts.reused,
    revision: result.revision,
  }

  await writeFile(outputPath, `${canonicalJson(summary)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})