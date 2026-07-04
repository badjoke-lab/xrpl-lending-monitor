import type { IncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import type { RuntimeConfig } from '../../shared/runtime-config'
import {
  runIncrementalCollectorCycle,
  type IncrementalCycleDependencies,
} from './collector-cycle'
import { runBoundedPreparedIncrementalRange } from './run-bounded-prepared-range'

export function runBoundedIncrementalCollectorCycle(options: {
  db: D1Database
  runtimeConfig: RuntimeConfig
  incrementalConfig: IncrementalRuntimeConfig
  dependencies?: IncrementalCycleDependencies
}) {
  return runIncrementalCollectorCycle({
    ...options,
    dependencies: {
      ...options.dependencies,
      runRange: options.dependencies?.runRange ?? runBoundedPreparedIncrementalRange,
    },
  })
}
