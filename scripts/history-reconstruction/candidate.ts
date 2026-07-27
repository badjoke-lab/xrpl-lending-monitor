import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'

import { canonicalJson, sha256Hex, utf8 } from '../../src/shared/current-state/canonical-json'
import {
  assertHistoryExactIndexManifest,
  historyExactIndexManifestDigest,
  type HistoryExactIndexManifest,
} from '../../src/shared/history-segments/exact-index'
import { HISTORY_SEGMENT_FILE_KINDS, type HistorySegmentManifest } from '../../src/shared/history-segments/manifest'
import {
  assertHistorySegmentPublicationDigest,
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
  type PublishedHistorySegment,
} from '../../src/shared/history-segments/publication'
import { planFinalTree, type FinalTreeEntry } from '../../src/shared/history-reconstruction/final-tree'
import {
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
  HISTORY_RECONSTRUCTION_START_LEDGER,
  HISTORY_RECONSTRUCTION_TARGET_HASH,
  HISTORY_RECONSTRUCTION_TARGET_LEDGER,
} from '../../src/shared/history-reconstruction/identity'
import { assertCompleteCheckpointPrefix } from '../../src/shared/history-reconstruction/runner'
import type { RawCheckpoint } from '../../src/shared/history-reconstruction/schema'
import {
  enumerateFiles,
  parseNdjson,
  segmentDirectory,
  verifySegmentDirectory,
  writeAtomic,
} from './common'
import { buildAllExactBuckets, exactDirectory, inspectExactAssets } from './exact-runner'

const unzip = promisify(gunzip)
const WITNESS = {
  ledgerIndex: 3_913_030,
  transactionHash: '70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684',
  objectId: 'AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1',
}

async function verifyWitness(outputDir: string): Promise<void> {
  const id = 224
  const directory = segmentDirectory(outputDir, id)
  const { manifest } = await verifySegmentDirectory(directory, id)
  let transactionFound = false
  let objectFound = false
  for (const file of manifest.files) {
    if (!['protocol_events', 'object_changes'].includes(file.kind)) continue
    const bytes = new Uint8Array(await readFile(join(directory, file.path)))
    const records = parseNdjson(new TextDecoder().decode(await unzip(bytes))) as Record<string, unknown>[]
    if (file.kind === 'protocol_events') {
      transactionFound ||= records.some((record) => (
        record.ledgerIndex === WITNESS.ledgerIndex && record.eventHash === WITNESS.transactionHash
      ))
    } else {
      objectFound ||= records.some((record) => (
        record.ledgerIndex === WITNESS.ledgerIndex
        && record.transactionHash === WITNESS.transactionHash
        && record.objectId === WITNESS.objectId
      ))
    }
  }
  if (!transactionFound || !objectFound) throw new Error('Fixed Vault witness is absent from reconstructed segment 224')
}

async function buildPublication(
  outputDir: string,
  checkpoints: readonly RawCheckpoint[],
  sourceRevision: string,
): Promise<HistorySegmentChainPublication> {
  const manifests: HistorySegmentManifest[] = []
  const segments: PublishedHistorySegment[] = []
  for (const checkpoint of checkpoints) {
    const { manifest } = await verifySegmentDirectory(segmentDirectory(outputDir, checkpoint.segmentId), checkpoint.segmentId)
    manifests.push(manifest)
    const recordCounts = Object.fromEntries(HISTORY_SEGMENT_FILE_KINDS.map((kind) => [
      kind,
      manifest.files.find((file) => file.kind === kind)!.records,
    ])) as PublishedHistorySegment['recordCounts']
    segments.push({
      segmentId: manifest.segmentId,
      manifestPath: `history/${HISTORY_RECONSTRUCTION_EPOCH_ID}/${manifest.segmentId}/manifest.json`,
      manifestSha256: checkpoint.manifestSha256,
      startLedgerIndex: manifest.startLedgerIndex,
      startLedgerHash: manifest.startLedgerHash,
      startParentHash: manifest.startParentHash,
      endLedgerIndex: manifest.endLedgerIndex,
      endLedgerHash: manifest.endLedgerHash,
      ledgerCount: manifest.ledgerCount,
      previousSegmentId: manifest.previousSegmentId,
      previousSegmentEndHash: manifest.previousSegmentEndHash,
      recordCounts,
    })
  }
  const first = manifests[0]!
  const last = manifests.at(-1)!
  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: HISTORY_RECONSTRUCTION_EPOCH_ID,
    chainId: HISTORY_RECONSTRUCTION_ID,
    complete: true,
    startLedgerIndex: HISTORY_RECONSTRUCTION_START_LEDGER,
    startLedgerHash: first.startLedgerHash,
    startParentHash: first.startParentHash,
    endLedgerIndex: HISTORY_RECONSTRUCTION_TARGET_LEDGER,
    endLedgerHash: HISTORY_RECONSTRUCTION_TARGET_HASH,
    segmentCount: HISTORY_RECONSTRUCTION_SEGMENT_COUNT,
    ledgerCount: HISTORY_RECONSTRUCTION_TARGET_LEDGER - HISTORY_RECONSTRUCTION_START_LEDGER + 1,
    sourceRevision,
    publishedAt: last.generatedAt,
    segments,
    publicationSha256: '0'.repeat(64),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  await assertHistorySegmentPublicationDigest(publication)
  await writeAtomic(join(outputDir, 'candidate', 'history', 'publication.json'), `${canonicalJson(publication)}\n`)
  return publication
}

async function buildExactManifest(
  outputDir: string,
  publication: HistorySegmentChainPublication,
  sourceRevision: string,
): Promise<HistoryExactIndexManifest> {
  const assets = await inspectExactAssets(outputDir)
  const manifest: HistoryExactIndexManifest = {
    schemaVersion: 2,
    network: 'devnet',
    epochId: HISTORY_RECONSTRUCTION_EPOCH_ID,
    chainId: publication.chainId,
    publicationSha256: publication.publicationSha256,
    bucketCount: 256,
    hashFunction: 'sha256-first-u32-mod-bucket-count',
    assets,
    totalRecords: assets.reduce((total, asset) => total + asset.recordCount, 0),
    sourceRevision,
    generatedAt: publication.publishedAt,
    manifestSha256: '0'.repeat(64),
  }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  assertHistoryExactIndexManifest(manifest, publication)
  await writeAtomic(join(exactDirectory(outputDir), 'manifest.json'), `${canonicalJson(manifest)}\n`)
  return manifest
}

export async function finalizeCandidate(options: {
  outputDir: string
  checkpoints: readonly RawCheckpoint[]
  sourceRevision: string
}): Promise<void> {
  await assertCompleteCheckpointPrefix(options.checkpoints)
  if (options.checkpoints.at(-1)?.terminalHash !== HISTORY_RECONSTRUCTION_TARGET_HASH) {
    throw new Error('Raw reconstruction terminal hash mismatch')
  }
  await verifyWitness(options.outputDir)
  await buildAllExactBuckets(options.outputDir)
  const publication = await buildPublication(options.outputDir, options.checkpoints, options.sourceRevision)
  const exactManifest = await buildExactManifest(options.outputDir, publication, options.sourceRevision)
  const publicationText = `${canonicalJson(publication)}\n`
  const exactManifestText = `${canonicalJson(exactManifest)}\n`
  await writeAtomic(join(options.outputDir, 'candidate', 'history-channel.json'), `${canonicalJson({
    schemaVersion: 1,
    active: {
      dataCommitSha: options.sourceRevision,
      publicationPath: 'history/publication.json',
      publicationSha256: await sha256Hex(utf8(publicationText)),
      chainId: publication.chainId,
      epochId: publication.epochId,
      exactIndex: {
        manifestPath: 'history/index/exact/manifest.json',
        manifestSha256: await sha256Hex(utf8(exactManifestText)),
      },
    },
    updatedAt: publication.publishedAt,
  })}\n`)

  const root = join(options.outputDir, 'candidate')
  const entries: FinalTreeEntry[] = []
  for (const path of await enumerateFiles(root)) {
    entries.push({ path, sha256: await sha256Hex(new Uint8Array(await readFile(join(root, path)))) })
  }
  const tree = planFinalTree(entries)
  await writeAtomic(join(options.outputDir, 'evidence', 'final-tree.json'), `${canonicalJson({
    schemaVersion: 1,
    kind: 'history-reconstruction-candidate-tree',
    reconstructionId: HISTORY_RECONSTRUCTION_ID,
    entries: tree,
    witnessPassed: true,
    remoteRehearsalPassed: false,
    productionMutation: false,
  })}\n`)
}
