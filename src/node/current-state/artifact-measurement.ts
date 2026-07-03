import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { XrplJsonRpcClient } from '../../collector/network/xrpl-rpc'
import type { CurrentStateBatchResult } from '../../collector/current-state/scan-current-state'
import { runArtifactBootstrap } from '../../shared/current-state/artifact-bootstrap-runner'
import type {
  ArtifactBootstrapCheckpoint,
  ArtifactBootstrapIdentity,
} from '../../shared/current-state/artifact-bootstrap-types'
import type { PageArtifactManifest } from '../../shared/current-state/page-artifact-types'
import {
  buildAndPersistSnapshotLevelManifest,
  type SnapshotLevelArtifact,
} from '../../shared/current-state/snapshot-level-manifest'
import {
  LocalFileArtifactBootstrapCheckpointStore,
  LocalFileArtifactStore,
} from './local-file-storage'

const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234'
const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_PAGES_PER_RUN = 25
const DEFAULT_OBJECT_LIMIT_PER_PAGE = 2_048

interface ValidatedLedgerResult {
  ledger?: unknown
  ledger_hash?: unknown
  ledger_index?: unknown
  validated?: unknown
}

export interface MeasurementRunPlan {
  schemaVersion: 1
  createdAt: string
  identity: ArtifactBootstrapIdentity
}

export interface LocalArtifactMeasurementEvidence {
  schemaVersion: 1
  generatedAt: string
  status: 'paused' | 'complete'
  runRoot: string
  identity: ArtifactBootstrapIdentity
  checkpoint: ArtifactBootstrapCheckpoint
  snapshotManifest: null | {
    key: string
    sha256: string
    bytes: number
  }
  artifacts: {
    count: number
    dataShardCount: number
    indexShardCount: number
    pageManifestCount: number
    totalStoredBytes: number
    dataCompressedBytes: number
    indexCompressedBytes: number
    pageManifestBytes: number
    snapshotManifestBytes: number
    maxArtifactBytes: number
  }
  payload: {
    dataObjects: number
    indexEntries: number
    dataUncompressedBytes: number
    indexUncompressedBytes: number
    combinedUncompressedBytes: number
    combinedCompressedBytes: number
    compressionRatio: number | null
    indexShareOfCompressedPayload: number | null
  }
  runtime: {
    invocationWallMs: number
    cumulativeScanElapsedMs: number
    maxHeapUsedBytes: number
    startingPageCount: number
    endingPageCount: number
    processedPagesThisInvocation: number
  }
}

export interface LocalArtifactMeasurementOptions {
  root: string
  endpoint?: string
  timeoutMs?: number
  maxPagesPerRun?: number
  objectLimitPerPage?: number
  pageBudget?: number
  ledgerIndex?: number
  ledgerHash?: string
  epochId?: string
  snapshotId?: string
  now?: () => string
  scanBatch?: (options: Parameters<typeof runArtifactBootstrap>[0] extends never ? never : never) => Promise<CurrentStateBatchResult>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return Number.isSafeInteger(parsed) && Number(parsed) >= 0 ? Number(parsed) : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function validatePositive(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
}

function validateHash(value: string): string {
  const normalized = value.toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    throw new Error('ledgerHash must be 64 hexadecimal characters')
  }
  return normalized
}

function parseRunPlan(value: unknown): MeasurementRunPlan {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.identity)) {
    throw new Error('Measurement run plan schema is invalid')
  }
  const identity = value.identity
  const plan: MeasurementRunPlan = {
    schemaVersion: 1,
    createdAt: text(value.createdAt) ?? '',
    identity: {
      network: 'devnet',
      endpoint: text(identity.endpoint) ?? '',
      epochId: text(identity.epochId) ?? '',
      snapshotId: text(identity.snapshotId) ?? '',
      ledgerIndex: integer(identity.ledgerIndex) ?? -1,
      ledgerHash: text(identity.ledgerHash) ?? '',
    },
  }
  if (
    plan.createdAt.length === 0
    || plan.identity.endpoint.length === 0
    || plan.identity.epochId.length === 0
    || plan.identity.snapshotId.length === 0
    || plan.identity.ledgerIndex < 0
  ) {
    throw new Error('Measurement run plan fields are invalid')
  }
  plan.identity.ledgerHash = validateHash(plan.identity.ledgerHash)
  return plan
}

async function resolveValidatedLedger(endpoint: string, timeoutMs: number): Promise<{
  ledgerIndex: number
  ledgerHash: string
}> {
  const client = new XrplJsonRpcClient({ endpoint, timeoutMs })
  const result = await client.call<ValidatedLedgerResult>('ledger', {
    ledger_index: 'validated',
    transactions: false,
    expand: false,
  })
  const ledger = isRecord(result.ledger) ? result.ledger : result
  const ledgerIndex = integer(result.ledger_index) ?? integer(ledger.ledger_index)
  const ledgerHash = text(result.ledger_hash) ?? text(ledger.ledger_hash) ?? text(ledger.hash)
  if (result.validated !== true || ledgerIndex == null || ledgerHash == null) {
    throw new Error('Validated ledger response did not include a fixed ledger identity')
  }
  return { ledgerIndex, ledgerHash: validateHash(ledgerHash) }
}

async function loadOrCreateRunPlan(options: {
  root: string
  endpoint: string
  timeoutMs: number
  ledgerIndex?: number
  ledgerHash?: string
  epochId?: string
  snapshotId?: string
  now: () => string
}): Promise<MeasurementRunPlan> {
  const path = join(options.root, 'run.json')
  if (await exists(path)) return parseRunPlan(JSON.parse(await readFile(path, 'utf8')))

  const hasIndex = options.ledgerIndex !== undefined
  const hasHash = options.ledgerHash !== undefined
  if (hasIndex !== hasHash) throw new Error('ledgerIndex and ledgerHash must be provided together')
  const fixed = hasIndex && hasHash
    ? {
        ledgerIndex: options.ledgerIndex!,
        ledgerHash: validateHash(options.ledgerHash!),
      }
    : await resolveValidatedLedger(options.endpoint, options.timeoutMs)
  if (!Number.isSafeInteger(fixed.ledgerIndex) || fixed.ledgerIndex < 0) {
    throw new Error('ledgerIndex must be a non-negative safe integer')
  }
  const shortHash = fixed.ledgerHash.slice(0, 12).toLowerCase()
  const plan: MeasurementRunPlan = {
    schemaVersion: 1,
    createdAt: options.now(),
    identity: {
      network: 'devnet',
      endpoint: options.endpoint,
      epochId: options.epochId ?? `devnet-measurement-${fixed.ledgerIndex}`,
      snapshotId: options.snapshotId ?? `devnet-${fixed.ledgerIndex}-${shortHash}`,
      ledgerIndex: fixed.ledgerIndex,
      ledgerHash: fixed.ledgerHash,
    },
  }
  await atomicJson(path, plan)
  return plan
}

async function readPageManifests(
  store: LocalFileArtifactStore,
  checkpoint: ArtifactBootstrapCheckpoint,
): Promise<Array<{ manifest: PageArtifactManifest; bytes: number }>> {
  const pages: Array<{ manifest: PageArtifactManifest; bytes: number }> = []
  for (const reference of checkpoint.pageManifests) {
    const bytes = await store.read(reference.key)
    if (!bytes) throw new Error(`Missing page manifest ${reference.key}`)
    pages.push({
      manifest: JSON.parse(new TextDecoder().decode(bytes)) as PageArtifactManifest,
      bytes: bytes.byteLength,
    })
  }
  return pages
}

function finiteRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function buildEvidence(options: {
  generatedAt: string
  root: string
  checkpoint: ArtifactBootstrapCheckpoint
  pages: Array<{ manifest: PageArtifactManifest; bytes: number }>
  snapshot: SnapshotLevelArtifact | null
  wallMs: number
  maxHeapUsedBytes: number
  startingPageCount: number
}): LocalArtifactMeasurementEvidence {
  const dataShards = options.pages.flatMap((page) => page.manifest.dataShards)
  const indexShards = options.pages.flatMap((page) => page.manifest.indexShards)
  const dataCompressedBytes = dataShards.reduce((total, shard) => total + shard.compressedBytes, 0)
  const indexCompressedBytes = indexShards.reduce((total, shard) => total + shard.compressedBytes, 0)
  const dataUncompressedBytes = dataShards.reduce((total, shard) => total + shard.uncompressedBytes, 0)
  const indexUncompressedBytes = indexShards.reduce((total, shard) => total + shard.uncompressedBytes, 0)
  const pageManifestBytes = options.pages.reduce((total, page) => total + page.bytes, 0)
  const snapshotManifestBytes = options.snapshot?.bytes.byteLength ?? 0
  const shardSizes = [...dataShards, ...indexShards].map((shard) => shard.compressedBytes)
  const maxArtifactBytes = Math.max(0, ...shardSizes, ...options.pages.map((page) => page.bytes), snapshotManifestBytes)
  const combinedCompressedBytes = dataCompressedBytes + indexCompressedBytes
  const combinedUncompressedBytes = dataUncompressedBytes + indexUncompressedBytes

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    status: options.checkpoint.scanComplete ? 'complete' : 'paused',
    runRoot: options.root,
    identity: {
      network: options.checkpoint.network,
      endpoint: options.checkpoint.endpoint,
      epochId: options.checkpoint.epochId,
      snapshotId: options.checkpoint.snapshotId,
      ledgerIndex: options.checkpoint.ledgerIndex,
      ledgerHash: options.checkpoint.ledgerHash,
    },
    checkpoint: options.checkpoint,
    snapshotManifest: options.snapshot
      ? {
          key: options.snapshot.key,
          sha256: options.snapshot.sha256,
          bytes: options.snapshot.bytes.byteLength,
        }
      : null,
    artifacts: {
      count: dataShards.length + indexShards.length + options.pages.length + (options.snapshot ? 1 : 0),
      dataShardCount: dataShards.length,
      indexShardCount: indexShards.length,
      pageManifestCount: options.pages.length,
      totalStoredBytes: combinedCompressedBytes + pageManifestBytes + snapshotManifestBytes,
      dataCompressedBytes,
      indexCompressedBytes,
      pageManifestBytes,
      snapshotManifestBytes,
      maxArtifactBytes,
    },
    payload: {
      dataObjects: dataShards.reduce((total, shard) => total + shard.objectCount, 0),
      indexEntries: indexShards.reduce((total, shard) => total + shard.entryCount, 0),
      dataUncompressedBytes,
      indexUncompressedBytes,
      combinedUncompressedBytes,
      combinedCompressedBytes,
      compressionRatio: finiteRatio(combinedUncompressedBytes, combinedCompressedBytes),
      indexShareOfCompressedPayload: finiteRatio(indexCompressedBytes, combinedCompressedBytes),
    },
    runtime: {
      invocationWallMs: options.wallMs,
      cumulativeScanElapsedMs: options.checkpoint.metrics.elapsedMs,
      maxHeapUsedBytes: options.maxHeapUsedBytes,
      startingPageCount: options.startingPageCount,
      endingPageCount: options.checkpoint.metrics.pages,
      processedPagesThisInvocation: options.checkpoint.metrics.pages - options.startingPageCount,
    },
  }
}

export async function runLocalArtifactMeasurement(
  options: LocalArtifactMeasurementOptions,
): Promise<LocalArtifactMeasurementEvidence> {
  const root = resolve(options.root)
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxPagesPerRun = options.maxPagesPerRun ?? DEFAULT_MAX_PAGES_PER_RUN
  const objectLimitPerPage = options.objectLimitPerPage ?? DEFAULT_OBJECT_LIMIT_PER_PAGE
  const now = options.now ?? (() => new Date().toISOString())
  validatePositive(timeoutMs, 'timeoutMs')
  validatePositive(maxPagesPerRun, 'maxPagesPerRun')
  validatePositive(objectLimitPerPage, 'objectLimitPerPage')
  if (options.pageBudget !== undefined) validatePositive(options.pageBudget, 'pageBudget')

  const plan = await loadOrCreateRunPlan({
    root,
    endpoint,
    timeoutMs,
    ledgerIndex: options.ledgerIndex,
    ledgerHash: options.ledgerHash,
    epochId: options.epochId,
    snapshotId: options.snapshotId,
    now,
  })
  const store = new LocalFileArtifactStore(join(root, 'artifacts'))
  const checkpointStore = new LocalFileArtifactBootstrapCheckpointStore(join(root, 'checkpoints'))
  const starting = await checkpointStore.load(plan.identity.snapshotId)
  const startingPageCount = starting?.metrics.pages ?? 0
  const startedAt = Date.now()
  let maxHeapUsedBytes = process.memoryUsage().heapUsed
  let checkpoint = starting

  while (!checkpoint?.scanComplete) {
    const processed = (checkpoint?.metrics.pages ?? 0) - startingPageCount
    const remaining = options.pageBudget === undefined ? maxPagesPerRun : options.pageBudget - processed
    if (remaining <= 0) break
    const result = await runArtifactBootstrap({
      identity: plan.identity,
      store,
      checkpointStore,
      timeoutMs,
      maxPagesPerRun: Math.min(maxPagesPerRun, remaining),
      objectLimitPerPage,
      scanBatch: options.scanBatch as typeof import('../../collector/current-state/scan-current-state').scanCurrentStateBatch | undefined,
    })
    checkpoint = result.checkpoint
    maxHeapUsedBytes = Math.max(maxHeapUsedBytes, process.memoryUsage().heapUsed)
    if (result.status === 'complete') break
  }

  checkpoint ??= await checkpointStore.load(plan.identity.snapshotId)
  if (!checkpoint) throw new Error('Artifact measurement did not produce a checkpoint')
  const generatedAt = now()
  const snapshot = checkpoint.scanComplete
    ? await buildAndPersistSnapshotLevelManifest({
        store,
        checkpoint,
        generatedAt: plan.createdAt,
      })
    : null
  const pages = await readPageManifests(store, checkpoint)
  const evidence = buildEvidence({
    generatedAt,
    root,
    checkpoint,
    pages,
    snapshot,
    wallMs: Date.now() - startedAt,
    maxHeapUsedBytes,
    startingPageCount,
  })
  await atomicJson(join(root, 'evidence.json'), evidence)
  return evidence
}
