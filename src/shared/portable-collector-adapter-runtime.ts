import type {
  PortableCollectorExecutionAdapter,
  PortableCollectorFinalizeExecutionAdapter,
  PortableCollectorRuntimeAdapters,
  PortableCollectorSchedulerAdapter,
  PortableCollectorStorageAdapter,
} from './portable-collector-adapters'
import { PortableCollectorCommitRuntime } from './portable-collector-commit-runtime'
import { PortableCollectorFinalizeRuntime } from './portable-collector-finalize-runtime'
import type { PortableCollectorPhaseMessageV1 } from './portable-collector-messages'
import type {
  PortableCollectorWorkDefinition,
  PortableCommitChunk,
  PortablePayloadChunk,
  PortableReferenceRow,
  PortableSqliteDatabase,
  PortableSqliteValue,
} from './portable-collector-reference-store'
import { PortableCollectorReferenceStore } from './portable-collector-reference-store'
import { PortableCollectorScanRuntime } from './portable-collector-scan-runtime'
import {
  PortableCollectorScheduler,
  type PortableSchedulerFailureClassification,
} from './portable-collector-scheduler'
import { FixtureExecutionAdapter } from './portable-collector-fixture-execution'

const unreachableDatabase: PortableSqliteDatabase = {
  run(): never {
    throw new Error('adapter runtime bridge reached an unavailable database')
  },
  get(): never {
    throw new Error('adapter runtime bridge reached an unavailable database')
  },
  all(): never {
    throw new Error('adapter runtime bridge reached an unavailable database')
  },
  transaction(): never {
    throw new Error('adapter runtime bridge reached an unavailable database')
  },
}

class StorageRuntimeBridge extends PortableCollectorReferenceStore {
  constructor(private readonly adapter: PortableCollectorStorageAdapter) {
    super(unreachableDatabase)
  }

  override beginWork(definition: PortableCollectorWorkDefinition) {
    return this.adapter.beginWork(definition)
  }

  override getWork(workId: string) {
    return this.adapter.getWork(workId)
  }

  override getPayloadChunk(workId: string, chunkIndex: number) {
    return this.adapter.getPayloadChunk(workId, chunkIndex)
  }

  override listPayloadChunks(workId: string) {
    return this.adapter.listPayloadChunks(workId)
  }

  override listCommitChunks(workId: string) {
    return this.adapter.listCommitChunks(workId)
  }

  override listReferenceRowsForWork(workId: string) {
    return this.adapter.listReferenceRowsForWork(workId)
  }

  override stagePayloadChunk(chunk: PortablePayloadChunk): void {
    this.adapter.stagePayloadChunk(chunk)
  }

  override stageReferenceRow(row: PortableReferenceRow): void {
    this.adapter.stageReferenceRow(row)
  }

  override sealScan(options: Parameters<PortableCollectorStorageAdapter['sealScan']>[0]): void {
    this.adapter.sealScan(options)
  }

  override completeCommitChunk(chunk: PortableCommitChunk): void {
    this.adapter.completeCommitChunk(chunk)
  }

  override finalizeWork(options: Parameters<PortableCollectorStorageAdapter['finalizeWork']>[0]) {
    return this.adapter.finalizeWork(options)
  }

  override finalizeWorkInTransaction(
    options: Parameters<PortableCollectorStorageAdapter['finalizeWorkInTransaction']>[0],
  ) {
    return this.adapter.finalizeWorkInTransaction(options)
  }

  override getWatermark(network: string, epochId: string, baseIdentity: string) {
    return this.adapter.getWatermark(network, epochId, baseIdentity)
  }

  override listCommittedReferenceRows() {
    return this.adapter.listCommittedReferenceRows()
  }

  override exportState(): string {
    return this.adapter.exportState()
  }
}

class SchedulerRuntimeBridge extends PortableCollectorScheduler {
  constructor(private readonly adapter: PortableCollectorSchedulerAdapter) {
    super(unreachableDatabase)
  }

  override enqueue(
    message: PortableCollectorPhaseMessageV1,
    options: { availableAt: string; createdAt: string },
  ) {
    return this.adapter.enqueue(message, options)
  }

  override getMessage(messageId: string) {
    return this.adapter.getMessage(messageId)
  }

  override claim(
    messageId: string,
    options: { leaseOwner: string; now: string; leaseExpiresAt: string },
  ) {
    return this.adapter.claim(messageId, options)
  }

  override claimNext(options: {
    leaseOwner: string
    now: string
    leaseExpiresAt: string
  }) {
    return this.adapter.claimNext(options)
  }

  override completeWithSuccessor<T>(options: {
    messageId: string
    leaseOwner: string
    now: string
    result: unknown
    successor: PortableCollectorPhaseMessageV1
    successorAvailableAt: string
    mutate?: () => T
  }) {
    return this.adapter.completeWithSuccessor(options)
  }

  override retry(options: {
    messageId: string
    leaseOwner: string
    now: string
    availableAt: string
    classification: PortableSchedulerFailureClassification
    errorMessage: string
  }): void {
    this.adapter.retry(options)
  }

  override failTerminal(options: {
    messageId: string
    leaseOwner: string
    now: string
    classification: PortableSchedulerFailureClassification
    errorMessage: string
  }): void {
    this.adapter.failTerminal(options)
  }

  override getOutbox(currentMessageId: string) {
    return this.adapter.getOutbox(currentMessageId)
  }

  override dispatchNextOutbox(options: { now: string }) {
    return this.adapter.dispatchNextOutbox(options)
  }
}

class ExecutionRuntimeBridge extends FixtureExecutionAdapter {
  constructor(private readonly adapter: PortableCollectorExecutionAdapter) {
    super({
      network: adapter.network,
      epochId: adapter.epochId,
      baseIdentity: adapter.baseIdentity,
      immutableBaseLedgerIndex: adapter.immutableBaseLedgerIndex,
      immutableBaseLedgerHash: adapter.immutableBaseLedgerHash,
      validatedHeadLedgerIndex: adapter.immutableBaseLedgerIndex,
      budget: adapter.budget,
      estimates: [],
      ranges: [],
      commitSuccessorAvailableAt: adapter.commitSuccessorAvailableAt,
      caughtUpSuccessorAvailableAt: adapter.caughtUpSuccessorAvailableAt,
      retryAvailableAt: adapter.retryAvailableAt,
    })
  }

  override readValidatedHeadLedgerIndex(): number {
    return this.adapter.readValidatedHeadLedgerIndex()
  }

  override readLedgerCostEstimates(
    startLedgerIndex: number,
    latestValidatedLedgerIndex: number,
  ) {
    return this.adapter.readLedgerCostEstimates(
      startLedgerIndex,
      latestValidatedLedgerIndex,
    )
  }

  override buildPayloadInput(
    ...parameters: Parameters<PortableCollectorExecutionAdapter['buildPayloadInput']>
  ) {
    return this.adapter.buildPayloadInput(...parameters)
  }

  override afterScanStaging(): void {
    this.adapter.afterScanStaging()
  }

  override afterCommitMutation(): void {
    this.adapter.afterCommitMutation()
  }
}

export class PortableCollectorAdapterRuntime {
  private readonly storageBridge: StorageRuntimeBridge
  private readonly schedulerBridge: SchedulerRuntimeBridge
  private readonly executionBridge: ExecutionRuntimeBridge

  constructor(readonly adapters: PortableCollectorRuntimeAdapters) {
    this.storageBridge = new StorageRuntimeBridge(adapters.storage)
    this.schedulerBridge = new SchedulerRuntimeBridge(adapters.scheduler)
    this.executionBridge = new ExecutionRuntimeBridge(adapters.execution)
  }

  executeScan(
    messageId: string,
    options: Parameters<PortableCollectorScanRuntime['execute']>[1],
  ) {
    return new PortableCollectorScanRuntime(
      this.storageBridge,
      this.schedulerBridge,
      this.executionBridge,
    ).execute(messageId, options)
  }

  executeCommit(
    messageId: string,
    options: Parameters<PortableCollectorCommitRuntime['execute']>[1],
  ) {
    return new PortableCollectorCommitRuntime(
      this.storageBridge,
      this.schedulerBridge,
      this.executionBridge,
    ).execute(messageId, options)
  }

  executeFinalize(
    messageId: string,
    options: Parameters<PortableCollectorFinalizeRuntime['execute']>[1],
  ) {
    const finalizeExecution: PortableCollectorFinalizeExecutionAdapter =
      this.adapters.finalizeExecution
    return new PortableCollectorFinalizeRuntime(
      this.storageBridge,
      this.schedulerBridge,
      finalizeExecution,
    ).execute(messageId, options)
  }
}

export function assertPortableAdapterSet(
  adapters: PortableCollectorRuntimeAdapters,
): PortableCollectorRuntimeAdapters {
  return adapters
}

export type PortableAdapterSqlValue = PortableSqliteValue
