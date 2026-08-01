import {
  buildCommitPhaseMessage,
  buildFinalizePhaseMessage,
  type CommitPhaseMessageV1,
} from './portable-collector-messages'
import {
  decodeAndVerifyNormalizedPayloadChunk,
  PortablePayloadValidationError,
  type NormalizedCandidateV1,
  type NormalizedSemanticClassV1,
} from './portable-collector-payload'
import {
  canonicalPortableJson,
  PortableCollectorReferenceStore,
  type PortableCollectorWorkSnapshot,
  type PortableCommitChunkSnapshot,
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

const COMMIT_RECORD_LIMIT = 40
const COMMIT_OPERATION_LIMIT = 40
const EXPECTED_CHUNK_ENCODING = 'normalized-payload-chunk-json-v1'

const SEMANTIC_CLASS_ORDER: Record<NormalizedSemanticClassV1, number> = {
  'validated-ledger': 0,
  'protocol-event': 1,
  'object-change': 2,
  'loan-lifecycle': 3,
  'archived-object': 4,
  'balance-history': 5,
  'current-projection': 6,
}

type PortableTerminalFailureClassification = Exclude<
  PortableSchedulerFailureClassification,
  'retryable_transport' | 'retryable_storage' | 'lease_lost'
>

export type PortableCommitRuntimeResult =
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
      classification: PortableTerminalFailureClassification
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

export interface PortableCommitRuntimeExecutionOptions {
  leaseOwner: string
  now: string
  leaseExpiresAt: string
}

class PortableCommitTerminalError extends Error {
  constructor(
    readonly classification: PortableTerminalFailureClassification,
    message: string,
  ) {
    super(message)
    this.name = 'PortableCommitTerminalError'
  }
}

function terminalClassification(
  classification: PortableSchedulerFailureClassification | null,
): PortableTerminalFailureClassification {
  if (
    classification === null ||
    classification === 'retryable_transport' ||
    classification === 'retryable_storage' ||
    classification === 'lease_lost'
  ) {
    return 'terminal_internal'
  }
  return classification
}

function parseRetainedResult(resultJson: string | null): Record<string, unknown> {
  if (resultJson === null) return {}
  const parsed = JSON.parse(resultJson) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { value: parsed }
  return parsed as Record<string, unknown>
}

function compareCandidates(left: NormalizedCandidateV1, right: NormalizedCandidateV1): number {
  return (
    left.sourceLedgerIndex - right.sourceLedgerIndex ||
    SEMANTIC_CLASS_ORDER[left.semanticClass] - SEMANTIC_CLASS_ORDER[right.semanticClass] ||
    left.canonicalKey.localeCompare(right.canonicalKey) ||
    (left.sourceTransactionHash ?? '').localeCompare(right.sourceTransactionHash ?? '')
  )
}

function assertCanonicalOrder(records: readonly NormalizedCandidateV1[]): void {
  for (let index = 1; index < records.length; index += 1) {
    if (compareCandidates(records[index - 1]!, records[index]!) > 0) {
      throw new PortableCommitTerminalError(
        'digest_mismatch',
        `commit chunk record order is not canonical at offset ${index}`,
      )
    }
  }
}

function assertUniqueChunkIdentities(records: readonly NormalizedCandidateV1[]): void {
  const identities = new Set<string>()
  for (const record of records) {
    const identity = `${record.semanticClass}\u0000${record.canonicalKey}`
    if (identities.has(identity)) {
      throw new PortableCommitTerminalError(
        'digest_mismatch',
        `duplicate commit candidate identity: ${record.semanticClass}/${record.canonicalKey}`,
      )
    }
    identities.add(identity)
  }
}

function validateWorkForCommit(
  message: CommitPhaseMessageV1,
  work: PortableCollectorWorkSnapshot | undefined,
): PortableCollectorWorkSnapshot {
  if (!work) {
    throw new PortableCommitTerminalError('invalid_message', `collector work not found: ${message.workId}`)
  }
  if (!['staged', 'committing'].includes(work.status)) {
    throw new PortableCommitTerminalError(
      'invalid_message',
      `collector work cannot commit from status ${work.status}`,
    )
  }
  if (work.payloadDigest === null || work.scannedEndLedgerIndex === null) {
    throw new PortableCommitTerminalError(
      'digest_mismatch',
      `collector work is missing sealed scan evidence: ${work.workId}`,
    )
  }
  if (
    work.expectedPayloadChunks < 1 ||
    work.expectedCommitChunks !== work.expectedPayloadChunks
  ) {
    throw new PortableCommitTerminalError(
      'digest_mismatch',
      `collector work chunk counts are inconsistent: ${work.workId}`,
    )
  }
  if (message.chunkIndex >= work.expectedPayloadChunks) {
    throw new PortableCommitTerminalError(
      'invalid_message',
      `commit chunk index ${message.chunkIndex} is outside work ${work.workId}`,
    )
  }
  return work
}

function existingChunk(
  chunks: readonly PortableCommitChunkSnapshot[],
  chunkIndex: number,
): PortableCommitChunkSnapshot | undefined {
  return chunks.find((chunk) => chunk.chunkIndex === chunkIndex)
}

function firstMissingChunk(
  chunks: readonly PortableCommitChunkSnapshot[],
  totalChunks: number,
): number | undefined {
  const completed = new Set(chunks.map((chunk) => chunk.chunkIndex))
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    if (!completed.has(chunkIndex)) return chunkIndex
  }
  return undefined
}

export class PortableCollectorCommitRuntime {
  constructor(
    private readonly store: PortableCollectorReferenceStore,
    private readonly scheduler: PortableCollectorScheduler,
    private readonly execution: FixtureExecutionAdapter,
  ) {}

  async execute(
    messageId: string,
    options: PortableCommitRuntimeExecutionOptions,
  ): Promise<PortableCommitRuntimeResult> {
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
        classification: terminalClassification(claim.snapshot.errorClassification),
        errorMessage: claim.snapshot.errorMessage ?? 'scheduler message is halted',
      }
    }

    const message = claim.message
    if (message.phase !== 'commit') {
      return this.failTerminal(
        messageId,
        options,
        'invalid_message',
        `commit runtime received ${message.phase} message`,
      )
    }

    try {
      const work = validateWorkForCommit(message, this.store.getWork(message.workId))
      const payloadChunk = this.store.getPayloadChunk(message.workId, message.chunkIndex)
      if (!payloadChunk) {
        throw new PortableCommitTerminalError(
          'digest_mismatch',
          `payload chunk not found: ${message.workId}/${message.chunkIndex}`,
        )
      }
      if (payloadChunk.encoding !== EXPECTED_CHUNK_ENCODING) {
        throw new PortableCommitTerminalError(
          'digest_mismatch',
          `payload chunk encoding mismatch: ${payloadChunk.encoding}`,
        )
      }
      if (payloadChunk.byteCount !== payloadChunk.payload.byteLength) {
        throw new PortableCommitTerminalError(
          'digest_mismatch',
          `payload chunk byte count mismatch: ${message.workId}/${message.chunkIndex}`,
        )
      }

      const decoded = await decodeAndVerifyNormalizedPayloadChunk(
        payloadChunk.payload,
        work.payloadDigest ?? undefined,
      )
      if (decoded.workId !== work.workId || decoded.chunkIndex !== message.chunkIndex) {
        throw new PortableCommitTerminalError(
          'digest_mismatch',
          `decoded payload chunk identity mismatch: ${message.workId}/${message.chunkIndex}`,
        )
      }
      if (
        decoded.totalChunks !== work.expectedPayloadChunks ||
        decoded.totalChunks !== work.expectedCommitChunks
      ) {
        throw new PortableCommitTerminalError(
          'digest_mismatch',
          `decoded payload chunk total mismatch: ${decoded.totalChunks}`,
        )
      }
      if (decoded.chunkDigest !== payloadChunk.payloadDigest) {
        throw new PortableCommitTerminalError(
          'digest_mismatch',
          `stored payload chunk digest mismatch: ${message.workId}/${message.chunkIndex}`,
        )
      }
      if (decoded.records.length !== payloadChunk.recordCount) {
        throw new PortableCommitTerminalError(
          'digest_mismatch',
          `stored payload chunk record count mismatch: ${message.workId}/${message.chunkIndex}`,
        )
      }
      if (decoded.records.length > COMMIT_RECORD_LIMIT) {
        throw new PortableCommitTerminalError(
          'resource_halt',
          `commit chunk contains ${decoded.records.length} records; limit is ${COMMIT_RECORD_LIMIT}`,
        )
      }
      if (decoded.records.length > COMMIT_OPERATION_LIMIT) {
        throw new PortableCommitTerminalError(
          'resource_halt',
          `commit chunk requires ${decoded.records.length} operations; limit is ${COMMIT_OPERATION_LIMIT}`,
        )
      }
      for (const record of decoded.records) {
        if (
          record.sourceLedgerIndex < work.startLedgerIndex ||
          record.sourceLedgerIndex > (work.scannedEndLedgerIndex ?? -1)
        ) {
          throw new PortableCommitTerminalError(
            'digest_mismatch',
            `commit candidate ledger ${record.sourceLedgerIndex} is outside work ${work.startLedgerIndex}-${work.scannedEndLedgerIndex}`,
          )
        }
      }
      assertCanonicalOrder(decoded.records)
      assertUniqueChunkIdentities(decoded.records)

      const commitChunks = this.store.listCommitChunks(work.workId)
      const completed = existingChunk(commitChunks, message.chunkIndex)
      const firstMissing = firstMissingChunk(commitChunks, work.expectedCommitChunks)
      if (!completed && firstMissing !== message.chunkIndex) {
        throw new PortableCommitTerminalError(
          'invalid_message',
          `commit chunk ${message.chunkIndex} is not the next unresolved chunk ${String(firstMissing)}`,
        )
      }
      if (
        completed &&
        (completed.chunkDigest !== decoded.chunkDigest ||
          completed.rowMutationCount !== decoded.records.length ||
          completed.operationCount !== decoded.records.length)
      ) {
        throw new PortableCommitTerminalError(
          'digest_mismatch',
          `completed commit chunk evidence mismatch: ${work.workId}/${message.chunkIndex}`,
        )
      }

      const successor =
        message.chunkIndex + 1 < decoded.totalChunks
          ? buildCommitPhaseMessage({
              workId: work.workId,
              chunkIndex: message.chunkIndex + 1,
            })
          : buildFinalizePhaseMessage({ workId: work.workId })
      const result = {
        status: 'committed_chunk',
        workId: work.workId,
        chunkIndex: message.chunkIndex,
        totalChunks: decoded.totalChunks,
        rowMutationCount: decoded.records.length,
        operationCount: decoded.records.length,
        chunkDigest: decoded.chunkDigest,
        successorPhase: successor.phase,
      }

      const completion = this.scheduler.completeWithSuccessor({
        messageId,
        leaseOwner: options.leaseOwner,
        now: options.now,
        result,
        successor,
        successorAvailableAt: this.execution.commitSuccessorAvailableAt,
        mutate: completed
          ? undefined
          : () => {
              for (const record of decoded.records) {
                this.store.stageReferenceRow({
                  workId: work.workId,
                  semanticClass: record.semanticClass,
                  canonicalKey: record.canonicalKey,
                  sourceLedgerIndex: record.sourceLedgerIndex,
                  sourceLedgerHash: record.sourceLedgerHash,
                  valueJson: record.value === null ? null : canonicalPortableJson(record.value),
                  isTombstone: record.isTombstone,
                  createdAt: options.now,
                })
              }
              this.store.completeCommitChunk({
                workId: work.workId,
                chunkIndex: message.chunkIndex,
                operationCount: decoded.records.length,
                rowMutationCount: decoded.records.length,
                chunkDigest: decoded.chunkDigest,
                completedAt: options.now,
              })
              this.execution.afterCommitMutation()
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

  private handleFailure(
    message: CommitPhaseMessageV1,
    options: PortableCommitRuntimeExecutionOptions,
    error: unknown,
  ): PortableCommitRuntimeResult {
    if (error instanceof PortableSchedulerLeaseLostError) {
      return { status: 'lease_lost', messageId: message.messageId }
    }

    let classification: PortableSchedulerFailureClassification
    let errorMessage: string
    if (error instanceof PortableFixtureExecutionError) {
      classification = error.classification
      errorMessage = error.message
    } else if (error instanceof PortableCommitTerminalError) {
      classification = error.classification
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
      terminalClassification(classification),
      errorMessage,
    )
  }

  private failTerminal(
    messageId: string,
    options: PortableCommitRuntimeExecutionOptions,
    classification: PortableTerminalFailureClassification,
    errorMessage: string,
  ): PortableCommitRuntimeResult {
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
