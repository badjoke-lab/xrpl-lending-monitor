import type { ReadModelKind } from '../../shared/current-state/github-read-model-reader'
import {
  listResolvedCurrentProjections as listCanonicalCurrentProjections,
  type BaseOverlayListOptions,
  type BaseOverlayListResult,
} from './base-overlay-current-reader'
import type { ActiveSnapshotRecord } from './core-api-repository'
import { CurrentStateObjectReadError } from './current-state-read-error'
import {
  encodeThreeLayerCursor,
  readThreeLayerCursor,
} from './three-layer-cursor'
import {
  fastIsNewer,
  fastRowsForIds,
  loadFastLanePage,
  overlayRowsForIds,
  parseFastProjection,
  readFastLaneContext,
  type PositionedCurrentRow,
  type ThreeLayerProjection,
  usableFastSupersedes,
} from './three-layer-fast-read'
import type { ReleaseCurrentStateSource } from './release-current-state'

const PAGE_SIZE = 100
const MAX_PAGES_PER_REQUEST = 4

function compareIds(left: string, right: string, direction: 'asc' | 'desc'): number {
  const comparison = left.localeCompare(right)
  return direction === 'asc' ? comparison : -comparison
}

export async function listThreeLayerCurrentProjections(options: {
  db: D1Database
  source: ReleaseCurrentStateSource
  snapshot: ActiveSnapshotRecord
  kind: ReadModelKind
  list: BaseOverlayListOptions
}): Promise<BaseOverlayListResult> {
  if (!Number.isSafeInteger(options.list.limit) || options.list.limit < 1 || options.list.limit > 100) {
    throw new Error('limit must be an integer from 1 to 100')
  }

  const context = await readFastLaneContext(options.db, options.snapshot)
  const cursor = readThreeLayerCursor({
    value: options.list.cursor,
    snapshot: options.snapshot,
    kind: options.kind,
    list: options.list,
    fastToken: context?.token ?? null,
  })
  const activeContext = cursor.fastToken === null ? null : context
  if (cursor.fastToken !== null && !activeContext) {
    throw new CurrentStateObjectReadError(
      'manifest_integrity_error',
      'fast-lane read context is unavailable during pagination',
    )
  }

  const predicate = options.list.predicate ?? (() => true)
  const output: ThreeLayerProjection[] = []
  let basePageReads = 0
  let objectsExamined = 0
  let canonicalPageReads = 0
  let fastPageReads = 0

  while (output.length < options.list.limit && (!cursor.canonicalDone || !cursor.fastDone)) {
    let canonicalLoaded = false
    let canonicalItems: ThreeLayerProjection[] = []
    let canonicalNextCursor: string | null = null
    let fastForCanonical = new Map<string, PositionedCurrentRow>()
    let overlayForCanonical = new Map<string, PositionedCurrentRow>()

    if (!cursor.canonicalDone && canonicalPageReads < MAX_PAGES_PER_REQUEST) {
      const page = await listCanonicalCurrentProjections({
        db: options.db,
        source: options.source,
        snapshot: options.snapshot,
        kind: options.kind,
        list: {
          ...options.list,
          limit: PAGE_SIZE,
          cursor: cursor.canonicalCursor ?? undefined,
        },
      })
      canonicalLoaded = true
      canonicalPageReads += 1
      basePageReads += page.basePageReads
      objectsExamined += page.objectsExamined
      canonicalItems = page.items
      canonicalNextCursor = page.nextCursor
      if (cursor.canonicalOffset > canonicalItems.length) {
        throw new CurrentStateObjectReadError(
          'invalid_cursor',
          'canonical cursor offset is beyond the current page',
        )
      }
      if (activeContext && canonicalItems.length > 0) {
        const ids = canonicalItems.map((item) => item.id)
        const [fastRows, overlayRows] = await Promise.all([
          fastRowsForIds({
            db: options.db,
            context: activeContext,
            kind: options.kind,
            ids,
          }),
          overlayRowsForIds({
            db: options.db,
            snapshot: options.snapshot,
            kind: options.kind,
            ids,
          }),
        ])
        fastForCanonical = fastRows
        overlayForCanonical = overlayRows
      }
    }

    let fastLoaded = false
    let fastRows: PositionedCurrentRow[] = []
    let fastScanEndId = cursor.fastAfter
    let fastComplete = false
    let overlayForFast = new Map<string, PositionedCurrentRow>()

    if (!cursor.fastDone && activeContext && fastPageReads < MAX_PAGES_PER_REQUEST) {
      const page = await loadFastLanePage({
        db: options.db,
        context: activeContext,
        kind: options.kind,
        direction: options.list.direction,
        after: cursor.fastAfter,
      })
      fastLoaded = true
      fastPageReads += 1
      objectsExamined += page.rows.length
      fastRows = page.rows
      fastScanEndId = page.scanEndId
      fastComplete = page.complete
      if (cursor.fastOffset > fastRows.length) {
        throw new CurrentStateObjectReadError(
          'invalid_cursor',
          'fast-lane cursor offset is beyond the current page',
        )
      }
      if (fastRows.length > 0) {
        overlayForFast = await overlayRowsForIds({
          db: options.db,
          snapshot: options.snapshot,
          kind: options.kind,
          ids: fastRows.map((row) => row.object_id),
        })
      }
    }

    const canonicalCandidate = (): ThreeLayerProjection | null => {
      while (cursor.canonicalOffset < canonicalItems.length) {
        const candidate = canonicalItems[cursor.canonicalOffset]!
        const fast = fastForCanonical.get(candidate.id)
        const overlay = overlayForCanonical.get(candidate.id)
        if (fast && usableFastSupersedes({
          fast,
          overlay,
          snapshot: options.snapshot,
          kind: options.kind,
        })) {
          cursor.canonicalOffset += 1
          continue
        }
        return candidate
      }
      return null
    }

    const fastCandidate = (): ThreeLayerProjection | null => {
      while (cursor.fastOffset < fastRows.length) {
        const row = fastRows[cursor.fastOffset]!
        const overlay = overlayForFast.get(row.object_id)
        if (!fastIsNewer(row, overlay, options.snapshot)) {
          cursor.fastOffset += 1
          continue
        }
        let projection: ThreeLayerProjection
        try {
          projection = parseFastProjection(row, options.kind)
        } catch {
          cursor.fastOffset += 1
          continue
        }
        if (!predicate(projection)) {
          cursor.fastOffset += 1
          continue
        }
        return projection
      }
      return null
    }

    while (output.length < options.list.limit) {
      const canonical = canonicalCandidate()
      const fast = fastCandidate()
      if (!canonical && !fast) break
      if (canonical && (!fast || compareIds(canonical.id, fast.id, options.list.direction) < 0)) {
        output.push(canonical)
        cursor.canonicalOffset += 1
        continue
      }
      if (fast && (!canonical || compareIds(fast.id, canonical.id, options.list.direction) < 0)) {
        output.push(fast)
        cursor.fastOffset += 1
        continue
      }
      if (canonical && fast) {
        output.push(fast)
        cursor.canonicalOffset += 1
        cursor.fastOffset += 1
      }
    }

    let advanced = false
    if (canonicalLoaded && !cursor.canonicalDone && cursor.canonicalOffset >= canonicalItems.length) {
      if (canonicalNextCursor === null) {
        cursor.canonicalDone = true
      } else {
        cursor.canonicalCursor = canonicalNextCursor
        cursor.canonicalOffset = 0
        advanced = true
      }
    }
    if (fastLoaded && !cursor.fastDone && cursor.fastOffset >= fastRows.length) {
      if (fastComplete) {
        cursor.fastDone = true
      } else {
        cursor.fastAfter = fastScanEndId
        cursor.fastOffset = 0
        advanced = true
      }
    }

    if (output.length >= options.list.limit) break
    if (!advanced) break
    if (
      canonicalPageReads >= MAX_PAGES_PER_REQUEST
      && fastPageReads >= MAX_PAGES_PER_REQUEST
    ) break
  }

  return {
    items: output,
    nextCursor: cursor.canonicalDone && cursor.fastDone ? null : encodeThreeLayerCursor(cursor),
    basePageReads,
    objectsExamined,
  }
}
