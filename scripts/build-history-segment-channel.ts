import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { canonicalJson, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import {
  assertHistoryExactIndexManifest,
  historyExactIndexManifestDigest,
  type HistoryExactIndexManifest,
} from '../src/shared/history-segments/exact-index'
import {
  assertHistorySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from '../src/shared/history-segments/publication'
import {
  parseHistorySegmentChannel,
  type HistorySegmentChannel,
} from '../src/shared/history-segments/channel'

function value(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const result = args[index + 1]
  if (!result || result.startsWith('--')) throw new Error(`${name} requires a value`)
  return result
}

function required(args: readonly string[], name: string): string {
  const result = value(args, name)
  if (result === null) throw new Error(`${name} is required`)
  return result
}

function commitSha(input: string): string {
  if (!/^[a-f0-9]{40}$/.test(input)) throw new Error('--data-commit-sha must be a lowercase 40-character Git commit SHA')
  return input
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('History channel generation requires --local')
  const publicationFile = resolve(required(args, '--publication'))
  const outputFile = resolve(required(args, '--output'))
  const publicationPath = value(args, '--publication-path') ?? 'history/publication.json'
  const publicationBytes = new Uint8Array(await readFile(publicationFile))
  const publication = JSON.parse(new TextDecoder().decode(publicationBytes)) as HistorySegmentChainPublication
  await assertHistorySegmentPublicationDigest(publication)

  const exactIndexFile = value(args, '--exact-index-manifest')
  const exactIndexPathArgument = value(args, '--exact-index-manifest-path')
  if (exactIndexFile === null && exactIndexPathArgument !== null) {
    throw new Error('--exact-index-manifest-path requires --exact-index-manifest')
  }
  let exactIndex: NonNullable<HistorySegmentChannel['active']['exactIndex']> | null = null
  if (exactIndexFile !== null) {
    const bytes = new Uint8Array(await readFile(resolve(exactIndexFile)))
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as HistoryExactIndexManifest
    assertHistoryExactIndexManifest(manifest, publication)
    if (await historyExactIndexManifestDigest(manifest) !== manifest.manifestSha256) {
      throw new Error('History exact index semantic manifest digest mismatch')
    }
    exactIndex = {
      manifestPath: exactIndexPathArgument ?? 'history/index/exact/manifest.json',
      manifestSha256: await sha256Hex(bytes),
    }
  }

  const channel: HistorySegmentChannel = {
    schemaVersion: 1,
    active: {
      dataCommitSha: commitSha(required(args, '--data-commit-sha')),
      publicationPath,
      publicationSha256: await sha256Hex(publicationBytes),
      chainId: publication.chainId,
      epochId: publication.epochId,
      exactIndex,
    },
    updatedAt: publication.publishedAt,
  }
  parseHistorySegmentChannel(channel)
  await mkdir(dirname(outputFile), { recursive: true })
  const text = `${canonicalJson(channel)}\n`
  await writeFile(outputFile, utf8(text))
  process.stdout.write(text)
}

await main()
