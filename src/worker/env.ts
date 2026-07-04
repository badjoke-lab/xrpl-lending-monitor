import type { CatchUpRuntimeEnvironment } from '../shared/catch-up-runtime-config'
import type { IncrementalRuntimeEnvironment } from '../shared/incremental-runtime-config'
import type { RuntimeEnvironment } from '../shared/runtime-config'

export interface Bindings
  extends RuntimeEnvironment,
    IncrementalRuntimeEnvironment,
    CatchUpRuntimeEnvironment {
  ASSETS: Fetcher
  DB: D1Database
}
