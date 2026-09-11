import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import {
  getResolvedCurrentProjection,
  listResolvedCurrentProjections,
} from './base-overlay-current-reader'
import type { ReleaseCurrentStateSource } from './release-current-state'

export const getThreeLayerCurrentProjection = getResolvedCurrentProjection
export const listThreeLayerCurrentProjections = listResolvedCurrentProjections

export async function getThreeLayerCurrentProjections(options: {
  db: D1Database
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  objectIds: string[]
}): Promise<{ items: Map<string, Awaited<ReturnType<typeof getResolvedCurrentProjection>>['item']>; assetReads: number }> {
  const items = new Map<string, Awaited<ReturnType<typeof getResolvedCurrentProjection>>['item']>()
  let assetReads = 0
  for (const objectId of options.objectIds) {
    const resolved = await getResolvedCurrentProjection({
      db: options.db,
      source: options.source,
      snapshot: options.snapshot,
      kind: options.kind,
      objectId,
    })
    items.set(objectId, resolved.item)
    assetReads += resolved.assetReads
  }
  return { items, assetReads }
}
