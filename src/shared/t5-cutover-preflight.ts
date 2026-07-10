import type { CatchUpBaseIdentity } from './catch-up-base-identity'
import {
  assertHistorySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from './history-segments/publication'
import {
  planReplacementBaseRebase,
  type ReplacementBaseRebaseEvidence,
  type ReplacementBaseRebasePlan,
} from '../worker/operator/replacement-base-rebase-plan'

const COMMIT_SHA = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/
const LEDGER_HASH = /^[A-F0-9]{64}$/

export interface T5CandidateRehearsalSummary {
  schemaVersion: 1
  passed: boolean
  repository: string
  historyBranch: string
  currentStateBranch: string
  epochId: string
  chainId: string
  ledgerIndex: number
  ledgerHash: string
  segmentCount: number
  ledgerCount: number
  currentStateSnapshotId: string
  currentStateManifestSha256: string
}

export interface T5CutoverPreflightBundle {
  schemaVersion: 1
  candidate: {
    repository: string
    historyBranch: string
    historyCommitSha: string
    currentStateBranch: string
    currentStateCommitSha: string
    epochId: string
    chainId: string
    publicationSha256: string
    currentStateSnapshotId: string
    currentStateManifestSha256: string
    ledgerIndex: number
    ledgerHash: string
    segmentCount: number
    ledgerCount: number
  }
  production: {
    cursorLedgerIndex: number
    cursorLedgerHash: string
    latestObservedLedger: number
    latestObservedHash: string
    overlayStateCount: number
  }
  target: CatchUpBaseIdentity
  rebasePlan: ReplacementBaseRebasePlan
}

function assertCommitSha(value: string, field: string): void {
  if (!COMMIT_SHA.test(value)) throw new Error(`${field} is not a full commit SHA`)
}

function assertCandidateShape(candidate: T5CandidateRehearsalSummary): void {
  if (candidate.schemaVersion !== 1) throw new Error('T5 candidate rehearsal schema is unsupported')
  if (!candidate.repository || !candidate.historyBranch || !candidate.currentStateBranch) {
    throw new Error('T5 candidate source identity is incomplete')
  }
  if (!candidate.epochId || !candidate.chainId || !candidate.currentStateSnapshotId) {
    throw new Error('T5 candidate target identity is incomplete')
  }
  if (!Number.isSafeInteger(candidate.ledgerIndex) || candidate.ledgerIndex < 1) {
    throw new Error('T5 candidate ledger index is invalid')
  }
  if (!LEDGER_HASH.test(candidate.ledgerHash)) throw new Error('T5 candidate ledger hash is invalid')
  if (!Number.isSafeInteger(candidate.segmentCount) || candidate.segmentCount < 1) {
    throw new Error('T5 candidate segment count is invalid')
  }
  if (!Number.isSafeInteger(candidate.ledgerCount) || candidate.ledgerCount < 1) {
    throw new Error('T5 candidate ledger count is invalid')
  }
  if (!SHA256.test(candidate.currentStateManifestSha256)) {
    throw new Error('T5 candidate current-state manifest digest is invalid')
  }
}

export async function buildT5CutoverPreflightBundle(options: {
  candidate: T5CandidateRehearsalSummary
  historyPublication: HistorySegmentChainPublication
  productionEvidence: ReplacementBaseRebaseEvidence
  historyCommitSha: string
  currentStateCommitSha: string
}): Promise<T5CutoverPreflightBundle> {
  const { candidate, historyPublication, productionEvidence } = options
  if (!candidate.passed) throw new Error('T5 candidate rehearsal did not pass')
  assertCandidateShape(candidate)
  assertCommitSha(options.historyCommitSha, 'historyCommitSha')
  assertCommitSha(options.currentStateCommitSha, 'currentStateCommitSha')
  await assertHistorySegmentPublicationDigest(historyPublication)

  if (
    candidate.epochId !== historyPublication.epochId
    || candidate.chainId !== historyPublication.chainId
    || candidate.ledgerIndex !== historyPublication.endLedgerIndex
    || candidate.ledgerHash !== historyPublication.endLedgerHash
    || candidate.segmentCount !== historyPublication.segmentCount
    || candidate.ledgerCount !== historyPublication.ledgerCount
  ) throw new Error('T5 candidate rehearsal does not match the history publication identity')

  const target: CatchUpBaseIdentity = {
    epochId: candidate.epochId,
    snapshotId: candidate.currentStateSnapshotId,
    ledgerIndex: candidate.ledgerIndex,
    ledgerHash: candidate.ledgerHash,
  }
  const rebasePlan = planReplacementBaseRebase({ target, evidence: productionEvidence })
  const sync = productionEvidence.sync
  if (
    sync === null
    || sync.lastProcessedLedger === null
    || sync.lastProcessedHash === null
    || sync.latestObservedLedger === null
    || sync.latestObservedHash === null
  ) {
    throw new Error('T5 production sync evidence is incomplete')
  }

  return {
    schemaVersion: 1,
    candidate: {
      repository: candidate.repository,
      historyBranch: candidate.historyBranch,
      historyCommitSha: options.historyCommitSha,
      currentStateBranch: candidate.currentStateBranch,
      currentStateCommitSha: options.currentStateCommitSha,
      epochId: candidate.epochId,
      chainId: candidate.chainId,
      publicationSha256: historyPublication.publicationSha256,
      currentStateSnapshotId: candidate.currentStateSnapshotId,
      currentStateManifestSha256: candidate.currentStateManifestSha256,
      ledgerIndex: candidate.ledgerIndex,
      ledgerHash: candidate.ledgerHash,
      segmentCount: candidate.segmentCount,
      ledgerCount: candidate.ledgerCount,
    },
    production: {
      cursorLedgerIndex: sync.lastProcessedLedger,
      cursorLedgerHash: sync.lastProcessedHash,
      latestObservedLedger: sync.latestObservedLedger,
      latestObservedHash: sync.latestObservedHash,
      overlayStateCount: productionEvidence.overlayStates.length,
    },
    target,
    rebasePlan,
  }
}
