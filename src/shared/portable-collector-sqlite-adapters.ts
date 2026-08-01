import type {
  PortableCollectorSchedulerAdapter,
  PortableCollectorStorageAdapter,
} from './portable-collector-adapters'
import {
  PortableCollectorReferenceStore,
  type PortableCollectorWorkDefinition,
  type PortableCommitChunk,
  type PortablePayloadChunk,
  type PortableReferenceRow,
  type PortableSqliteDatabase,
} from './portable-collector-reference-store'
import {
  PortableCollectorScheduler,
  type PortableSchedulerFailureClassification,
} from './portable-collector-scheduler'
import type { PortableCollectorPhaseMessageV1 } from './portable-collector-messages'

export class SqlitePortableCollectorStorageAdapter
implements PortableCollectorStorageAdapter {
  constructor(readonly referenceStore: PortableCollectorReferenceStore) {}

  beginWork(definition: PortableCollectorWorkDefinition) {
    return this.referenceStore.beginWork(definition)
  }

  getWork(workId: string) {
    return this.referenceStore.getWork(workId)
  }

  getPayloadChunk(workId: string, chunkIndex: number) {
    return this.referenceStore.getPayloadChunk(workId, chunkIndex)
  }

  listPayloadChunks(workId: string) {
    return this.referenceStore.listPayloadChunks(workId)
  }

  listCommitChunks(workId: string) {
    return this.referenceStore.listCommitChunks(workId)
  }

  listReferenceRowsForWork(workId: string) {
    return this.referenceStore.listReferenceRowsForWork(workId)
  }

  stagePayloadChunk(chunk: PortablePayloadChunk): void {
    this.referenceStore.stagePayloadChunk(chunk)
  }

  stageReferenceRow(row: PortableReferenceRow): void {
    this.referenceStore.stageReferenceRow(row)
  }

  sealScan(options: Parameters<PortableCollectorReferenceStore['sealScan']>[0]): void {
    this.referenceStore.sealScan(options)
  }

  completeCommitChunk(chunk: PortableCommitChunk): void {
    this.referenceStore.completeCommitChunk(chunk)
  }

  finalizeWork(options: Parameters<PortableCollectorReferenceStore['finalizeWork']>[0]) {
    return this.referenceStore.finalizeWork(options)
  }

  finalizeWorkInTransaction(
    options: Parameters<PortableCollectorReferenceStore['finalizeWorkInTransaction']>[0],
  ) {
    return this.referenceStore.finalizeWorkInTransaction(options)
  }

  getWatermark(network: string, epochId: string, baseIdentity: string) {
    return this.referenceStore.getWatermark(network, epochId, baseIdentity)
  }

  listCommittedReferenceRows() {
    return this.referenceStore.listCommittedReferenceRows()
  }

  exportState(): string {
    return this.referenceStore.exportState()
  }
}

export class SqlitePortableCollectorSchedulerAdapter
implements PortableCollectorSchedulerAdapter {
  constructor(readonly referenceScheduler: PortableCollectorScheduler) {}

  enqueue(
    message: PortableCollectorPhaseMessageV1,
    options: { availableAt: string; createdAt: string },
  ) {
    return this.referenceScheduler.enqueue(message, options)
  }

  getMessage(messageId: string) {
    return this.referenceScheduler.getMessage(messageId)
  }

  claim(
    messageId: string,
    options: { leaseOwner: string; now: string; leaseExpiresAt: string },
  ) {
    return this.referenceScheduler.claim(messageId, options)
  }

  claimNext(options: {
    leaseOwner: string
    now: string
    leaseExpiresAt: string
  }) {
    return this.referenceScheduler.claimNext(options)
  }

  completeWithSuccessor<T>(options: {
    messageId: string
    leaseOwner: string
    now: string
    result: unknown
    successor: PortableCollectorPhaseMessageV1
    successorAvailableAt: string
    mutate?: () => T
  }) {
    return this.referenceScheduler.completeWithSuccessor(options)
  }

  retry(options: {
    messageId: string
    leaseOwner: string
    now: string
    availableAt: string
    classification: PortableSchedulerFailureClassification
    errorMessage: string
  }): void {
    this.referenceScheduler.retry(options)
  }

  failTerminal(options: {
    messageId: string
    leaseOwner: string
    now: string
    classification: PortableSchedulerFailureClassification
    errorMessage: string
  }): void {
    this.referenceScheduler.failTerminal(options)
  }

  getOutbox(currentMessageId: string) {
    return this.referenceScheduler.getOutbox(currentMessageId)
  }

  dispatchNextOutbox(options: { now: string }) {
    return this.referenceScheduler.dispatchNextOutbox(options)
  }
}

export function createSqlitePortableCollectorAdapters(db: PortableSqliteDatabase): {
  storage: SqlitePortableCollectorStorageAdapter
  scheduler: SqlitePortableCollectorSchedulerAdapter
} {
  return {
    storage: new SqlitePortableCollectorStorageAdapter(
      new PortableCollectorReferenceStore(db),
    ),
    scheduler: new SqlitePortableCollectorSchedulerAdapter(
      new PortableCollectorScheduler(db),
    ),
  }
}
