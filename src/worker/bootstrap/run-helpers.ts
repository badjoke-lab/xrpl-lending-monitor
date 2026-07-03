import type { BootstrapIdentity } from '../../collector/current-state/bootstrap-runner'
import type {
  CurrentStatePage,
  CurrentStateScanMetrics,
} from '../../collector/current-state/scan-current-state'
import type { D1BootstrapCheckpoint } from '../repositories/d1-bootstrap-checkpoint-repository'
import { PAGE_OBJECT_LIMIT } from './page-batching'

export const DEFAULT_PAGES_PER_RUN = 25

export function emptyRunMetrics(objectLimitPerPage: number): CurrentStateScanMetrics {
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

export function copyRunMetrics(metrics: CurrentStateScanMetrics): CurrentStateScanMetrics {
  return {
    ...metrics,
    byType: {
      vault: { ...metrics.byType.vault },
      loan_broker: { ...metrics.byType.loan_broker },
      loan: { ...metrics.byType.loan },
    },
  }
}

export function addRunPage(metrics: CurrentStateScanMetrics, page: CurrentStatePage): void {
  metrics.pages += 1
  metrics.requests += 1
  metrics.decodedObjects += page.decodedObjects
  metrics.byType.vault.objects += page.vaults.length
  metrics.byType.loan_broker.objects += page.loanBrokers.length
  metrics.byType.loan.objects += page.loans.length
  metrics.objects += page.vaults.length + page.loanBrokers.length + page.loans.length
}

export function validateRunLimits(objectLimitPerPage: number, maxPagesPerRun: number): void {
  if (!Number.isSafeInteger(objectLimitPerPage) || objectLimitPerPage < 1) {
    throw new Error('objectLimitPerPage must be a positive safe integer')
  }
  if (objectLimitPerPage > PAGE_OBJECT_LIMIT) {
    throw new Error(`D1 bootstrap objectLimitPerPage must not exceed ${PAGE_OBJECT_LIMIT}`)
  }
  if (!Number.isSafeInteger(maxPagesPerRun) || maxPagesPerRun < 1) {
    throw new Error('maxPagesPerRun must be a positive safe integer')
  }
}

export function createRunCheckpoint(options: {
  identity: BootstrapIdentity
  nextMarker: unknown
  nextBatchSequence: number
  scanComplete: boolean
  metrics: CurrentStateScanMetrics
  updatedAt: string
}): D1BootstrapCheckpoint {
  return {
    snapshotId: options.identity.snapshotId,
    nextMarker: options.nextMarker,
    nextBatchSequence: options.nextBatchSequence,
    scanComplete: options.scanComplete,
    metrics: copyRunMetrics(options.metrics),
    updatedAt: options.updatedAt,
  }
}
