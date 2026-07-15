import { getPlatformProxy } from 'wrangler'

import { runFastLaneShadowCycle } from '../src/collector/incremental/fast-lane-shadow-cycle'
import { resolveFastLaneShadowRuntimeConfig } from '../src/shared/fast-lane-shadow-runtime-config'
import { resolveReplacementBaseRuntimeConfig } from '../src/shared/replacement-base-runtime-config'
import { resolveRuntimeConfig } from '../src/shared/runtime-config'
import type { Bindings } from '../src/worker/env'
import { promoteFastLaneCompactToCanonicalOverlay } from '../src/worker/operator/fast-lane-canonical-bridge'
import {
  deleteFastLaneShadowRunHeartbeat,
  saveFastLaneShadowRunError,
  saveFastLaneShadowRunHeartbeat,
  saveFastLaneShadowRunMetric,
} from '../src/worker/repositories/fast-lane-shadow-run-metrics'
import {
  assertFastLaneStorageCapacity,
  pruneFastLaneStorage,
} from '../src/worker/repositories/fast-lane-storage-retention'

const MAX_PASSES = 8
const FIVE_MINUTES_MS = 5 * 60_000
const ONE_HOUR_MS = 60 * 60_000

interface FastLaneStateRow {
  last_processed_ledger: number
  latest_observed_ledger: number
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function scheduledSlot(now = Date.now()): number {
  return Math.floor(now / FIVE_MINUTES_MS) * FIVE_MINUTES_MS
}

function shouldCheckOverlayCapacity(slot: number): boolean {
  return Math.floor(slot / ONE_HOUR_MS) !== Math.floor((slot - FIVE_MINUTES_MS) / ONE_HOUR_MS)
}

async function fastLaneCaughtUp(db: D1Database): Promise<boolean> {
  const row = await db.prepare(
    `SELECT last_processed_ledger, latest_observed_ledger
     FROM fast_lane_shadow_state
     WHERE network = 'devnet'`,
  ).first<FastLaneStateRow>()
  return Boolean(row && row.last_processed_ledger >= row.latest_observed_ledger)
}

async function main(): Promise<void> {
  const platform = await getPlatformProxy<Bindings>({
    configPath: 'wrangler.jsonc',
    remoteBindings: true,
  })

  const env = platform.env
  const runAt = new Date().toISOString()
  const slot = scheduledSlot()
  let heartbeatSaved = false

  try {
    if (env.APP_NETWORK !== 'devnet' || env.MAINNET_ENABLED !== 'false') {
      throw new Error('five-minute collector requires the devnet-only runtime')
    }

    const replacementBase = resolveReplacementBaseRuntimeConfig(env).target
    if (!replacementBase) {
      throw new Error('five-minute collector requires the configured replacement base')
    }

    await saveFastLaneShadowRunHeartbeat({ db: env.DB, runAt })
    heartbeatSaved = true

    await assertFastLaneStorageCapacity(env.DB, {
      includeOverlay: shouldCheckOverlayCapacity(slot),
    })

    const runtimeConfig = resolveRuntimeConfig(env)
    const fastLaneConfig = resolveFastLaneShadowRuntimeConfig(env)
    const passes = []
    let caughtUp = false

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const passRunAt = new Date(Date.parse(runAt) + pass).toISOString()
      const result = await runFastLaneShadowCycle({
        db: env.DB,
        runtimeConfig,
        fastLaneConfig,
        base: replacementBase,
      })
      await saveFastLaneShadowRunMetric({ db: env.DB, runAt: passRunAt, result })
      passes.push(result)
      caughtUp = await fastLaneCaughtUp(env.DB)
      if (caughtUp) break
    }

    const promotion = caughtUp
      ? await promoteFastLaneCompactToCanonicalOverlay(env.DB)
      : null

    await pruneFastLaneStorage(env.DB)
    await assertFastLaneStorageCapacity(env.DB, { includeOverlay: false })
    await deleteFastLaneShadowRunHeartbeat({ db: env.DB, runAt })
    heartbeatSaved = false

    process.stdout.write(`${JSON.stringify({
      status: caughtUp ? 'completed' : 'deferred',
      runAt,
      slot: new Date(slot).toISOString(),
      caughtUp,
      passes,
      promotion,
    }, null, 2)}\n`)

    if (!caughtUp) {
      throw new Error('five-minute collector exhausted bounded catch-up before lag zero')
    }
  } catch (error) {
    const reason = errorReason(error)
    if (heartbeatSaved) {
      try {
        await saveFastLaneShadowRunError({
          db: env.DB,
          runAt,
          errorMessage: reason,
        })
      } catch (persistenceError) {
        process.stderr.write(`failed to persist collector error: ${errorReason(persistenceError)}\n`)
      }
    }
    throw error
  } finally {
    await platform.dispose()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${errorReason(error)}\n`)
  process.exitCode = 1
})
