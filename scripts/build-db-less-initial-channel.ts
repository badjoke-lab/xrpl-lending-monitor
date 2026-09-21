import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  buildDbLessInitialChannel,
  type LegacyHistoryChannelV1,
  type LegacyHistoryPublicationV1,
} from '../src/shared/db-less/initial-channel'
import type { DbLessBaseManifestV1 } from '../src/shared/db-less/base-manifest'
import { encodeDbLessChannel } from '../src/shared/db-less/channel'

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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('DB-less initial channel generation requires --local')

  const baseManifestPath = resolve(requiredArgument(args, '--base-manifest'))
  const archiveChannelPath = resolve(requiredArgument(args, '--archive-channel'))
  const archivePublicationPath = resolve(requiredArgument(args, '--archive-publication'))
  const archiveExactIndexPath = resolve(requiredArgument(args, '--archive-exact-index'))
  const outputPath = resolve(requiredArgument(args, '--output'))
  const baseManifestBytes = await readFile(baseManifestPath)
  const archivePublicationBytes = await readFile(archivePublicationPath)
  const archiveExactIndexBytes = await readFile(archiveExactIndexPath)

  const channel = await buildDbLessInitialChannel({
    baseManifest: JSON.parse(baseManifestBytes.toString('utf8')) as DbLessBaseManifestV1,
    baseManifestBytes,
    baseLocation: {
      provider: 'github-release',
      repository: requiredArgument(args, '--base-repository'),
      releaseTag: requiredArgument(args, '--base-release-tag'),
    },
    baseManifestKey: argumentValue(args, '--base-manifest-key') ?? 'base-manifest.json',
    archiveChannel: JSON.parse(await readFile(archiveChannelPath, 'utf8')) as LegacyHistoryChannelV1,
    archivePublication: JSON.parse(archivePublicationBytes.toString('utf8')) as LegacyHistoryPublicationV1,
    archivePublicationBytes,
    archiveExactIndexBytes,
    archiveRepository: requiredArgument(args, '--archive-repository'),
    updatedAt: requiredArgument(args, '--updated-at'),
  })

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, encodeDbLessChannel(channel))
  process.stdout.write(`${JSON.stringify({
    schemaVersion: channel.schemaVersion,
    epochId: channel.epochId,
    baseGenerationId: channel.base.generationId,
    baseReleaseTag: channel.base.location.provider === 'github-release'
      ? channel.base.location.releaseTag
      : null,
    baseLedgerIndex: channel.base.ledgerIndex,
    baseLedgerHash: channel.base.ledgerHash,
    historyCoverage: channel.historyCoverage,
    channelSha256: channel.channelSha256,
  }, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})