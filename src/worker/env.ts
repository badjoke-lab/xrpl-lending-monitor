import type { IncrementalRuntimeEnvironment } from '../shared/incremental-runtime-config'
import type { RuntimeEnvironment } from '../shared/runtime-config'

export interface Bindings extends RuntimeEnvironment, IncrementalRuntimeEnvironment {
  ASSETS: Fetcher
  DB: D1Database
}
