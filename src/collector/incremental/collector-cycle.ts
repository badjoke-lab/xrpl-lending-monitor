import type { IncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import type { RuntimeConfig } from '../../shared/runtime-config'
import {
  getIncrementalCollectorState,
  saveIncrementalCollectorState,
} from '../../worker/repositories/incremental-collector-state'
import { getSyncState } from '../../worker/repositories/network-status-repository'
import { buildCollectorRunState } from './collector-run-record'
import { readCollectorScope } from './collector-scope'
import { planCollectorPreflight } from './preflight'
import { runBoundedPreparedIncrementalRange } from './run-bounded-prepared-range'

export interface IncrementalCycleResult {
  status:
    | 'awaiting_initialization'
    | 'caught_up'
    | 'committed'
    | 'deferred'
    | 'reset_suspected'
  ledgersProcessed: number
  lagLedgers: number | null
}

export interface IncrementalCycleDependencies {
  getSync?: typeof getSyncState
  getCollectorState?: typeof getIncrementalCollectorState
  saveCollectorState?: typeof saveIncrementalCollectorState
  readScope?: typeof readCollectorScope
  runRange?: typeof runBoundedPreparedIncrementalRange
  now?: () => Date
}

export async function runIncrementalCollectorCycle(options: {
  db: D1Database
  runtimeConfig: RuntimeConfig
  incrementalConfig: IncrementalRuntimeConfig
  dependencies?: IncrementalCycleDependencies
}): Promise<IncrementalCycleResult> {
  const dependencies = options.dependencies ?? {}
  const getSync = dependencies.getSync ?? getSyncState
  const getCollectorState = dependencies.getCollectorState ?? getIncrementalCollectorState
  const saveCollectorState = dependencies.saveCollectorState ?? saveIncrementalCollectorState
  const readScope = dependencies.readScope ?? readCollectorScope
  const runRange = dependencies.runRange ?? runBoundedPreparedIncrementalRange
  const now = dependencies.now ?? (() => new Date())
  const started = now()
  const attemptedAt = started.toISOString()
  const durationMs = () => Math.max(0, now().getTime() - started.getTime())
  const previous = await getCollectorState(options.db)

  try {
    const sync = await getSync(options.db)
    const scope = sync?.epochId ? await readScope(options.db, sync.epochId) : null
    const preflight = planCollectorPreflight({
      sync,
      scope,
      previous,
      now: attemptedAt,
      durationMs: durationMs(),
    })

    if (preflight.kind === 'stop') {
      await saveCollectorState(options.db, preflight.state)
      return {
        status: preflight.status,
        ledgersProcessed: 0,
        lagLedgers: preflight.lagLedgers,
      }
    }

    if (
      !sync?.epochId
      || sync.lastProcessedLedger === null
      || !sync.lastProcessedHash
      || sync.latestObservedLedger === null
      || !sync.latestObservedHash
    ) throw new Error('Incremental cursor became unavailable after preflight')

    const executed = await runRange({
      db: options.db,
      cursor: {
        epochId: sync.epochId,
        lastProcessedLedger: sync.lastProcessedLedger,
        lastProcessedHash: sync.lastProcessedHash,
        latestObservedLedger: sync.latestObservedLedger,
        latestObservedHash: sync.latestObservedHash,
        endpoint: sync.endpoint,
      },
      scope: preflight.scope,
      previous,
      attemptedAt,
      startedAtMs: started.getTime(),
      runtimeConfig: options.runtimeConfig,
      incrementalConfig: options.incrementalConfig,
      now,
    })
    await saveCollectorState(options.db, executed.state)
    return executed.result
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('Incremental collector failed')
    await saveCollectorState(options.db, buildCollectorRunState({
      previous,
      status: 'error',
      now: attemptedAt,
      lag: null,
      endpoint: null,
      durationMs: durationMs(),
      error: failure,
    }))
    throw error
  }
}
