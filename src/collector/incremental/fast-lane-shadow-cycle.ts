import { XrplJsonRpcClient } from '../network/xrpl-rpc'
import type { CatchUpBaseIdentity } from '../../shared/catch-up-base-identity'
import type { RuntimeConfig } from '../../shared/runtime-config'
import type { FastLaneShadowRuntimeConfig } from '../../shared/fast-lane-shadow-runtime-config'
import { buildFastLaneShadowWindowPlan } from './fast-lane-shadow-plan'
import { fastLaneShadowReanchorReason } from './fast-lane-shadow-reanchor'
import { scanValidatedLedgerRange } from './scan-validated-ledgers'
import { createXrplWebSocketLedgerSession } from './xrpl-websocket-ledger-session'
import {
  commitFastLaneCompactShadowWindow,
} from '../../worker/repositories/fast-lane-compact-shadow-repository'
import { buildBoundedFastLaneHistoryWindow } from '../../worker/repositories/fast-lane-history-window'
import {
  bindFastLaneShadowBase,
  readFastLaneShadowBaseBinding,
  sameFastLaneShadowBaseBinding,
} from '../../worker/repositories/fast-lane-shadow-base-binding'
import {
  readFastLaneShadowState,
} from '../../worker/repositories/fast-lane-shadow-repository'

const SHADOW_EPOCH_ID = 'fast-lane-shadow-devnet'

export interface FastLaneShadowCycleResult {
  status: 'caught_up' | 'committed' | 'reanchored'
  startLedgerIndex: number | null
  endLedgerIndex: number | null
  latestObservedLedger: number
  lagLedgers: number
  ledgersProcessed: number
  lendingTransactions: number
  coalescedObjectRows: number
  persistenceRowsRead: number
  persistenceRowsWritten: number
}

interface ValidatedHead {
  ledgerIndex: number
  ledgerHash: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) throw new Error(`${field} is invalid`)
  return Number(parsed)
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} is invalid`)
  return value
}

export function selectFastLaneHeadRpcEndpoint(options: {
  rpcEndpoints: readonly string[]
  webSocketEndpoint: string
}): string {
  const fallback = options.rpcEndpoints[0]
  if (!fallback) throw new Error('Fast-lane shadow requires a Devnet RPC endpoint')

  const webSocketHost = new URL(options.webSocketEndpoint).hostname.toLowerCase()
  return options.rpcEndpoints.find((endpoint) => (
    new URL(endpoint).hostname.toLowerCase() === webSocketHost
  )) ?? fallback
}

async function readLedgerIdentity(options: {
  endpoint: string
  timeoutMs: number
  ledgerIndex: number | 'validated'
}): Promise<ValidatedHead> {
  const client = new XrplJsonRpcClient({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
  })
  const result = await client.call<Record<string, unknown>>('ledger', {
    ledger_index: options.ledgerIndex,
    transactions: false,
    expand: false,
  })
  const ledger = isRecord(result.ledger) ? result.ledger : null
  const ledgerIndex = integer(
    result.ledger_index ?? ledger?.ledger_index ?? ledger?.seqNum,
    'validated ledger index',
  )
  const ledgerHash = stringValue(
    result.ledger_hash ?? ledger?.ledger_hash ?? ledger?.hash,
    'validated ledger hash',
  )
  return { ledgerIndex, ledgerHash: ledgerHash.toUpperCase() }
}

export async function readFastLaneValidatedHead(options: {
  endpoint: string
  timeoutMs: number
}): Promise<ValidatedHead> {
  return readLedgerIdentity({ ...options, ledgerIndex: 'validated' })
}

async function verifyFastLaneBaseIdentity(options: {
  endpoint: string
  timeoutMs: number
  head: ValidatedHead
  base: CatchUpBaseIdentity
}): Promise<void> {
  if (options.head.ledgerIndex < options.base.ledgerIndex) {
    throw new Error('Fast-lane validated head is below the configured canonical base ledger')
  }
  const observed = await readLedgerIdentity({
    endpoint: options.endpoint,
    timeoutMs: options.runtimeConfig?.rpcTimeoutMs ?? options.timeoutMs,
    ledgerIndex: options.base.ledgerIndex,
  })
  if (
    observed.ledgerIndex !== options.base.ledgerIndex
    || observed.ledgerHash !== options.base.ledgerHash.toUpperCase()
  ) {
    throw new Error('Fast-lane canonical base ledger identity verification failed')
  }
}

export async function resetFastLaneCompactShadow(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM fast_lane_shadow_commit_guards'),
    db.prepare('DELETE FROM fast_lane_shadow_windows'),
    db.prepare('DELETE FROM fast_lane_shadow_objects_compact'),
    db.prepare('DELETE FROM fast_lane_shadow_state'),
    db.prepare('DELETE FROM fast_lane_shadow_base_binding'),
  ])
}

export async function runFastLaneShadowCycle(options: {
  db: D1Database
  runtimeConfig: RuntimeConfig
  fastLaneConfig: FastLaneShadowRuntimeConfig
  base: CatchUpBaseIdentity
  now?: () => Date
}): Promise<FastLaneShadowCycleResult> {
  const now = options.now ?? (() => new Date())
  const processedAt = now().toISOString()
  const endpoint = selectFastLaneHeadRpcEndpoint({
    rpcEndpoints: options.runtimeConfig.xrplRpcUrls,
    webSocketEndpoint: options.fastLaneConfig.webSocketEndpoint,
  })

  const head = await readFastLaneValidatedHead({
    endpoint,
    timeoutMs: options.runtimeConfig.rpcTimeoutMs,
  })
  let state = await readFastLaneShadowState(options.db)
  const binding = await readFastLaneShadowBaseBinding(options.db)
  let reanchored = false

  const bindingMatches = sameFastLaneShadowBaseBinding({
    binding,
    shadowEpochId: SHADOW_EPOCH_ID,
    base: options.base,
  })
  const reanchorReason = fastLaneShadowReanchorReason({
    state,
    head,
    expectedEpochId: SHADOW_EPOCH_ID,
    reanchorLagLedgers: options.fastLaneConfig.reanchorLagLedgers,
  })

  if (!bindingMatches || reanchorReason !== null) {
    await verifyFastLaneBaseIdentity({
      endpoint,
      timeoutMs: options.runtimeConfig.rpcTimeoutMs,
      head,
      base: options.base,
    })
    await resetFastLaneCompactShadow(options.db)
    await bindFastLaneShadowBase({
      db: options.db,
      shadowEpochId: SHADOW_EPOCH_ID,
      base: options.base,
      boundAt: processedAt,
    })
    state = null
    reanchored = true
  }

  if (state && state.lastProcessedLedger >= head.ledgerIndex) {
    return {
      status: 'caught_up',
      startLedgerIndex: null,
      endLedgerIndex: state.lastProcessedLedger,
      latestObservedLedger: head.ledgerIndex,
      lagLedgers: 0,
      ledgersProcessed: 0,
      lendingTransactions: 0,
      coalescedObjectRows: 0,
      persistenceRowsRead: 0,
      persistenceRowsWritten: 0,
    }
  }

  const startLedgerIndex = state
    ? state.lastProcessedLedger + 1
    : Math.max(options.base.ledgerIndex + 1, head.ledgerIndex - options.fastLaneConfig.bootstrapLedgers + 1)
  const expectedPreviousLedger = startLedgerIndex - 1

  const session = createXrplWebSocketLedgerSession({
    endpoint: options.fastLaneConfig.webSocketEndpoint,
  })
  try {
    const previousHash = state?.lastProcessedHash ?? (
      await session.reader({
        endpoint: options.fastLaneConfig.webSocketEndpoint,
        ledgerIndex: expectedPreviousLedger,
        timeoutMs: options.runtimeConfig.rpcTimeoutMs,
      })
    ).ledgerHash

    const scanned = await scanValidatedLedgerRange({
      endpoint: options.fastLaneConfig.webSocketEndpoint,
      timeoutMs: options.runtimeConfig.rpcTimeoutMs,
      startLedgerIndex,
      latestValidatedLedger: head.ledgerIndex,
      maxLedgers: options.fastLaneConfig.maxLedgersPerRun,
      expectedPreviousHash: previousHash,
      reader: session.reader,
      readWindowSize: options.fastLaneConfig.readWindow,
    })
    const scannedFinalLedger = scanned.ledgers.at(-1)
    if (!scannedFinalLedger) {
      return {
        status: 'caught_up',
        startLedgerIndex: null,
        endLedgerIndex: expectedPreviousLedger,
        latestObservedLedger: head.ledgerIndex,
        lagLedgers: Math.max(0, head.ledgerIndex - expectedPreviousLedger),
        ledgersProcessed: 0,
        lendingTransactions: 0,
        coalescedObjectRows: 0,
        persistenceRowsRead: 0,
        persistenceRowsWritten: 0,
      }
    }

    const bounded = await buildBoundedFastLaneHistoryWindow({
      scan: scanned,
      epochId: options.base.epochId,
      processedAt,
    })
    const plan = buildFastLaneShadowWindowPlan({
      epochId: SHADOW_EPOCH_ID,
      scan: bounded.scan,
      latestObservedHash: head.ledgerHash,
      processedAt,
    })
    const persistence = await commitFastLaneCompactShadowWindow({
      db: options.db,
      plan,
      historyBundle: bounded.bundle,
      encodedHistoryBundle: bounded.encodedBundle,
      expectedPreviousLedger,
      expectedPreviousHash: previousHash,
      processedAt,
    })
    const lagLedgers = Math.max(0, head.ledgerIndex - plan.endLedgerIndex)

    return {
      status: reanchored ? 'reanchored' : 'committed',
      startLedgerIndex: plan.startLedgerIndex,
      endLedgerIndex: plan.endLedgerIndex,
      latestObservedLedger: head.ledgerIndex,
      lagLedgers,
      ledgersProcessed: bounded.scan.metrics.ledgers,
      lendingTransactions: plan.lendingTransactions,
      coalescedObjectRows: plan.mutations.length,
      persistenceRowsRead: persistence.rowsRead,
      persistenceRowsWritten: persistence.rowsWritten,
    }
  } finally {
    session.close()
  }
}
