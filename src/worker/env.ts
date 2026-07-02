import type { RuntimeEnvironment } from '../shared/runtime-config'

export interface Bindings extends RuntimeEnvironment {
  ASSETS: Fetcher
  DB: D1Database
  CURRENT_STATE?: R2Bucket
}
