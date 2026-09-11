import type { ActiveSnapshotRecord } from './core-api-repository'

export type CurrentStateWatermarkSource = 'canonical_overlay' | 'base_snapshot'
export type CountsWatermarkSource = 'canonical_overlay' | 'base_snapshot'

export interface CurrentStateWatermark {
  source: CurrentStateWatermarkSource
  ledgerIndex: number
  ledgerHash: string
  updatedAt: string | null
}

export interface CountsWatermark {
  source: CountsWatermarkSource
  ledgerIndex: number
  ledgerHash: string
  updatedAt: string | null
}

export interface CanonicalOverlayWatermark {
  overlayLedgerIndex: number
  overlayLedgerHash: string
  updatedAt: string
}

export interface ThreeLayerOverviewWatermarks {
  currentState: CurrentStateWatermark
  counts: CountsWatermark
}

function baseWatermark(snapshot: ActiveSnapshotRecord): CurrentStateWatermark {
  return {
    source: 'base_snapshot',
    ledgerIndex: snapshot.ledgerIndex,
    ledgerHash: snapshot.ledgerHash,
    updatedAt: snapshot.completedAt,
  }
}

function overlayWatermark(overlay: CanonicalOverlayWatermark): CurrentStateWatermark {
  return {
    source: 'canonical_overlay',
    ledgerIndex: overlay.overlayLedgerIndex,
    ledgerHash: overlay.overlayLedgerHash,
    updatedAt: overlay.updatedAt,
  }
}

export async function resolveThreeLayerOverviewWatermarks(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
  overlay: CanonicalOverlayWatermark | null
}): Promise<ThreeLayerOverviewWatermarks> {
  const currentState = options.overlay ? overlayWatermark(options.overlay) : baseWatermark(options.snapshot)
  return {
    currentState,
    counts: {
      source: currentState.source,
      ledgerIndex: currentState.ledgerIndex,
      ledgerHash: currentState.ledgerHash,
      updatedAt: currentState.updatedAt,
    },
  }
}
