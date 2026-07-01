import {
  buildCurrentStateManifest,
  serializeCurrentStateManifest,
  type CurrentStateManifest,
  type CurrentStateShardSummary,
} from './current-state-manifest'
import {
  scanCurrentStateBatch,
  type CurrentStateBatchResult,
  type CurrentStatePage,
  type CurrentStateScanMetrics,
} from './scan-current-state'

export interface BootstrapIdentity {
  snapshotId: string
  epochId: string
  endpoint: string
  ledgerIndex: number
  ledgerHash: string
  objectPrefix: string
}

export interface BootstrapCheckpoint extends BootstrapIdentity {
  schemaVersion: 1
  nextMarker: unknown
  nextPageNumber: number
  scanComplete: boolean
  metrics: CurrentStateScanMetrics
  shards: readonly CurrentStateShardSummary[]
}

export interface BootstrapCheckpointStore {
  load(snapshotId: string): Promise<BootstrapCheckpoint | null>
  save(checkpoint: BootstrapCheckpoint): Promise<void>
  clear(snapshotId: string): Promise<void>
}

export interface EncodedBootstrapShard {
  bytes: Uint8Array
  encoding: 'gzip'
}

export interface BootstrapObjectStore {
  putShard(options: {
    key: string
    bytes: Uint8Array
    sha256: string
  }): Promise<{ storedBytes: number }>
  putManifest(options: {
    key: string
    bytes: Uint8Array
    sha256: string
  }): Promise<void>
  verifyManifest(options: { key: string; sha256: string }): Promise<boolean>
}

export interface BootstrapLifecycle {
  begin(identity: BootstrapIdentity): Promise<void>
  activate(options: {
    identity: BootstrapIdentity
    manifest: CurrentStateManifest
    manifestKey: string
    manifestSha256: string
  }): Promise<void>
}

export interface BootstrapRunResult {
  status: 'paused' | 'complete'
  checkpoint: BootstrapCheckpoint | null
  manifest: CurrentStateManifest | null
  manifestKey: string | null
  manifestSha256: string | null
}

type ScanBatch = typeof scanCurrentStateBatch

type EncodePage = (
  page: CurrentStatePage,
  context: { snapshotId: string; pageNumber: number },
) => Promise<EncodedBootstrapShard> | EncodedBootstrapShard

function emptyMetrics(objectLimitPerPage: number): CurrentStateScanMetrics {
  return {
    pages: 0,
    requests: 0,
    decodedObjects: 0,
    objects: 0,
    elapsedMs: 0,
    requestedObjectsPerPage: objectLimitPerPage,
    responseMode: 'binary',
    byType: {
      vault: { objects: 0 },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
  }
}

function copyMetrics(metrics: CurrentStateScanMetrics): CurrentStateScanMetrics {
  return {
    ...metrics,
    byType: {
      vault: { ...metrics.byType.vault },
      loan_broker: { ...metrics.byType.loan_broker },
      loan: { ...metrics.byType.loan },
    },
  }
}

function addPage(metrics: CurrentStateScanMetrics, page: CurrentStatePage): void {
  metrics.pages += 1
  metrics.requests += 1
  metrics.decodedObjects += page.decodedObjects
  metrics.byType.vault.objects += page.vaults.length
  metrics.byType.loan_broker.objects += page.loanBrokers.length
  metrics.byType.loan.objects += page.loans.length
  metrics.objects += page.vaults.length + page.loanBrokers.length + page.loans.length
}

function assertCheckpointIdentity(
  identity: BootstrapIdentity,
  checkpoint: BootstrapCheckpoint,
): void {
  const fields: (keyof BootstrapIdentity)[] = [
    'snapshotId',
    'epochId',
    'endpoint',
    'ledgerIndex',
    'ledgerHash',
    'objectPrefix',
  ]
  for (const field of fields) {
    if (checkpoint[field] !== identity[field]) {
      throw new Error(`Bootstrap checkpoint ${field} does not match the requested snapshot`)
    }
  }
  if (checkpoint.nextPageNumber !== checkpoint.shards.length + 1) {
    throw new Error('Bootstrap checkpoint page sequence does not match its shard list')
  }
  if (!checkpoint.scanComplete && checkpoint.nextPageNumber > 1 && checkpoint.nextMarker == null) {
    throw new Error('Incomplete bootstrap checkpoint must preserve a continuation marker')
  }
}

function shardKey(objectPrefix: string, pageNumber: number): string {
  return `${objectPrefix}/shards/page-${String(pageNumber).padStart(8, '0')}.json.gz`
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', source.buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function checkpointFrom(options: {
  identity: BootstrapIdentity
  nextMarker: unknown
  nextPageNumber: number
  scanComplete: boolean
  metrics: CurrentStateScanMetrics
  shards: readonly CurrentStateShardSummary[]
}): BootstrapCheckpoint {
  return {
    schemaVersion: 1,
    ...options.identity,
    nextMarker: options.nextMarker,
    nextPageNumber: options.nextPageNumber,
    scanComplete: options.scanComplete,
    metrics: copyMetrics(options.metrics),
    shards: [...options.shards],
  }
}

export async function runCurrentStateBootstrap(options: {
  identity: BootstrapIdentity
  checkpointStore: BootstrapCheckpointStore
  objectStore: BootstrapObjectStore
  lifecycle: BootstrapLifecycle
  encodePage: EncodePage
  timeoutMs: number
  maxPagesPerBatch?: number
  objectLimitPerPage?: number
  generatedAt?: () => string
  scanBatch?: ScanBatch
}): Promise<BootstrapRunResult> {
  const objectLimitPerPage = options.objectLimitPerPage ?? 2_048
  const maxPagesPerBatch = options.maxPagesPerBatch ?? 25
  const generatedAt = options.generatedAt ?? (() => new Date().toISOString())
  const scanBatch = options.scanBatch ?? scanCurrentStateBatch
  const existing = await options.checkpointStore.load(options.identity.snapshotId)

  if (existing) assertCheckpointIdentity(options.identity, existing)
  else await options.lifecycle.begin(options.identity)

  let checkpoint =
    existing ??
    checkpointFrom({
      identity: options.identity,
      nextMarker: null,
      nextPageNumber: 1,
      scanComplete: false,
      metrics: emptyMetrics(objectLimitPerPage),
      shards: [],
    })

  if (!checkpoint.scanComplete) {
    const metrics = copyMetrics(checkpoint.metrics)
    const shards = [...checkpoint.shards]
    const firstPageNumber = checkpoint.nextPageNumber
    let lastSaved = checkpoint

    const batch: CurrentStateBatchResult = await scanBatch({
      endpoint: options.identity.endpoint,
      timeoutMs: options.timeoutMs,
      ledgerHash: options.identity.ledgerHash,
      ledgerIndex: options.identity.ledgerIndex,
      startMarker: firstPageNumber === 1 ? undefined : checkpoint.nextMarker,
      maxPages: maxPagesPerBatch,
      objectLimitPerPage,
      onPage: async (page) => {
        const pageNumber = firstPageNumber + page.pageNumber - 1
        const encoded = await options.encodePage(page, {
          snapshotId: options.identity.snapshotId,
          pageNumber,
        })
        if (encoded.encoding !== 'gzip' || encoded.bytes.byteLength === 0) {
          throw new Error(`Bootstrap shard ${pageNumber} must be a non-empty gzip payload`)
        }
        const key = shardKey(options.identity.objectPrefix, pageNumber)
        const sha256 = await sha256Hex(encoded.bytes)
        const stored = await options.objectStore.putShard({ key, bytes: encoded.bytes, sha256 })
        if (stored.storedBytes !== encoded.bytes.byteLength) {
          throw new Error(`Bootstrap shard ${pageNumber} stored byte count does not match payload`)
        }

        shards.push({
          key,
          pageNumber,
          firstLedgerIndex: page.firstLedgerIndex,
          lastLedgerIndex: page.lastLedgerIndex,
          decodedObjects: page.decodedObjects,
          vaultCount: page.vaults.length,
          loanBrokerCount: page.loanBrokers.length,
          loanCount: page.loans.length,
          compressedBytes: stored.storedBytes,
          sha256,
        })
        addPage(metrics, page)
        lastSaved = checkpointFrom({
          identity: options.identity,
          nextMarker: page.markerAfter ?? null,
          nextPageNumber: pageNumber + 1,
          scanComplete: page.markerAfter == null,
          metrics,
          shards,
        })
        await options.checkpointStore.save(lastSaved)
      },
    })

    metrics.elapsedMs += batch.metrics.elapsedMs
    checkpoint = checkpointFrom({
      identity: options.identity,
      nextMarker: batch.nextMarker,
      nextPageNumber: lastSaved.nextPageNumber,
      scanComplete: batch.complete,
      metrics,
      shards,
    })
    await options.checkpointStore.save(checkpoint)

    if (!batch.complete) {
      return {
        status: 'paused',
        checkpoint,
        manifest: null,
        manifestKey: null,
        manifestSha256: null,
      }
    }
  }

  const manifest = buildCurrentStateManifest({
    snapshotId: options.identity.snapshotId,
    epochId: options.identity.epochId,
    ledgerIndex: options.identity.ledgerIndex,
    ledgerHash: options.identity.ledgerHash,
    objectPrefix: options.identity.objectPrefix,
    generatedAt: generatedAt(),
    metrics: checkpoint.metrics,
    shards: checkpoint.shards,
  })
  const manifestBytes = serializeCurrentStateManifest(manifest)
  const manifestSha256 = await sha256Hex(manifestBytes)
  const manifestKey = `${options.identity.objectPrefix}/manifest.json`
  await options.objectStore.putManifest({
    key: manifestKey,
    bytes: manifestBytes,
    sha256: manifestSha256,
  })
  if (!(await options.objectStore.verifyManifest({ key: manifestKey, sha256: manifestSha256 }))) {
    throw new Error('Current-state manifest verification failed')
  }
  await options.lifecycle.activate({
    identity: options.identity,
    manifest,
    manifestKey,
    manifestSha256,
  })
  await options.checkpointStore.clear(options.identity.snapshotId)

  return {
    status: 'complete',
    checkpoint: null,
    manifest,
    manifestKey,
    manifestSha256,
  }
}
