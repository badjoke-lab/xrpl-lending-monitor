import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { Bindings } from '../env'
import { readResolvedOverlayState } from '../repositories/base-overlay-current-reader'
import { resolveBaseOverlaySnapshotCounts } from '../repositories/base-overlay-overview'
import { getCurrentEpoch, getSyncState } from '../repositories/network-status-repository'
import { resolveCurrentStateStorage } from '../repositories/release-current-state'
import { resolveThreeLayerOverviewWatermarks } from '../repositories/three-layer-overview-watermark'
import { serializeOverview } from '../serializers/core-api'

export async function handleThreeLayerOverview(
  request: Request,
  env: Bindings,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.pathname !== '/api/overview') return null

  const config = resolveRuntimeConfig(env)
  const [state, epoch, currentState] = await Promise.all([
    getSyncState(env.DB),
    getCurrentEpoch(env.DB),
    resolveCurrentStateStorage(config, env.DB),
  ])

  const snapshot = currentState.snapshot
    ? await resolveBaseOverlaySnapshotCounts(env.DB, currentState.snapshot)
    : null
  const overlay = snapshot
    ? await readResolvedOverlayState({ db: env.DB, snapshot })
    : null
  const watermarks = snapshot
    ? await resolveThreeLayerOverviewWatermarks({ db: env.DB, snapshot, overlay })
    : null

  return Response.json(serializeOverview({
    state,
    epoch,
    snapshot,
    overlay,
    watermarks,
  }))
}
