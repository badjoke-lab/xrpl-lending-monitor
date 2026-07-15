import type { CatchUpRuntimeEnvironment } from '../shared/catch-up-runtime-config'
import type { FastLaneShadowRuntimeEnvironment } from '../shared/fast-lane-shadow-runtime-config'
import type { IncrementalRuntimeEnvironment } from '../shared/incremental-runtime-config'
import type { ReplacementBaseRuntimeEnvironment } from '../shared/replacement-base-runtime-config'
import type { RuntimeEnvironment } from '../shared/runtime-config'

export interface FastLaneQueueMessage {
  scheduledTime: number
  cron: string
  enqueuedAt: string
}

export interface Bindings
  extends RuntimeEnvironment,
    IncrementalRuntimeEnvironment,
    CatchUpRuntimeEnvironment,
    ReplacementBaseRuntimeEnvironment,
    FastLaneShadowRuntimeEnvironment {
  ASSETS: Fetcher
  DB: D1Database
  FAST_LANE_QUEUE: Queue<FastLaneQueueMessage>
  REPLACEMENT_BASE_CUTOVER_TOKEN?: string
  P0_CANONICAL_BRIDGE_TOKEN?: string
}
