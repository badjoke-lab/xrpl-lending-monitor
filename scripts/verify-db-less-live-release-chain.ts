import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { DbLessLivePointerV1 } from '../src/shared/db-less/channel'
import { GitHubReleaseDbLessStore } from '../src/shared/db-less/github-release-publication'
import {
  verifyDbLessLiveChainFromChannel,
  verifyDbLessLiveChainHeadFromChannel,
} from '../src/shared/db-less/live-chain-reader'
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
  if (!args.includes('--local')) throw new Error('DB-less live-chain verification requires --local')

  const repository = requiredArgument(args, '--repository')
  const channelReleaseTag = requiredArgument(args, '--channel-release-tag')
  const outputPath = resolve(requiredArgument(args, '--output'))
  const maxGenerations = positiveInteger(args, '--max-generations', 2_048)
  const headOnly = args.includes('--head-only')
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
  const readArtifact = async (pointer: DbLessLivePointerV1) => {
    if (pointer.location.provider !== 'github-release') {
      throw new Error('DB-less live-chain verifier supports GitHub Release live artifacts only')
    }
    if (pointer.location.repository !== repository) {
      throw new Error('DB-less live-chain artifact repository changed unexpectedly')
    }
    const key = pointer.location.releaseTag
    let store = stores.get(key)
    if (!store) {
      store = new GitHubReleaseDbLessStore({
        repository,
        releaseTag: key,
        token,
        maxAssets: 900,
      })
      stores.set(key, store)
    }
    return store.readImmutable(pointer.manifestKey)
  }

  const summary = headOnly
    ? await verifyDbLessLiveChainHeadFromChannel({
        channel: channelRead.channel,
        readArtifact,
      })
    : await verifyDbLessLiveChainFromChannel({
        channel: channelRead.channel,
        maxGenerations,
        readArtifact,
      })

  const result = {
    schemaVersion: 1,
    verificationMode: headOnly ? 'head' : 'full',
    repository,
    channelReleaseTag,
    channelSha256: channelRead.channel.channelSha256,
    lastCommittedLedgerIndex: channelRead.channel.lastCommittedLedgerIndex,
    lastCommittedLedgerHash: channelRead.channel.lastCommittedLedgerHash,
    live: summary,
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${canonicalJson(result)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
