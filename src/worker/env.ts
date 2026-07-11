import type { CatchUpRuntimeEnvironment } from '../shared/catch-up-runtime-config'
import type { FastLaneShadowRuntimeEnvironment } from '../shared/fast-lane-shadow-runtime-config'
import type { IncrementalRuntimeEnvironment } from '../shared/incremental-runtime-config'
import type { ReplacementBaseRuntimeEnvironment } from '../shared/replacement-base-runtime-config'
import type { RuntimeEnvironment } from '../shared/runtime-config'

export interface Bindings
  extends RuntimeEnvironment,
    IncrementalRuntimeEnvironment,
    CatchUpRuntimeEnvironment,
    ReplacementBaseRuntimeEnvironment,
    FastLaneShadowRuntimeEnvironment {
  ASSETS: Fetcher
  DB: D1Database
  REPLACEMENT_BASE_CUTOVER_TOKEN?: string
}
