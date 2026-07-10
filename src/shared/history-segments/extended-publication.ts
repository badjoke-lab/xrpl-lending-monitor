import { assertHistoryExtensionArtifacts } from './extension-artifacts'
import {
  assertHistoryExtensionPlan,
  type HistoryExtensionPlan,
} from './extension-plan'
import {
  HISTORY_SEGMENT_FILE_KINDS,
  type HistorySegmentManifest,
} from './manifest'
import {
  assertHistorySegmentPublicationDigest,
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
  type PublishedHistorySegment,
} from './publication'

const SHA256 = /^[a-f0-9]{64}$/

export interface ExtensionManifestInput {
  manifest: HistorySegmentManifest
  manifestSha256: string
}

function assertFrozenSourceBinding(options: {
  publication: HistorySegmentChainPublication
  plan: HistoryExtensionPlan
}): void {
  const publication = options.publication
  const source = options.plan.source
  const last = publication.segments.at(-1)
  if (!last) throw new Error('Extended history source publication has no terminal segment')

  if (
    source.chainId !== publication.chainId
    || source.publicationSha256 !== publication.publicationSha256
    || source.startLedgerIndex !== publication.startLedgerIndex
    || source.endLedgerIndex !== publication.endLedgerIndex
    || source.endLedgerHash !== publication.endLedgerHash
    || source.segmentCount !== publication.segmentCount
    || source.ledgerCount !== publication.ledgerCount
    || source.lastSegmentId !== last.segmentId
  ) {
    throw new Error('Extended history source publication does not match the frozen extension plan')
  }
}

function descriptor(input: ExtensionManifestInput): PublishedHistorySegment {
  if (!SHA256.test(input.manifestSha256)) {
    throw new Error('Extended history manifest digest is invalid')
  }
  const manifest = input.manifest
  return {
    segmentId: manifest.segmentId,
    manifestPath: `history/${manifest.epochId}/${manifest.segmentId}/manifest.json`,
    manifestSha256: input.manifestSha256,
    startLedgerIndex: manifest.startLedgerIndex,
    startLedgerHash: manifest.startLedgerHash,
    startParentHash: manifest.startParentHash,
    endLedgerIndex: manifest.endLedgerIndex,
    endLedgerHash: manifest.endLedgerHash,
    ledgerCount: manifest.ledgerCount,
    previousSegmentId: manifest.previousSegmentId,
    previousSegmentEndHash: manifest.previousSegmentEndHash,
    recordCounts: Object.fromEntries(
      HISTORY_SEGMENT_FILE_KINDS.map((kind) => [
        kind,
        manifest.files.find((file) => file.kind === kind)?.records ?? 0,
      ]),
    ) as PublishedHistorySegment['recordCounts'],
  }
}

export async function buildExtendedHistoryPublication(options: {
  sourcePublication: HistorySegmentChainPublication
  plan: HistoryExtensionPlan
  extensionManifests: readonly ExtensionManifestInput[]
  chainId: string
  sourceRevision: string
}): Promise<HistorySegmentChainPublication> {
  await assertHistorySegmentPublicationDigest(options.sourcePublication)
  assertHistoryExtensionPlan(options.plan)
  assertFrozenSourceBinding({ publication: options.sourcePublication, plan: options.plan })

  assertHistoryExtensionArtifacts({
    plan: options.plan,
    manifests: options.extensionManifests.map((input) => input.manifest),
  })

  const extensionDescriptors = options.extensionManifests.map(descriptor)
  const lastExtension = options.extensionManifests.at(-1)?.manifest
  if (!lastExtension) throw new Error('Extended history publication requires extension manifests')

  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: options.sourcePublication.epochId,
    chainId: options.chainId,
    complete: true,
    startLedgerIndex: options.sourcePublication.startLedgerIndex,
    startLedgerHash: options.sourcePublication.startLedgerHash,
    startParentHash: options.sourcePublication.startParentHash,
    endLedgerIndex: options.plan.target.ledgerIndex,
    endLedgerHash: options.plan.target.ledgerHash,
    segmentCount: options.sourcePublication.segmentCount + extensionDescriptors.length,
    ledgerCount: options.sourcePublication.ledgerCount + options.plan.extension.ledgerCount,
    sourceRevision: options.sourceRevision,
    publishedAt: lastExtension.generatedAt,
    segments: [
      ...options.sourcePublication.segments,
      ...extensionDescriptors,
    ],
    publicationSha256: '0'.repeat(64),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  await assertHistorySegmentPublicationDigest(publication)
  return publication
}
