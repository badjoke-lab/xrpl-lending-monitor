import type { IncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import type { RuntimeConfig } from '../../shared/runtime-config'
import { commitIncrementalScan } from '../../worker/repositories/incremental-ledger-repository'
import type { IncrementalCollectorState } from '../../worker/repositories/incremental-collector-state'
import { buildCollectorRunState } from './collector-run-record'
import type { CollectorScopeRow } from './collector-scope'
import { selectIncrementalCommitPrefix } from './incremental-work-budget'
import { scanValidatedLedgerRange } from './scan-validated-ledgers'

export interface RunnableCursor {
  epochId: string
  lastProcessedLedger: number
  lastProcessedHash: string
  latestObservedLedger: number
  latestObservedHash: string
  endpoint: string | null
}

export async function runPreparedIncrementalRange(options: {
  db: D1Database
  cursor: RunnableCursor
  scope: CollectorScopeRow
  previous: IncrementalCollectorState | null
  attemptedAt: string
  startedAtMs: number
  runtimeConfig: RuntimeConfig
  incrementalConfig: IncrementalRuntimeConfig
  scan?: typeof scanValidatedLedgerRange
  commit?: typeof commitIncrementalScan
  now?: () => Date
}) {
  const scan = options.scan ?? scanValidatedLedgerRange
  const commit = options.commit ?? commitIncrementalScan
  const now = options.now ?? (() => new Date())
  const endpoint = options.cursor.endpoint ?? options.runtimeConfig.xrplRpcUrls[0]
  if (!endpoint) throw new Error('No XRPL endpoint is configured')
  const stopAt = options.startedAtMs
    + options.incrementalConfig.executionBudgetMs
    - options.incrementalConfig.deadlineMarginMs

  const scanned = await scan({
    endpoint,
    timeoutMs: options.runtimeConfig.rpcTimeoutMs,
    startLedgerIndex: options.cursor.lastProcessedLedger + 1,
    latestValidatedLedger: options.cursor.latestObservedLedger,
    maxLedgers: Math.min(
      options.incrementalConfig.maxLedgersPerRun,
      options.incrementalConfig.maxLedgerRpcRequestsPerRun,
    ),
    expectedPreviousHash: options.cursor.lastProcessedHash,
    shouldContinue: () => now().getTime() < stopAt,
  })

  if (scanned.ledgers.length === 0) {
    const lag = options.cursor.latestObservedLedger - options.cursor.lastProcessedLedger
    return {
      result: { status: 'deferred' as const, ledgersProcessed: 0, lagLedgers: lag },
      state: buildCollectorRunState({
        previous: options.previous,
        status: 'behind',
        now: options.attemptedAt,
        lag,
        endpoint,
        durationMs: Math.max(0, now().getTime() - options.startedAtMs),
      }),
    }
  }

  if (scanned.completeToLatest && scanned.ledgers.at(-1)?.ledgerHash !== options.cursor.latestObservedHash) {
    throw new Error('Validated head hash changed before persistence')
  }

  const selected = selectIncrementalCommitPrefix({
    scan: scanned,
    epochId: options.cursor.epochId,
    config: options.incrementalConfig,
  })
  const finalLedger = selected.scan.ledgers.at(-1)
  if (!finalLedger) throw new Error('Incremental limits produced no commit range')

  await commit({
    db: options.db,
    epochId: options.cursor.epochId,
    base: {
      network: 'devnet',
      epochId: options.scope.epoch_id,
      baseSnapshotId: options.scope.base_snapshot_id,
      baseLedgerIndex: options.scope.base_ledger_index,
      baseLedgerHash: options.scope.base_ledger_hash,
    },
    expectedPreviousLedger: options.cursor.lastProcessedLedger,
    expectedPreviousHash: options.cursor.lastProcessedHash,
    scan: selected.scan,
    processedAt: options.attemptedAt,
    retainPayloads: options.incrementalConfig.retainPayloads,
  })

  const lag = Math.max(0, options.cursor.latestObservedLedger - finalLedger.ledgerIndex)
  return {
    result: {
      status: 'committed' as const,
      ledgersProcessed: selected.scan.ledgers.length,
      lagLedgers: lag,
    },
    state: buildCollectorRunState({
      previous: options.previous,
      status: lag === 0 ? 'healthy' : 'behind',
      now: options.attemptedAt,
      lag,
      endpoint,
      durationMs: Math.max(0, now().getTime() - options.startedAtMs),
      rpcRequests: scanned.metrics.ledgers,
      ledgers: selected.scan.metrics.ledgers,
      inspected: selected.scan.metrics.inspectedTransactions,
      lending: selected.scan.metrics.lendingTransactions,
      rows: selected.estimate.estimatedRows,
      statements: selected.estimate.estimatedStatements,
      overlays: selected.estimate.overlayMutations,
      success: true,
    }),
  }
}
