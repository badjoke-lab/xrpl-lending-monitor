import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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
import { readFastLaneShadowState } from '../src/worker/repositories/fast-lane-shadow-repository'
import {
  assertFastLaneStorageCapacity,
  pruneFastLaneStorage,
} from '../src/worker/repositories/fast-lane-storage-retention'
import { createD1HttpDatabase } from './d1-http-adapter'

const DEFAULT_FAST_LANE_PASSES_PER_RUN = 8
const MAX_FAST_LANE_PASSES_PER_RUN = 64
const FIVE_MINUTE_MS = 5 * 60_000

interface WranglerD1Binding {
  binding?: string
  database_id?: string
}

interface WranglerConfig {
  vars?: Record<string, string>
  d1_databases?: WranglerD1Binding[]
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function passesPerRun(): number {
  const raw = process.env.FAST_LANE_PASSES_PER_RUN?.trim()
  if (!raw) return DEFAULT_FAST_LANE_PASSES_PER_RUN
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_FAST_LANE_PASSES_PER_RUN) {
    throw new Error(`FAST_LANE_PASSES_PER_RUN must be an integer from 1 to ${MAX_FAST_LANE_PASSES_PER_RUN}`)
  }
  return value
}

function scheduledSlot(now: number): string {
  const supplied = process.env.FAST_LANE_SCHEDULED_SLOT?.trim()
  if (supplied) {
    const parsed = Date.parse(supplied)
    if (!Number.isFinite(parsed)) throw new Error('FAST_LANE_SCHEDULED_SLOT is invalid')
    return new Date(parsed).toISOString()
  }
  return new Date(Math.floor(now / FIVE_MINUTE_MS) * FIVE_MINUTE_MS).toISOString()
}

function shouldCheckOverlayCapacity(date: Date): boolean {
  return date.getUTCMinutes() < 5
}

async function readWranglerConfig(): Promise<WranglerConfig> {
  const path = resolve(process.env.WRANGLER_CONFIG_PATH ?? 'wrangler.jsonc')
  const text = await readFile(path, 'utf8')
  return JSON.parse(text) as WranglerConfig
}

function validateRuntimeVars(vars: Record<string, string>): void {
  if (vars.APP_NETWORK !== 'devnet') throw new Error('fast-lane production runner requires APP_NETWORK=devnet')
  if (vars.MAINNET_ENABLED !== 'false') throw new Error('fast-lane production runner requires MAINNET_ENABLED=false')
  const required = [
    'XRPL_DEVNET_RPC_URL',
    'XRPL_RPC_TIMEOUT_MS',
    'REPLACEMENT_BASE_EPOCH_ID',
    'REPLACEMENT_BASE_SNAPSHOT_ID',
    'REPLACEMENT_BASE_LEDGER_INDEX',
    'REPLACEMENT_BASE_LEDGER_HASH',
    'FAST_LANE_WEBSOCKET_ENDPOINT',
    'FAST_LANE_MAX_LEDGERS_PER_RUN',
    'FAST_LANE_REANCHOR_LAG_LEDGERS',
    'FAST_LANE_READ_WINDOW',
  ]
  for (const name of required) {
    if (!vars[name]?.trim()) throw new Error(`wrangler vars.${name} is required`)
  }
}

async function main(): Promise<void> {
  const config = await readWranglerConfig()
  const vars = config.vars ?? {}
  const maxPasses = passesPerRun()
  validateRuntimeVars(vars)
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim()
    ?? config.d1_databases?.find((entry) => entry.binding === 'DB')?.database_id
  if (!databaseId) throw new Error('D1 database id is required')

  if (process.argv.includes('--validate-config')) {
    process.stdout.write(`${JSON.stringify({
      status: 'valid',
      network: vars.APP_NETWORK,
      databaseId,
      passesPerRun: maxPasses,
    }, null, 2)}\n`)
    return
  }

  const database = createD1HttpDatabase({
    accountId: requiredEnvironment('CLOUDFLARE_ACCOUNT_ID'),
    databaseId,
    apiToken: requiredEnvironment('CLOUDFLARE_API_TOKEN'),
  })
  const env = { ...vars, DB: database } as unknown as Bindings
  const runtimeConfig = resolveRuntimeConfig(env)
  const fastLaneConfig = resolveFastLaneShadowRuntimeConfig(env)
  const replacementBase = resolveReplacementBaseRuntimeConfig(env).target
  if (!replacementBase) throw new Error('fast-lane production runner requires a replacement base target')

  const startedAt = new Date()
  const runAt = startedAt.toISOString()
  const slot = scheduledSlot(startedAt.getTime())
  let phase = 'heartbeat'
  await saveFastLaneShadowRunHeartbeat({ db: database, runAt })

  try {
    phase = 'capacity'
    await assertFastLaneStorageCapacity(database, {
      includeOverlay: shouldCheckOverlayCapacity(startedAt),
    })

    phase = 'collecting'
    let caughtUp = false
    let lastResult: Awaited<ReturnType<typeof runFastLaneShadowCycle>> | null = null
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const result = await runFastLaneShadowCycle({
        db: database,
        runtimeConfig,
        fastLaneConfig,
        base: replacementBase,
      })
      const metricRunAt = new Date(Date.now() + pass).toISOString()
      await saveFastLaneShadowRunMetric({ db: database, runAt: metricRunAt, result })
      lastResult = result
      caughtUp = result.lagLedgers === 0
      process.stdout.write(`${JSON.stringify({
        event: 'fast_lane_action_pass',
        slot,
        pass: pass + 1,
        ...result,
      })}\n`)
      if (caughtUp) break
    }

    if (!caughtUp || !lastResult) {
      throw new Error(`fast-lane action did not catch up within ${maxPasses} passes; lag=${lastResult?.lagLedgers ?? 'unknown'}`)
    }

    phase = 'promoting'
    const promotion = await promoteFastLaneCompactToCanonicalOverlay(database)

    phase = 'pruning'
    await pruneFastLaneStorage(database)
    await assertFastLaneStorageCapacity(database, { includeOverlay: false })

    phase = 'completed'
    const finalState = await readFastLaneShadowState(database)
    await deleteFastLaneShadowRunHeartbeat({ db: database, runAt })
    process.stdout.write(`${JSON.stringify({
      event: 'fast_lane_action_completed',
      slot,
      runAt,
      finalState,
      promotion,
    })}\n`)
  } catch (error) {
    const reason = `${phase}: ${errorReason(error)}`
    try {
      await saveFastLaneShadowRunError({ db: database, runAt, errorMessage: reason })
    } catch (persistenceError) {
      process.stderr.write(`failed to persist fast-lane action error: ${errorReason(persistenceError)}\n`)
    }
    throw new Error(reason, { cause: error })
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${errorReason(error)}\n`)
  process.exitCode = 1
})
