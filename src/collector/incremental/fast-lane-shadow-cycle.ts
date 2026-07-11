import { XrplJsonRpcClient } from '../network/xrpl-rpc'
import type { RuntimeConfig } from '../../shared/runtime-config'
import type { FastLaneShadowRuntimeConfig } from '../../shared/fast-lane-shadow-runtime-config'
import { buildFastLaneShadowWindowPlan } from './fast-lane-shadow-plan'
import { fastLaneShadowReanchorReason } from './fast-lane-shadow-reanchor'
import { scanValidatedLedgerRange } from './scan-validated-ledgers'
import { createXrplWebSocketLedgerSession } from './xrpl-websocket-ledger-session'
import {
  commitFastLaneCompactShadowWindow,
} from '../../worker/repositories/fast-lane-compact-shadow-repository'
import {
  readFastLaneShadowState,
} from '../../worker/repositories/fast-lane-shadow-repository'

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

export async function readFastLaneValidatedHead(options: {
  endpoint: string
  timeoutMs: number
}): Promise<ValidatedHead> {
  const client = new XrplJsonRpcClient({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
  })
  const result = await client.call<Record<string, unknown>>('ledger', {
    ledger_index: 'validated',
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
  return { ledgerIndex, ledgerHash }
}

export async function resetFastLaneCompactShadow(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM fast_lane_shadow_commit_guards'),
    db.prepare('DELETE FROM fast_lane_shadow_windows'),
    db.prepare('DELETE FROM fast_lane_shadow_objects_compact'),
    db.prepare('DELETE FROM fast_lane_shadow_state'),
  ])
}

export async function runFastLaneShadowCycle(options: {
  db: D1Database
  runtimeConfig: RuntimeConfig
  fastLaneConfig: FastLaneShadowRuntimeConfig
  now?: () => Date
}): Promise<FastLaneShadowCycleResult> {
  const now = options.now ?? (() => new Date())
  const processedAt = now().toISOString()
  const endpoint = options.runtimeConfig.xrplRpcUrls[0]
  if (!endpoint) throw new Error('Fast-lane shadow requires a Devnet RPC endpoint')

  const head = await readFastLaneValidatedHead({
    endpoint,
    timeoutMs: options.runtimeConfig.rpcTimeoutMs,
  })
  let state = await readFastLaneShadowState(options.db)
  let reanchored = false

  const reanchorReason = fastLaneShadowReanchorReason({
    state,
    head,
    expectedEpochId: 'fast-lane-shadow-devnet',
    reanchorLagLedgers: options.fastLaneConfig.reanchorLagLedgers,
  })
  if (reanchorReason !== null) {
    await resetFastLaneCompactShadow(options.db)
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
    : Math.max(1, head.ledgerIndex - options.fastLaneConfig.bootstrapLedgers + 1)
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

    const scan = await scanValidatedLedgerRange({
      endpoint: options.fastLaneConfig.webSocketEndpoint,
      timeoutMs: options.runtimeConfig.rpcTimeoutMs,
      startLedgerIndex,
      latestValidatedLedger: head.ledgerIndex,
      maxLedgers: options.fastLaneConfig.maxLedgersPerRun,
      expectedPreviousHash: previousHash,
      reader: session.reader,
      readWindowSize: options.fastLaneConfig.readWindow,
    })
    const finalLedger = scan.ledgers.at(-1)
    if (!finalLedger) {
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

    const plan = buildFastLaneShadowWindowPlan({
      epochId: 'fast-lane-shadow-devnet',
      scan,
      latestObservedHash: head.ledgerHash,
      processedAt,
    })
    const persistence = await commitFastLaneCompactShadowWindow({
      db: options.db,
      plan,
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
      ledgersProcessed: scan.metrics.ledgers,
      lendingTransactions: plan.lendingTransactions,
      coalescedObjectRows: plan.mutations.length,
      persistenceRowsRead: persistence.rowsRead,
      persistenceRowsWritten: persistence.rowsWritten,
    }
  } finally {
    session.close()
  }
}
