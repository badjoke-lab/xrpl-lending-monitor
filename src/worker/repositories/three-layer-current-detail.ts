import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import { getResolvedCurrentProjection as getCanonicalCurrentProjection } from './base-overlay-current-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  fastObject,
  overlayObject,
  parseFastProjection,
  readFastLaneContext,
  type ThreeLayerProjection,
  usableFastSupersedes,
} from './three-layer-fast-read'
import type { ReleaseCurrentStateSource } from './release-current-state'

export async function getThreeLayerCurrentProjection(options: {
  db: D1Database
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  objectId: string
}): Promise<{ item: ThreeLayerProjection | null; assetReads: number }> {
  const objectId = options.objectId.toUpperCase()
  const canonical = await getCanonicalCurrentProjection({ ...options, objectId })
  const context = await readFastLaneContext(options.db, options.snapshot)
  if (!context) return canonical

  try {
    const [fast, overlay] = await Promise.all([
      fastObject({ db: options.db, context, kind: options.kind, objectId }),
      overlayObject({
        db: options.db,
        snapshot: options.snapshot,
        kind: options.kind,
        objectId,
      }),
    ])
    if (!fast || !usableFastSupersedes({
      fast,
      overlay,
      snapshot: options.snapshot,
      kind: options.kind,
    })) return canonical
    if (fast.operation === 'deleted') {
      return { item: null, assetReads: canonical.assetReads }
    }
    return {
      item: parseFastProjection(fast, options.kind),
      assetReads: canonical.assetReads,
    }
  } catch {
    return canonical
  }
}
