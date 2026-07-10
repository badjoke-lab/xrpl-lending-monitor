import { describe, expect, it } from 'vitest'

import type { StoredSyncState } from '../../domain/network/status'
import { HISTORY_SEGMENT_FILE_KINDS } from '../../shared/history-segments/manifest'
import {
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
  type PublishedHistorySegment,
} from '../../shared/history-segments/publication'
import type { CurrentStateOverlayState } from '../repositories/current-state-overlay'
import type { ReplacementBaseRebaseEvidence } from './replacement-base-rebase-plan'
import { buildT5CutoverPreflightBundle, type T5CandidateRehearsalSummary } from './t5-cutover-preflight'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const D = 'D'.repeat(64)

function recordCounts(ledgers: number): PublishedHistorySegment['recordCounts'] {
  return Object.fromEntries(
    HISTORY_SEGMENT_FILE_KINDS.map((kind) => [kind, kind === 'ledgers' ? ledgers : 0]),
  ) as PublishedHistorySegment['recordCounts']
}

async function publication(): Promise<HistorySegmentChainPublication> {
  const result: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-99',
    chainId: 'canonical-devnet-100-110',
    complete: true,
    startLedgerIndex: 100,
    startLedgerHash: A,
    startParentHash: B,
    endLedgerIndex: 110,
    endLedgerHash: C,
    segmentCount: 1,
    ledgerCount: 11,
    sourceRevision: 'test',
    publishedAt: '2026-07-10T00:00:00.000Z',
    segments: [{
      segmentId: 'devnet-99-100-110',
      manifestPath: 'history/devnet-99/devnet-99-100-110/manifest.json',
      manifestSha256: '1'.repeat(64),
      startLedgerIndex: 100,
      startLedgerHash: A,
      startParentHash: B,
      endLedgerIndex: 110,
      endLedgerHash: C,
      ledgerCount: 11,
      previousSegmentId: null,
      previousSegmentEndHash: null,
      recordCounts: recordCounts(11),
    }],
    publicationSha256: '0'.repeat(64),
  }
  result.publicationSha256 = await historySegmentPublicationDigest(result)
  return result
}

function sync(): StoredSyncState {
  return {
    network: 'devnet',
    epochId: 'devnet-99',
    lastProcessedLedger: 105,
    lastProcessedHash: D,
    latestObservedLedger: 120,
    latestObservedHash: 'E'.repeat(64),
    latestLedgerAgeSeconds: 1,
    lastAttemptAt: null,
    lastSuccessAt: null,
    status: 'healthy',
    consecutiveFailures: 0,
    endpoint: null,
    serverVersion: null,
    serverState: null,
    completeLedgers: null,
    lendingProtocolEnabled: true,
    lendingProtocolSupported: true,
    singleAssetVaultEnabled: true,
    singleAssetVaultSupported: true,
    resetReason: null,
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}

function overlay(): CurrentStateOverlayState {
  return {
    network: 'devnet',
    epochId: 'devnet-99',
    baseSnapshotId: 'base-old',
    baseLedgerIndex: 99,
    baseLedgerHash: B,
    overlayLedgerIndex: 105,
    overlayLedgerHash: D,
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}

function candidateFor(historyPublication: HistorySegmentChainPublication): T5CandidateRehearsalSummary {
  return {
    schemaVersion: 1,
    passed: true,
    repository: 'owner/repo',
    historyBranch: 'history-candidate',
    currentStateBranch: 'current-candidate',
    epochId: 'devnet-99',
    chainId: historyPublication.chainId,
    ledgerIndex: 110,
    ledgerHash: C,
    segmentCount: 1,
    ledgerCount: 11,
    currentStateSnapshotId: 'devnet-110-cccccccccccc',
    currentStateManifestSha256: 'f'.repeat(64),
  }
}

describe('T5 cutover preflight bundle', () => {
  it('binds rehearsed candidate identities to production rebase evidence', async () => {
    const historyPublication = await publication()
    const candidate = candidateFor(historyPublication)
    const evidence: ReplacementBaseRebaseEvidence = {
      sync: sync(),
      currentEpochId: 'devnet-99',
      overlayStates: [overlay()],
    }
    const bundle = await buildT5CutoverPreflightBundle({
      candidate,
      historyPublication,
      productionEvidence: evidence,
      historyCommitSha: 'a'.repeat(40),
      currentStateCommitSha: 'b'.repeat(40),
    })
    expect(bundle.target).toEqual({
      epochId: 'devnet-99',
      snapshotId: 'devnet-110-cccccccccccc',
      ledgerIndex: 110,
      ledgerHash: C,
    })
    expect(bundle.rebasePlan.action).toBe('rebase')
    expect(bundle.candidate.publicationSha256).toBe(historyPublication.publicationSha256)
    expect(bundle.production.cursorLedgerIndex).toBe(105)
  })

  it('rejects candidate/history identity disagreement', async () => {
    const historyPublication = await publication()
    const candidate = candidateFor(historyPublication)
    candidate.ledgerIndex = 111
    candidate.currentStateSnapshotId = 'devnet-111-cccccccccccc'
    await expect(buildT5CutoverPreflightBundle({
      candidate,
      historyPublication,
      productionEvidence: { sync: sync(), currentEpochId: 'devnet-99', overlayStates: [overlay()] },
      historyCommitSha: 'a'.repeat(40),
      currentStateCommitSha: 'b'.repeat(40),
    })).rejects.toThrow('does not match the history publication identity')
  })

  it('rejects an invalid current-state manifest digest before planning cutover', async () => {
    const historyPublication = await publication()
    const candidate = candidateFor(historyPublication)
    candidate.currentStateManifestSha256 = 'not-a-digest'
    await expect(buildT5CutoverPreflightBundle({
      candidate,
      historyPublication,
      productionEvidence: { sync: sync(), currentEpochId: 'devnet-99', overlayStates: [overlay()] },
      historyCommitSha: 'a'.repeat(40),
      currentStateCommitSha: 'b'.repeat(40),
    })).rejects.toThrow('current-state manifest digest is invalid')
  })
})
