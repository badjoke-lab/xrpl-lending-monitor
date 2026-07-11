import type { ActiveSnapshotRecord } from './core-api-repository'
import { readFastLaneShadowBaseBinding } from './fast-lane-shadow-base-binding'
import { readFastLaneShadowState } from './fast-lane-shadow-repository'

export type CurrentStateWatermarkSource = 'fast_lane' | 'canonical_overlay' | 'base_snapshot'
export type CountsWatermarkSource = 'canonical_overlay' | 'base_snapshot'

export interface CurrentStateWatermark {
  source: CurrentStateWatermarkSource
  ledgerIndex: number
  ledgerHash: string
  updatedAt: string
}

export interface CountsWatermark {
  source: CountsWatermarkSource
  ledgerIndex: number
  ledgerHash: string
  updatedAt: string
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

function sameHash(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase()
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

async function eligibleFastWatermark(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
}): Promise<CurrentStateWatermark | null> {
  try {
    const [binding, state] = await Promise.all([
      readFastLaneShadowBaseBinding(options.db),
      readFastLaneShadowState(options.db),
    ])
    if (!binding || !state || state.status === 'error') return null
    if (state.epochId !== binding.shadowEpochId) return null
    if (
      binding.base.epochId !== options.snapshot.epochId
      || binding.base.snapshotId !== options.snapshot.id
      || binding.base.ledgerIndex !== options.snapshot.ledgerIndex
      || !sameHash(binding.base.ledgerHash, options.snapshot.ledgerHash)
    ) return null
    if (state.lastProcessedLedger < options.snapshot.ledgerIndex) return null
    return {
      source: 'fast_lane',
      ledgerIndex: state.lastProcessedLedger,
      ledgerHash: state.lastProcessedHash,
      updatedAt: state.updatedAt,
    }
  } catch {
    return null
  }
}

export async function resolveThreeLayerOverviewWatermarks(options: {
  db: D1Database
  snapshot: ActiveSnapshotRecord
  overlay: CanonicalOverlayWatermark | null
}): Promise<ThreeLayerOverviewWatermarks> {
  const base = baseWatermark(options.snapshot)
  const canonical = options.overlay ? overlayWatermark(options.overlay) : base
  const fast = await eligibleFastWatermark({ db: options.db, snapshot: options.snapshot })

  let currentState = canonical
  if (fast) {
    if (fast.ledgerIndex > canonical.ledgerIndex) {
      currentState = fast
    } else if (
      fast.ledgerIndex === canonical.ledgerIndex
      && sameHash(fast.ledgerHash, canonical.ledgerHash)
    ) {
      currentState = fast
    }
  }

  return {
    currentState,
    counts: {
      source: options.overlay ? 'canonical_overlay' : 'base_snapshot',
      ledgerIndex: canonical.ledgerIndex,
      ledgerHash: canonical.ledgerHash,
      updatedAt: canonical.updatedAt,
    },
  }
}
