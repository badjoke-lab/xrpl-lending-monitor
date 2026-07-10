import { assertHistorySegmentChain } from './chain'
import {
  assertHistoryExtensionPlan,
  type HistoryExtensionPlan,
} from './extension-plan'
import {
  assertHistorySegmentManifest,
  type HistorySegmentManifest,
} from './manifest'

export interface HistoryExtensionArtifactSummary {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  sourceTerminal: {
    ledgerIndex: number
    ledgerHash: string
    segmentId: string
  }
  target: {
    ledgerIndex: number
    ledgerHash: string
  }
  extension: {
    startLedgerIndex: number
    endLedgerIndex: number
    ledgerCount: number
    segmentCount: number
  }
}

export function assertHistoryExtensionArtifacts(options: {
  plan: HistoryExtensionPlan
  manifests: readonly HistorySegmentManifest[]
}): HistoryExtensionArtifactSummary {
  assertHistoryExtensionPlan(options.plan)
  const plan = options.plan
  const manifests = options.manifests

  if (manifests.length !== plan.extension.segmentCount) {
    throw new Error('History extension artifact segment count does not match the frozen plan')
  }

  for (let index = 0; index < manifests.length; index += 1) {
    const manifest = manifests[index]!
    const planned = plan.extension.segments[index]!
    assertHistorySegmentManifest(manifest)

    if (manifest.network !== plan.network) {
      throw new Error(`History extension artifact network mismatch at segment ${planned.ordinal}`)
    }
    if (manifest.epochId !== plan.epochId) {
      throw new Error(`History extension artifact epoch mismatch at segment ${planned.ordinal}`)
    }
    if (manifest.segmentId !== planned.segmentId) {
      throw new Error(`History extension artifact segment ID mismatch at segment ${planned.ordinal}`)
    }
    if (
      manifest.startLedgerIndex !== planned.startLedgerIndex
      || manifest.endLedgerIndex !== planned.endLedgerIndex
      || manifest.ledgerCount !== planned.ledgerCount
    ) {
      throw new Error(`History extension artifact range mismatch at segment ${planned.ordinal}`)
    }

    const expectedPreviousId = index === 0
      ? plan.extension.anchorPreviousSegmentId
      : manifests[index - 1]!.segmentId
    const expectedPreviousHash = index === 0
      ? plan.extension.anchorPreviousSegmentEndHash
      : manifests[index - 1]!.endLedgerHash

    if (manifest.previousSegmentId !== expectedPreviousId) {
      throw new Error(`History extension artifact predecessor ID mismatch at segment ${planned.ordinal}`)
    }
    if (manifest.previousSegmentEndHash !== expectedPreviousHash) {
      throw new Error(`History extension artifact predecessor hash mismatch at segment ${planned.ordinal}`)
    }
  }

  assertHistorySegmentChain([...manifests], {
    network: 'devnet',
    epochId: plan.epochId,
    startLedgerIndex: plan.extension.startLedgerIndex,
    startParentHash: plan.source.endLedgerHash,
    previousSegmentId: plan.source.lastSegmentId,
    previousSegmentEndHash: plan.source.endLedgerHash,
    endLedgerIndex: plan.target.ledgerIndex,
    endLedgerHash: plan.target.ledgerHash,
  })

  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: plan.epochId,
    sourceTerminal: {
      ledgerIndex: plan.source.endLedgerIndex,
      ledgerHash: plan.source.endLedgerHash,
      segmentId: plan.source.lastSegmentId,
    },
    target: {
      ledgerIndex: plan.target.ledgerIndex,
      ledgerHash: plan.target.ledgerHash,
    },
    extension: {
      startLedgerIndex: plan.extension.startLedgerIndex,
      endLedgerIndex: plan.extension.endLedgerIndex,
      ledgerCount: plan.extension.ledgerCount,
      segmentCount: manifests.length,
    },
  }
}
