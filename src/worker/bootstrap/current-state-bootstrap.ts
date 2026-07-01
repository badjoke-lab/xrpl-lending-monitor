import {
  runCurrentStateBootstrap,
  type BootstrapIdentity,
  type BootstrapRunResult,
} from '../../collector/current-state/bootstrap-runner'
import { encodeCurrentStatePageGzip } from '../../collector/current-state/bootstrap-shard-encoder'
import { createD1BootstrapCheckpointStore } from '../repositories/bootstrap-checkpoint-repository'
import { createD1BootstrapLifecycle } from '../repositories/bootstrap-lifecycle'
import { createR2BootstrapObjectStore } from '../repositories/bootstrap-object-store'

export interface D1R2CurrentStateBootstrapOptions {
  db: D1Database
  bucket: R2Bucket
  identity: BootstrapIdentity
  timeoutMs: number
  maxPagesPerBatch?: number
  objectLimitPerPage?: number
  now?: () => string
}

export async function runD1R2CurrentStateBootstrap(
  options: D1R2CurrentStateBootstrapOptions,
): Promise<BootstrapRunResult> {
  const now = options.now ?? (() => new Date().toISOString())
  return runCurrentStateBootstrap({
    identity: options.identity,
    checkpointStore: createD1BootstrapCheckpointStore(options.db, now),
    objectStore: createR2BootstrapObjectStore(options.bucket),
    lifecycle: createD1BootstrapLifecycle(options.db, now),
    encodePage: encodeCurrentStatePageGzip,
    timeoutMs: options.timeoutMs,
    maxPagesPerBatch: options.maxPagesPerBatch,
    objectLimitPerPage: options.objectLimitPerPage,
    generatedAt: now,
  })
}
