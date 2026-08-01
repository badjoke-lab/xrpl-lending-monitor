import {
  buildScanPhaseMessage,
  type FinalizePhaseMessageV1,
} from './portable-collector-messages'
import {
  buildNormalizedCollectorPayload,
  decodeAndVerifyNormalizedPayloadChunk,
  PortablePayloadValidationError,
  type NormalizedCandidateV1,
  type NormalizedCollectorPayloadV1,
} from './portable-collector-payload'
import {
  canonicalPortableJson,
  PortableCollectorReferenceStore,
  type PortableCollectorWorkSnapshot,
  type PortableReferenceRow,
} from './portable-collector-reference-store'
import {
  PortableCollectorScheduler,
  PortableSchedulerLeaseLostError,
  type PortableSchedulerFailureClassification,
} from './portable-collector-scheduler'

const EXPECTED_CHUNK_ENCODING = 'normalized-payload-chunk-json-v1'

type PortableTerminalFailureClassification = Exclude<
  PortableSchedulerFailureClassification,
  'retryable_transport' | 'retryable_storage' | 'lease_lost'
>

export interface PortableFinalizeExecutionAdapter {
  nextScanAvailableAt: string
  retryAvailableAt: string
  afterFinalizeMutation?(): void
}

export class PortableFinalizeExecutionError extends Error {
  constructor(
    readonly classification: 'retryable_transport' | 'retryable_storage' | 'terminal_internal',
    message: string,
  ) {
    super(message)
    this.name = 'PortableFinalizeExecutionError'
  }
}

export type PortableFinalizeRuntimeResult =
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

export interface PortableFinalizeRuntimeExecutionOptions {
  leaseOwner: string
  now: string
  leaseExpiresAt: string
}

class PortableFinalizeTerminalError extends Error {
  constructor(
    readonly classification: PortableTerminalFailureClassification,
    message: string,
  ) {
    super(message)
    this.name = 'PortableFinalizeTerminalError'
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

function requireFinalizeWork(
  message: FinalizePhaseMessageV1,
  work: PortableCollectorWorkSnapshot | undefined,
): PortableCollectorWorkSnapshot {
  if (!work) {
    throw new PortableFinalizeTerminalError(
      'invalid_message',
      `collector work not found: ${message.workId}`,
    )
  }
  if (!['staged', 'committing', 'finalizing'].includes(work.status)) {
    throw new PortableFinalizeTerminalError(
      'invalid_message',
      `collector work cannot finalize from status ${work.status}`,
    )
  }
  if (
    work.scannedEndLedgerIndex === null ||
    work.finalLedgerHash === null ||
    work.semanticCountsJson === null ||
    work.payloadDigest === null
  ) {
    throw new PortableFinalizeTerminalError(
      'digest_mismatch',
      `collector work is missing sealed scan evidence: ${work.workId}`,
    )
  }
  if (
    work.expectedPayloadChunks < 1 ||
    work.expectedCommitChunks !== work.expectedPayloadChunks
  ) {
    throw new PortableFinalizeTerminalError(
      'digest_mismatch',
      `collector work chunk counts are inconsistent: ${work.workId}`,
    )
  }
  return work
}

function groupCandidates(records: readonly NormalizedCandidateV1[]) {
  return {
    ledgers: records.filter((record) => record.semanticClass === 'validated-ledger'),
    protocolEvents: records.filter((record) => record.semanticClass === 'protocol-event'),
    objectChanges: records.filter((record) => record.semanticClass === 'object-change'),
    loanLifecycleEvents: records.filter((record) => record.semanticClass === 'loan-lifecycle'),
    archivedObjects: records.filter((record) => record.semanticClass === 'archived-object'),
    balanceHistory: records.filter((record) => record.semanticClass === 'balance-history'),
    currentProjectionMutations: records.filter(
      (record) => record.semanticClass === 'current-projection',
    ),
  }
}

function candidateIdentity(record: Pick<NormalizedCandidateV1, 'semanticClass' | 'canonicalKey'>): string {
  return `${record.semanticClass}\u0000${record.canonicalKey}`
}

function expectedReferenceRow(record: NormalizedCandidateV1): Omit<PortableReferenceRow, 'createdAt'> {
  return {
    workId: '',
    semanticClass: record.semanticClass,
    canonicalKey: record.canonicalKey,
    sourceLedgerIndex: record.sourceLedgerIndex,
    sourceLedgerHash: record.sourceLedgerHash,
    sourceTransactionHash: record.sourceTransactionHash,
    objectId: record.objectId,
    relationshipIds: record.relationshipIds,
    valueJson: record.value === null ? null : canonicalPortableJson(record.value),
    isTombstone: record.isTombstone,
  }
}

function assertCandidateRows(
  workId: string,
  records: readonly NormalizedCandidateV1[],
  rows: readonly PortableReferenceRow[],
): void {
  if (rows.length !== records.length) {
    throw new PortableFinalizeTerminalError(
      'digest_mismatch',
      `candidate row count mismatch: expected ${records.length}, received ${rows.length}`,
    )
  }

  const actual = new Map(rows.map((row) => [candidateIdentity(row), row]))
  if (actual.size !== rows.length) {
    throw new PortableFinalizeTerminalError('digest_mismatch', 'duplicate durable candidate identity')
  }

  for (const record of records) {
    const identity = candidateIdentity(record)
    const row = actual.get(identity)
    if (!row) {
      throw new PortableFinalizeTerminalError(
        'digest_mismatch',
        `durable candidate missing: ${record.semanticClass}/${record.canonicalKey}`,
      )
    }
    const expected = { ...expectedReferenceRow(record), workId }
    const comparable = {
      workId: row.workId,
      semanticClass: row.semanticClass,
      canonicalKey: row.canonicalKey,
      sourceLedgerIndex: row.sourceLedgerIndex,
      sourceLedgerHash: row.sourceLedgerHash,
      sourceTransactionHash: row.sourceTransactionHash,
      objectId: row.objectId,
      relationshipIds: row.relationshipIds,
      valueJson: row.valueJson,
      isTombstone: row.isTombstone,
    }
    if (canonicalPortableJson(comparable) !== canonicalPortableJson(expected)) {
      throw new PortableFinalizeTerminalError(
        'digest_mismatch',
        `durable candidate identity mismatch: ${record.semanticClass}/${record.canonicalKey}`,
      )
    }
  }
}

function assertCommitEvidence(
  chunks: readonly {
    chunkIndex: number
    chunkDigest: string
    records: readonly NormalizedCandidateV1[]
  }[],
  evidence: ReturnType<PortableCollectorReferenceStore['listCommitChunks']>,
): void {
  if (evidence.length !== chunks.length) {
    throw new PortableFinalizeTerminalError(
      'digest_mismatch',
      `commit evidence count mismatch: expected ${chunks.length}, received ${evidence.length}`,
    )
  }
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!
    const committed = evidence[index]
    if (
      !committed ||
      committed.chunkIndex !== index ||
      committed.status !== 'completed' ||
      committed.chunkDigest !== chunk.chunkDigest ||
      committed.rowMutationCount !== chunk.records.length ||
      committed.operationCount !== chunk.records.length
    ) {
      throw new PortableFinalizeTerminalError(
        'digest_mismatch',
        `commit evidence mismatch at chunk ${index}`,
      )
    }
  }
}

async function reconstructPayload(
  store: PortableCollectorReferenceStore,
  work: PortableCollectorWorkSnapshot,
): Promise<NormalizedCollectorPayloadV1> {
  const payloadChunks = store.listPayloadChunks(work.workId)
  if (payloadChunks.length !== work.expectedPayloadChunks) {
    throw new PortableFinalizeTerminalError(
      'digest_mismatch',
      `payload chunk count mismatch: expected ${work.expectedPayloadChunks}, received ${payloadChunks.length}`,
    )
  }

  const decodedChunks: Array<{
    chunkIndex: number
    chunkDigest: string
    records: NormalizedCandidateV1[]
  }> = []
  for (let index = 0; index < payloadChunks.length; index += 1) {
    const stored = payloadChunks[index]!
    if (stored.chunkIndex !== index) {
      throw new PortableFinalizeTerminalError(
        'digest_mismatch',
        `payload chunk index mismatch: expected ${index}, received ${stored.chunkIndex}`,
      )
    }
    if (stored.encoding !== EXPECTED_CHUNK_ENCODING) {
      throw new PortableFinalizeTerminalError(
        'digest_mismatch',
        `payload chunk encoding mismatch at ${index}: ${stored.encoding}`,
      )
    }
    if (stored.byteCount !== stored.payload.byteLength) {
      throw new PortableFinalizeTerminalError(
        'digest_mismatch',
        `payload chunk byte count mismatch at ${index}`,
      )
    }
    const decoded = await decodeAndVerifyNormalizedPayloadChunk(
      stored.payload,
      work.payloadDigest ?? undefined,
    )
    if (
      decoded.workId !== work.workId ||
      decoded.chunkIndex !== index ||
      decoded.totalChunks !== payloadChunks.length ||
      decoded.chunkDigest !== stored.payloadDigest ||
      decoded.records.length !== stored.recordCount
    ) {
      throw new PortableFinalizeTerminalError(
        'digest_mismatch',
        `payload chunk identity mismatch at ${index}`,
      )
    }
    decodedChunks.push({
      chunkIndex: index,
      chunkDigest: decoded.chunkDigest,
      records: decoded.records,
    })
  }

  assertCommitEvidence(decodedChunks, store.listCommitChunks(work.workId))
  const records = decodedChunks.flatMap((chunk) => chunk.records)
  const groups = groupCandidates(records)
  const rebuilt = await buildNormalizedCollectorPayload({
    workId: work.workId,
    network: work.network,
    epochId: work.epochId,
    baseIdentity: work.baseIdentity,
    previousLedgerIndex: work.previousLedgerIndex,
    expectedParentHash: work.expectedParentHash,
    startLedgerIndex: work.startLedgerIndex,
    endLedgerIndex: work.scannedEndLedgerIndex!,
    finalLedgerHash: work.finalLedgerHash!,
    ...groups,
  })

  if (rebuilt.digest !== work.payloadDigest) {
    throw new PortableFinalizeTerminalError('digest_mismatch', 'full payload digest mismatch')
  }
  if (canonicalPortableJson(rebuilt.semanticCounts) !== work.semanticCountsJson) {
    throw new PortableFinalizeTerminalError('digest_mismatch', 'semantic counts mismatch')
  }
  assertCandidateRows(work.workId, records, store.listReferenceRowsForWork(work.workId))
  return rebuilt
}

export class PortableCollectorFinalizeRuntime {
  constructor(
    private readonly store: PortableCollectorReferenceStore,
    private readonly scheduler: PortableCollectorScheduler,
    private readonly execution: PortableFinalizeExecutionAdapter,
  ) {}

  async execute(
    messageId: string,
    options: PortableFinalizeRuntimeExecutionOptions,
  ): Promise<PortableFinalizeRuntimeResult> {
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
    if (message.phase !== 'finalize') {
      return this.failTerminal(
        messageId,
        options,
        'invalid_message',
        `finalize runtime received ${message.phase} message`,
      )
    }

    try {
      const work = requireFinalizeWork(message, this.store.getWork(message.workId))
      const rebuilt = await reconstructPayload(this.store, work)
      const successor = buildScanPhaseMessage({
        network: work.network,
        epochId: work.epochId,
        baseIdentity: work.baseIdentity,
        expectedPreviousLedgerIndex: rebuilt.endLedgerIndex,
        expectedPreviousLedgerHash: rebuilt.finalLedgerHash,
        scanSequence: 0,
      })
      const result = {
        status: 'finalized',
        workId: work.workId,
        ledgerIndex: rebuilt.endLedgerIndex,
        ledgerHash: rebuilt.finalLedgerHash,
        payloadDigest: rebuilt.digest,
        semanticCounts: rebuilt.semanticCounts,
      }

      const completion = this.scheduler.completeWithSuccessor({
        messageId,
        leaseOwner: options.leaseOwner,
        now: options.now,
        result,
        successor,
        successorAvailableAt: this.execution.nextScanAvailableAt,
        mutate: () => {
          this.store.finalizeWorkInTransaction({
            workId: work.workId,
            committedAt: options.now,
          })
          this.execution.afterFinalizeMutation?.()
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
    message: FinalizePhaseMessageV1,
    options: PortableFinalizeRuntimeExecutionOptions,
    error: unknown,
  ): PortableFinalizeRuntimeResult {
    if (error instanceof PortableSchedulerLeaseLostError) {
      return { status: 'lease_lost', messageId: message.messageId }
    }

    let classification: PortableSchedulerFailureClassification
    let errorMessage: string
    if (error instanceof PortableFinalizeExecutionError) {
      classification = error.classification
      errorMessage = error.message
    } else if (error instanceof PortableFinalizeTerminalError) {
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
    options: PortableFinalizeRuntimeExecutionOptions,
    classification: PortableTerminalFailureClassification,
    errorMessage: string,
  ): PortableFinalizeRuntimeResult {
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
