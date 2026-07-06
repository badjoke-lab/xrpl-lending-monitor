import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { canonicalJson, sha256Hex, utf8 } from '../src/shared/current-state/canonical-json'
import { assertHistorySegmentChain } from '../src/shared/history-segments/chain'
import {
  assertHistorySegmentManifest,
  type HistorySegmentManifest,
} from '../src/shared/history-segments/manifest'
import {
  assertHistorySegmentChainPublication,
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
  type PublishedHistorySegment,
} from '../src/shared/history-segments/publication'

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

function argumentValue(args: readonly string[], name: string): string | null {
  const values = argumentValues(args, name)
  if (values.length > 1) throw new Error(`${name} may be supplied at most once`)
  return values[0] ?? null
}

function requiredArgument(args: readonly string[], name: string): string {
  const value = argumentValue(args, name)
  if (value === null) throw new Error(`${name} is required`)
  return value
}

function safeId(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--local')) throw new Error('History publication generation requires --local')
  const manifestPaths = argumentValues(args, '--manifest').map((path) => resolve(path))
  if (manifestPaths.length === 0) throw new Error('At least one --manifest is required')
  const chainId = safeId(requiredArgument(args, '--chain-id'), 'chainId')
  const epochId = safeId(requiredArgument(args, '--epoch-id'), 'epochId')
  const sourceRevision = safeId(requiredArgument(args, '--source-revision'), 'sourceRevision')
  const outputPath = resolve(requiredArgument(args, '--output'))

  const manifests: HistorySegmentManifest[] = []
  const manifestDigests: string[] = []
  for (const path of manifestPaths) {
    const bytes = new Uint8Array(await readFile(path))
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as HistorySegmentManifest
    assertHistorySegmentManifest(manifest)
    manifests.push(manifest)
    manifestDigests.push(await sha256Hex(bytes))
  }

  const first = manifests[0]!
  const last = manifests.at(-1)!
  if (first.epochId !== epochId) throw new Error('Requested epoch does not match the first manifest')
  assertHistorySegmentChain(manifests, {
    network: 'devnet',
    epochId,
    startLedgerIndex: first.startLedgerIndex,
    startParentHash: first.startParentHash,
    previousSegmentId: first.previousSegmentId,
    previousSegmentEndHash: first.previousSegmentEndHash,
    endLedgerIndex: last.endLedgerIndex,
    endLedgerHash: last.endLedgerHash,
  })

  const segments: PublishedHistorySegment[] = manifests.map((manifest, index) => ({
    segmentId: manifest.segmentId,
    manifestPath: `history/${epochId}/${manifest.segmentId}/manifest.json`,
    manifestSha256: manifestDigests[index]!,
    startLedgerIndex: manifest.startLedgerIndex,
    startLedgerHash: manifest.startLedgerHash,
    startParentHash: manifest.startParentHash,
    endLedgerIndex: manifest.endLedgerIndex,
    endLedgerHash: manifest.endLedgerHash,
    ledgerCount: manifest.ledgerCount,
    previousSegmentId: manifest.previousSegmentId,
    previousSegmentEndHash: manifest.previousSegmentEndHash,
    recordCounts: Object.fromEntries(
      manifest.files.map((file) => [file.kind, file.records]),
    ) as PublishedHistorySegment['recordCounts'],
  }))

  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId,
    chainId,
    complete: true,
    startLedgerIndex: first.startLedgerIndex,
    startLedgerHash: first.startLedgerHash,
    startParentHash: first.startParentHash,
    endLedgerIndex: last.endLedgerIndex,
    endLedgerHash: last.endLedgerHash,
    segmentCount: segments.length,
    ledgerCount: segments.reduce((total, segment) => total + segment.ledgerCount, 0),
    sourceRevision,
    publishedAt: last.generatedAt,
    segments,
    publicationSha256: '0'.repeat(64),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  assertHistorySegmentChainPublication(publication)
  await mkdir(dirname(outputPath), { recursive: true })
  const text = `${canonicalJson(publication)}\n`
  await writeFile(outputPath, utf8(text))
  process.stdout.write(text)
}

await main()
