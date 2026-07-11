import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import { getResolvedCurrentProjection as getCanonicalCurrentProjection } from './base-overlay-current-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  fastObject,
  fastRowsForIds,
  overlayObject,
  overlayRowsForIds,
  parseFastProjection,
  readFastLaneContext,
  type ThreeLayerProjection,
  usableFastSupersedes,
} from './three-layer-fast-read'
import type { ReleaseCurrentStateSource } from './release-current-state'

const BATCH_DETAIL_CONCURRENCY = 8

interface CurrentProjectionResult {
  item: ThreeLayerProjection | null
  assetReads: number
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  transform: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await transform(items[index]!)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

export async function getThreeLayerCurrentProjections(options: {
  db: D1Database
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  objectIds: string[]
}): Promise<{ items: Map<string, ThreeLayerProjection | null>; assetReads: number }> {
  const objectIds = [...new Set(options.objectIds.map((objectId) => objectId.toUpperCase()))]
  const canonicalRows = await mapWithConcurrency(
    objectIds,
    BATCH_DETAIL_CONCURRENCY,
    async (objectId) => ({
      objectId,
      result: await getCanonicalCurrentProjection({ ...options, objectId }),
    }),
  )
  const canonical = new Map<string, CurrentProjectionResult>(
    canonicalRows.map(({ objectId, result }) => [objectId, result]),
  )
  const assetReads = canonicalRows.reduce((total, row) => total + row.result.assetReads, 0)
  const context = await readFastLaneContext(options.db, options.snapshot)
  if (!context || objectIds.length === 0) {
    return {
      items: new Map(canonicalRows.map(({ objectId, result }) => [objectId, result.item])),
      assetReads,
    }
  }

  try {
    const [fastRows, overlayRows] = await Promise.all([
      fastRowsForIds({
        db: options.db,
        context,
        kind: options.kind,
        ids: objectIds,
      }),
      overlayRowsForIds({
        db: options.db,
        snapshot: options.snapshot,
        kind: options.kind,
        ids: objectIds,
      }),
    ])
    const items = new Map<string, ThreeLayerProjection | null>()
    for (const objectId of objectIds) {
      const canonicalResult = canonical.get(objectId)
      if (!canonicalResult) continue
      const fast = fastRows.get(objectId)
      const overlay = overlayRows.get(objectId)
      if (!fast || !usableFastSupersedes({
        fast,
        overlay,
        snapshot: options.snapshot,
        kind: options.kind,
      })) {
        items.set(objectId, canonicalResult.item)
        continue
      }
      if (fast.operation === 'deleted') {
        items.set(objectId, null)
        continue
      }
      try {
        items.set(objectId, parseFastProjection(fast, options.kind))
      } catch {
        items.set(objectId, canonicalResult.item)
      }
    }
    return { items, assetReads }
  } catch {
    return {
      items: new Map(canonicalRows.map(({ objectId, result }) => [objectId, result.item])),
      assetReads,
    }
  }
}

export async function getThreeLayerCurrentProjection(options: {
  db: D1Database
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  objectId: string
}): Promise<CurrentProjectionResult> {
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
