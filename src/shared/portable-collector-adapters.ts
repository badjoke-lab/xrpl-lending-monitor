import type { PortableCollectorPhaseMessageV1 } from './portable-collector-messages'
import type { BuildNormalizedCollectorPayloadInput } from './portable-collector-payload'
import type {
  PortableLedgerCostEstimate,
  PortablePlannedScan,
  PortableScanBudget,
} from './portable-collector-planner'
import type {
  PortableCollectorWorkDefinition,
  PortableCollectorWorkSnapshot,
  PortableCommittedWatermark,
  PortableCommitChunk,
  PortableCommitChunkSnapshot,
  PortablePayloadChunk,
  PortablePayloadChunkSnapshot,
  PortableReferenceRow,
} from './portable-collector-reference-store'
import type {
  PortableSchedulerClaimResult,
  PortableSchedulerFailureClassification,
  PortableSchedulerMessageSnapshot,
  PortableSchedulerOutboxSnapshot,
} from './portable-collector-scheduler'

export interface PortableCollectorStorageAdapter {
  beginWork(definition: PortableCollectorWorkDefinition): PortableCollectorWorkSnapshot
  getWork(workId: string): PortableCollectorWorkSnapshot | undefined
  getPayloadChunk(workId: string, chunkIndex: number): PortablePayloadChunkSnapshot | undefined
  listPayloadChunks(workId: string): PortablePayloadChunkSnapshot[]
  listCommitChunks(workId: string): PortableCommitChunkSnapshot[]
  listReferenceRowsForWork(workId: string): PortableReferenceRow[]
  stagePayloadChunk(chunk: PortablePayloadChunk): void
  stageReferenceRow(row: PortableReferenceRow): void
  sealScan(options: {
    workId: string
    scannedEndLedgerIndex: number
    finalLedgerHash: string
    semanticCountsJson: string
    payloadDigest: string
    expectedPayloadChunks: number
    expectedCommitChunks: number
    updatedAt: string
  }): void
  completeCommitChunk(chunk: PortableCommitChunk): void
  finalizeWork(options: {
    workId: string
    committedAt: string
  }): PortableCommittedWatermark
  finalizeWorkInTransaction(options: {
    workId: string
    committedAt: string
  }): PortableCommittedWatermark
  getWatermark(
    network: string,
    epochId: string,
    baseIdentity: string,
  ): PortableCommittedWatermark | undefined
  listCommittedReferenceRows(): PortableReferenceRow[]
  exportState(): string
}

export interface PortableCollectorSchedulerAdapter {
  enqueue(
    message: PortableCollectorPhaseMessageV1,
    options: { availableAt: string; createdAt: string },
  ): PortableSchedulerMessageSnapshot
  getMessage(messageId: string): PortableSchedulerMessageSnapshot | undefined
  claim(
    messageId: string,
    options: { leaseOwner: string; now: string; leaseExpiresAt: string },
  ): PortableSchedulerClaimResult
  claimNext(options: {
    leaseOwner: string
    now: string
    leaseExpiresAt: string
  }): PortableSchedulerClaimResult
  completeWithSuccessor<T>(options: {
    messageId: string
    leaseOwner: string
    now: string
    result: unknown
    successor: PortableCollectorPhaseMessageV1
    successorAvailableAt: string
    mutate?: () => T
  }): { status: 'completed' | 'duplicate'; mutationResult: T | undefined }
  retry(options: {
    messageId: string
    leaseOwner: string
    now: string
    availableAt: string
    classification: PortableSchedulerFailureClassification
    errorMessage: string
  }): void
  failTerminal(options: {
    messageId: string
    leaseOwner: string
    now: string
    classification: PortableSchedulerFailureClassification
    errorMessage: string
  }): void
  getOutbox(currentMessageId: string): PortableSchedulerOutboxSnapshot | undefined
  dispatchNextOutbox(options: { now: string }): PortableSchedulerOutboxSnapshot | undefined
}

export interface PortableCollectorExecutionAdapter {
  readonly network: string
  readonly epochId: string
  readonly baseIdentity: string
  readonly immutableBaseLedgerIndex: number
  readonly immutableBaseLedgerHash: string
  readonly budget: PortableScanBudget
  readonly commitSuccessorAvailableAt: string
  readonly caughtUpSuccessorAvailableAt: string
  readonly retryAvailableAt: string

  readValidatedHeadLedgerIndex(): number
  readLedgerCostEstimates(
    startLedgerIndex: number,
    latestValidatedLedgerIndex: number,
  ): PortableLedgerCostEstimate[]
  buildPayloadInput(
    plan: PortablePlannedScan,
    previousLedgerIndex: number,
    expectedParentHash: string,
  ): BuildNormalizedCollectorPayloadInput
  afterScanStaging(): void
  afterCommitMutation(): void
}

export interface PortableCollectorFinalizeExecutionAdapter {
  readonly nextScanAvailableAt: string
  readonly retryAvailableAt: string
  afterFinalizeMutation?(): void
}

export interface PortableCollectorRuntimeAdapters {
  readonly storage: PortableCollectorStorageAdapter
  readonly scheduler: PortableCollectorSchedulerAdapter
  readonly execution: PortableCollectorExecutionAdapter
  readonly finalizeExecution: PortableCollectorFinalizeExecutionAdapter
}

export interface PortablePublicationWorkIdentityV1 {
  schemaVersion: 1
  network: string
  epochId: string
  baseIdentity: string
  workId: string
  previousLedgerIndex: number
  expectedParentHash: string
  startLedgerIndex: number
  endLedgerIndex: number
  endLedgerHash: string
  payloadDigest: string
  semanticCountsJson: string
}

export interface PortablePublicationAssetV1 {
  schemaVersion: 1
  works: Array<{
    work: PortablePublicationWorkIdentityV1
    rows: PortableReferenceRow[]
  }>
}

export interface PortablePublicationCandidateV1 {
  schemaVersion: 1
  publicationId: string
  previousPublicationId: string | null
  works: PortablePublicationWorkIdentityV1[]
  assetJson: string
  assetDigest: string
  manifestJson: string
  manifestDigest: string
  createdAt: string
}

export interface PortableVerifiedPublicationV1 extends PortablePublicationCandidateV1 {
  verifiedAt: string
}

export interface PortablePublicationWatermarkV1 {
  schemaVersion: 1
  streamId: string
  publicationId: string
  workId: string
  ledgerIndex: number
  ledgerHash: string
  updatedAt: string
}

export interface PortableCollectorPublicationAdapter {
  getPublicationWatermark(): PortablePublicationWatermarkV1 | undefined
  selectCommittedAfter(options: {
    publicationWatermarkWorkId: string | null
    limit: number
  }): PortablePublicationWorkIdentityV1[]
  buildCandidate(
    works: readonly PortablePublicationWorkIdentityV1[],
  ): Promise<PortablePublicationCandidateV1>
  getCandidate(publicationId: string): PortablePublicationCandidateV1 | undefined
  verifyCandidate(
    candidate: PortablePublicationCandidateV1,
  ): Promise<PortableVerifiedPublicationV1>
  advancePublicationWatermark(
    publication: PortableVerifiedPublicationV1,
  ): PortablePublicationWatermarkV1
}

export interface PortableMaintenanceMutationV1 {
  table: 'collector_payload_chunks' | 'collector_commit_chunks'
  workId: string
  reason: 'verified_publication_retention'
}

export interface PortableMaintenancePlanV1 {
  schemaVersion: 1
  planId: string
  verifiedPublicationId: string
  planJson: string
  planDigest: string
  mutations: PortableMaintenanceMutationV1[]
  createdAt: string
}

export interface PortableCollectorMaintenanceAdapter {
  getPlan(planId: string): PortableMaintenancePlanV1 | undefined
  buildPlan(options: {
    verifiedPublication: PortableVerifiedPublicationV1
    retainCommittedWorks: number
    maxMutations: number
  }): PortableMaintenancePlanV1
  applyPlan(plan: PortableMaintenancePlanV1): { appliedMutations: number }
}
