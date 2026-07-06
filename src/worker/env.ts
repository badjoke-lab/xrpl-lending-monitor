import type { CatchUpRuntimeEnvironment } from '../shared/catch-up-runtime-config'
import type { IncrementalRuntimeEnvironment } from '../shared/incremental-runtime-config'
import type { ReplacementBaseRuntimeEnvironment } from '../shared/replacement-base-runtime-config'
import type { RuntimeEnvironment } from '../shared/runtime-config'

export interface Bindings
  extends RuntimeEnvironment,
    IncrementalRuntimeEnvironment,
    CatchUpRuntimeEnvironment,
    ReplacementBaseRuntimeEnvironment {
  ASSETS: Fetcher
  DB: D1Database
}
