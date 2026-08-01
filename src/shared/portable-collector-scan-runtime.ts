import {
  buildCommitPhaseMessage,
  buildScanPhaseMessage,
  type ScanPhaseMessageV1,
} from './portable-collector-messages'
import {
  buildNormalizedCollectorPayload,
  buildNormalizedPayloadChunks,
  PortablePayloadResourceHaltError,
  PortablePayloadValidationError,
} from './portable-collector-payload'
import {
  planPortableCollectorScan,
  type PortableBlockedScan,
} from './portable-collector-planner'
import {
  canonicalPortableJson,
  PortableCollectorReferenceStore,
} from './portable-collector-reference-store'
import {
  PortableCollectorScheduler,
  PortableSchedulerLeaseLostError,
  type PortableSchedulerFailureClassification,
} from './portable-collector-scheduler'
import {
  FixtureExecutionAdapter,
  PortableFixtureExecutionError,
} from './portable-collector-fixture-execution'

export type PortableScanRuntimeResult =
  | {
      status: 'completed' | 'duplicate'
      messageId: string
      result: Record<string, unknown>
      successorMessageId: string
    }
  | {
      status: 'retry_scheduled'
      messageId: string
      classification: 'retryable_transport' | 'retryable_storage'
      availableAt: string
    }
  | {
      status: 'halted'
      messageId: string
      classification: Exclude<
        PortableSchedulerFailureClassification,
        'retryable_transport' | 'retryable_storage' | 'lease_lost'
      >
      errorMessage: string
    }
  | {
      status: 'unavailable'
      messageId: string
      reason: 'not_found' | 'not_ready' | 'fresh_lease'
    }
  | {
      status: 'lease_lost'
      messageId: string
    }

export interface PortableScanRuntimeExecutionOptions {
  leaseOwner: string
  now: string
  leaseExpiresAt: string
}

class PortableScanTerminalError extends Error {
  constructor(
    readonly classification: Exclude<
      PortableSchedulerFailureClassification,
      'retryable_transport' | 'retryable_storage' | 'lease_lost'
    >,
    message: string,
  ) {
    super(message)
    this.name = 'PortableScanTerminalError'
  }
}

function canonicalHash(value: string): string {
  return value.trim().toUpperCase()
}

function parseRetainedResult(resultJson: string | null): Record<string, unknown> {
  if (resultJson === null) return {}
  const parsed = JSON.parse(resultJson) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { value: parsed }
  return parsed as Record<string, unknown>
}

function blockedMessage(plan: PortableBlockedScan): string {
  return `ledger ${plan.ledgerIndex} exceeds scan budgets: ${plan.exceededBudgets.join(',')}`
}

export class PortableCollectorScanRuntime {
  constructor(
    private readonly store: PortableCollectorReferenceStore,
    private readonly scheduler: PortableCollectorScheduler,
    private readonly execution: FixtureExecutionAdapter,
  ) {}

  async execute(
    messageId: string,
    options: PortableScanRuntimeExecutionOptions,
  ): Promise<PortableScanRuntimeResult> {
    const claim = this.scheduler.claim(messageId, options)
    if (claim.status === 'unavailable') {
      return { status: 'unavailable', messageId, reason: claim.reason }
    }
    if (claim.status === 'completed') {
      return {
        status: 'duplicate',
        messageId,
        result: parseRetainedResult(claim.snapshot.resultJson),
        successorMessageId: claim.snapshot.successorMessageId ?? '',
      }
    }
    if (claim.status === 'error') {
      return {
        status: 'halted',
        messageId,
        classification: claim.snapshot.errorClassification ?? 'terminal_internal',
        errorMessage: claim.snapshot.errorMessage ?? 'scheduler message is halted',
      }
    }

    const message = claim.message
    if (message.phase !== 'scan') {
      return this.failTerminal(
        messageId,
        options,
        'invalid_message',
        `scan runtime received ${message.phase} message`,
      )
    }

    try {
      this.assertBoundary(message)
      const latestValidatedLedgerIndex = this.execution.readValidatedHeadLedgerIndex()
      if (latestValidatedLedgerIndex < message.expectedPreviousLedgerIndex) {
        throw new PortableScanTerminalError(
          'reset_detected',
          `validated head ${latestValidatedLedgerIndex} precedes boundary ${message.expectedPreviousLedgerIndex}`,
        )
      }

      const estimates = this.execution.readLedgerCostEstimates(
        message.expectedPreviousLedgerIndex + 1,
        latestValidatedLedgerIndex,
      )
      const plan = planPortableCollectorScan({
        network: message.network,
        epochId: message.epochId,
        baseIdentity: message.baseIdentity,
        previousLedgerIndex: message.expectedPreviousLedgerIndex,
        expectedParentHash: message.expectedPreviousLedgerHash,
        latestValidatedLedgerIndex,
        budget: this.execution.budget,
        estimates,
      })

      if (plan.status === 'caught_up') {
        const successor = buildScanPhaseMessage({
          network: message.network,
          epochId: message.epochId,
          baseIdentity: message.baseIdentity,
          expectedPreviousLedgerIndex: message.expectedPreviousLedgerIndex,
          expectedPreviousLedgerHash: message.expectedPreviousLedgerHash,
          scanSequence: message.scanSequence + 1,
        })
        const result = {
          status: 'caught_up',
          ledgerIndex: plan.ledgerIndex,
          scanSequence: message.scanSequence,
          successorScanSequence: successor.scanSequence,
        }
        const completion = this.scheduler.completeWithSuccessor({
          messageId,
          leaseOwner: options.leaseOwner,
          now: options.now,
          result,
          successor,
          successorAvailableAt: this.execution.caughtUpSuccessorAvailableAt,
        })
        return {
          status: completion.status,
          messageId,
          result,
          successorMessageId: successor.messageId,
        }
      }

      if (plan.status === 'blocked') {
        return this.failTerminal(
          messageId,
          options,
          'resource_halt',
          blockedMessage(plan),
        )
      }

      const payload = await buildNormalizedCollectorPayload(
        this.execution.buildPayloadInput(
          plan,
          message.expectedPreviousLedgerIndex,
          message.expectedPreviousLedgerHash,
        ),
      )
      const chunks = await buildNormalizedPayloadChunks(payload)
      const successor = buildCommitPhaseMessage({ workId: plan.workId, chunkIndex: 0 })
      const result = {
        status: 'staged',
        workId: plan.workId,
        startLedgerIndex: plan.startLedgerIndex,
        endLedgerIndex: plan.endLedgerIndex,
        payloadDigest: payload.digest,
        payloadChunks: chunks.length,
        semanticCounts: payload.semanticCounts,
      }

      const completion = this.scheduler.completeWithSuccessor({
        messageId,
        leaseOwner: options.leaseOwner,
        now: options.now,
        result,
        successor,
        successorAvailableAt: this.execution.commitSuccessorAvailableAt,
        mutate: () => {
          this.store.beginWork({
            workId: plan.workId,
            network: message.network,
            epochId: message.epochId,
            baseIdentity: message.baseIdentity,
            previousLedgerIndex: message.expectedPreviousLedgerIndex,
            expectedParentHash: message.expectedPreviousLedgerHash,
            plannedEndLedgerIndex: plan.endLedgerIndex,
            planJson: plan.planJson,
            createdAt: options.now,
          })
          for (const built of chunks) {
            this.store.stagePayloadChunk({
              workId: plan.workId,
              chunkIndex: built.chunk.chunkIndex,
              encoding: 'normalized-payload-chunk-json-v1',
              payload: built.encoded,
              payloadDigest: built.chunk.chunkDigest,
              recordCount: built.chunk.records.length,
              createdAt: options.now,
            })
          }
          this.store.sealScan({
            workId: plan.workId,
            scannedEndLedgerIndex: plan.endLedgerIndex,
            finalLedgerHash: payload.finalLedgerHash,
            semanticCountsJson: canonicalPortableJson(payload.semanticCounts),
            payloadDigest: payload.digest,
            expectedPayloadChunks: chunks.length,
            expectedCommitChunks: chunks.length,
            updatedAt: options.now,
          })
          this.execution.afterScanStaging()
        },
      })

      return {
        status: completion.status,
        messageId,
        result,
        successorMessageId: successor.messageId,
      }
    } catch (error) {
      return this.handleFailure(message, options, error)
    }
  }

  private assertBoundary(message: ScanPhaseMessageV1): void {
    if (message.network !== this.execution.network) {
      throw new PortableScanTerminalError(
        'base_mismatch',
        `network mismatch: expected ${this.execution.network}, received ${message.network}`,
      )
    }
    if (message.epochId !== this.execution.epochId) {
      throw new PortableScanTerminalError(
        'epoch_mismatch',
        `epoch mismatch: expected ${this.execution.epochId}, received ${message.epochId}`,
      )
    }
    if (message.baseIdentity !== this.execution.baseIdentity) {
      throw new PortableScanTerminalError(
        'base_mismatch',
        `base mismatch: expected ${this.execution.baseIdentity}, received ${message.baseIdentity}`,
      )
    }

    const watermark = this.store.getWatermark(
      this.execution.network,
      this.execution.epochId,
      this.execution.baseIdentity,
    )
    const expectedLedgerIndex = watermark?.ledgerIndex ?? this.execution.immutableBaseLedgerIndex
    const expectedLedgerHash = watermark?.ledgerHash ?? this.execution.immutableBaseLedgerHash

    if (message.expectedPreviousLedgerIndex !== expectedLedgerIndex) {
      throw new PortableScanTerminalError(
        'stale_boundary',
        `scan boundary index mismatch: expected ${expectedLedgerIndex}, received ${message.expectedPreviousLedgerIndex}`,
      )
    }
    if (canonicalHash(message.expectedPreviousLedgerHash) !== canonicalHash(expectedLedgerHash)) {
      throw new PortableScanTerminalError(
        'parent_hash_mismatch',
        `scan boundary hash mismatch at ${expectedLedgerIndex}`,
      )
    }
  }

  private handleFailure(
    message: ScanPhaseMessageV1,
    options: PortableScanRuntimeExecutionOptions,
    error: unknown,
  ): PortableScanRuntimeResult {
    if (error instanceof PortableSchedulerLeaseLostError) {
      return { status: 'lease_lost', messageId: message.messageId }
    }

    let classification: PortableSchedulerFailureClassification
    let errorMessage: string
    if (error instanceof PortableFixtureExecutionError) {
      classification = error.classification
      errorMessage = error.message
    } else if (error instanceof PortableScanTerminalError) {
      classification = error.classification
      errorMessage = error.message
    } else if (error instanceof PortablePayloadResourceHaltError) {
      classification = 'resource_halt'
      errorMessage = error.message
    } else if (error instanceof PortablePayloadValidationError) {
      classification = 'digest_mismatch'
      errorMessage = error.message
    } else {
      classification = 'terminal_internal'
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    if (classification === 'retryable_transport' || classification === 'retryable_storage') {
      try {
        this.scheduler.retry({
          messageId: message.messageId,
          leaseOwner: options.leaseOwner,
          now: options.now,
          availableAt: this.execution.retryAvailableAt,
          classification,
          errorMessage,
        })
      } catch (retryError) {
        if (retryError instanceof PortableSchedulerLeaseLostError) {
          return { status: 'lease_lost', messageId: message.messageId }
        }
        throw retryError
      }
      return {
        status: 'retry_scheduled',
        messageId: message.messageId,
        classification,
        availableAt: this.execution.retryAvailableAt,
      }
    }

    return this.failTerminal(
      message.messageId,
      options,
      classification === 'lease_lost' ? 'terminal_internal' : classification,
      errorMessage,
    )
  }

  private failTerminal(
    messageId: string,
    options: PortableScanRuntimeExecutionOptions,
    classification: Exclude<
      PortableSchedulerFailureClassification,
      'retryable_transport' | 'retryable_storage' | 'lease_lost'
    >,
    errorMessage: string,
  ): PortableScanRuntimeResult {
    try {
      this.scheduler.failTerminal({
        messageId,
        leaseOwner: options.leaseOwner,
        now: options.now,
        classification,
        errorMessage,
      })
    } catch (error) {
      if (error instanceof PortableSchedulerLeaseLostError) {
        return { status: 'lease_lost', messageId }
      }
      throw error
    }
    return { status: 'halted', messageId, classification, errorMessage }
  }
}
